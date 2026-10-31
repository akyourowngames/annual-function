# Annual Function — Family Verification Architecture (Invitation Code + OTP)

## 1. Goal

Preserve the existing family workflow while removing the unsafe assumption that
a shareable invitation code proves identity.

```
Before:  code ─────────────────────────────► view name, guests, QR, edit everything

After:   code ──► verified contact ──► OTP ──► 30-min family session ──► data
                 (school-approved)    (5 min)   (HttpOnly cookie)
```

The code remains the **lookup identifier**. The OTP to a **previously verified
contact** is the possession factor. Neither alone authorizes family-management
operations.

---

## 2. Components

| Component | File | Responsibility |
|---|---|---|
| OTP/session primitives | `web/lib/security/family.ts` | Crypto-random OTP, keyed HMAC, constant-time compare, masked destination, signed session token. Pure and unit-tested. |
| Verification service | `web/lib/server/family-verification.ts` | Start/confirm state machine, contact resolution, challenge lifecycle, audit. |
| Session service | `web/lib/server/family-auth.ts` | Cookie issue/rotate/revoke, server-side session validation, `requireFamily(code)`. |
| Delivery | `web/lib/server/delivery.ts` (`sendTextTo`) | Sends the OTP over the family's verified WhatsApp/Telegram endpoint. |
| Shared limiter | `web/lib/server/rate-limit.ts` | Atomic DB buckets across serverless instances. |
| Audit | `web/lib/server/audit.ts` | Append-only actor/action trail. |
| Schema | `web/lib/db/schema.ts`, `drizzle/migrations/0004_family_verification.sql` | Tables + indexes + RLS. |
| Portal UI | `web/app/(student)/portal/page.tsx` | Two-step code → OTP flow, session resume, logout. |

---

## 3. Data model

```sql
family_contacts                 -- one verified destination per invitation
  invitation_id UNIQUE → invitations(id)
  channel ('whatsapp'|'telegram'), address
  verified_by ('admin:<id>' | 'staff:<id>'), verified_at

family_verification_challenges  -- one row per issued OTP
  invitation_id, purpose ('family_manage')
  channel, address
  otp_hash (HMAC), salt, attempts, max_attempts
  expires_at, consumed_at, created_at

family_sessions                 -- server-side revocation record
  id (= token sid), invitation_id, code, scope ('family')
  expires_at, revoked_at, last_seen_at, ip_hash, user_agent

family_rate_limits              -- shared buckets
  key_hash PRIMARY KEY, window_start, attempts

security_audit_log              -- append-only
  actor_type, actor_id, action, invitation_id, invitation_code,
  ip_hash, detail (jsonb)
```

A partial unique index protects admissions:

```sql
CREATE UNIQUE INDEX check_ins_guest_unique
  ON check_ins (guest_id) WHERE guest_id IS NOT NULL;
```

All five verification tables have RLS enabled and `anon`/`authenticated` revoked,
so the Supabase Data API cannot read them. The app's privileged `DATABASE_URL`
connection is unaffected.

---

## 4. State machine

### 4.1 Start — `POST /api/family/verify/start { code }`

1. Normalise and strict-validate the code (`^[A-Z0-9][A-Z0-9-]{3,63}$`).
2. Rate limits: IP 10 / 15 min, code 5 / 15 min.
3. Look up an **active** invitation.
4. Resolve a verified contact:
   - `family_contacts` (admin-approved) first,
   - else `invitation_contacts` (captured only after identity-verified chat).
5. If no invitation or no contact → **uniform** `200 { nextStep:
   "contact_teacher" }`. No enumeration signal.
6. Resend cooldown: if a live challenge was issued < 60 s ago, return the same
   generic message and `retryAfterSeconds`.
7. Invalidate every older unconsumed challenge for the invitation.
8. Generate a 6-digit OTP and a 128-bit salt. Store
   `HMAC(secret, invitationId|purpose|salt|otp)` only.
9. Send the OTP over the verified channel. Never log the plaintext.
10. On delivery failure: consume the challenge, audit, return the generic
    recovery message (no provider details).

### 4.2 Confirm — `POST /api/family/verify/confirm { code, otp }`

1. Strict OTP parsing (`^[0-9]{6}$`, ASCII only).
2. Rate limits: IP 20 / 15 min, code 10 / 15 min.
3. Load the latest live challenge bound to the invitation and purpose.
4. Reject expired challenges and consume them.
5. Increment `attempts` **before** comparison so concurrent guesses all count.
6. Constant-time compare the keyed HMAC.
7. On success, consume with a conditional `UPDATE … WHERE consumed_at IS NULL
   AND expires_at > now()`; only one concurrent request gets the row.
8. Revoke previous active sessions for the invitation, insert a new
   `family_sessions` row, set the cookie, audit.

### 4.3 Session

- Cookie name: `annual_family`.
- `HttpOnly`, `Secure` in production, `SameSite=Strict`, `Path=/`, 30 minutes.
- Token: `fs.<base64url(payload)>.<HMAC-SHA256>`, payload includes `sid`,
  `invitationId`, `code`, `scope`, `iat`, `exp`.
