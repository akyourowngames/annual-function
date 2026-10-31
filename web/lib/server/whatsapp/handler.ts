import type { answerQuestion } from "@/lib/server/helpdesk";
import type { recoverInvitation } from "@/lib/server/invitation-recovery";
import type { getGuestUsage, createTicketForCode } from "@/lib/db/queries";
import { menuText, nextMenuStep, type Inbound, type WaStep } from "./menu.ts";
import { pushHistory, newSession, type SessionPayload } from "./history.ts";
import { buildInvitationPdf } from "./pass.ts";
import type { NewWhatsappSession } from "@/lib/db/schema";

export type HandlerDeps = {
  now: () => Date;
  loadSession: (waId: string) => Promise<{ step: string; payload: unknown; invitationCode: string | null } | null>;
  saveSession: (s: NewWhatsappSession) => Promise<void>;
  sendText: (to: string, body: string) => Promise<unknown>;
  sendPass: (to: string, pdf: Buffer, filename: string, caption: string) => Promise<void>;
  recover: typeof recoverInvitation;
  answer: typeof answerQuestion;
  usage: typeof getGuestUsage;
  createTicket: typeof createTicketForCode;
  recordContact?: (key: string, code: string) => Promise<void>;
  /** True when the school has an approved OTP destination for this invitation. */
  hasVerifiedContact: (code: string) => Promise<boolean>;
};

