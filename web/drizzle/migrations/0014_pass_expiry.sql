-- One moment after which the gate refuses every ticket pass.
--
-- The gate used to accept a pass forever: only switching one invitation off (or
-- regenerating its QR) closed it. A school function ends, though, so the office
-- should be able to say "after 10 pm on the 20th, no pass gets anyone in".
--
-- NULL keeps the old behaviour on purpose. An event with no expiry set behaves
-- exactly as it did before this column existed, so applying this during the
-- run-up changes nothing until staff choose a time.

ALTER TABLE "event_settings"
  ADD COLUMN IF NOT EXISTS "pass_expires_at" timestamptz;

COMMENT ON COLUMN "event_settings"."pass_expires_at" IS
  'Instant after which the gate refuses every pass. NULL means passes never expire.';
