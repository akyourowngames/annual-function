import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
  return id;
}
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN is not configured");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra };
}

// Meta signs the RAW request body: HMAC-SHA256 with the app secret,
// header format "sha256=<hex>". Constant-time compare, fail closed.
export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function graphPost(path: string, body: unknown): Promise<{ id?: string }> {
  const res = await fetch(`${GRAPH}/${phoneNumberId()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ messaging_product: "whatsapp", ...(body as Record<string, unknown>) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
    const e = new Error(`WhatsApp send failed: HTTP ${res.status} ${err.error?.message ?? ""}`) as Error & { code?: number };
    e.code = err.error?.code;
    throw e;
  }
  const data = (await res.json()) as { messages?: Array<{ id?: string }> };
  return { id: data.messages?.[0]?.id };
}

export function isWindowError(e: unknown): boolean {
  const err = e as { code?: number; message?: string };
  return err?.code === 470 || /outside.*(window|24)|24.*hour/i.test(err?.message ?? "");
}

export async function sendText(to: string, body: string) {
  return graphPost("/messages", { to, type: "text", text: { body } });
}

// Upload a Buffer (PDF pass) to Meta, returns the media id for sendDocument.
export async function uploadMedia(buf: Buffer, filename: string, mime = "application/pdf"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  form.append("messaging_product", "whatsapp");
  const res = await fetch(`${GRAPH}/${phoneNumberId()}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`WhatsApp media upload failed: HTTP ${res.status}`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("WhatsApp media upload returned no id");
  return data.id;
}

export async function sendDocument(to: string, mediaId: string, filename: string, caption: string) {
  return graphPost("/messages", {
    to,
    type: "document",
    document: { id: mediaId, filename, caption },
  });
}

export async function sendTemplate(to: string, name: string, languageCode = "en") {
  return graphPost("/messages", {
    to,
    type: "template",
    template: { name, language: { code: languageCode } },
  });
}

// Reactive replies are inside the 24h window, so free-form text is the norm.
// If Meta rejects with a window error (stale session edge case), retry once
// with the approved faq_followup utility template instead of failing silently.
export async function sendTextWithTemplateFallback(to: string, body: string) {
  try {
    return await sendText(to, body);
  } catch (e) {
    if (!isWindowError(e)) throw e;
    return sendTemplate(to, "faq_followup");
  }
}
