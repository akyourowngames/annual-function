import { getDb } from "@/lib/db";
import { whatsappSessions, type NewWhatsappSession, type WhatsappSession } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { WaStep } from "./menu";

export type SessionPayload = {
  admission?: string;
  name?: string;
  className?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function loadSession(waId: string): Promise<WhatsappSession | null> {
  const rows = await getDb().select().from(whatsappSessions).where(eq(whatsappSessions.waId, waId)).limit(1);
  return rows[0] ?? null;
}

export async function saveSession(s: NewWhatsappSession): Promise<void> {
  await getDb()
    .insert(whatsappSessions)
    .values(s)
    .onConflictDoUpdate({
      target: whatsappSessions.waId,
      set: { ...s, updatedAt: new Date() },
    });
}

// Append one turn, cap history at the last 8 messages (matches answerQuestion's window).
export function pushHistory(payload: SessionPayload, role: "user" | "assistant", content: string): SessionPayload {
  const history = [...(payload.history ?? []), { role, content }].slice(-8);
  return { ...payload, history };
}

export function newSession(waId: string): NewWhatsappSession {
  return { waId, step: "idle" as WaStep, payload: {}, attempts: 0, lastUserMsgAt: new Date() };
}
