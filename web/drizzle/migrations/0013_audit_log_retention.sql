-- Keep the activity log from growing forever.
--
-- security_audit_log is written by every sensitive action (check-ins, guest
-- edits, invitation changes, sign-ins). Nothing used to delete old rows, so the
-- table only ever grew. This function removes rows older than a retention
-- window, a bounded batch at a time, so a large backlog never holds a long
-- lock on a live event.
--
-- Deletion is not a security decision, so the guards are blunt: a window under
-- one day is refused outright rather than silently emptying the table.

CREATE OR REPLACE FUNCTION trim_security_audit_log(
  p_retention_days integer,
  p_batch integer
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff  timestamptz;
  total   integer := 0;
  removed integer := 0;
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'retention days must be at least 1, got %', p_retention_days;
  END IF;
  IF p_batch IS NULL OR p_batch < 1 THEN
    RAISE EXCEPTION 'batch size must be at least 1, got %', p_batch;
  END IF;

  cutoff := now() - make_interval(days => p_retention_days);

  -- The oldest rows first, so each batch uses security_audit_log_at_idx.
  LOOP
    DELETE FROM security_audit_log
    WHERE id IN (
      SELECT id
      FROM security_audit_log
      WHERE at < cutoff
      ORDER BY at
      LIMIT p_batch
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    total := total + removed;
    EXIT WHEN removed < p_batch;
  END LOOP;

  RETURN total;
END;
$$;

COMMENT ON FUNCTION trim_security_audit_log(integer, integer) IS
  'Deletes audit rows older than p_retention_days in batches of p_batch; returns rows deleted.';
