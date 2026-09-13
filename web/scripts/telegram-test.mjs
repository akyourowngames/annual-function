import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleTelegramInbound, parseTelegramUpdate } from "../lib/server/telegram/handler.ts";

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
  it("FAQ path answers from docs via the tg clientKey", async () => {
    let seenKey = null;
    const d = fakeDeps({
      answer: async (message, code, history, clientKey) => {
        seenKey = clientKey;
        assert.match(message, /shuru/);
        return { reply: "Karyakram shaam 5 baje shuru hoga.", action: null };
      },
    });
    await handleTelegramInbound(inbound("2"), d);
    await handleTelegramInbound(inbound("Program kab shuru hoga?"), d);
    assert.equal(seenKey, "tg:424242");
    assert.match(d.sent.at(-1).text, /5 baje/);
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
