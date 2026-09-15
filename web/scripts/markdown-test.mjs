import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { toTelegramHtml, toWhatsappMarkup, stripMarkdown } from "../lib/server/markdown.ts";
import { sendMessage } from "../lib/server/telegram/client.ts";

describe("markdown -> telegram html", () => {
  it("renders bold, headings, and bullets", () => {
    assert.equal(toTelegramHtml("**Parking:** Gate 2"), "<b>Parking:</b> Gate 2");
    assert.equal(
      toTelegramHtml("# Schedule\n- Arrival\n- Dinner"),
      "<b>Schedule</b>\n• Arrival\n• Dinner",
    );
  });
  it("escapes html entities and renders inline code", () => {
    assert.equal(toTelegramHtml("a < b & c"), "a &lt; b &amp; c");
    assert.equal(toTelegramHtml("use `yes` to confirm"), "use <code>yes</code> to confirm");
  });
  it("never formats inside code blocks", () => {
    assert.equal(
      toTelegramHtml("```\nraw *text* **here**\n```"),
      "<pre>raw *text* **here**</pre>",
    );
  });
  it("renders italic and drops stray markers", () => {
    assert.equal(toTelegramHtml("*soft*"), "<i>soft</i>");
    assert.equal(toTelegramHtml("leftover ** marker"), "leftover  marker");
  });
});

describe("markdown -> whatsapp markup", () => {
  it("converts bold/headings to single-asterisk bold and bullets to dots", () => {
    assert.equal(toWhatsappMarkup("**Parking:** free"), "*Parking:* free");
    assert.equal(toWhatsappMarkup("# Schedule"), "*Schedule*");
    assert.equal(toWhatsappMarkup("- one\n- two"), "• one\n• two");
  });
  it("leaves plain text untouched", () => {
    assert.equal(toWhatsappMarkup("Namaste"), "Namaste");
  });
});

describe("stripMarkdown", () => {
  it("removes markers for plain channels", () => {
    assert.equal(stripMarkdown("**Bold** text"), "Bold text");
    assert.equal(stripMarkdown("# Heading"), "Heading");
    assert.equal(stripMarkdown("use `yes`"), "use yes");
  });
});

describe("telegram client formatting", () => {
  const realFetch = globalThis.fetch;
  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedToken;
  });
  it("sends HTML parse mode, then retries plain if Telegram rejects it", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1)
        return { ok: false, status: 400, json: async () => ({ ok: false, description: "can't parse entities" }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    };
    await sendMessage("1", "**Bold** text");
    assert.equal(calls.length, 2, "expected a plain retry");
    assert.equal(calls[0].parse_mode, "HTML");
    assert.equal(calls[0].text, "<b>Bold</b> text");
    assert.equal(calls[1].parse_mode, undefined);
    assert.equal(calls[1].text, "Bold text");
  });
});
