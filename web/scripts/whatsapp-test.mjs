import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasLlmKey, llmConfig, chatCompletion, messageText } from "../lib/server/llm-client.ts";
import { menuText, nextMenuStep, needsTemplate, parseWebhookBody } from "../lib/server/whatsapp/menu.ts";
import {
  verifySignature,
  sendText,
  sendTemplate,
  sendTextWithTemplateFallback,
} from "../lib/server/whatsapp/client.ts";
import { buildInvitationPdf } from "../lib/server/whatsapp/pass.ts";

describe("llm-client", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("prefers LLM_* vars and falls back to OPENAI_* vars", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_MODEL = "gpt-4.1-mini";
    assert.equal(hasLlmKey(), true);
    assert.equal(llmConfig().model, "gpt-4.1-mini");
    process.env.LLM_API_KEY = "other-key";
    process.env.LLM_MODEL = "custom-model";
    assert.equal(llmConfig().apiKey, "other-key");
    assert.equal(llmConfig().model, "custom-model");
  });
  it("reports no key when neither var is set", () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal(hasLlmKey(), false);
  });
  it("defaults base URL to the Kilo gateway and strips trailing slash", () => {
    delete process.env.LLM_BASE_URL;
    assert.equal(llmConfig().baseUrl, "https://api.kilo.ai/api/gateway");
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1/";
    assert.equal(llmConfig().baseUrl, "https://gateway.example.com/v1");
  });
});

describe("chatCompletion", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let seen;
  beforeEach(() => {
    seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
      };
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("posts to {baseUrl}/chat/completions with bearer key and LLM_MODEL override", async () => {
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "custom-model";
    await chatCompletion({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(seen.url, "https://gateway.example.com/v1/chat/completions");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, "custom-model");
    assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  });
  it("falls back to OPENAI_MODEL and then the free default model", async () => {
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1";
    process.env.LLM_API_KEY = "test-key";
    delete process.env.LLM_MODEL;
    process.env.OPENAI_MODEL = "gpt-x";
    await chatCompletion({ messages: [] });
    assert.equal(JSON.parse(seen.init.body).model, "gpt-x");
    delete process.env.OPENAI_MODEL;
    await chatCompletion({ messages: [] });
    assert.equal(JSON.parse(seen.init.body).model, "kilo-auto/free");
  });
  it("fails over to the next model when one errors", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "primary-model";
    const tried = [];
    globalThis.fetch = async (url, init) => {
      tried.push(JSON.parse(init.body).model);
      if (tried.length === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "recovered" } }] }) };
    };
    const out = await chatCompletion({ messages: [] });
    assert.equal(tried[0], "primary-model");
    assert.ok(tried.length >= 2, "expected a fallback attempt");
    assert.equal(out.choices[0].message.content, "recovered");
  });
  it("fails over when a model replies with empty content", async () => {
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "empty-model";
    const tried = [];
    globalThis.fetch = async (url, init) => {
      tried.push(JSON.parse(init.body).model);
      if (tried.length === 1)
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] }) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "second" } }] }) };
    };
    const out = await chatCompletion({ messages: [] });
    assert.ok(tried.length >= 2);
    assert.equal(out.choices[0].message.content, "second");
  });
  it("passes through max_tokens, temperature, and tools", async () => {
    process.env.LLM_API_KEY = "test-key";
    await chatCompletion({
      messages: [],
      max_tokens: 700,
      temperature: 0.3,
      tools: [{ type: "function", function: { name: "get_invitation", parameters: {} } }],
    });
    const body = JSON.parse(seen.init.body);
    assert.equal(body.max_tokens, 700);
    assert.equal(body.temperature, 0.3);
    assert.equal(body.tools[0].function.name, "get_invitation");
  });
  it("rejects with AI provider HTTP on non-OK response", async () => {
    process.env.LLM_API_KEY = "test-key";
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(() => chatCompletion({ messages: [] }), /AI provider HTTP/);
  });
  it("rejects when no key is configured", async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(() => chatCompletion({ messages: [] }), /not configured/);
  });
  it("flattens string and content-part assistant text", () => {
    assert.equal(messageText("hello"), "hello");
    assert.equal(messageText([{ text: "a" }, { text: "b" }]), "ab");
    assert.equal(messageText(null), "");
  });
});

