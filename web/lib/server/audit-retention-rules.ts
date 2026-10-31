// Pure rules for trimming the activity log. Dependency-free so it unit-tests
// under plain `node --test`, the same shape as `roles.ts`.

/**
 * How long the full activity log is kept before old rows are deleted.
 *
 * 90 days is three months: long enough to answer "who did what" after the
 * event and for any follow-up, short enough that the table stays small. Change
 * it with AUDIT_RETENTION_DAYS when a school needs a longer paper trail.
 */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * A window shorter than this is refused and replaced by the default. A typo
 * like `AUDIT_RETENTION_DAYS=0` must never mean "delete everything".
 */
export const MIN_RETENTION_DAYS = 7;

/**
 * Ten years. Anything larger is a typo, not a policy; clamp rather than keep
 * an absurd interval that deletes nothing.
 */
export const MAX_RETENTION_DAYS = 3650;

/**
 * Rows deleted per statement. Large enough that a normal day needs one pass,
 * small enough that a first run over a huge backlog never holds a long lock
 * while the gate is scanning passes.
 */
export const DEFAULT_TRIM_BATCH = 5000;
export const MIN_TRIM_BATCH = 100;
export const MAX_TRIM_BATCH = 50_000;

/** Whole numbers only; anything unreadable becomes `null`. */
function readInteger(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function clamp(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Retention window in days, from AUDIT_RETENTION_DAYS, always inside the safe
 * range.
 *
 * Zero and negative values are typos, not policies — there is no sane reading
 * of "keep the log for 0 days" — so they fall back to the default rather than
 * being clamped to the floor. A positive value that is merely too small is a
 * real (if risky) intent and is clamped up instead.
 */
export function auditRetentionDays(raw: unknown = process.env.AUDIT_RETENTION_DAYS): number {
  const days = readInteger(raw);
  if (days !== null && days <= 0) return DEFAULT_RETENTION_DAYS;
  return clamp(days, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
}

/** Batch size per delete, from AUDIT_TRIM_BATCH, always inside the safe range. */
export function auditTrimBatch(raw: unknown = process.env.AUDIT_TRIM_BATCH): number {
  const size = readInteger(raw);
  if (size !== null && size <= 0) return DEFAULT_TRIM_BATCH;
  return clamp(size, MIN_TRIM_BATCH, MAX_TRIM_BATCH, DEFAULT_TRIM_BATCH);
}
