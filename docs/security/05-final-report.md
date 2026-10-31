# Annual Function — Final Security Assessment & Remediation Report

**Date:** 2026-10-30
**Application:** `annual-function` — https://annual-five.vercel.app
**Repository:** https://github.com/akyourowngames/annual-function
**Assessor role:** Application security / penetration testing / remediation
**Environment used:** local build and local production server (`next start`,
`http://localhost:3105`). **No production data was read or modified.**

---

## 1. Deliverables

| # | Deliverable | Location |
|---|---|---|
| 1 | Attack-surface inventory | `docs/security/01-attack-surface.md` |
| 2 | Threat model (adversaries A–L) | `docs/security/02-threat-model.md` |
| 3 | Prioritized findings report | `docs/security/03-findings.md` |
| 4 | OTP + invitation verification architecture | `docs/security/04-family-verification.md` |
| 5 | Implemented remediation | `web/lib/security/`, `web/lib/server/`, `web/app/api/family/`, route hardening |
| 6 | Database migration | `web/drizzle/migrations/0004_family_verification.sql` |
| 7 | Automated security regression tests | `web/scripts/security-unit-test.mjs`, `web/scripts/security-test.mjs` |
| 8 | Dependency / deployment findings | `03-findings.md` (C-02, M-03, M-07, section 10) |
| 9 | Additional measures + rationale | `03-findings.md`, `04-family-verification.md` §9–10 |
| 10 | This report | `docs/security/05-final-report.md` |

---

## 2. What was tested

### Executed

| Check | Command | Result |
|---|---|---|
| Type checking | `npx tsc --noEmit` | ✅ passed |
| Lint | `npm run lint` | ✅ 0 errors, 1 pre-existing warning (`whatsapp-test.mjs` unused import) |
| Production build | `npm run build` | ✅ Next.js 16.4.3, 24 routes |
| Security unit tests | `node --test scripts/security-unit-test.mjs` | ✅ 11/11 passed |
| Full unit suite | 11 files incl. the new security tests | ✅ 99/99 passed |
| Live unauthenticated regression | `TEST_BASE_URL=http://localhost:3105 node scripts/security-test.mjs` | ✅ 15 passed, 0 failed, 4 skipped (need staging DB + cookies) |
| Dependency audit | `npm audit` | ✅ 0 critical, 0 high; 4 moderate dev-only (`drizzle-kit`→`esbuild`) |

### Reviewed statically

All API routes, auth/roles, Drizzle schema and queries, invitation/QR code
generation, admission transaction, OTP-related new code, webhook signature
checks, Supabase usage, file upload limits, environment handling, security
headers, CI workflow, and the portal/admin/gate client flows.

### Not executed (and why)

- **End-to-end OTP delivery and redemption** — no staging database, no seeded
  synthetic families, no test WhatsApp/Telegram inbox. Executing it would send a
  real message or require production credentials.
- **Database migration** — no `DATABASE_URL`/`.env.local` was provided. The SQL
  is written to be idempotent and was reviewed, not applied.
- **True IDOR/admission concurrency tests** — need two synthetic family sessions
  and a seeded event database. Those cases are encoded in
  `scripts/security-test.mjs` and will run when cookies are supplied.
- **Production configuration** (Vercel env, Supabase RLS/Data API, backups,
  domain/CORS) — requires console access and is explicitly out of the
  non-destructive scope.
- **Chat identity-recovery exploitation** — requires real WhatsApp/Telegram
  provider credentials and a real student record.

---