describe("whatsapp menu", () => {
  it("parses text, buttons, list replies, and image messages", () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            messages: [
              { from: "919999999999", type: "text", text: { body: "  Hi " } },
              { from: "918888888888", type: "interactive", interactive: { button_reply: { id: "invite", title: "Get invitation" } } },
              { from: "917777777777", type: "interactive", interactive: { list_reply: { id: "faq", title: "Ask" } } },
              { from: "919999999999", type: "image", image: { id: "x" } },
            ],
          },
        }],
      }],
    };
    assert.deepStrictEqual(parseWebhookBody(body), [
      { waId: "919999999999", text: "Hi" },
      { waId: "918888888888", text: "", buttonId: "invite" },
      { waId: "917777777777", text: "", buttonId: "faq" },
      { waId: "919999999999", text: "", media: { id: "x", mime: "image/jpeg", caption: "" } },
    ]);
  });
  it("offers invitation vs question with numbered fallback", () => {
    assert.match(menuText(), /1.*invitation/i);
    assert.match(menuText(), /2.*question/i);
  });
  it("walks idle -> admission -> name -> class, resets on menu/cancel", () => {
    assert.equal(nextMenuStep("idle", "1").step, "await_admission");
    assert.equal(nextMenuStep("idle", "2").step, "faq");
    assert.equal(nextMenuStep("await_name", "cancel").step, "idle");
    assert.equal(nextMenuStep("await_class", "menu").step, "idle");
    const keep = nextMenuStep("await_admission", "A-123");
    assert.equal(keep.step, "await_admission");
    assert.equal(keep.value, "A-123");
  });
  it("flags sessions older than 24h for template-only replies", () => {
    const now = new Date("2026-09-12T10:00:00Z");
    assert.equal(needsTemplate("2026-09-11T09:00:00Z", now), true);
    assert.equal(needsTemplate("2026-09-11T11:00:00Z", now), false);
  });
  it("skips malformed non-array changes/messages without throwing", () => {
    assert.deepStrictEqual(parseWebhookBody({ entry: [{ changes: 5 }] }), []);
    assert.deepStrictEqual(parseWebhookBody({ entry: [{ changes: [{ value: { messages: { from: "919999999999" } } }] }] }), []);
    assert.deepStrictEqual(parseWebhookBody({ entry: "nope" }), []);
  });
  it("returns no value for blank stepwise input", () => {
    for (const step of ["await_admission", "await_name", "await_class"]) {
      const res = nextMenuStep(step, "   ");
      assert.equal(res.step, step);
      assert.equal("value" in res, false);
    }
  });
});

describe("whatsapp client", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.WHATSAPP_TOKEN = "test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
    process.env.WHATSAPP_APP_SECRET = "secret";
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      if (body.text?.body === "trigger-window-error") {
        return { ok: false, status: 400, json: async () => ({ error: { code: 470, message: "outside the allowed window" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("verifies X-Hub-Signature-256 with a fixed vector", async () => {
    const { createHmac } = await import("node:crypto");
    const raw = '{"hello":"world"}';
    const sig = "sha256=" + createHmac("sha256", "secret").update(raw).digest("hex");
    assert.equal(verifySignature(raw, sig), true);
    assert.equal(verifySignature(raw, "sha256=deadbeef"), false);
    assert.equal(verifySignature(raw, null), false);
  });
  it("sends text to the Graph messages endpoint", async () => {
    await sendText("919999999999", "Namaste");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/12345/messages");
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), {
      messaging_product: "whatsapp",
      to: "919999999999",
      type: "text",
      text: { body: "Namaste" },
    });
  });
  it("retries once with the faq_followup template on 24h-window errors", async () => {
    await sendTextWithTemplateFallback("919999999999", "trigger-window-error");
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[1].init.body).template.name, "faq_followup");
  });
  it("does not retry templates on other errors", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
    await assert.rejects(() => sendText("919999999999", "hi"), /WhatsApp send failed/);
  });
});

describe("invitation pass pdf", () => {
  it("builds a non-empty PDF starting with the PDF magic header", async () => {
    const pdf = await buildInvitationPdf({
      code: "TEST-123",
      studentName: "Aarav Sharma",
      guestLimit: 2,
      qrToken: "qr-token-abc",
    });
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 5000, `pdf too small: ${pdf.length} bytes`);
  });
});
