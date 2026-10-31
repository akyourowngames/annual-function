-- 0004_family_verification.sql
--
-- Two-factor family verification (invitation code + OTP to a verified contact).
-- Idempotent so it can be applied to an existing production database with
--   node scripts/migrate.mjs drizzle/migrations/0004_family_verification.sql
--
-- Security notes:
--   * Only a keyed HMAC of the OTP is stored (`otp_hash`), never the plaintext.
--   * OTPs are bound to (invitation_id, purpose, salt) and expire in 5 minutes.
--   * Family sessions have a server-side row so they can be revoked.
--   * All verification tables are hidden from the Supabase Data API (RLS on +
--     anon/authenticated revoked). The application uses a privileged Postgres
--     connection, which is unaffected.

CREATE TABLE IF NOT EXISTS family_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL UNIQUE REFERENCES invitations(id) ON DELETE CASCADE,
  channel text NOT NULL,
  address text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'family_manage',
  channel text NOT NULL,
  address text NOT NULL,
  otp_hash text NOT NULL,
  salt text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_challenges_invitation_idx
  ON family_verification_challenges (invitation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS family_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  code text NOT NULL,
  scope text NOT NULL DEFAULT 'family',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS family_sessions_invitation_idx
  ON family_sessions (invitation_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS family_rate_limits (
  key_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  invitation_id uuid,
  invitation_code text,
  ip_hash text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS security_audit_log_at_idx
  ON security_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS security_audit_log_invitation_idx
  ON security_audit_log (invitation_id, at DESC);

-- Defense in depth for admission: a guest can only ever have one check-in row,
-- even if a future code path forgets the transaction lock. Pre-existing
-- duplicates (if any) are reported rather than aborting the whole migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'check_ins_guest_unique') THEN
    BEGIN
      CREATE UNIQUE INDEX check_ins_guest_unique
        ON check_ins (guest_id) WHERE guest_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'check_ins_guest_unique not created: duplicate guest check-ins exist and need manual review';
    END;
  END IF;
END $$;

-- Hide security tables from the Supabase Data API. The application's
-- DATABASE_URL connection is privileged and continues to work.
ALTER TABLE family_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON family_contacts FROM anon, authenticated;
REVOKE ALL ON family_verification_challenges FROM anon, authenticated;
REVOKE ALL ON family_sessions FROM anon, authenticated;
REVOKE ALL ON family_rate_limits FROM anon, authenticated;
REVOKE ALL ON security_audit_log FROM anon, authenticated;
