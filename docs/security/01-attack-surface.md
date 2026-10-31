# Annual Function — Attack Surface Inventory

**Assessment date:** 2026-10-30
**Scope:** `web/` (Next.js 16.4.3, TypeScript, Drizzle ORM, Supabase PostgreSQL),
the family portal, the staff/gate workspaces, the chat webhooks, and the
deployment configuration. The Python `agent/` backstage assistant is out of
scope for this pass except where it shares the database.

> This inventory describes the application **after** the remediation in
> `03-findings.md`. Where a control was added, it is marked ✅.

---

## 1. Trust boundaries

| # | Boundary | What crosses it | Trust |
|---|---|---|---|
| TB1 | Browser → Next.js server | Cookies, JSON, form data, QR tokens | Untrusted |
| TB2 | Next.js server → PostgreSQL | Drizzle queries, transactions | Privileged (`DATABASE_URL`) |
| TB3 | Next.js server → Supabase Auth | Staff email/password verification | Privileged (anon key + user token) |
| TB4 | Next.js server → Supabase Storage | Album photo upload/signed URLs | Privileged (service-role key) |
| TB5 | WhatsApp/Telegram → webhooks | Inbound messages, photos, voice notes | Untrusted unless signature/secret verified |
| TB6 | Vercel Cron → `/api/cron` | `Authorization: Bearer $CRON_SECRET` | Shared secret |
| TB7 | Staff browser → Next.js server | `annual_staff` cookie | Authenticated staff |

**Critical property:** the `DATABASE_URL` connection is privileged and bypasses
Row Level Security. All authorization must therefore be enforced in server code
and database constraints, not by RLS alone. RLS is still enabled on the new
verification tables to close the Supabase Data API.

---

## 2. Data classification

| Class | Examples | Where it lives |
|---|---|---|
| **Secret** | `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_ACCESS_KEY`, `GATE_ACCESS_KEY`, `FAMILY_SESSION_SECRET`, `FAMILY_OTP_SECRET`, `CRON_SECRET`, WhatsApp/Telegram tokens, LLM keys | Server env only |
| **Credential** | Invitation code, QR token, OTP, family session cookie, staff session cookie | DB / HttpOnly cookies |
| **Sensitive personal** | Student name, admission number, class, phone/email, guest names + relationships, RSVP, support tickets, admission records | PostgreSQL |
| **Restricted media** | Family-contributed photos | Private Supabase Storage bucket |
| **Public** | Event date/venue/dress code/programme, approved gallery photos | Public API |

---

## 3. Endpoint inventory

Legend — Auth: **Public**, **Family** (verified family session bound to the
code), **Staff** (`admin`/`staff`), **Gate** (`admin`/`staff`/`gate`),
**Admin** (`admin` only), **Signature**.

| Endpoint | Methods | Auth | Inputs | Sensitive output / effect | Rate limit | CSRF |
|---|---|---|---|---|---|---|
| `/api/family/verify/start` | POST | Public | `code` | Sends OTP to a **verified** contact; uniform response | IP 10/15m, code 5/15m, resend 60s | Origin check |
| `/api/family/verify/confirm` | POST | Public + OTP | `code`, `otp` | Issues family session; returns invitation detail | IP 20/15m, code 10/15m, 5 attempts/challenge | Origin check |
| `/api/family/session` | GET, DELETE | Family (cookie) | — | Session state; revokes session | — | Origin check on DELETE |
| `/api/family/contact` | POST, DELETE | Admin | `code`, `channel`, `address` | Approves/replaces OTP destination | Staff limiter | Origin check |
| `/api/invitations` | GET | Family **or** Gate+ | `code` | Student name, guest list, RSVP, **QR token** | — | n/a |
| `/api/invitations` | POST | Admin | admission no., name, class, limit | Creates student + invitation | — | Origin check |
| `/api/guests` | GET, POST, PATCH, DELETE | Family | `code`, guest fields, `guestId` | Guest list / mutation | — | Origin check |
| `/api/rsvp` | POST | Family | `code`, status, count, note | RSVP mutation | — | Origin check |
| `/api/tickets` | GET | Family (with `code`) or Staff | `code`, `id` | Support history + student identity | — | n/a |
| `/api/tickets` | POST | Family | `code`, category, description | Creates ticket | — | Origin check |
| `/api/tickets` | PATCH | Staff | `id`, status/reply | Status change, outbound chat message | — | Origin check |
| `/api/agent` | POST | Public (general) / Family (with `code`) | `message`, `code`, `history`, `recovery` | Guest list, RSVP, tickets, QR PDF via chat | IP 30/10m (memory) | Origin check |
| `/api/check-in` | GET | Gate+ | `qrToken` | Student name, guest list, admission count | — | n/a |
| `/api/check-in` | POST | Gate+ | `qrToken`, `guestId` | Records admission | — | Origin check |
| `/api/auth` | GET, POST, DELETE | Public / staff | email+password or access key | Staff session | DB 10/15m (+ memory fallback) | Origin check |
| `/api/admin` | GET, PATCH | Staff / Admin | roster filters, limits, statuses | Full roster, 467 students, guest limits | — | Origin check |
| `/api/admin/live` | GET | Staff | — | Live attendance/RSVP stats | — | n/a |
| `/api/admin/deliver` | GET, POST | Admin | audience, resend | Bulk outbound passes | — | Origin check |
| `/api/announcements` | GET, POST, PATCH, DELETE | Admin | title, body, audience, schedule | Bulk messaging | — | Origin check |
| `/api/album` | GET, PATCH, DELETE | Staff / Admin | photo id, status | Private photos via signed URLs | — | Origin check |
| `/api/album` (upload path) | — | via chat webhooks | image | Private storage | — | Webhook auth |
| `/api/gallery` | GET | Public | — | **Approved** photos only, signed URLs | — | n/a |
| `/api/event` | GET | Public | — | Official event info | — | n/a |
| `/api/event` | PUT | Admin | event fields, landing content | Public content mutation | — | Origin check |
| `/api/landing` | PUT | Admin | landing JSON | Public content mutation | — | Origin check |
| `/api/knowledge` | GET, POST, DELETE | Admin | documents, sources | Internal knowledge base | — | Origin check |
| `/api/knowledge/upload` | POST | Admin | file ≤ 15 MB | Parses PDF/DOCX; CPU heavy | — | Origin check |
| `/api/cron` | GET | `CRON_SECRET` or Admin | — | Sends scheduled announcements | — | n/a |
| `/api/telegram/webhook` | POST | `x-telegram-bot-api-secret-token` (fail-closed in production) | update JSON | Chat agent, photos, tickets | — | n/a |
| `/api/whatsapp/webhook` | GET, POST | Verify token / HMAC signature | webhook JSON | Chat agent, photos, tickets | — | n/a |

