import { NextResponse } from "next/server";
import { handleInbound, liveDeps } from "@/lib/server/whatsapp/handler";
import { parseWebhookBody } from "@/lib/server/whatsapp/menu";
import {
  downloadMedia,
  sendDocument,
  sendTextWithTemplateFallback,
  uploadMedia,
  verifySignature,
} from "@/lib/server/whatsapp/client";
import { loadSession } from "@/lib/server/whatsapp/session";
import { saveIncomingPhoto } from "@/lib/server/album";

// Agent calls can take several seconds; give the function room.
export const maxDuration = 60;

// Meta verification: GET with hub.mode=subscribe, hub.challenge,
// hub.verify_token == WHATSAPP_VERIFY_TOKEN.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret && !verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // Per-message try/catch + always 200: Meta retries aggressively on
  // non-2xx, so a poison message must not wedge the whole batch.
  for (const inbound of parseWebhookBody(body)) {
    try {
      if (inbound.media) {
        const { bytes, mime } = await downloadMedia(inbound.media.id);
        const session = await loadSession(`wa:${inbound.waId}`);
        const saved = await saveIncomingPhoto({
          channel: "whatsapp",
          address: inbound.waId,
          code: session?.invitationCode ?? null,
          buffer: Buffer.from(bytes),
          mime,
          caption: inbound.media.caption,
        });
        await sendTextWithTemplateFallback(
          inbound.waId,
          saved
            ? "Thank you! Your photo has been added to the school's Annual Function album."
            : "We couldn't save that photo right now. Please try again in a moment.",
        );
        continue;
      }
      await handleInbound(inbound, {
        ...liveDeps,
        sendText: (to, text) => sendTextWithTemplateFallback(to, text),
        sendPass: async (to, pdf, filename, caption) => {
          const mediaId = await uploadMedia(pdf, filename);
          await sendDocument(to, mediaId, filename, caption);
        },
      });
    } catch (e) {
      console.error("whatsapp inbound failed", inbound.waId, e);
    }
  }
  return NextResponse.json({ ok: true });
}
