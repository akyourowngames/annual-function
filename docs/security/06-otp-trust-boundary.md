# 06 — Second-pass remediation: OTP trust boundary

**Date:** 2026-10-30
**Scope:** closing the two findings the first pass left open (`H-05`, `M-09`) plus
the database exposure it deferred to console access (`H-06`).
**Environment:** local build, typecheck, lint, unit tests. **No production data
was read or modified.**

---

## 1. The flaw that mattered: the OTP factor was not a possession factor

The first pass implemented a genuinely careful OTP design — HMAC-stored codes,
per-invitation binding, 5-minute expiry, atomic single-use redemption, attempt
caps, revocable server-side sessions. All of that was correct. The problem was
**who the code was sent to**.

```
attacker knows: admission number + full name + class      (classmates have this)
        │
        ├─► messages WhatsApp/Telegram bot, passes identityMatches
        │        └─► recordContact() writes THE ATTACKER's address
        │             into invitation_contacts for that code
        │
        ├─► POST /api/family/verify/start { code }
        │        └─► resolveVerifiedContact() returns that row as "verified"
        │             → OTP delivered to the attacker's own phone
        │
        └─► POST /api/family/verify/confirm { code, otp }
                 └─► full family session: student name, guest list, RSVP,
                     and the bearer QR token
```

Every control worked as designed; the factor was simply self-asserted. This is
why the brief's instruction — *"Do not send verification codes to a phone number
supplied by an unverified visitor and treat that as identity verification"* —
is the crux of the whole design.

A second, independent variant: both chat handlers sent the **QR pass PDF**
immediately on an identity match, with no OTP at all.

---

## 2. What changed

| File | Change |
|---|---|
| `lib/security/family.ts` | New pure policy: `OTP_TRUSTED_SOURCES = ["admin_approved"]`, `isOtpTrustedSource()`, `mayReceiveQrPass()`. One place, unit-testable, no DB. |
| `lib/server/family-verification.ts` | `resolveVerifiedContact` returns `trusted`; `startFamilyVerification` refuses to issue/deliver a code when untrusted, returning the same uniform `contact_teacher` message (no new enumeration signal). |
| `lib/server/invitation-recovery.ts` | Returns `passReleaseAllowed`, computed from the existence of a staff-approved `family_contacts` row. |
| `lib/server/whatsapp/handler.ts`, `telegram/handler.ts` | Fail-closed: the PDF is only sent when `passReleaseAllowed === true`. Otherwise the family gets the code plus a portal link. |
| `lib/server/delivery.ts` | `deliverInvitation` prefers an approved contact; a chat-learned contact receives only the reference code, never the QR token. |
| `components/admin/FamilyVerification.tsx`, `app/admin/page.tsx` | New admin-only **Verify a family** view wired to `POST/DELETE /api/family/contact`. Without this, tightening the policy would have had no operational escape hatch. |
| `drizzle/migrations/0012_data_api_lockdown.sql` | RLS + REVOKE on all 20 tables, sequence revokes, `ALTER DEFAULT PRIVILEGES`. |
| `app/api/agent/route.ts` | Agent throttle moved to the shared database limiter (in-process `Map` kept only as fallback). |
| `app/api/rsvp/route.ts` | Stopped echoing arbitrary internal error messages as 409. |
| `scripts/bundle-secrets-test.mjs` | New CI gate: no server-only secret names or JWT material in `.next/static`. |

---

## 3. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean (1 pre-existing warning in `whatsapp-test.mjs`) |
| `npm run build` | succeeds, all routes emitted |
| Unit tests (12 files) | **104 passed, 0 failed** |
| Tests before this pass | 99 |
| `npm audit` | 0 vulnerabilities |
| Client bundle secret scan | no server-only secret names, no JWT material |

### New regression tests

- `security-unit-test.mjs` → "only school-verified contacts can receive an OTP"
- `security-unit-test.mjs` → "QR passes are released only to a verified contact"
- `whatsapp-handler-test.mjs` → "never sends the QR pass when the contact is not school-verified"
- `whatsapp-handler-test.mjs` → "fails closed when the recovery result omits the trust flag"
- `bundle-secrets-test.mjs` → server-secret absence in client bundles

---

## 4. Not verified — stated plainly

1. **`0012_data_api_lockdown.sql` was never executed.** No PostgreSQL or Docker
   is available in this environment. It is written to be idempotent and
   role-guarded, but it is **unrun**. Apply it, then confirm from a browser with
   the anon key that `GET /rest/v1/invitations?select=qr_token` fails.
2. **Owner/role caveat.** RLS with no policies blocks non-owner roles. If
   `DATABASE_URL` does not connect as the table owner, the app will read empty
   results after this migration. The migration header documents the check.
3. **No live OTP round trip.** Requires a staging database, two synthetic
   families, and a test WhatsApp/Telegram inbox. `scripts/security-test.mjs`
   covers the unauthenticated and session-boundary cases but needs a running
   staging target.
4. **No production testing.** Non-destructive checks only; nothing was sent,
   changed, or rotated.

---

## 5. Residual risk

- **Operational, not technical:** with no roster phone numbers in the data,
  every family now needs a staff-approved contact before self-verifying.
  Onboarding 467 families is real work. Staff approval is admin-only and audited
  (`family_contact.upserted`), but a mistyped number or social engineering still
  binds the wrong destination.
- **QR tokens are bearer credentials.** A photographed pass admits whoever holds
  it. Admission is per-guest and single-use at the database level, but the token
  itself is copyable. Per-guest QR codes would reduce this.
- **Shared `ADMIN_ACCESS_KEY`.** One secret grants full administrator rights.
  Per-person staff accounts with MFA are the durable fix.
- **No retention policy** for guest lists, tickets, photos, or audit records.

---

## 6. Next three actions

1. **Apply `0012` and verify the Data API is closed** from a browser with the
   anon key. This is a one-line curl check and closes the widest remaining door.
2. **Decide the onboarding flow for verified contacts** — bulk import from the
   school's parent register, or class-wise teacher entry — then register them
   before invitations go out.
3. **Replace the shared admin key** with per-person Supabase accounts carrying
   the `admin` role, and require MFA on those accounts.
