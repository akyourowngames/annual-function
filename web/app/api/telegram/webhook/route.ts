import { NextResponse } from "next/server";
import { handleTelegramInbound, liveDeps, parseTelegramUpdate } from "@/lib/server/telegram/handler";
import { sendDocument, sendMessage } from "@/lib/server/telegram/client";

// Agent calls (vision: none) can take several seconds; give the function room.
export const maxDuration = 60;

export async function POST(req: Request) {
  // Fail closed: when TELEGRAM_WEBHOOK_SECRET is set (production MUST set
  // it — see .env.example), the request must carry the matching
  // x-telegram-bot-api-secret-token header or it is rejected. When the env
  // is unset (local dev only), validation is skipped.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "bad secret" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  // Non-text updates (stickers, photos, callbacks, ...) parse to null and
  // are acknowledged with 200 and no sends.
  const inbound = parseTelegramUpdate(body);
  if (!inbound) return NextResponse.json({ ok: true });
  // Per-message try/catch + always 200: Telegram retries aggressively on
  // non-2xx, so a poison message must not wedge the webhook — same
  // discipline as the WhatsApp route.
  try {
    await handleTelegramInbound(inbound, { ...liveDeps, sendMessage, sendDocument });
  } catch (e) {
    console.error("telegram inbound failed", inbound.chatId, e);
  }
  return NextResponse.json({ ok: true });
}