## 3. Confirmed vulnerabilities

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-01 | Critical | Invitation code alone authorized full family data (student name, guest list, QR token) and guest/RSVP/ticket mutations. | **Fixed** |
| C-02 | Critical | Next.js 16.3.4 critical RCE/SSRF advisories. | **Fixed** (16.4.3) |
| H-01 | High | Public lookup disclosed the bearer QR token → copied-pass admission. | **Fixed** |
| H-02 | High | No second factor; code was a permanent credential. | **Fixed** (OTP + session) |
| H-03 | High | In-memory rate limits bypassable across serverless instances. | **Fixed** (DB limiter) |
| H-04 | High | Telegram webhook skipped validation when its secret was unset, including production. | **Fixed** (fail closed) |
| H-05 | High | Chat identity recovery (admission no. + name + class) sends the QR pass. | **Partially fixed / accepted residual** |
| M-01 | Medium | Code-scoped AI helpdesk exposed guests, RSVP and tickets. | **Fixed** |
| M-02 | Medium | Support history exposed with an invitation code. | **Fixed** |
| M-03 | Medium | Missing CSP/HSTS/Permissions-Policy. | **Fixed** (CSP allows inline scripts) |
| M-04 | Medium | No DB uniqueness backstop for per-guest admission. | **Fixed** (migration) |
| M-05 | Medium | No audit trail for sensitive actions. | **Fixed** |
| M-06 | Medium | 8-hour shared admin key, no MFA. | **Partially fixed** (4 h + audit) |
| M-07 | Medium | High-severity dependency advisories (`sharp`, `source-map-js`, `brace-expansion`). | **Fixed** (`npm audit fix`) |
| M-08 | Medium | Sensitive JSON responses cacheable. | **Fixed** (`no-store`) |
| M-09 | Medium | OTP contact bootstrap relies on identity recovery / admin approval. | **Mitigated + documented** |
| L-01–L-05 | Low/Info | Error mapping, safe `dangerouslySetInnerHTML`, origin check, retention, limiter growth. | **Documented** |

The complete evidence, reproduction steps and residual risk for each item are in
`03-findings.md`.

---

## 4. What was implemented

### 4.1 Two-factor family verification

- `POST /api/family/verify/start` — validates the code, resolves a **verified**
  contact, issues a crypto-random 6-digit OTP (5-minute TTL), stores only a
  keyed HMAC + per-challenge salt, enforces resend cooldown, invalidates older
  challenges, audits, and returns a uniform anti-enumeration response.
- `POST /api/family/verify/confirm` — strict OTP parsing, atomic attempt
  counting, constant-time comparison, single-use consumption under concurrency,
  session rotation, audit.
- `GET/DELETE /api/family/session` — resume or revoke.
- `POST/DELETE /api/family/contact` — **admin-only** recovery contact
  registration/removal.

### 4.2 Session hardening

- `annual_family` cookie: HttpOnly, Secure in production, SameSite=Strict,
  30-minute expiry.
- Signed token bound to `sid`, `invitationId`, `code`, `scope`.
- Server-side `family_sessions` row for revocation; previous sessions revoked on
  every new verification.
- `requireFamily(code)` enforces the exact invitation binding on every request.

### 4.3 Authorization changes

- `/api/invitations` GET: family session **or** staff/gate scanner; anonymous →
  401.
- `/api/guests` GET/POST/PATCH/DELETE: family session required.
- `/api/rsvp`: family session required.
- `/api/tickets` code path: family session required; staff path unchanged.
- `/api/agent` with `code`: family session required.

### 4.4 Abuse, audit and infrastructure

- DB-backed shared rate limiter (`family_rate_limits`); staff sign-in 10/15 min,
  OTP start/confirm per IP and per code.
- Append-only `security_audit_log` for OTP lifecycle, sessions, guest mutations,
  RSVP, tickets, admissions, contact changes and staff sign-in.
- Telegram webhook fails closed in production without its secret.
- Security headers: CSP, HSTS (prod), COOP/CORP, Permissions-Policy,
  no-referrer, nosniff, frame denial.
- `Cache-Control: no-store` on sensitive responses.
- Next.js upgraded to 16.4.3; high-severity dependencies upgraded.

---

## 5. Test results

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| Security unit tests | 11 | 0 | 0 |
| Complete unit suite | 99 | 0 | 0 |
| Live unauthenticated regression | 15 | 0 | 4 |
| TypeScript | ✅ | — | — |
| Lint | ✅ (1 warning) | — | — |
| Build | ✅ | — | — |
| Dependency audit | 0 critical / 0 high | 4 moderate (dev) | — |

