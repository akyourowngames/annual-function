import type { answerQuestion } from "@/lib/server/helpdesk";
import type { recoverInvitation } from "@/lib/server/invitation-recovery";
import type { getGuestUsage, createTicketForCode } from "@/lib/db/queries";
import { menuText, nextMenuStep, type WaStep } from "../whatsapp/menu.ts";
import { pushHistory, newSession, type SessionPayload } from "../whatsapp/history.ts";
import { buildInvitationPdf } from "../whatsapp/pass.ts";
import type { NewWhatsappSession } from "@/lib/db/schema";

export type TelegramInbound = { chatId: string; text: string };
export type TelegramMedia = { chatId: string; fileId: string; caption: string; mime: string };
export type TelegramVoice = { chatId: string; fileId: string; mime: string; duration: number };

export type TelegramHandlerDeps = {
  now: () => Date;
  loadSession: (waId: string) => Promise<{ step: string; payload: unknown; invitationCode: string | null } | null>;
  saveSession: (s: NewWhatsappSession) => Promise<void>;
  sendMessage: (chatId: string, text: string) => Promise<unknown>;
  sendDocument: (chatId: string, pdf: Buffer, filename: string, caption: string) => Promise<unknown>;
  recover: typeof recoverInvitation;
  answer: typeof answerQuestion;
  usage: typeof getGuestUsage;
  createTicket: typeof createTicketForCode;
  recordContact?: (key: string, code: string) => Promise<void>;
  /** True when the school has an approved OTP destination for this invitation. */
  hasVerifiedContact: (code: string) => Promise<boolean>;
};

// NOTE on imports: same discipline as the WhatsApp handler — the brain/DB
// modules (and ../whatsapp/session, which pulls `@/lib/db`) cannot be
// statically imported because unit tests run under plain `node --test`,
// which does not resolve the tsconfig `@/` alias. Pure helpers come from
// dependency-free modules, live implementations bind via deferred dynamic
// imports (resolved by Next.js at runtime; never executed in tests).
export const liveDeps: TelegramHandlerDeps = {
  now: () => new Date(),
  loadSession: (waId: string) => import("../whatsapp/session").then((m) => m.loadSession(waId)),
  saveSession: (s: NewWhatsappSession) => import("../whatsapp/session").then((m) => m.saveSession(s)),
  sendMessage: async () => {
    throw new Error("liveDeps.sendMessage not wired");
  },
  sendDocument: async () => {
    throw new Error("liveDeps.sendDocument not wired");
  },
  recover: (...args: Parameters<typeof recoverInvitation>) =>
    import("../invitation-recovery").then((m) => m.recoverInvitation(...args)),
  answer: (...args: Parameters<typeof answerQuestion>) =>
    import("../helpdesk").then((m) => m.answerQuestion(...args)),
  usage: (code: string) => import("../../db/queries").then((m) => m.getGuestUsage(code)),
  createTicket: (input) =>
    import("../../db/queries").then((m) => m.createTicketForCode(input)),
  recordContact: (key, code) =>
    import("../delivery").then((m) => m.recordContact(key, code)),
  hasVerifiedContact: (code: string) =>
    import("../family-verification").then((m) => m.hasTrustedContact(code)),
};

const PORTAL_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://annual-five.vercel.app";

// Walk a Telegram Bot API update, return the inbound text message or null.
// Stickers, photos, voice, edited messages, callbacks etc. are non-text and
// ignored by the route (200, no sends).
export function parseTelegramUpdate(update: unknown): TelegramInbound | null {
  const msg = (update as { message?: { chat?: { id?: unknown }; text?: unknown } })?.message;
  if (!msg) return null;
  if (typeof msg.text !== "string") return null;
  if (msg.chat == null || (typeof msg.chat.id !== "number" && typeof msg.chat.id !== "string")) return null;
  const text = msg.text.trim();
  if (!text) return null;
  return { chatId: String(msg.chat.id), text };
}

// Photos (or image documents) the family shares for the event album. Non-image
// documents, stickers, video etc. parse to null.
export function parseTelegramMedia(update: unknown): TelegramMedia | null {
  const msg = (update as {
    message?: {
      chat?: { id?: unknown };
      caption?: unknown;
      photo?: Array<{ file_id?: unknown }>;
      document?: { file_id?: unknown; mime_type?: unknown };
    };
  })?.message;
  if (!msg?.chat || msg.chat.id == null) return null;
  const chatId = String(msg.chat.id);
  const caption = typeof msg.caption === "string" ? msg.caption : "";
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const largest = msg.photo[msg.photo.length - 1];
    if (typeof largest?.file_id === "string")
      return { chatId, fileId: largest.file_id, caption, mime: "image/jpeg" };
  }
  const doc = msg.document;
  if (typeof doc?.file_id === "string" && typeof doc.mime_type === "string" && doc.mime_type.startsWith("image/"))
    return { chatId, fileId: doc.file_id, caption, mime: doc.mime_type };
  return null;
}

