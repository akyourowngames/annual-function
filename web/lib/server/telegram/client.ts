const API = "https://api.telegram.org";

import { stripMarkdown, toTelegramHtml } from "../markdown.ts";

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
  // Render the model's light Markdown as Telegram HTML. If Telegram rejects
  // the entities for any reason, fall back to plain text so a reply never
  // fails to send.
  try {
    return await botPostJson("sendMessage", {
      chat_id: chatId,
      text: toTelegramHtml(text),
      parse_mode: "HTML",
    });
  } catch (e) {
    console.error("telegram formatted send failed; retrying plain", e);
    return botPostJson("sendMessage", { chat_id: chatId, text: stripMarkdown(text) });
  }
}

async function postDocument(
  chatId: string,
  pdf: Buffer,
  filename: string,
  caption: string,
  parseMode?: "HTML",
): Promise<unknown> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  if (caption) form.append("caption", caption);
  if (parseMode) form.append("parse_mode", parseMode);
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

// Download a file the bot received (photos for the event album). Telegram
// caps bot downloads at 20 MB, which is plenty for a compressed photo.
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const result = (await botPostJson("getFile", { file_id: fileId })) as { file_path?: string };
  if (!result?.file_path)
    throw new TelegramError("getFile returned no path", "NO_FILE");
  const res = await fetch(`${API}/file/bot${botToken()}/${result.file_path}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw new TelegramError(
      `Telegram file download failed: HTTP ${res.status}`,
      "DOWNLOAD_FAILED",
      res.status,
    );
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: result.file_path };
}

// Sends a PDF Buffer as a Telegram document (invitation pass). Multipart
// upload, same 15s timeout discipline as text.
export async function sendDocument(
  chatId: string,
  pdf: Buffer,
  filename: string,
  caption: string,
): Promise<unknown> {
  try {
    return await postDocument(chatId, pdf, filename, toTelegramHtml(caption), "HTML");
  } catch (e) {
    if (!caption) throw e;
    console.error("telegram document caption failed; retrying plain", e);
    return postDocument(chatId, pdf, filename, stripMarkdown(caption));
  }
}

