import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { invitations, students } from "@/lib/db/schema";
import { identityMatches, type StudentIdentity } from "@/lib/invitations/identity";
import { HttpError, text } from "./http";

/** Shared, atomic attempt counters work across serverless instances. */
async function limitAttempts(clientKey: string, admissionNumber: string) {
  const keys = [
    { value: `client:${clientKey}`, limit: 20 },
    { value: `admission:${admissionNumber}`, limit: 8 },
  ];
  const allowed = await getDb().transaction(async (tx) => {
    let allowed = true;
    for (const key of keys) {
      const hash = createHash("sha256").update(key.value).digest("hex");
      const rows = await tx.execute<{ attempts: number }>(sql`
        insert into invitation_lookup_limits (key_hash, window_start, attempts)
        values (${hash}, now(), 1)
        on conflict (key_hash) do update set
          attempts = case when invitation_lookup_limits.window_start <= now() - interval '15 minutes'
            then 1 else least(invitation_lookup_limits.attempts + 1, 1000000) end,
          window_start = case when invitation_lookup_limits.window_start <= now() - interval '15 minutes'
            then now() else invitation_lookup_limits.window_start end
        returning attempts
      `);
      if (rows[0].attempts > key.limit) allowed = false;
    }
    await tx.execute(sql`delete from invitation_lookup_limits where window_start < now() - interval '1 day'`);
    return allowed;
  });
  if (!allowed) throw new HttpError("Too many invitation lookup attempts. Please wait 15 minutes or contact your class teacher.", 429);
}

export async function recoverInvitation(raw: Record<string, unknown>, clientKey: string) {
  const input: StudentIdentity = {
    admissionNumber: text(raw.admissionNumber, "Admission number", 100),
    name: text(raw.name, "Full name", 100),
    className: text(raw.className, "Class", 100),
  };
  await limitAttempts(clientKey, input.admissionNumber);
  const [row] = await getDb()
    .select({ student: students, code: invitations.invitationCode, status: invitations.status })
    .from(students)
    .innerJoin(invitations, eq(invitations.studentId, students.id))
    .where(eq(students.studentId, input.admissionNumber))
    .limit(1);
  // Same response for missing students, inactive invitations, and mismatched details.
  if (!row || row.status !== "active" || !identityMatches(row.student, input)) {
    return {
      reply: "I couldn’t find an active invitation matching all three details. Check your admission number (including any starting zeros), full name, and class, or contact your class teacher.",
      source: "School invitation records",
      action: null,
      recoveryRequired: true,
    };
  }
  return {
    reply: `Your details match. Your invitation code is ${row.code}. Keep it private. Open your invitation below to view your pass and register guests.`,
    source: "Verified school invitation records",
    action: null,
    recoveredCode: row.code,
  };
}
