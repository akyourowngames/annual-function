CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  wa_id text PRIMARY KEY,
  step text NOT NULL DEFAULT 'idle',
  payload jsonb NOT NULL DEFAULT '{}',
  invitation_code text,
  attempts integer NOT NULL DEFAULT 0,
  last_user_msg_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whatsapp_sessions FROM anon, authenticated;
