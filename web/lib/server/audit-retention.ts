import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditRetentionDays, auditTrimBatch } from "./audit-retention-rules";

export { auditRetentionDays, auditTrimBatch };

export type TrimResult = { deleted: number; retentionDays: number };

/**
 * Delete activity-log rows older than the retention window.
 *
 * The work happens in `trim_security_audit_log` (migration 0013), which deletes
 * a bounded batch at a time so a first run over a large backlog cannot hold a
 * long lock while the gate is scanning. The window and batch come from the
 * environment, clamped in `audit-retention-rules.ts`.
 *
 * Callers decide what a failure means; this throws so a cron job can report it.
 */
export async function trimAuditLog(): Promise<TrimResult> {
  const retentionDays = auditRetentionDays();
  const batch = auditTrimBatch();
  const rows = (await getDb().execute(
    sql`select trim_security_audit_log(${retentionDays}::int, ${batch}::int) as deleted`,
  )) as unknown as Array<{ deleted: number }>;
  const deleted = Number(rows[0]?.deleted ?? 0);
  return { deleted, retentionDays };
}
