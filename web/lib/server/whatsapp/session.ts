import { getDb } from "@/lib/db";
import { whatsappSessions, type NewWhatsappSession, type WhatsappSession } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { pushHistory, newSession, type SessionPayload } from "./history.ts";

// Re-exported so existing import sites keep working; canonical
// implementations live in ./history (dependency-free, unit-testable).
export { pushHistory, newSession };
export type { SessionPayload };

export async function loadSession(waId: string): Promise<WhatsappSession | null> {
  const rows = await getDb().select().from(whatsappSessions).where(eq(whatsappSessions.waId, waId)).limit(1);
  return rows[0] ?? null;
}

export async function saveSession(s: NewWhatsappSession): Promise<void> {
  // Omit the PK from the update set: the conflict target already pins the row.
  const update = { ...s, updatedAt: new Date() };
  delete (update as Partial<typeof update>).waId;
  await getDb()
    .insert(whatsappSessions)
    .values(s)
    .onConflictDoUpdate({
      target: whatsappSessions.waId,
      set: update,
    });
}
