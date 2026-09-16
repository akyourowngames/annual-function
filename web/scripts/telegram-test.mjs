import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleTelegramInbound, parseTelegramUpdate, parseTelegramVoice } from "../lib/server/telegram/handler.ts";
import { heardPrefix, tooLong } from "../lib/server/telegram/voice.ts";

function fakeDeps(overrides = {}) {
  const sent = [];
  const sessions = new Map();
  return {
    sent,
    sessions,
    now: () => new Date("2026-09-12T10:00:00Z"),
    loadSession: async (key) => sessions.get(key) ?? null,
    saveSession: async (s) => {
      sessions.set(s.waId, { ...s, payload: JSON.parse(JSON.stringify(s.payload)) });
    },
    sendMessage: async (chatId, text) => {
      sent.push({ kind: "text", chatId, text });
    },
    sendDocument: async (chatId, pdf, filename, caption) => {
      sent.push({ kind: "document", chatId, bytes: pdf.length, filename, caption });
    },
    recover: async () => ({ recoveredCode: "ABC-123" }),
    answer: async () => ({ reply: "Karyakram shaam 5 baje shuru hoga.", action: null }),
    usage: async () => ({
      invitation: { invitationCode: "ABC-123", qrToken: "qr-1", guestLimit: 2 },
      studentName: "Aarav Sharma",
      registered: 0,
      remaining: 2,
    }),
    createTicket: async () => ({ id: "abcdef12-9999-9999-9999-999999999999", status: "pending" }),
    ...overrides,
  };
}
const inbound = (text, chatId = "424242") => ({ chatId, text });
const update = (message) => ({ update_id: 1, message });

describe("telegram handler", () => {
  it("walks 1 -> admission -> name -> class, stores invitationCode, sends the PDF", async () => {
    let seenKey = null;
    const d = fakeDeps({
      recover: async (identity, clientKey) => {
        seenKey = clientKey;
        assert.equal(identity.admissionNumber, "A-123");
        assert.equal(identity.name, "Aarav Sharma");
        assert.equal(identity.className, "5-A");
        return { recoveredCode: "ABC-123" };
      },
    });
    await handleTelegramInbound(inbound("1"), d);
    assert.match(d.sent[0].text, /admission/i);
    await handleTelegramInbound(inbound("A-123"), d);
    assert.match(d.sent[1].text, /naam|name/i);
    await handleTelegramInbound(inbound("Aarav Sharma"), d);
    assert.match(d.sent[2].text, /class/i);
    await handleTelegramInbound(inbound("5-A"), d);
    assert.equal(seenKey, "tg:424242");
    const doc = d.sent.find((s) => s.kind === "document");
    assert.ok(doc, "expected a document to be sent");
    assert.equal(doc.filename, "invitation-ABC-123.pdf");
    assert.match(doc.caption, /ABC-123/);
    assert.ok(doc.bytes > 0, "expected a non-empty PDF buffer");
    const stored = d.sessions.get("tg:424242");
    assert.ok(stored, "expected a session to be stored");
    assert.equal(stored.invitationCode, "ABC-123");
  });
  it("FAQ path answers free text from the agent via the tg clientKey", async () => {
    let seenKey = null;
    let seenMessage = null;
    const d = fakeDeps({
      answer: async (message, code, history, clientKey) => {
        seenKey = clientKey;
        seenMessage = message;
        return { reply: "Karyakram shaam 5 baje shuru hoga.", action: null };
      },
    });
    await handleTelegramInbound(inbound("Program kab shuru hoga?"), d);
    assert.equal(seenKey, "tg:424242");
    assert.match(seenMessage, /shuru/);
    assert.match(d.sent.at(-1).text, /5 baje/);
  });
  it("routes a greeting straight to the agent, not a canned menu", async () => {
    let answered = 0;
    const d = fakeDeps({
      answer: async () => {
        answered++;
        return { reply: "Namaste! Main aapki kaise madad karun?", action: null };
      },
    });
    await handleTelegramInbound(inbound("hi"), d);
    assert.equal(answered, 1);
    assert.equal(d.sent.length, 1);
    assert.doesNotMatch(d.sent[0].text, /Reply 1 ya 2/);
  });
  it("still shows the menu when explicitly asked", async () => {
    const d = fakeDeps();
    await handleTelegramInbound(inbound("menu"), d);
    assert.match(d.sent[0].text, /1\. Get my invitation/);
  });
  it("proposes a ticket, then creates it only after the family confirms", async () => {
    let created = null;
    const d = fakeDeps({
      answer: async () => ({
        reply: "x",
        action: { kind: "create_ticket", category: "venue", description: "Wrong venue shown" },
      }),
      createTicket: async (input) => {
        created = input;
        return { id: "abcdef12-9999-9999-9999-999999999999", status: "pending" };
      },
    });
    await handleTelegramInbound(inbound("raise a ticket for the wrong venue"), d);
    assert.match(d.sent.at(-1).text, /yes/i);
    assert.equal(created, null, "must not create before confirmation");
    await handleTelegramInbound(inbound("yes"), d);
    assert.ok(created, "expected the ticket to be created after confirmation");
    assert.match(d.sent.at(-1).text, /ABCDEF12/);
  });
  it("declining a proposed ticket creates nothing", async () => {
    let created = null;
    const d = fakeDeps({
      answer: async () => ({
        reply: "x",
        action: { kind: "create_ticket", category: "venue", description: "Wrong venue shown" },
      }),
      createTicket: async (input) => {
        created = input;
        return { id: "abcdef12-9999-9999-9999-999999999999", status: "pending" };
      },
    });
    await handleTelegramInbound(inbound("ticket banao"), d);
    await handleTelegramInbound(inbound("no"), d);
    assert.equal(created, null);
    assert.match(d.sent.at(-1).text, /cancel/i);
  });
  it("media failure still stores the code and sends the portal link", async () => {
    const d = fakeDeps({
      sendDocument: async () => {
        throw new Error("upload down");
      },
    });
    await handleTelegramInbound(inbound("1"), d);
    await handleTelegramInbound(inbound("A-123"), d);
    await handleTelegramInbound(inbound("Aarav Sharma"), d);
    await handleTelegramInbound(inbound("5-A"), d);
    assert.match(d.sent.at(-1).text, /portal/i);
    assert.match(d.sent.at(-1).text, /ABC-123/);
    const stored = d.sessions.get("tg:424242");
    assert.ok(stored, "expected a session to be stored");
    assert.equal(stored.invitationCode, "ABC-123");
  });
  it("non-text update parses to null -> route would answer {ok:true} with no sends", async () => {
    const d = fakeDeps();
    const parsed = parseTelegramUpdate(
      update({ message_id: 7, chat: { id: 424242 }, sticker: { file_id: "zzz" } }),
    );
    assert.equal(parsed, null);
    assert.equal(d.sent.length, 0);
    const textParsed = parseTelegramUpdate(update({ message_id: 8, chat: { id: 424242 }, text: "1" }));
    assert.deepEqual(textParsed, { chatId: "424242", text: "1" });
  });
});

