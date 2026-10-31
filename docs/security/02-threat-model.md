# Annual Function — Threat Model

**Method:** asset-driven, adversary-per-persona. Each threat lists required
attacker capability, the attack path considered, the protections that existed
before remediation, the gap, impact, and the mitigation now in place.

Severity reflects **pre-remediation** risk. Current status is in the last column
and detailed evidence is in `03-findings.md`.

| ID | Adversary | Assets | Required capability | Attack path (pre-remediation) | Existing protection | Missing | Impact | Mitigation | Status |
|---|---|---|---|---|---|---|---|---|---|
| A | Outsider with a leaked invitation code | Student name, guest list, QR pass, RSVP, support history | See a printed/shared code | `GET /api/invitations?code=` returned everything incl. `qrToken`; `/api/guests` allowed read/write; `/api/rsvp`; `/api/tickets?code=` | Code entropy (80 bits) | Code treated as identity | Full family data disclosure, guest tampering, **unauthorized admission via copied QR** | OTP to verified contact → short-lived family session; code alone → 401; cross-family → 403 | Fixed |
| B | Person guessing invitation codes | Family data | Online guessing | Brute-force `ANL-…` codes against public lookup | 80-bit random codes | No rate limit on invitation lookup (`/api/invitations`), only recovery | Practically infeasible to guess one code; still unsafe at scale | Codes unchanged (80 bits) + verification start/confirm rate limits; lookup requires session | Fixed (defence in depth) |
| C | Guest modifying another family's invitation | Another family's guest list/RSVP | A valid code for their own family + another family's code or guest UUID | Supply victim `code` or `guestId` to `/api/guests` / `/api/rsvp`; `updateGuest`/`removeGuest` filter by invitation so UUID alone failed, but code-only auth meant any valid code worked for that code | Guest UUID ownership check inside transaction | No session binding | Unauthorized edits/deletions for any family whose code leaked | `requireFamily(code)` binds session to invitation; mutations additionally keep the ownership check | Fixed |
| D | Attacker copying a QR pass | Admission | Photograph/forward a QR | QR token was returned by a public endpoint; QR is a bearer credential | Opaque 122-bit token | Token disclosure + no session gate | Unauthorized entry; duplicate entry | Token only in verified family session or staff scanner; per-guest duplicate prevention + unique index; audit | Fixed (bearer risk documented) |
| E | Unauthenticated visitor hitting staff endpoints | Roster, admissions, messaging | Network access | Call `/api/admin`, `/api/check-in`, `/api/announcements`, `/api/album`, `/api/knowledge`, `/api/admin/deliver` | `requireStaff`/`requireCheckIn` on every staff route | — | — | Verified by regression suite (401) | Already adequate |
| F | Gate worker performing admin actions | Roster configuration, secrets, bulk messaging | Gate access key / gate account | Call admin-only routes with a `gate` session | `requireStaff(true)` = admin only; `requireStaff()` = admin/staff; gate excluded | — | — | Verified: gate → `/api/admin` 403 | Already adequate |
| G | Malicious user manipulating browser requests | Any family data | Code + browser devtools | Bypass frontend validation; craft JSON | Server validation (`text`, `integer`, `uuid`), DB constraints | Same as A (no session) | Guest-limit bypass, cross-family edits | Session enforcement server-side; guest limit in transaction; type/length validation; `sameOrigin` | Fixed |
| H | Concurrent requests bypassing guest/admission limits | Guest limit, admission integrity | Parallel requests | Fire N `POST /api/guests` or `/api/check-in` simultaneously | `SELECT … FOR UPDATE` on invitation row; transaction | No DB uniqueness on `check_ins.guest_id`; rate limits in memory | Over-admission / over-registration | Row lock retained; partial unique index added; shared DB rate limits | Fixed |
| I | Exposed env vars / API keys / DB permissions | Entire database, messaging, LLM | Read client bundle, repo, error pages, Supabase Data API | Secrets in `NEXT_PUBLIC_*`; default RLS; public tables | Only Supabase URL + anon key are public; service-role server-only; `.env*` ignored | New verification tables could be exposed via Data API; no secret scanning in CI | Full compromise | New tables: RLS enabled + `REVOKE` from `anon`/`authenticated`; `error` responses generic; add secret scanning recommendation | Partially fixed (deployment review pending) |
| J | Malicious/compromised staff account | Roster, admissions, family data | Valid staff credentials | Bulk export, bulk messaging, guest-limit changes, album access | Role checks, audit trail (new) | No MFA, 4-hour access-key session, no anomaly alerts | Data exfiltration, mass messaging, admission fraud | Audit trail + shorter session; MFA/passkeys and export restrictions recommended | Partially mitigated |
| K | OTP delivery/verification abuse | Messaging budget, family accounts | Trigger OTP sends / guess OTPs | OTP spam, brute force, replay, cross-invitation reuse | (new) | — | SMS/WhatsApp cost, account takeover | 5-min TTL, 5 attempts, per-challenge binding, single use, resend 60s, per-IP + per-code rate limits, no plaintext storage | New control (design) |
| L | File upload / injection / redirect / dependency attacks | Server, DB, users | Upload or crafted input | 15 MB knowledge upload; chat photo upload; XSS; SQLi; SSRF; open redirect | File type allow-list + size cap; Drizzle parameterization; React escaping; no `dangerouslySetInnerHTML` on user HTML; `sameOrigin` | No CSP; Next.js critical RCE advisories; dependency highs | RCE, XSS, data disclosure | CSP/HSTS headers; Next.js 16.4.3; audit triage; upload type/size checks retained | Partially fixed (see findings) |

---

## Assets and impact ranking

1. **Admission integrity** — a forged or copied pass admits an unauthorized
   person; a bypassed limit overfills the venue.
2. **Student/family privacy** — names, classes, phone numbers, guest lists,
   support conversations, photos of minors.
3. **Account takeover** — family sessions (guest/RSVP control) and staff
   sessions (full roster, bulk messaging, admissions).
4. **Database compromise** — service-role key or `DATABASE_URL` leak.
5. **Messaging abuse** — OTP/announcement flooding, cost, harassment.
6. **Availability** — build/deployment, rate-limit exhaustion, large uploads.

---

## Trust assumptions that are now explicit

- The invitation code is a **lookup identifier**, not an identity credential.
- The QR token is a **bearer admission credential**; possession is authorization
  at the gate, so it is only disclosed to a verified family or staff scanner.
- A verified contact is one the school established through an admin action or an
  identity-checked chat session. A number supplied in a web form is never
  trusted.
- RLS does not protect the app's privileged Postgres connection; server-side
  authorization and DB constraints are the real controls.
- Gate keepers are trusted for admission display/recording only, not for roster
  or messaging administration.
