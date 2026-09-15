const API = "https://api.telegram.org";

export class TelegramError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "TelegramError";
    this.code = code;
    this.status = status;
  }
}

// Token is read from env ONLY at send time, so importing this module never
// touches secrets — and the value is never logged, only interpolated into
// the request URL inside fetch.
function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new TelegramError("TELEGRAM_BOT_TOKEN is not configured", "MISSING_TOKEN");
  return t;
}

async function botPostJson(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || data.ok === false) {
    throw new TelegramError(
      `Telegram ${method} failed: HTTP ${res.status} ${data.description ?? ""}`.trim(),
      "SEND_FAILED",
      res.status,
    );
  }
  return data.result;
}

export async function sendMessage(chatId: string, text: string): Promise<unknown> {
  return botPostJson("sendMessage", { chat_id: chatId, text });
}

// Sends a PDF Buffer as a Telegram document (test-only path for the
// invitation pass). Multipart upload, same 15s timeout discipline as text.
export async function sendDocument(
  chatId: string,
  pdf: Buffer,
  filename: string,
  caption: string,
): Promise<unknown> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  if (caption) form.append("caption", caption);
  const res = await fetch(`${API}/bot${botToken()}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!res.ok || data.ok === false) {
    throw new TelegramError(
      `Telegram sendDocument failed: HTTP ${res.status} ${data.description ?? ""}`.trim(),
      "SEND_FAILED",
      res.status,
    );
  }
  return data.result;
}
