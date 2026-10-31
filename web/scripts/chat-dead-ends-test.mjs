// Regression tests for the three dead ends from the live Telegram transcript.
//
//   1. "i need pdf"            -> bot said "contact your class teacher"
//   2. "i am not ayansh"       -> chat stayed stuck on AYAANSH forever
//   3. TEST-001 / a connected chat -> recovery tool was hidden, so no way out
//
// The fixes are behavioural, so these drive the real handlers with fake deps.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleTelegramInbound } from "../lib/server/telegram/handler.ts";
import { handleInbound } from "../lib/server/whatsapp/handler.ts";
import { newSession } from "../lib/server/whatsapp/history.ts";

function fakeDeps(overrides = {}) {
  const sent = [];
  const sessions = new Map();
  return {
    sent,
    sessions,
    now: () => new Date("2026-10-30T10:00:00Z"),
    loadSession: async (k) => sessions.get(k) ?? null,
    saveSession: async (s) => sessions.set(s.waId, { ...s, payload: JSON.parse(JSON.stringify(s.payload)) }),
    sendMessage: async (chatId, text) => sent.push({ kind: "text", chatId, text }),
    // WhatsApp's handler calls its text sender `sendText`, not `sendMessage`.
    sendText: async (to, text) => sent.push({ kind: "text", to, text }),
    sendDocument: async (chatId, pdf, filename, caption) =>
      sent.push({ kind: "document", chatId, bytes: pdf?.length ?? 0, filename, caption }),
    recover: async () => ({ recoveredCode: "ANL-TEST", passReleaseAllowed: true }),
    answer: async () => ({ reply: "ok", action: null }),
    usage: async () => ({
      invitation: { invitationCode: "ANL-TEST", qrToken: "qr-1", guestLimit: 2 },
      studentName: "TEST STUDENT",
      registered: 0,
      remaining: 2,
    }),
    createTicket: async () => ({ id: "abcdef12-0000-0000-0000-000000000000", status: "pending" }),
    // The portal can only send an OTP when the school approved a contact.
    hasVerifiedContact: async () => true,
    ...overrides,
  };
}

const tg = (text) => ({ chatId: "424242", text });
const wa = (text) => ({ waId: "919999999999", text });

// A session already connected to a family, as after a successful verification.
function connectedSession(key, code = "ANL-TEST") {
  return { ...newSession(key), waId: key, step: "faq", invitationCode: code, payload: { history: [] } };
}

