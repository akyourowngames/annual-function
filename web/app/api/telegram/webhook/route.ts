import { NextResponse } from "next/server";
import {
  handleTelegramInbound,
  liveDeps,
  parseTelegramMedia,
  parseTelegramUpdate,
} from "@/lib/server/telegram/handler";
import { downloadFile, sendDocument, sendMessage } from "@/lib/server/telegram/client";
import { loadSession } from "@/lib/server/whatsapp/session";
import { saveIncomingPhoto } from "@/lib/server/album";

// Agent calls can take several seconds; give the function room.
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
  // Text messages go through the agent.
  const inbound = parseTelegramUpdate(body);
  if (inbound) {
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
  // Photos shared for the event album.
  const media = parseTelegramMedia(body);
  if (media) {
    try {
      const { bytes } = await downloadFile(media.fileId);
      const session = await loadSession(`tg:${media.chatId}`);
      const saved = await saveIncomingPhoto({
        channel: "telegram",
        address: media.chatId,
        code: session?.invitationCode ?? null,
        buffer: Buffer.from(bytes),
        mime: media.mime,
        caption: media.caption,
      });
      await sendMessage(
        media.chatId,
        saved
          ? "Thank you! Your photo has been added to the school's Annual Function album."
          : "We couldn't save that photo right now. Please try again in a moment.",
      );
    } catch (e) {
      console.error("telegram media failed", media.chatId, e);
    }
    return NextResponse.json({ ok: true });
  }
  // Non-text, non-photo updates (stickers, calls, callbacks, ...) are
  // acknowledged with 200 and no sends.
  return NextResponse.json({ ok: true });
}