// Voice notes (and audio files) get transcribed and then run through the exact
// same handler as typed text. Stickers, video notes, calls etc. parse to null.
export function parseTelegramVoice(update: unknown): TelegramVoice | null {
  const msg = (update as {
    message?: {
      chat?: { id?: unknown };
      voice?: { file_id?: unknown; mime_type?: unknown; duration?: unknown };
      audio?: { file_id?: unknown; mime_type?: unknown; duration?: unknown };
    };
  })?.message;
  if (!msg?.chat || msg.chat.id == null) return null;
  const clip = msg.voice ?? msg.audio;
  if (!clip || typeof clip.file_id !== "string") return null;
  return {
    chatId: String(msg.chat.id),
    fileId: clip.file_id,
    mime: typeof clip.mime_type === "string" ? clip.mime_type : "audio/ogg",
    duration: typeof clip.duration === "number" ? clip.duration : 0,
  };
}

function payloadOf(raw: unknown): SessionPayload {
  const p = (raw ?? {}) as SessionPayload;
  return {
    admission: p.admission,
    name: p.name,
    className: p.className,
    history: p.history,
    pending: p.pending,
  };
}

const YES = /^(yes+|y|ya|yeah|yep|haan?|ha|ok(ay)?|sure|confirm|theek|thik|kar ?do)\b/i;
const NO = /^(no+|n|nahi?|nah|cancel|stop|mat)\b/i;

// The only text that should still get the canned menu: an explicit ask for it.
function isMenuRequest(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return ["menu", "help", "start", "/start", "/help", "cancel", "0"].includes(t);
}