The 4 skipped live cases require staging data and cookies:

1. Invalid-code response after the verification schema is migrated.
2. Family A → own invitation (200) and Family A → Family B (403).
3. Gate keeper → admin dashboard (403).
4. Staff → admin dashboard (200).

They are implemented in `scripts/security-test.mjs` and are **not** claimed as
passing.

---

## 6. Residual risks

1. **Chat pass delivery (H-05).** A person who knows admission number, full name
   and class and controls a chat account can still receive the QR PDF. The web
   channel now requires OTP; the chat channel does not add a second factor
   because the OTP would go to the same chat.
2. **Bearer QR.** A verified family can screenshot/share its pass. Per-guest
   duplicate prevention stops reuse of the same guest row but cannot stop a
   first fraudulent entry.
3. **Staff account compromise.** A leaked `ADMIN_ACCESS_KEY` or staff password
   still grants broad access. No MFA/passkeys; sessions last 4 hours.
4. **Deployment configuration.** Vercel env vars, Supabase Data API exposure,
   backups, and secret rotation were not inspected from the console.
5. **CSP.** `script-src 'unsafe-inline'` is required by Next.js inline bootstrap
   scripts. A nonce-based policy via `proxy.ts` is the next step.
6. **Provider dependency.** OTP delivery depends on WhatsApp template/session
   rules and Telegram bot permissions. Delivery failure degrades to the
   admin-approved recovery path.
7. **Audit retention/monitoring.** The audit table is written but not yet
   surfaced to staff or shipped to an external monitor.
8. **Dev-only advisories.** `drizzle-kit` → `esbuild` (4 moderate) remain;
   fixing them requires a breaking downgrade and they do not ship to production.

---

## 7. Requires human approval or external access

| Action | Why |
|---|---|
| Apply `0004_family_verification.sql` to staging, then production | Schema change on live data; verify the unique index and resolve any duplicate check-ins. |
| Set `FAMILY_SESSION_SECRET`, `FAMILY_OTP_SECRET`, `TELEGRAM_WEBHOOK_SECRET` in Vercel | Secret configuration and rotation. |
| Register verified contacts for families without a chat session | Operational data entry (`POST /api/family/contact`). |
| Run `test:security:live` against staging with two synthetic families | Needs seeded DB + real cookies. |
| Send one real OTP to a controlled test inbox | External messaging side effect. |
| Enable MFA/passkeys for administrators; rotate `ADMIN_ACCESS_KEY` | Identity-provider and operational decision. |
| Review Supabase RLS/Data API, storage bucket policies, backups | Console access. |
| Decide the H-05 chat policy (second channel vs staff approval) | Product/operational decision. |

---

## 8. Next three highest-priority actions

1. **Deploy the migration and secrets, then run the staging verification flow
   end-to-end with two synthetic families.** Confirm: code alone → 401; OTP
   wrong/expired/reused → rejected; Family A cannot read Family B (403);
   concurrent OTP redemption yields one session; gate cannot open admin.
2. **Close the chat pass-delivery gap (H-05).** Either require an
   admin-approved contact on a different channel before the first PDF, or hold
   first-time chat recovery for staff approval. Until then, treat chat-recovered
   passes as lower assurance.
3. **Harden staff identity.** Enforce MFA/passkeys for `admin`, issue per-person
   credentials instead of a shared `ADMIN_ACCESS_KEY`, shorten privileged
   sessions further, and alert on bulk exports/messaging and repeated
   `staff.login_failed`.

---

## 9. Bottom line

The practical, code-confirmed attack path that mattered most — **“see a code,
own the family”** — is closed. Family data and guest mutations now require an
OTP delivered to a school-verified contact, sessions are short-lived and
revocable, cross-family access is rejected, admission has a database uniqueness
backstop, and sensitive actions are audited. The production build, type check,
lint, 99 unit tests and 15 live unauthenticated checks pass.

The application is **not** claimed to be unhackable. The largest remaining risks
are the chat-channel pass delivery, bearer-QR sharing, and staff account
compromise — all documented above with concrete next steps.
