# SQL to run — deployment checklist

**Status: APPLIED on 2026-10-30 to the production Supabase project
(`zdkxhjhztompjcrngons.supabase.co`).**

Both steps were run through the Supabase connection and then checked.
Recorded migrations:

| Version | Name |
|---|---|
| `20261030112039` | `family_verification_tables` |
| `20261030112053` | `data_api_lockdown_rls` |

**What was proven afterwards:**

- `set role anon; select * from invitations` → **permission denied** ✅
- `set role anon; select * from students` → **permission denied** ✅
- `set role authenticated; delete from students` → **permission denied** ✅
- App still works: 467 students, 467 invitations, 4 guests, 1 event row ✅
- `check_ins_guest_unique` index present ✅

The Supabase security advisor's CRITICAL "RLS is disabled" alert is gone.

---

## If you ever need to re-run them

`scripts/migrate.mjs` applies **one file at a time** and wraps it in a single
transaction. The files are idempotent, so re-running is safe.

```bash
cd web
node scripts/migrate.mjs drizzle/migrations/0004_family_verification.sql
node scripts/migrate.mjs drizzle/migrations/0012_data_api_lockdown.sql
```

---

## 1. Required — family verification (`0004_family_verification.sql`)

```bash
cd web
node scripts/migrate.mjs drizzle/migrations/0004_family_verification.sql
```

Creates: `family_contacts`, `family_verification_challenges`, `family_sessions`,
`family_rate_limits`, `security_audit_log`, and the `check_ins_guest_unique`
partial index.

**Without this the app is broken:** `/api/family/verify/start` and
`/api/family/verify/confirm` return 503, nobody can open an invitation, and the
shared database rate limiter has no table.

Idempotent — safe to re-run (`IF NOT EXISTS` throughout).

---

## 2. Required — Data API lockdown (`0012_data_api_lockdown.sql`)

```bash
cd web
node scripts/migrate.mjs drizzle/migrations/0012_data_api_lockdown.sql
```

Enables RLS on all 20 tables, revokes `ALL` from `anon`/`authenticated`, revokes
sequence access, and sets `ALTER DEFAULT PRIVILEGES` so a future migration
cannot silently reopen the Supabase Data API.

### Verify afterwards — two separate checks

**a) The Data API must be closed.** From a browser (or curl) using your
**anon** key:

```
GET https://<project>.supabase.co/rest/v1/invitations?select=qr_token
```

Must return an error or an empty array. If it returns rows, the lockdown did not
take effect — every OTP control in the app is bypassable through this door.

**b) The app must still work.** RLS with no policies denies every role that is
not the table owner and lacks `BYPASSRLS`. Confirm your `DATABASE_URL` role owns
the tables:

```sql
SELECT tablename, tableowner
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity
ORDER BY tablename;
```

`tableowner` must be the same role you connect as. **If it is not, the app will
start reading empty results** after this migration. On Supabase the owner is
normally `postgres`, which is what the pooler connection uses.

---

## 3. Check whether the earlier migrations were ever applied

The `drizzle/migrations/meta/_journal.json` only lists `0000_melted_veda`. So the
numbered files are applied by hand and the journal is not authoritative. Confirm
what actually exists before running anything:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

Expected core set:

```
announcements        families? ✗ (see note)
check_ins            deliveries
event_documents      event_settings
family_contacts      family_rate_limits
family_sessions      family_verification_challenges
guests               invitation_contacts
invitation_lookup_limits
invitations          knowledge_chunks
knowledge_sources    photos
security_audit_log   students
support_tickets      whatsapp_sessions
```

Missing tables map to these files:

| Missing table | File |
|---|---|
| `event_documents` | `0001_event_knowledge.sql` |
| `invitation_lookup_limits` | `0003_invitation_lookup_limits.sql` |
| `whatsapp_sessions` | `0004_whatsapp_sessions.sql` |
| `knowledge_sources`, `knowledge_chunks` | `0005_knowledge_rag.sql` |
| `invitation_contacts`, `deliveries`, `announcements` (+ RSVP columns) | `0008_events_ops.sql` |
| `photos` | `0010_photos.sql` |
| `gallery_enabled` column | `0011_gallery.sql` |
| verification tables | `0004_family_verification.sql` |

> **Numbering collision:** `0004_family_verification.sql` and
> `0004_whatsapp_sessions.sql` share a number. `migrate.mjs` takes an explicit
> path so it does not matter today, but any runner that sorts by filename will
> mis-order them. Rename one before adding an automated migrator.

Extra command-line migrations (idempotent, separate from the numbered files):

```bash
node scripts/migrate-product.mjs
node scripts/migrate-landing.mjs
```

---

## 4. Environment variables to set in Vercel

```bash
# Generate each independently — do not reuse ADMIN_ACCESS_KEY.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Why |
|---|---|
| `FAMILY_SESSION_SECRET` | Signs the HttpOnly family session cookie. Falls back to `ADMIN_ACCESS_KEY` if unset. |
| `FAMILY_OTP_SECRET` | Keys the HMAC used to store OTPs. Same fallback. |

While both fall back to `ADMIN_ACCESS_KEY`, one leaked secret compromises admin
access, family sessions **and** OTP storage at the same time.

---

## 5. After the SQL — operational step

The school roster contains **no phone numbers** (`scripts/import-students.mjs`
never populates `students.phone`). Verification codes can only be sent to a
contact a staff member has approved.

**Every family needs one registered before it can open its invitation.**

- Admin UI: `/admin` → **Verify a family** → enter the invitation code, channel
  (WhatsApp / Telegram) and address → *Approve this contact*.
- The panel looks up the invitation as soon as you leave the code field, so you
  can see **Verified contact on file** vs **No verified contact** before saving.
  It re-checks after both Approve and Remove.
- API: `GET /api/family/contact?code=…` (status, masked),
  `POST /api/family/contact { code, channel, address }` (admin only),
  `DELETE /api/family/contact { code }` (admin only).

Families with no approved contact get the generic "contact your class teacher"
message instead of a code. That is intended, not a bug.

---

## Quick copy-paste

```bash
cd web
node scripts/migrate.mjs drizzle/migrations/0004_family_verification.sql
node scripts/migrate.mjs drizzle/migrations/0012_data_api_lockdown.sql
```
