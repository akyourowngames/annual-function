CREATE TABLE IF NOT EXISTS invitation_lookup_limits (
  key_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1
);
ALTER TABLE invitation_lookup_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invitation_lookup_limits FROM anon, authenticated;
