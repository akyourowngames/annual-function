export type WaStep = "idle" | "await_admission" | "await_name" | "await_class" | "faq";
export type Inbound = {
  waId: string;
  text: string;
  buttonId?: string;
  media?: { id: string; mime: string; caption: string };
  audio?: { id: string; mime: string };
};

// Walk a Meta webhook payload, return one inbound per incoming user message.
// Skips statuses, non-text/non-image types (audio/video/...), and malformed
// entries.
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
        const msg = m as {
          from?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          audio?: { id?: string; mime_type?: string };
          interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } };
        };
        if (typeof msg?.from !== "string") continue;
        if (msg.type === "text" && typeof msg.text?.body === "string") {
          out.push({ waId: msg.from, text: msg.text.body.trim() });
        } else if (msg.type === "interactive") {
          const id = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
          if (id) out.push({ waId: msg.from, text: "", buttonId: id });
        } else if (msg.type === "image" && typeof msg.image?.id === "string") {
          out.push({
            waId: msg.from,
            text: "",
            media: {
              id: msg.image.id,
              mime: msg.image.mime_type || "image/jpeg",
              caption: msg.image.caption || "",
            },
          });
        } else if (msg.type === "audio" && typeof msg.audio?.id === "string") {
          out.push({
            waId: msg.from,
            text: "",
            audio: { id: msg.audio.id, mime: msg.audio.mime_type || "audio/ogg" },
          });
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
  // Inside the FAQ state, "1" still means "my invitation". Without this a
  // connected family that typed 1 stayed in the FAQ loop and never got a pass.
  if (step === "faq") {
    if (pick === "1" || pick === "invite") return { step: "await_admission" };
    if (pick === "2" || pick === "faq") return { step: "faq" };
    return { step: "faq" };
  }
  const value = raw.trim();
  if (!value) return { step };
  return { step, value }; // stepwise verify: handler stores value and advances
}

// True when the last user message is older than 24h: Meta only allows
// approved template messages until the family writes again.
export function needsTemplate(lastUserMsgAt: string | Date, now: Date = new Date()): boolean {
  const last = new Date(lastUserMsgAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > 24 * 60 * 60 * 1000;
}