// NOTE on imports: the brain/DB modules (and ./session, which pulls
// `@/lib/db`) cannot be statically imported here because unit tests run
// under plain `node --test`, which does not resolve the tsconfig `@/`
// alias. Types are still checked against the real modules via
// `import type`, pure session helpers come from dependency-free
// ./history, and liveDeps below binds the real implementations through
// deferred dynamic imports (resolved by Next.js at runtime; never
// executed in tests).
export const liveDeps: HandlerDeps = {
  now: () => new Date(),
  loadSession: (waId: string) => import("./session").then((m) => m.loadSession(waId)),
  saveSession: (s: NewWhatsappSession) => import("./session").then((m) => m.saveSession(s)),
  sendText: async () => {
    throw new Error("liveDeps.sendText not wired");
  },
  sendPass: async () => {
    throw new Error("liveDeps.sendPass not wired");
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

export async function handleInbound(inbound: Inbound, deps: HandlerDeps): Promise<void> {
  const { waId } = inbound;
  const existing = await deps.loadSession(waId);
  const base = existing ?? { ...newSession(waId), lastUserMsgAt: deps.now() };
  let step = (base.step ?? "idle") as WaStep;
  let payload = payloadOf(base.payload);
  const priorCode = ("invitationCode" in base ? base.invitationCode : null) ?? undefined;
  // Keep the family's reachable endpoint fresh on every message once verified.
  if (deps.recordContact && priorCode) {
    try {
      await deps.recordContact(`wa:${waId}`, priorCode);
    } catch (e) {
      console.error("contact capture failed", waId, e);
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
    await deps.sendText(waId, body);
    if (connectionCleared && !verifiedCode) {
      await persist({ invitationCode: null });
      return;
    }
    await persist(verifiedCode ? { invitationCode: verifiedCode } : {});
  };
  payload = pushHistory(payload, "user", inbound.text || inbound.buttonId || "");

  // `...base` must come FIRST and the patch LAST. With base last, a stale
  // invitationCode overwrote any clearing patch, so "I'm not this person" could
  // never disconnect the chat.
  const persist = (patch: Partial<NewWhatsappSession>) =>
    deps.saveSession({ ...base, step, payload, lastUserMsgAt: deps.now(), waId, ...patch });

  // Menu routing on every message (buttons "invite"/"faq", numbers, keywords).
  const route = nextMenuStep(step, inbound.text, inbound.buttonId);

  // A proposed ticket the family is confirming (or declining).
  if (payload.pending) {
    const pending = payload.pending;
    const answer = (inbound.text || inbound.buttonId || "").trim();
    if (YES.test(answer)) {
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
        console.error("whatsapp ticket failed", waId, e);
        await say(
          "Ticket banaane me dikkat aayi. Please portal ke Support se dobara bhejein.",
        );
      }
      return;
    }
    if (NO.test(answer)) {
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
      await deps.sendPass(
        waId,
        pdf,
        `invitation-${priorCode}.pdf`,
        `Aapka invitation pass. Code: ${priorCode}. Gate par ye QR dikhayein.`,
      );
      await persist({});
      return;
    } catch (e) {
      console.error("whatsapp pass on menu 1 failed", waId, priorCode, e);
      await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
      return;
    }
  }
  if (step === "idle") {
    if (route.step === "await_admission") {
      // "1" means "my invitation". If one is already connected, that IS the
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
          await deps.sendPass(
            waId,
            pdf,
            `invitation-${priorCode}.pdf`,
            `Aapka invitation pass. Code: ${priorCode}. Gate par ye QR dikhayein.`,
          );
          await persist({});
          return;
        } catch (e) {
          console.error("whatsapp pass on menu 1 failed", waId, priorCode, e);
          await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
          return;
        }
      }
      step = "await_admission";
      await say("Apna **admission number** bhejein. (Radd karne ke liye 'cancel' likhein.)");
      return;
    }
    if (route.step === "faq") {
      step = "faq";
      await say("Apna sawal likhkar bhejein — schedule, venue, dress code, parking, kuch bhi.");
      return;
    }
    await say(menuText());
    return;
  }

  // Stepwise invitation verification: collect 3 fields, then ONE backend call
  // with identical rules + attempt limits as the portal.
  if (step === "await_admission" || step === "await_name" || step === "await_class") {
    const value = route.value ?? inbound.text;
    if (step === "await_admission") {
      payload = { ...payload, admission: value };
      step = "await_name";
      await say("Ab student ka **poora naam** (full name) bhejein.");
      return;
    }
    if (step === "await_name") {
      payload = { ...payload, name: value };
      step = "await_class";
      await say("Ab **class** bhejein (jaise 5-A).");
      return;
    }
    const result = await deps.recover(
      { admissionNumber: payload.admission ?? "", name: payload.name ?? "", className: value },
      `wa:${waId}`,
    );
    if ("recoveredCode" in result && typeof result.recoveredCode === "string") {
      const code = result.recoveredCode;
      verifiedCode = code;
      if (deps.recordContact) {
        try {
          await deps.recordContact(`wa:${waId}`, code);
        } catch (e) {
          console.error("contact capture failed", waId, e);
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
        // them there (the old wording) sent them into a dead end.
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
        await deps.sendPass(waId, pdf, `invitation-${code}.pdf`, `Aapka invitation taiyaar hai! Code: ${code}. Gate par ye QR dikhayein.`);
        return;
      } catch (e) {
        console.error("whatsapp pass fallback", waId, code, e);
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
  const res = await deps.answer(inbound.text, priorCode, payload.history ?? [], `wa:${waId}`);

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
      await deps.sendPass(waId, pdf, `invitation-${priorCode}.pdf`, "Aapka invitation pass. Gate par ye QR dikhayein.");
      // sendPass bypasses say(), so record the exchange explicitly; otherwise
      // the family's request vanishes from the conversation history.
      payload = pushHistory(payload, "assistant", "Sent the invitation PDF with the QR code.");
      await persist({});
      return;
    } catch (e) {
      console.error("whatsapp pass on request failed", waId, priorCode, e);
      await say(`PDF bhejne me dikkat aayi — portal se download karein: ${PORTAL_URL}/portal`);
      return;
    }
  }

  if ("recoveryRequired" in res && res.recoveryRequired) {
    step = "await_admission";
    await say("Iske liye pehle invitation verify karte hain. Apna **admission number** bhejein.");
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