// Test-only mirror of the WhatsApp conversation flow, Telegram-simple:
// same menu → stepwise admission → name → class → ONE recoverInvitation,
// same FAQ path — but plain-text replies only (no WA interactive buttons),
// no support tickets, no message templates, and no 24h window (Telegram
// has none, so every reply is free-form sendMessage).
export async function handleTelegramInbound(inbound: TelegramInbound, deps: TelegramHandlerDeps): Promise<void> {
  const { chatId } = inbound;
  // Same sessions table as WhatsApp, distinct `tg:<chatId>` prefix so rows
  // never collide with `wa:<id>` rows.
  const key = `tg:${chatId}`;
  const existing = await deps.loadSession(key);
  const base = existing ?? { ...newSession(key), lastUserMsgAt: deps.now() };
  let step = (base.step ?? "idle") as WaStep;
  let payload = payloadOf(base.payload);
  const priorCode = ("invitationCode" in base ? base.invitationCode : null) ?? undefined;
  // Keep the family's reachable endpoint fresh on every message once verified —
  // not just at the moment of first verification.
  if (deps.recordContact && priorCode) {
    try {
      await deps.recordContact(key, priorCode);
    } catch (e) {
      console.error("contact capture failed", key, e);
    }
  }
  // Once verified mid-turn, every later persist must carry the code:
  // persist() rebuilds from the stale `base` closure, so a trailing
  // persist({}) (e.g. inside say()) would otherwise wipe a just-stored code.
  let verifiedCode: string | undefined;
  // Set when this turn deliberately ends the connection. `say()` must not then
  // write the old code back, which is exactly what undid the switch.
  let connectionCleared = false;

  const say = async (body: string) => {
    payload = pushHistory(payload, "assistant", body);
    await deps.sendMessage(chatId, body);
    if (connectionCleared && !verifiedCode) {
      await persist({ invitationCode: null });
      return;
    }
    await persist(verifiedCode ? { invitationCode: verifiedCode } : {});
  };
  payload = pushHistory(payload, "user", inbound.text);

  // `...base` must come FIRST and the patch LAST. With base last, a stale
  // invitationCode overwrote any clearing patch, so "I'm not this person" could
  // never disconnect the chat.
  const persist = (patch: Partial<NewWhatsappSession>) =>
    deps.saveSession({ ...base, step, payload, lastUserMsgAt: deps.now(), waId: key, ...patch });

  // Menu routing on every message (numbers, keywords).
  const route = nextMenuStep(step, inbound.text);

  // A proposed ticket the family is confirming (or declining).
  if (payload.pending) {
    const pending = payload.pending;
    if (YES.test(inbound.text.trim())) {
      payload = { history: payload.history };
      step = "idle";
      try {
        const ticket = await deps.createTicket({
          code: priorCode,
          category: pending.category,
          description: pending.description,
        });
        await say(
          `Done! Aapka request event team ke paas bhej diya. Ticket reference: ${ticket.id
            .slice(0, 8)
            .toUpperCase()} (status: ${ticket.status}).`,
        );
      } catch (e) {
        console.error("telegram ticket failed", key, e);
        await say(
          "Ticket banaane me dikkat aayi. Please portal ke Support se dobara bhejein.",
        );
      }
      return;
    }
    if (NO.test(inbound.text.trim())) {
      payload = { history: payload.history };
      step = "idle";
      await say("Theek hai, cancel kar diya. Aur kuch poochna chahenge?");
      return;
    }
  }
  if (route.step === "idle" && step !== "idle" && !route.value) {
    step = "idle";
    payload = { history: payload.history };
    await say(menuText());
    return;
  }
  // A connected family typing "1" from inside the FAQ state wants the pass, not
  // a new verification. Handled before the idle-only branch below, which would
  // otherwise loop them back into the menu.
  if (route.step === "await_admission" && step !== "idle" && priorCode) {
    try {
      const u = await deps.usage(priorCode);
      const pdf = await buildInvitationPdf({
        code: u.invitation.invitationCode,
        studentName: u.studentName,
        guestLimit: u.invitation.guestLimit,
        qrToken: u.invitation.qrToken,
      });
      await deps.sendDocument(
        chatId,
        pdf,
        `invitation-${priorCode}.pdf`,
        `Aapka invitation pass. Code: ${priorCode}. Gate par ye QR dikhayein.`,
      );
      await persist({});
      return;
    } catch (e) {
      console.error("telegram pass on menu 1 failed", key, priorCode, e);
      await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
      return;
    }
  }
  if (step === "idle") {
    if (route.step === "await_admission") {
      // "1" means "my invitation". If one is already connected, that is the
      // PDF — asking for an admission number again was a pointless hoop.
      if (priorCode) {
        try {
          const u = await deps.usage(priorCode);
          const pdf = await buildInvitationPdf({
            code: u.invitation.invitationCode,
            studentName: u.studentName,
            guestLimit: u.invitation.guestLimit,
            qrToken: u.invitation.qrToken,
          });
          step = "faq";
          await deps.sendDocument(
            chatId,
            pdf,
            `invitation-${priorCode}.pdf`,
            `Aapka invitation pass. Code: ${priorCode}. Gate par ye QR dikhayein.`,
          );
          await persist({});
          return;
        } catch (e) {
          console.error("telegram pass on menu 1 failed", key, priorCode, e);
          await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
          return;
        }
      }
      step = "await_admission";
      await say("Apna admission number bhejein. (Radd karne ke liye 'cancel' likhein.)");
      return;
    }
    if (isMenuRequest(inbound.text)) {
      await say(menuText());
      return;
    }
    // Anything else is a real message: hand it to the agent, no canned reply.
    step = "faq";
  }

  // Stepwise invitation verification: collect 3 fields, then ONE backend call
  // with identical rules + attempt limits as the portal.
  if (step === "await_admission" || step === "await_name" || step === "await_class") {
    const value = route.value ?? inbound.text;
    if (step === "await_admission") {
      payload = { ...payload, admission: value };
      step = "await_name";
      await say("Ab student ka poora naam (full name) bhejein.");
      return;
    }
    if (step === "await_name") {
      payload = { ...payload, name: value };
      step = "await_class";
      await say("Ab class bhejein (jaise 5-A).");
      return;
    }
    const result = await deps.recover(
      { admissionNumber: payload.admission ?? "", name: payload.name ?? "", className: value },
      key,
    );
    if ("recoveredCode" in result && typeof result.recoveredCode === "string") {
      const code = result.recoveredCode;
      verifiedCode = code;
      if (deps.recordContact) {
        try {
          await deps.recordContact(key, code);
        } catch (e) {
          console.error("contact capture failed", key, e);
        }
      }
      // The QR token is a bearer admission credential. A roster identity match
      // proves knowledge, not possession, so the pass is only sent when the
      // school has verified this family's contact. Fails closed: a missing flag
      // means "not allowed".
      if (!("passReleaseAllowed" in result) || result.passReleaseAllowed !== true) {
        payload = { history: payload.history };
        step = "idle";
        await persist({ invitationCode: code });
        // Do not promise an OTP the family cannot receive. With no approved
        // contact on file the portal has nowhere to send a code, so pointing
        // them there (the old wording) sent them into a dead end. Tell them the
        // truth and give the one route that actually works.
        const canOtp = await deps.hasVerifiedContact(code).catch(() => false);
        await say(
          canOtp
            ? `Aapke details match kar gaye. Invitation code: ${code}\nApna pass aur guest list dekhne ke liye portal kholein aur yahan code + OTP daalein: ${PORTAL_URL}/portal`
            : `Aapke details match kar gaye. Invitation code: ${code}\n\nAbhi aapke number par OTP nahi bhej sakte, isliye portal se login nahi hoga. Pass ke liye yahan "pdf" likhein, ya school office se sampark karein.`,
        );
        return;
      }
      try {
        const u = await deps.usage(code);
        const pdf = await buildInvitationPdf({
          code: u.invitation.invitationCode,
          studentName: u.studentName,
          guestLimit: u.invitation.guestLimit,
          qrToken: u.invitation.qrToken,
        });
        payload = { history: payload.history };
        step = "idle";
        await persist({ invitationCode: code });
        await deps.sendDocument(chatId, pdf, `invitation-${code}.pdf`, `Aapka invitation taiyaar hai! Code: ${code}. Gate par ye QR dikhayein.`);
        return;
      } catch (e) {
        console.error("telegram pass fallback", key, code, e);
        payload = { history: payload.history };
        step = "idle";
        await persist({ invitationCode: code });
        await say(
          `Aapka invitation mil gaya! Code: ${code}\nPDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`,
        );
        return;
      }
    }
    step = "idle";
    payload = { history: payload.history };
    await say("Maaf kijiye, ye details hamare record me nahi mili. Dobara koshish ke liye 1 likhein, ya sawal ke liye 2.");
    return;
  }

  // FAQ path: RAG-grounded answer with the stored code + last-8 history.
  const res = await deps.answer(inbound.text, priorCode, payload.history ?? [], key);

  // A family asked to leave the current invitation (wrong family, shared
  // phone). Clear the connection and start verification fresh. Handled before
  // recoveryRequired, which would otherwise swallow it as a plain hint.
  if ("clearInvitation" in res && res.clearInvitation) {
    step = "await_admission";
    payload = { history: payload.history };
    connectionCleared = true;
    await persist({ invitationCode: null });
    await say("reply" in res ? res.reply : "Invitation disconnected. Send your admission number to verify again.");
    return;
  }

  // The family asked for their pass. Send the actual PDF rather than telling
  // them to fetch it from a teacher.
  if ("sendPass" in res && res.sendPass) {
    if (!priorCode) {
      await say("Open your invitation first, then ask me for the pass again.");
      return;
    }
    try {
      const u = await deps.usage(priorCode);
      const pdf = await buildInvitationPdf({
        code: u.invitation.invitationCode,
        studentName: u.studentName,
        guestLimit: u.invitation.guestLimit,
        qrToken: u.invitation.qrToken,
      });
      await deps.sendDocument(chatId, pdf, `invitation-${priorCode}.pdf`, "Aapka invitation pass. Gate par ye QR dikhayein.");
      // sendDocument bypasses say(), so record the exchange explicitly;
      // otherwise the family's request vanishes from the conversation history.
      payload = pushHistory(payload, "assistant", "Sent the invitation PDF with the QR code.");
      await persist({});
      return;
    } catch (e) {
      console.error("telegram pass on request failed", key, priorCode, e);
      await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
      return;
    }
  }

  if ("recoveryRequired" in res && res.recoveryRequired) {
    step = "await_admission";
    await say("Iske liye pehle invitation verify karte hain. Apna admission number bhejein.");
    return;
  }
  if ("action" in res && res.action) {
    if (res.action.kind === "create_ticket") {
      payload = {
        ...payload,
        pending: {
          kind: "create_ticket",
          category: res.action.category,
          description: res.action.description,
        },
      };
      step = "idle";
      await say(
        `Main ye request event team ko bhej sakta hoon:\n“${res.action.description}”\n\nConfirm karne ke liye *yes* likhein, cancel ke liye *no*.`,
      );
      return;
    }
    await say(`Ye kaam portal se hoga (${PORTAL_URL}/portal). Chat me main sirf invitation aur jaankari de sakta hun. Kya poochna chahenge?`);
    return;
  }
  await say("reply" in res ? res.reply : "Thodi der me try karein.");
}
