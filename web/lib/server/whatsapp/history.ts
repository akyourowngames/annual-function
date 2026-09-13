import type { WaStep } from "./menu";
import type { NewWhatsappSession } from "@/lib/db/schema";

// Dependency-free session helpers (ZERO runtime imports — both imports
// above are type-only and erased, so plain `node --test` loads this
// module fine). Single source of truth shared by ./session (DB layer)
// and ./handler (chat logic).
export type SessionPayload = {
  admission?: string;
  name?: string;
  className?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

// Append one turn, cap history at the last 8 messages (matches answerQuestion's window).
export function pushHistory(payload: SessionPayload, role: "user" | "assistant", content: string): SessionPayload {
  const history = [...(payload.history ?? []), { role, content }].slice(-8);
  return { ...payload, history };
}

export function newSession(waId: string): NewWhatsappSession {
  return { waId, step: "idle" as WaStep, payload: {}, attempts: 0, lastUserMsgAt: new Date() };
}