- Every sensitive request re-validates signature, expiry, `sid` row,
  `revoked_at`, and the exact code binding.
- Logout (`DELETE /api/family/session`) revokes the row and clears the cookie.
- The code and OTP are never accepted as a substitute for the session.

---

## 5. Authorization matrix

| Operation | Code alone | Family session | Staff | Gate | Admin |
|---|---|---|---|---|---|
| Public event info | ✅ | ✅ | ✅ | ✅ | ✅ |
| View student name / guest list / QR | ❌ 401 | ✅ (own code) | ✅ | ✅ (scanner) | ✅ |
| Register/edit/remove guest | ❌ 401 | ✅ (own code) | ❌ | ❌ | ❌ |
| RSVP | ❌ 401 | ✅ (own code) | ❌ | ❌ | ❌ |
| Support history / create ticket | ❌ 401 | ✅ (own code) | ✅ (all) | ❌ | ✅ |
| Agent with `code` | ❌ 401 | ✅ | ❌ | ❌ | ❌ |
| Check in a pass | ❌ 401 | ❌ | ✅ | ✅ | ✅ |
| Roster / bulk messaging / album / knowledge | ❌ 401 | ❌ | ✅* | ❌ | ✅ |

\* `announcements`, `admin/deliver`, `knowledge`, `event` writes and
`family/contact` are admin-only via `requireStaff(true)`.

---

## 6. Error behaviour (anti-enumeration)

| Situation | Response |
|---|---|
| Unknown code / inactive invitation / no verified contact | `200 { nextStep: "contact_teacher", message: <generic> }` |
| OTP wrong | `400` generic “incorrect” |
| OTP expired | `400` “expired, request a new one” |
| OTP already used | `409` “already used” |
| 5 failed attempts | `429` “too many incorrect codes” |
| Too many starts/confirms | `429` generic |
| No/expired/revoked session | `401` |
| Valid session, different code | `403` |
| Missing secrets / DB | `503` generic, no internals |

Responses never include a full phone number, the OTP, or the session token.

---

## 7. Recovery paths

1. **Family has a verified chat contact** → normal OTP flow.
2. **Family lost access to the chat** → contact the class teacher; an
   administrator calls `POST /api/family/contact` with the new WhatsApp/Telegram
   address. This is the only way to replace the destination.
3. **Family lost the code** → the existing identity recovery (admission number,
   full name, class) returns the code; sensitive access still requires OTP.
4. **Suspected compromise** → admin removes/replaces the contact, and active
   family sessions can be revoked (new verification revokes previous sessions;
   `DELETE /api/family/session` revokes the current one).

> A contact supplied by the visitor in the verification request is **ignored**.
> This prevents “enter any phone number, receive the OTP, take over the family”.

---

## 8. Why these choices

- **Keyed HMAC + per-challenge salt** rather than bcrypt: OTPs are 6 digits and
  short-lived; the secret key plus salt prevents offline precomputation, and
  comparison is constant-time.
- **DB-backed sessions** rather than pure stateless JWTs: revocation and
  rotation are required for a bearer cookie.
- **One live challenge per invitation**: simplifies replay reasoning and makes
  “resend” invalidate the previous code.
- **Uniform start response**: prevents using the endpoint to test whether a
  student or phone number exists.
- **No OTP in the same chat for chat-initiated access**: adding an OTP to the
  same WhatsApp thread would not add a factor; the chat flow keeps identity
  recovery and is documented as residual risk H-05.

---

## 9. Deployment checklist

1. **Secrets** (Vercel → Environment Variables, server-only):
   ```
   FAMILY_SESSION_SECRET=<48 random bytes base64url>
   FAMILY_OTP_SECRET=<48 random bytes base64url>
   TELEGRAM_WEBHOOK_SECRET=<random>   # production now fails closed without it
   ```
   Generate:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
2. **Migration**:
   ```
   cd web
   node scripts/migrate.mjs drizzle/migrations/0004_family_verification.sql
   ```
   Verify the unique index was created; if the notice reports duplicate
   check-ins, resolve them before relying on the index.
3. **Seed verified contacts** for families that cannot use the chat flow:
   ```
   POST /api/family/contact
   { "code": "ANL-…", "channel": "whatsapp", "address": "+91…" }
   ```
   (admin session required).
4. **Provider check**: confirm WhatsApp template/session rules allow a plain-text
   OTP to the registered address; Telegram bots can message users who started
   the chat.
5. **Verify**: run `npm run test:security:live` against staging with synthetic
   families (see `scripts/security-test.mjs`).
6. **Monitor**: watch `security_audit_log` for `otp.failed`,
   `otp.start_no_verified_contact`, `staff.login_failed`, and
   `admission.checked_in` spikes.

---

## 10. Limits of this design

- It does not stop a verified family from sharing its own QR (bearer credential).
- It does not add MFA for staff; a leaked `ADMIN_ACCESS_KEY` is still powerful.
- It depends on the messaging provider; delivery failure degrades to the
  admin-approved recovery path.
- It does not fix the chat identity-recovery weakness (H-05).
- It does not replace a WAF or DDoS protection.
