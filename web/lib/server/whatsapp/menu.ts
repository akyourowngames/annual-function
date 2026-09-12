export type WaStep = "idle" | "await_admission" | "await_name" | "await_class" | "faq";
export type Inbound = { waId: string; text: string; buttonId?: string };

// Walk a Meta webhook payload, return one inbound per incoming user message.
// Skips statuses, non-text types (image/audio/...), and malformed entries.
export function parseWebhookBody(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }> })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const messages = (change as { value?: { messages?: unknown } })?.value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as { from?: string; type?: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } } };
        if (typeof msg?.from !== "string") continue;
        if (msg.type === "text" && typeof msg.text?.body === "string") {
          out.push({ waId: msg.from, text: msg.text.body.trim() });
        } else if (msg.type === "interactive") {
          const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
          if (id) out.push({ waId: msg.from, text: "", buttonId: id });
        }
      }
    }
  }
  return out;
}

export function menuText(): string {
  return (
    "Namaste! Annual Function helpdesk me swagat hai.\n" +
    "1. Get my invitation (PDF + QR)\n" +
    "2. Ask a question\n\n" +
    "Reply 1 ya 2 likhkar bhejein."
  );
}

export function nextMenuStep(step: WaStep, raw: string, buttonId?: string): { step: WaStep; value?: string } {
  const text = raw.trim().toLowerCase();
  const pick = buttonId === "invite" ? "1" : buttonId === "faq" ? "2" : text;
  if (pick === "menu" || pick === "cancel" || pick === "0") return { step: "idle" };
  if (step === "idle") {
    if (pick === "1" || pick.includes("invit")) return { step: "await_admission" };
    if (pick === "2" || pick.includes("question") || pick.includes("ask") || pick.includes("sawal")) return { step: "faq" };
    return { step: "idle" };
  }
  if (step === "faq") return { step: "faq" };
  const value = raw.trim();
  if (!value) return { step };
  return { step, value }; // stepwise verify: handler stores value and advances
}

// True when the last user message is older than 24h: Meta only allows
// approved template messages until the family writes again.
export function needsTemplate(lastUserMsgAt: string | Date, now: Date = new Date()): boolean {
  return now.getTime() - new Date(lastUserMsgAt).getTime() > 24 * 60 * 60 * 1000;
}
