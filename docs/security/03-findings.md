# Annual Function — Security Findings & Remediation

**Assessment date:** 2026-10-30
**Target:** `annual-function` (Next.js 16.4.3, Drizzle, Supabase PostgreSQL)
**Method:** source review, dependency audit, configuration review, local build
and runtime checks. No production data was read or modified.

**Evidence standard.** A finding is marked **Confirmed** only when the code path
or a local HTTP response proved it. Production exploitation was not performed
because no staging database, test family credentials, or OTP mailbox were
provided. Any claim that could not be executed is labelled **Code evidence** or
**Unverified**.

---

## Severity summary

| Severity | Count | Fixed | Partially fixed | Open |
|---|---|---|---|---|
| Critical | 2 | 2 | 0 | 0 |
| High | 5 | 4 | 1 | 0 |
| Medium | 9 | 6 | 1 | 2 |
| Low / Info | 5 | 2 | 0 | 3 |

---

## CRITICAL

### C-01 — Invitation code alone authorized full family data and mutations

**Severity:** Critical · **Confidence:** High (code evidence + local HTTP)
**Affected:**
`web/app/api/invitations/route.ts`,
`web/app/api/guests/route.ts`,
`web/app/api/rsvp/route.ts`,
`web/app/api/tickets/route.ts`,
`web/app/api/agent/route.ts`

**Evidence (pre-fix).** `GET /api/invitations?code=` had no authentication and
returned `studentName`, the full `guests` array, RSVP, and `invitation.qrToken`.
`/api/guests` accepted `code` as the only credential for GET, POST, PATCH and
DELETE. `/api/rsvp`, `/api/tickets?code=` and code-scoped `/api/agent` behaved
the same way.

**Attacker access.** Anyone who saw a printed invitation, a forwarded message,
or a screenshot. No account required.

**Reproduction (pre-fix, staging only).**
`GET /api/invitations?code=<valid-code>` → 200 with student name, guest list and
QR token. `POST /api/guests {code, name}` → 201, adding a guest.

**Impact.** Disclosure of minors' names, classes and guest relationships;
tampering with another family's guest list and RSVP; disclosure of the bearer QR
token enabling **unauthorized admission**; access to support conversations.

**Root cause.** The shareable invitation code was treated as an identity
credential. There was no second factor and no session binding.

**Remediation implemented.**
- Added `POST /api/family/verify/start` and `/confirm` (OTP to a verified
  contact) and a signed, revoked-on-logout, 30-minute family session cookie.
- `requireFamily(code)` now gates every family endpoint and rejects a session
  used with a different code (403).
- `GET /api/invitations` still allows a staff/gate session for the scanner, but
  an anonymous caller receives 401.
- Invitation responses send `Cache-Control: no-store`.

**Regression tests.** `scripts/security-test.mjs` cases 1–7, 14–15; unit tests
for session binding/tampering in `scripts/security-unit-test.mjs`.

**Verification.** Local production server: all anonymous family endpoints now
return 401; cross-family requests return 403 when a family cookie is supplied.
Full DB-backed exploitation was not executed (no staging credentials).

**Residual risk.** A family that completes OTP verification is authorized by
design. A compromised verified chat account can receive the OTP.

---

### C-02 — Next.js 16.3.4 carried critical RCE advisories

**Severity:** Critical · **Confidence:** High (vendor advisory + `npm audit`)
**Affected:** `web/package.json`, `web/package-lock.json`

**Evidence.** `npm audit` reported `next@16.3.4` with
GHSA-vcvr-r3jv-pc5j (“Remote Code Execution in next/og ImageResponse”) plus
SSRF, cache-poisoning and information-disclosure advisories. Fix available in
16.4.3 (non-major).

**Impact.** Depending on the route exercised, unauthenticated RCE or SSRF on the
deployment host.

**Remediation.** Upgraded `next` and `eslint-config-next` to `16.4.3`, ran
`npm audit fix`, rebuilt. `npm audit` now reports **0 critical / 0 high**.

**Verification.** `npm audit` → 4 moderate, all dev-only `drizzle-kit`/`esbuild`.
`npm run build` succeeds on 16.4.3.

