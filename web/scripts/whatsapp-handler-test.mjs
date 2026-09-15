import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleInbound } from "../lib/server/whatsapp/handler.ts";
import { pushHistory, newSession } from "../lib/server/whatsapp/history.ts";

function fakeDeps(overrides = {}) {
  const sent = [];
  const sessions = new Map();
  return {
    sent,
    sessions,
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
    createTicket: async () => ({ id: "abcdef12-9999-9999-9999-999999999999", status: "pending" }),
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
  it("media fallback still stores the code and sends the portal link", async () => {
    const d = fakeDeps({
      sendPass: async () => {
        throw new Error("upload down");
      },
    });
    await handleInbound(inbound("1"), d);
    await handleInbound(inbound("A-123"), d);
    await handleInbound(inbound("Aarav Sharma"), d);
    await handleInbound(inbound("5-A"), d);
    assert.match(d.sent.at(-1).body, /portal/i);
    assert.match(d.sent.at(-1).body, /ABC-123/);
    const stored = d.sessions.get("919999999999");
    assert.ok(stored, "expected a session to be stored");
    assert.equal(stored.invitationCode, "ABC-123");
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
    await handleInbound(inbound("2"), d);
    await handleInbound(inbound("ye galat hai, ticket banao"), d);
    assert.match(d.sent.at(-1).body, /yes/i);
    assert.equal(created, null, "must not create before confirmation");
    await handleInbound(inbound("yes"), d);
    assert.ok(created, "expected the ticket to be created after confirmation");
    assert.equal(created.description, "Wrong venue shown");
    assert.match(d.sent.at(-1).body, /ABCDEF12/);
  });
  it("declining a proposed ticket cancels it and creates nothing", async () => {
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
    await handleInbound(inbound("2"), d);
    await handleInbound(inbound("ticket banao"), d);
    await handleInbound(inbound("no"), d);
    assert.equal(created, null);
    assert.match(d.sent.at(-1).body, /cancel/i);
  });
  it("stored history contains both user and assistant turns after an FAQ exchange", async () => {
    const d = fakeDeps();
    await handleInbound(inbound("2"), d);
    await handleInbound(inbound("Program kab shuru hoga?"), d);
    const stored = d.sessions.get("919999999999");
    assert.ok(stored, "expected a session to be stored");
    const history = stored.payload.history ?? [];
    assert.ok(
      history.some((t) => t.role === "user" && /shuru hoga/.test(t.content)),
      "expected the user question in stored history",
    );
    assert.ok(
      history.some((t) => t.role === "assistant" && /5 baje/.test(t.content)),
      "expected the assistant reply in stored history",
    );
  });
  it("shared history helpers cap at 8 and new sessions start idle", () => {
    let p = {};
    for (let i = 0; i < 10; i++) p = pushHistory(p, "user", `m${i}`);
    assert.equal(p.history.length, 8);
    assert.equal(p.history[0].content, "m2");
    assert.equal(p.history.at(-1).content, "m9");
    const s = newSession("919999999999");
    assert.equal(s.waId, "919999999999");
    assert.equal(s.step, "idle");
    assert.deepEqual(s.payload, {});
  });
});
