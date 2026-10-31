-- 0012_data_api_lockdown.sql
--
-- Close the Supabase Data API to the browser key for every table that holds
-- student, family, guest, admission, or messaging data.
--
-- Why this matters: this application reaches PostgreSQL through DATABASE_URL (a
-- privileged direct connection) and uses the Supabase *Auth* API for staff
-- sign-in. It never reads these tables through the Data API. But a standard
-- Supabase project grants `anon` and `authenticated` full access to every table
-- in `public` by default. Since the anon key is a public client credential, any
-- leak of it (or any future client-side code that imports it) turned
-- `https://<project>.supabase.co/rest/v1/invitations` into an unauthenticated
-- dump of QR bearer tokens, student names, phone numbers, and guest lists —
-- bypassing the OTP design entirely.
--
-- RLS with no policy denies everything to non-owner roles, and the REVOKEs make
-- the intent explicit even if RLS were later disabled by accident. The
-- application is unaffected because its connection role owns the tables.
--
-- Idempotent, and safe on a plain PostgreSQL instance where the Supabase client
-- roles do not exist (local development, CI): every role-specific statement is
-- guarded by a role-existence check.
--
-- !! IMPORTANT OPERATIONAL CHECK !!
-- RLS with no policy denies every row to every role that is not the table owner
-- and does not hold BYPASSRLS. The application must therefore connect as the
-- table owner (on Supabase, normally `postgres`). If DATABASE_URL points at a
-- different, non-owner role, the app itself will start seeing empty results.
--
-- Verify after applying:
--   -- must list the tables below, owner = the role in DATABASE_URL
--   SELECT tablename, tableowner FROM pg_tables
--   WHERE schemaname = 'public' AND rowsecurity ORDER BY tablename;
--
--   -- from a browser with the anon key, this MUST fail or return no rows:
--   GET https://<project>.supabase.co/rest/v1/invitations?select=qr_token
--
-- For extra safety on a table you want readable by nobody but the app, also run
--   ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
-- to apply RLS even to the owner. Only do that if DATABASE_URL has BYPASSRLS.

-- 1. RLS everywhere. With no policy defined, RLS denies every row to anyone who
--    is not the table owner — which is exactly the client roles.
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'students',
    'invitations',
    'guests',
    'check_ins',
    'support_tickets',
    'event_settings',
    'event_documents',
    'knowledge_sources',
    'knowledge_chunks',
    'invitation_contacts',
    'deliveries',
    'announcements',
    'photos',
    'whatsapp_sessions',
    'invitation_lookup_limits',
    'family_contacts',
    'family_verification_challenges',
    'family_sessions',
    'family_rate_limits',
    'security_audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- 2. Explicit REVOKEs, so the intent survives even if RLS is later disabled.
DO $$
DECLARE
  r text;
  t text;
  targets text[] := ARRAY[
    'students', 'invitations', 'guests', 'check_ins', 'support_tickets',
    'event_settings', 'event_documents', 'knowledge_sources', 'knowledge_chunks',
    'invitation_contacts', 'deliveries', 'announcements', 'photos',
    'whatsapp_sessions', 'invitation_lookup_limits', 'family_contacts',
    'family_verification_challenges', 'family_sessions', 'family_rate_limits',
    'security_audit_log'
  ];
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY targets LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = t
        ) THEN
          EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
        END IF;
      END LOOP;

      -- Sequences backing those tables must not be usable either (ids are
      -- generated server-side, so the client has no legitimate need).
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);

      -- Belt and braces: deny *future* tables in `public` too, so a later
      -- migration cannot silently re-open the Data API.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r
      );
    END IF;
  END LOOP;
END $$;