describe("dead ends from the live transcript", () => {
  it('asking for the PDF sends the document, not "contact your teacher"', async () => {
    const key = "tg:424242";
    const d = fakeDeps({
      answer: async () => ({
        reply: "Here's your invitation pass with the QR code attached.",
        action: null,
        sendPass: true,
        source: "Invitation pass",
      }),
    });
    d.sessions.set(key, connectedSession(key));

    await handleTelegramInbound(tg("i need pdf"), d);

    const doc = d.sent.find((s) => s.kind === "document");
    assert.ok(doc, "the PDF must be attached, not described");
    assert.ok(doc.bytes > 0, "the PDF must not be empty");
    assert.match(doc.filename, /ANL-TEST/);
    assert.ok(
      !d.sent.some((s) => /class teacher|school office/i.test(s.text ?? "")),
      "must not send the family to a teacher for something the bot can do",
    );
  });

  it('"i am not this person" disconnects instead of staying stuck', async () => {
    const key = "tg:424242";
    const d = fakeDeps({
      answer: async () => ({
        reply: "No problem — I've disconnected the invitation that was open.",
        action: null,
        clearInvitation: true,
        recoveryRequired: true,
        source: "Family switch",
      }),
    });
    d.sessions.set(key, connectedSession(key));

    await handleTelegramInbound(tg("i am not ayansh"), d);

    const stored = d.sessions.get(key);
    assert.equal(stored.invitationCode, null, "the wrong invitation must be cleared");
    assert.equal(stored.step, "await_admission", "must move on to verification");
    assert.match(d.sent.at(-1).text, /disconnected|admission/i);
  });

  it("after switching, the family can verify as someone else", async () => {
    const key = "tg:424242";
    const d = fakeDeps({
      answer: async () => ({ reply: "switched", action: null, clearInvitation: true, recoveryRequired: true }),
    });
    d.sessions.set(key, connectedSession(key));

    await handleTelegramInbound(tg("not me"), d);
    // Now walk the normal verification steps.
    await handleTelegramInbound(tg("TEST-001"), d);
    await handleTelegramInbound(tg("TEST STUDENT"), d);
    await handleTelegramInbound(tg("TEST CLASS"), d);

    const stored = d.sessions.get(key);
    assert.equal(stored.invitationCode, "ANL-TEST", "a new invitation must attach");
  });

  it("never promises an OTP when the family has no approved contact", async () => {
    // The old wording sent every verified family to /portal to "enter code +
    // OTP", but with no approved contact no code can ever be sent — a dead end
    // dressed up as an instruction.
    const key = "tg:424242";
    const d = fakeDeps({
      // Identity matched, but the pass is withheld (no approved contact).
      recover: async () => ({ recoveredCode: "ANL-TEST", passReleaseAllowed: false }),
      hasVerifiedContact: async () => false,
    });
    d.sessions.set(key, { ...newSession(key), waId: key, step: "await_admission", payload: {} });

    await handleTelegramInbound(tg("TEST-001"), d);
    await handleTelegramInbound(tg("TEST STUDENT"), d);
    await handleTelegramInbound(tg("TEST CLASS"), d);

    const said = d.sent.map((s) => s.text ?? "").join("\n");
    assert.ok(
      !/OTP daalein|enter .*OTP|code \+ OTP/i.test(said),
      `must not tell them to enter an OTP they cannot receive:\n${said}`,
    );
    assert.match(said, /pdf|office/i, "must offer a route that actually works");
  });

  it("does promise the portal when a contact IS approved", async () => {
    const key = "tg:424242";
    const d = fakeDeps({
      recover: async () => ({ recoveredCode: "ANL-TEST", passReleaseAllowed: false }),
      hasVerifiedContact: async () => true,
    });
    d.sessions.set(key, { ...newSession(key), waId: key, step: "await_admission", payload: {} });

    await handleTelegramInbound(tg("TEST-001"), d);
    await handleTelegramInbound(tg("TEST STUDENT"), d);
    await handleTelegramInbound(tg("TEST CLASS"), d);

    const said = d.sent.map((s) => s.text ?? "").join("\n");
    assert.match(said, /portal/i, "with an approved contact the portal link is correct");
  });

  it('"1" while already connected sends the PDF instead of asking for details again', async () => {
    const key = "tg:424242";
    const d = fakeDeps();
    d.sessions.set(key, connectedSession(key));

    await handleTelegramInbound(tg("1"), d);

    const doc = d.sent.find((s) => s.kind === "document");
    assert.ok(doc, '"1" must deliver the pass when one is already connected');
    assert.ok(
      !d.sent.some((s) => /admission number bhejein/i.test(s.text ?? "")),
      "must not ask for an admission number it already knows",
    );
  });
});

describe("whatsapp has the same escape hatches", () => {
  it("sends the payload when the family asks for their PDF", async () => {
    const key = "919999999999";
    const d = fakeDeps({
      answer: async () => ({ reply: "pass attached", action: null, sendPass: true }),
      sendPass: async (to, pdf, filename, caption) =>
        d.sent.push({ kind: "pass", to, bytes: pdf?.length ?? 0, filename, caption }),
    });
    d.sessions.set(key, connectedSession(key));

    await handleInbound(wa("i need pdf"), d);
    const pass = d.sent.find((s) => s.kind === "pass");
    assert.ok(pass, "WhatsApp must attach the pass too");
    assert.ok(pass.bytes > 0);
  });

  it("disconnects on a wrong-family claim", async () => {
    const key = "919999999999";
    const d = fakeDeps({
      answer: async () => ({ reply: "disconnected", action: null, clearInvitation: true, recoveryRequired: true }),
      sendPass: async () => {},
    });
    d.sessions.set(key, connectedSession(key));

    await handleInbound(wa("not me"), d);
    const stored = d.sessions.get(key);
    assert.equal(stored.invitationCode, null);
    assert.equal(stored.step, "await_admission");
  });
});
