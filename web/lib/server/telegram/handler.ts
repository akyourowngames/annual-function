import type { answerQuestion } from "@/lib/server/helpdesk";
import type { recoverInvitation } from "@/lib/server/invitation-recovery";
import type { getGuestUsage, createTicketForCode } from "@/lib/db/queries";
import { menuText, nextMenuStep, type WaStep } from "../whatsapp/menu.ts";
import { pushHistory, newSession, type SessionPayload } from "../whatsapp/history.ts";
import { buildInvitationPdf } from "../whatsapp/pass.ts";
import type { NewWhatsappSession } from "@/lib/db/schema";

export type TelegramInbound = { chatId: string; text: string };

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

  const say = async (body: string) => {
    payload = pushHistory(payload, "assistant", body);
    await deps.sendMessage(chatId, body);
    await persist(verifiedCode ? { invitationCode: verifiedCode } : {});
  };
  payload = pushHistory(payload, "user", inbound.text);

  const persist = (patch: Partial<NewWhatsappSession>) =>
    deps.saveSession({ ...base, waId: key, ...patch, step, payload, lastUserMsgAt: deps.now() });

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
  if (step === "idle") {
    if (route.step === "await_admission") {
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