**Residual risk.** Dev-only esbuild dev-server advisory; not shipped to
production. Upgrading `drizzle-kit` is a breaking change and was not forced.

---

## HIGH

### H-01 — QR bearer token disclosed by a public endpoint

**Severity:** High · **Confidence:** High
**Affected:** `web/app/api/invitations/route.ts`

**Evidence.** The public lookup returned `qrToken`, the exact value encoded in
the admission QR (`components/invitation/QrCard.tsx`).

**Impact.** Copy the token, print it, and enter the venue as that family. The QR
is intentionally a bearer credential, so disclosure is equivalent to handing
over the pass.

**Remediation.** Token is only returned inside a verified family session or a
staff/gate scanner session. Admission still requires a gate session.

**Verification.** Anonymous `GET /api/invitations?code=` → 401.

**Residual risk.** A verified family can still share its own QR. Per-guest
duplicate prevention limits replay; it cannot stop a first fraudulent entry.

---

### H-02 — No second factor; code reusable as a permanent credential

**Severity:** High · **Confidence:** High
**Affected:** family API surface (same files as C-01)

**Evidence.** Possession of `code` was sufficient forever; there was no OTP,
session, expiry or revocation.

**Remediation.** Code → OTP to a school-verified contact → 30-minute family
session. Session rotation on every verification, server-side revocation,
`SameSite=Strict` + `HttpOnly` + `Secure` cookie. The code alone cannot mutate
anything.

**Verification.** OTP primitives unit-tested (generation, HMAC binding, expiry,
single-use logic); live end-to-end OTP not executed without a test mailbox.

**Residual risk.** Delivery depends on WhatsApp/Telegram provider configuration;
if no verified contact exists, the family must use admin-approved recovery.

---

### H-03 — In-memory rate limiting was ineffective on serverless

**Severity:** High · **Confidence:** High
**Affected:** `web/app/api/auth/route.ts`, `web/app/api/agent/route.ts`,
`web/lib/server/invitation-recovery.ts` (already DB-backed)

**Evidence.** `const attempts = new Map()` and `const requests = new Map()` are
per-instance and reset on cold start. Vercel runs multiple instances, so an
attacker can spread attempts.

**Impact.** Staff sign-in brute force and helpdesk/OTP abuse throttling could be
bypassed by concurrency or instance rotation.

**Remediation.**
- New `family_rate_limits` table + atomic upsert limiter
  (`web/lib/server/rate-limit.ts`).
- Staff sign-in: DB limiter (10/15 min per IP) with a memory fallback only when
  the DB is unavailable.
- OTP start/confirm: per-IP and per-code buckets.
- Keys are HMACed before storage (no raw IPs).

**Verification.** Unit tests cover key stability/non-reversibility; the limiter
SQL is exercised only with a database (not available locally).

**Residual risk.** `/api/agent` still uses a memory limiter for anonymous
general questions; it is not security-critical (no mutation without a session).

---

### H-04 — Telegram webhook accepted unsigned updates in production

**Severity:** High · **Confidence:** High
**Affected:** `web/app/api/telegram/webhook/route.ts`

**Evidence.** `if (secret && header !== secret)` skipped validation entirely
when `TELEGRAM_WEBHOOK_SECRET` was unset, including in production.

**Impact.** A forged update could drive the chat agent: create tickets, trigger
identity lookups, upload photos, and send messages to arbitrary chat IDs.

**Remediation.** Production now returns 503 when the secret is unset; the
header must match otherwise. Local development keeps the permissive path.

**Verification.** Code review + build. A production request without a configured
secret now fails closed.

**Residual risk.** Deployment must set the secret; the new behavior makes
misconfiguration visible rather than silently insecure.

---

### H-05 — Chat identity recovery delivers the QR pass after three semi-public fields

**Severity:** ~~High (residual)~~ **Closed** · **Confidence:** High
**Affected:** `web/lib/server/invitation-recovery.ts`,
`web/lib/server/whatsapp/handler.ts`,
`web/lib/server/telegram/handler.ts`,
`web/lib/server/delivery.ts`