describe("telegram voice notes", () => {
  const chat = { id: 424242 };
  it("reads a voice note", () => {
    const r = parseTelegramVoice(
      update({ chat, voice: { file_id: "v1", mime_type: "audio/ogg", duration: 7 } }),
    );
    assert.deepEqual(r, { chatId: "424242", fileId: "v1", mime: "audio/ogg", duration: 7 });
  });
  it("reads an audio file and defaults mime/duration", () => {
    const r = parseTelegramVoice(update({ chat, audio: { file_id: "a1" } }));
    assert.equal(r.fileId, "a1");
    assert.equal(r.mime, "audio/ogg");
    assert.equal(r.duration, 0);
  });
  it("ignores text, photos, and empty updates", () => {
    assert.equal(parseTelegramVoice(update({ chat, text: "hi" })), null);
    assert.equal(parseTelegramVoice(update({ chat, photo: [{ file_id: "p" }] })), null);
    assert.equal(parseTelegramVoice({}), null);
  });
  it("shows what was heard, and flags long clips", () => {
    const saved = process.env.TELEGRAM_SHOW_TRANSCRIPT;
    delete process.env.TELEGRAM_SHOW_TRANSCRIPT;
    assert.equal(heardPrefix("  set   guest limit 6 "), "Heard: “set guest limit 6”");
    assert.equal(heardPrefix("   "), null);
    process.env.TELEGRAM_SHOW_TRANSCRIPT = "0";
    assert.equal(heardPrefix("anything"), null);
    if (saved === undefined) delete process.env.TELEGRAM_SHOW_TRANSCRIPT;
    else process.env.TELEGRAM_SHOW_TRANSCRIPT = saved;
    assert.equal(tooLong(181), true);
    assert.equal(tooLong(30), false);
  });
});