Pages: `/` (public), `/gallery` (public), `/portal` (family), `/admin` (staff),
`/gate` (gate keeper).

---

## 4. Sensitive flow traces

### 4.1 Family verification (new)

```
Portal code form
  → POST /api/family/verify/start
      normalize code → shared rate limits → invitations lookup
      → family_contacts (admin-approved) or invitation_contacts (identity-verified chat)
      → invalidate old unconsumed challenges
      → HMAC(secret, invitationId|purpose|salt|otp) stored, salt stored, 5-min expiry
      → sendTextTo(verified channel, OTP)  [plaintext never stored/logged]
      → uniform 200 { nextStep }
  → POST /api/family/verify/confirm
      normalize + rate limits → latest live challenge
      → attempts++ (atomic) → constant-time HMAC compare
      → consume exactly once (conditional UPDATE)
      → family_sessions row + signed HttpOnly cookie (30 min)
      → audit otp.issued / otp.verified / otp.failed
  → GET /api/invitations?code=… (family cookie) → invitation detail incl. QR
```

### 4.2 Guest registration

UI → `POST /api/guests` → `requireFamily(code)` → `registerGuest()` transaction:
`SELECT … FOR UPDATE` on the invitation, count guests, reject at limit, insert.
The database enforces `guest_limit >= 0`; the server enforces the limit; the
frontend is never trusted.

### 4.3 Admission

Scanner → `GET /api/check-in?qrToken=…` (Gate+) → invitation + guests.
`POST /api/check-in` → `requireCheckIn()` → `checkInByQrToken()` transaction:
`SELECT … FOR UPDATE` on the invitation row, count check-ins, verify guest
belongs to invitation, reject duplicate guest, insert check-in. A partial unique
index on `check_ins(guest_id)` is the database backstop. Actor recorded in
`checked_in_by` and `security_audit_log`.

### 4.4 Staff auth

`POST /api/auth` → shared DB rate limit (10/15m per IP) → access key compared in
constant time, or Supabase Auth password grant → role read from
`app_metadata.role` → HMAC-signed `key.` cookie or Supabase access token in an
HttpOnly/Secure/SameSite=Strict cookie. `requireStaff`/`requireCheckIn` resolve
the role on every request; `admin`-only routes call `requireStaff(true)`.

---

## 5. Controls present after remediation

- ✅ Family data requires invitation code **and** OTP-backed session.
- ✅ Session cookie: HttpOnly, Secure in production, SameSite=Strict, 30 min,
  server-side revocation row, rotated on every verification.
- ✅ Cross-family binding: `requireFamily(code)` rejects a valid session used
  with another family's code (403).
- ✅ OTP: crypto-random, 5-minute expiry, single use, 5 attempts, keyed HMAC with
  per-challenge salt, bound to invitation + purpose, resend cooldown.
- ✅ Shared DB rate limiting for OTP and staff sign-in.
- ✅ Audit trail for OTP lifecycle, sessions, guest mutations, RSVP, tickets,
  admissions, contact changes, staff sign-in.
- ✅ Security headers: CSP, HSTS (prod), nosniff, DENY framing, COOP/CORP,
  Permissions-Policy, no-referrer.
- ✅ Next.js upgraded past the critical RCE advisories.
- ✅ Admission duplicate protection at transaction + unique index level.
- ✅ Sensitive API responses send `Cache-Control: no-store`.

## 6. Remaining exposed surfaces (accepted / documented)

- The **chat channels** still deliver the QR PDF after the three-field identity
  recovery. Control of the WhatsApp/Telegram account plus admission number, name
  and class is the current gate; this is weaker than an OTP to a *different*
  verified contact. See finding H-05.
- Public endpoints `/api/event`, `/api/gallery`, `/` disclose only official
  event content and approved photos.
- The `invitation_code` remains a lookup identifier and is still printed on
  invitations. It no longer authorizes access to personal data.