**Evidence.** `identityMatches` compares admission number, full name and class;
on success the handler builds and sends the PDF containing the QR token. These
three fields are often known to classmates and are not secrets.

**Impact.** A person who knows a student's admission number, name and class and
controls a chat account can receive that family's QR pass.

**Status: fixed in this pass.** Recovery now returns an explicit
`passReleaseAllowed` flag, computed from the presence of an
administrator-approved `family_contacts` row. Both chat handlers and
`deliverInvitation` refuse to send the PDF unless that flag is exactly `true`
(fail-closed: a missing flag denies). A recovered family receives only the
reference code and a portal link, and the pass itself sits behind the OTP check
in the browser. Regression tests: `whatsapp-handler-test.mjs` ("never sends the
QR pass when the contact is not school-verified", "fails closed when the
recovery result omits the trust flag").

**Remaining risk.** A family with no admin-approved contact can no longer
receive a pass over chat. This is intentional — staff register the contact in
**Verify a family** (`/admin` → Verify a family →
`POST /api/family/contact`). During onboarding that is an operational task for
467 families.

**Residual note (historical).** The original remediation left this open; the
flag-based fix closes the pass-delivery path, and M-09 (below) closes the
matching OTP-delivery path.

**Verification.** Behaviour covered by unit tests (see above); the full chat
round trip still needs real provider credentials to exercise end to end.

---

## HIGH

### H-06 — Core tables had no RLS, leaving the Supabase Data API open to the client key

**Severity:** High · **Confidence:** High (code + migration evidence; live
project setting not verifiable without console access)
**Affected:** `web/drizzle/migrations/0000_melted_veda.sql`,
`/0008…0011`, new `/0012_data_api_lockdown.sql`

**Evidence.** Only five *auxiliary* tables had RLS enabled
(`event_documents`, `invitation_lookup_limits`, `whatsapp_sessions`, and the
five verification tables in `0004`). The six tables carrying the actual
sensitive data — `students`, `invitations`, `guests`, `check_ins`,
`support_tickets`, and later `photos`, `deliveries`, `announcements`,
`invitation_contacts` — had **no RLS and no REVOKE**. A stock Supabase project
grants `anon` and `authenticated` full access to `public`, so the public anon
key could read `invitations.qr_token` (bearer admission), `students.phone` and
`students.email` through `https://<project>.supabase.co/rest/v1/…`.

**Impact.** Where a project retains the default grants, every OTP and session
control in the application is irrelevant: the Data API is a second, unguarded
door to the same rows.

**Verification of the mitigating factor.** The application does not currently
ship the anon key to the browser — `createClient` is only imported in
server-side modules (`lib/server/auth.ts`, `lib/server/storage.ts`) and no client
component reads it. `scripts/bundle-secrets-test.mjs` now asserts that no
server-only secret name or JWT material reaches `.next/static`.

**Remediation (implemented).** `0012_data_api_lockdown.sql` enables RLS on all
twenty tables with **no policies** (deny-by-default for non-owners), revokes
`ALL` from `anon`/`authenticated`, revokes sequence access, and adds
`ALTER DEFAULT PRIVILEGES` so a future migration cannot silently re-open the
Data API. Every role-specific statement is guarded by a `pg_roles` existence
check, so it also runs cleanly on a plain PostgreSQL instance.

**Not verified.** The migration could not be executed here — no PostgreSQL or
Docker is available in this environment. It must be applied and then confirmed
from a browser using the anon key:
`GET /rest/v1/invitations?select=qr_token` must return an error or an empty set.

**Residual risk.** RLS is irrelevant to the app's own privileged connection, so
this is defence in depth for the Data API surface only.

---

## MEDIUM

### M-01 — Code-scoped AI helpdesk exposed guest list, RSVP and tickets

**Severity:** Medium · **Confidence:** High
**Affected:** `web/app/api/agent/route.ts`, `web/lib/server/helpdesk.ts`
**Evidence.** With only `code`, the agent tools `list_my_guests`,
`check_ticket_status`, `set_rsvp` and `get_invitation` operated on that family.
**Remediation.** `if (code) await requireFamily(code)` before the agent runs.
**Verification.** Anonymous `POST /api/agent {code}` → 401.

### M-02 — Support history disclosed with an invitation code

**Severity:** Medium · **Confidence:** High
**Affected:** `web/app/api/tickets/route.ts`
**Evidence.** `GET /api/tickets?code=` resolved the student and returned every
ticket plus the student's name and admission number.
**Remediation.** Family session required for the `code` path; staff path
unchanged.
**Verification.** Anonymous request → 401.

### M-03 — Missing CSP, HSTS and Permissions-Policy

**Severity:** Medium · **Confidence:** High
**Affected:** `web/next.config.ts`
**Evidence.** Only `Referrer-Policy`, `nosniff` and `X-Frame-Options` were set.
**Remediation.** Added a restrictive CSP (self-only sources, `frame-ancestors
'none'`, `object-src 'none'`), HSTS in production, COOP/CORP, and a
Permissions-Policy that allows the camera only for the scanner.
**Residual risk.** Next.js inline scripts require `script-src 'unsafe-inline'`;
a nonce-based policy via `proxy.ts` is the next hardening step.

### M-04 — No database uniqueness backstop for admissions

**Severity:** Medium · **Confidence:** Medium
**Affected:** `web/lib/db/queries.ts`, migration `0004`
**Evidence.** Duplicate prevention relied on the invitation row lock plus a
read-then-insert. Correct today, but a future code path could bypass it.
**Remediation.** Partial unique index `check_ins_guest_unique` on
`check_ins(guest_id) WHERE guest_id IS NOT NULL`; migration reports legacy
duplicates instead of failing.
**Verification.** DDL reviewed; not applied locally (no database).

### M-05 — No audit trail for sensitive actions

**Severity:** Medium · **Confidence:** High
**Affected:** new `security_audit_log`, `web/lib/server/audit.ts`
**Evidence.** Admissions stored `checked_in_by`, but guest edits, RSVP, ticket
creation, OTP lifecycle and sessions had no actor record.
**Remediation.** Append-only audit records for OTP issued/verified/failed,
session revoked, guest create/update/delete, RSVP, ticket creation, admission,
contact changes and staff sign-in. No OTPs or tokens are written.
**Residual risk.** Audit table is not yet exposed to staff or shipped to an
external SIEM; retention is undefined.

### M-06 — Long privileged session and no MFA

**Severity:** Medium · **Confidence:** High
**Affected:** `web/app/api/auth/route.ts`, `web/lib/server/auth.ts`
**Evidence.** Access-key sessions lasted 8 hours; a single shared key grants
administrator access; no MFA.
**Remediation (partial).** Reduced to 4 hours; audit records sign-in. MFA /
passkeys for administrators and per-user keys are recommended but not
implemented (product/infra decision).
**Residual risk.** A leaked `ADMIN_ACCESS_KEY` remains a full compromise until
rotated.

### M-07 — Vulnerable dependencies (high)

**Severity:** Medium · **Confidence:** High
**Affected:** `package-lock.json`
**Evidence.** `sharp` (librsvg), `source-map-js` (event-loop DoS) and
`brace-expansion` (stack exhaustion) were high.
**Remediation.** `npm audit fix` upgraded them within range; `sharp` is now
0.35.5, `next` 16.4.3. Remaining 4 moderate are dev-only `drizzle-kit`→`esbuild`.
**Residual risk.** Forced fix would downgrade `drizzle-kit` (breaking). Track
upstream.

### M-08 — Sensitive responses were cacheable

**Severity:** Medium · **Confidence:** Medium
**Affected:** invitation/guest/ticket/session routes
**Evidence.** No `Cache-Control` on family JSON.
**Remediation.** `Cache-Control: no-store` on sensitive responses.
**Residual risk.** CDN/proxy configuration should also be checked in the Vercel
project.

### M-09 — Verification contact bootstrap depends on identity recovery

**Severity:** ~~Medium~~ **Closed (raised to High pre-fix)** · **Confidence:** High
**Affected:** `web/lib/server/family-verification.ts`,
`web/lib/security/family.ts`, `web/lib/server/delivery.ts`

**Evidence.** The OTP destination came from `family_contacts` (admin) *or*
`invitation_contacts` (captured when a chat session passed identity recovery).

**Impact.** This was worse than the original Medium rating. The two bugs
composed into a complete bypass of the second factor:

1. An attacker who knows a student's admission number, full name and class
   messages the bot, passes the identity check, and `recordContact` writes
   **their own** WhatsApp/Telegram address into `invitation_contacts` for that
   invitation code.
2. `resolveVerifiedContact` then treated that row as a verified contact, so
   `POST /api/family/verify/start` delivered the OTP **to the attacker**.
3. The attacker redeems it and receives a full family session — student name,
   guest list, RSVP, and the bearer QR token — from a browser, with no access to
   the real family's phone at all.

So the "possession factor" was really a knowledge factor plus attacker-chosen
delivery, defeating the entire OTP design.

**Remediation (implemented).** Contact trust is now an explicit, single-source
policy in `lib/security/family.ts`:

```ts
export const OTP_TRUSTED_SOURCES = ["admin_approved"] as const;
export function isOtpTrustedSource(source) { /* only admin_approved */ }
```

`resolveVerifiedContact` returns a `trusted` flag, and
`startFamilyVerification` refuses to issue or send a code when it is false —
responding with the same uniform `contact_teacher` message, so nothing is
learnable. `invitation_contacts` is still used for *messaging* (announcements,
replies), but it is never an authentication anchor.

**Regression tests.** `security-unit-test.mjs` — "only school-verified contacts
can receive an OTP", "QR passes are released only to a verified contact".

**Operational impact (requires a human decision).** No roster phone numbers
exist in the data, so `invitation_contacts` was the only populated source. Under
the new policy every family needs a staff-approved contact before it can
self-verify. The admin UI now provides this: **Verify a family** in `/admin`
(`components/admin/FamilyVerification.tsx` → `POST|DELETE /api/family/contact`,
admin-only). Onboarding 467 families is an event-operations task, not a code
change.

**Residual risk.** Staff approve a phone number by hand, so a typo or a social
engineering request could still bind the wrong destination. Mitigations:
admin-only, audited (`family_contact.upserted`), and removable at any time.

---

## LOW / INFORMATIONAL

### L-01 — Error mapping can echo domain messages
`fail()` maps `/not found|Invalid QR/` to 404 and several phrases to 409,
returning the message. No SQL or stack traces were found; Drizzle parameterizes
all reviewed queries. **Info.** Keep messages domain-level.

### L-02 — `dangerouslySetInnerHTML` in the announcement preview
`components/admin/Outreach.tsx` escapes the input before applying bold/list
markup. User HTML cannot execute. **Info / no change.**

### L-03 — `sameOrigin` allows requests without an `Origin` header
CSRF protection relies on `SameSite=Strict` cookies plus the origin check when
present. Non-browser clients legitimately omit `Origin`. **Low.** A stricter
`Sec-Fetch-Site` check can be added when all clients are browsers.

### L-04 — No data-retention or deletion workflow
Guest lists, tickets, photos and audit records have no retention policy.
**Info.** Define retention before the event and delete after the academic year.

### L-05 — Rate-limit table growth
`family_rate_limits` and audit rows grow without partitioning; the limiter
deletes buckets older than one day opportunistically. **Info.** Add a scheduled
cleanup for audit retention.

---

## Fixes that require a human decision or external access

| Item | Why it is not fully fixed |
|---|---|
| H-05 chat pass delivery | Needs a product decision on a second channel or staff approval for first-time recovery. |
| M-06 admin MFA/passkeys | Requires identity-provider configuration and a UX change. |
| M-09 first-contact approval | Needs an operational policy for 467 families. |
| Production deployment checks | Vercel env vars, Supabase RLS/Data API review, and secret rotation require console access. |
| Live OTP end-to-end | Requires a staging DB, seeded synthetic families, and a test WhatsApp/Telegram inbox. |
