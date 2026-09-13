import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleInbound } from "../lib/server/whatsapp/handler.ts";

function fakeDeps(overrides = {}) {
  const sent = [];
  const sessions = new Map();
  return {
    sent,
    now: () => new Date("2026-09-12T10:00:00Z"),
    loadSession: async (waId) => sessions.get(waId) ?? null,
    saveSession: async (s) => {
      sessions.set(s.waId, { ...s, payload: JSON.parse(JSON.stringify(s.payload)) });
    },
    sendText: async (to, body) => {
      sent.push({ kind: "text", to, body });
    },
    sendPass: async (to, pdf, filename, caption) => {
      sent.push({ kind: "pass", to, bytes: pdf.length, filename, caption });
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
const inbound = (text, waId = "919999999999", buttonId) => ({ waId, text, buttonId });

describe("whatsapp handler", () => {
  it("unknown text gets the menu", async () => {
    const d = fakeDeps();
    await handleInbound(inbound("Namaste"), d);
    assert.match(d.sent[0].body, /1.*invitation/i);
  });
  it("walks admission -> name -> class then sends the pass PDF", async () => {
    const d = fakeDeps();
    await handleInbound(inbound("1"), d);
    assert.match(d.sent[0].body, /admission/i);
    await handleInbound(inbound("A-123"), d);
    assert.match(d.sent[1].body, /naam|name/i);
    await handleInbound(inbound("Aarav Sharma"), d);
    assert.match(d.sent[2].body, /class/i);
    await handleInbound(inbound("5-A"), d);
    const pass = d.sent.find((s) => s.kind === "pass");
    assert.ok(pass, "expected a pass document to be sent");
    assert.match(pass.caption, /ABC-123/);
  });
  it("failed verification replies honestly and resets to menu", async () => {
    const d = fakeDeps({ recover: async () => ({ recoveryRequired: true }) });
    await handleInbound(inbound("1"), d);
    await handleInbound(inbound("A-999"), d);
    await handleInbound(inbound("Nobody"), d);
    await handleInbound(inbound("9-Z"), d);
    assert.match(d.sent.at(-1).body, /nahi mil|not found/i);
  });
  it("FAQ path answers from docs and keeps idle step", async () => {
    const d = fakeDeps();
    await handleInbound(inbound("2"), d);
    await handleInbound(inbound("Program kab shuru hoga?"), d);
    assert.match(d.sent.at(-1).body, /5 baje/);
  });
  it("faq action replies are portal-directed, never executed in chat", async () => {
    const d = fakeDeps({ answer: async () => ({ reply: "x", action: { type: "register_guest", data: {} } }) });
    await handleInbound(inbound("2"), d);
    await handleInbound(inbound("guest add karo"), d);
    assert.match(d.sent.at(-1).body, /portal/i);
  });
});
