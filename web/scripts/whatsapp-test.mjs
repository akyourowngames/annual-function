import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasLlmKey, llmConfig, postResponses } from "../lib/server/llm-client.ts";

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
  it("defaults base URL to OpenAI and strips trailing slash", () => {
    delete process.env.LLM_BASE_URL;
    assert.equal(llmConfig().baseUrl, "https://api.openai.com/v1");
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1/";
    assert.equal(llmConfig().baseUrl, "https://gateway.example.com/v1");
  });
});

describe("postResponses", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let seen;
  beforeEach(() => {
    seen = null;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ output: [] }) };
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  it("posts to {baseUrl}/responses with bearer key and LLM_MODEL override", async () => {
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL = "custom-model";
    await postResponses({ instructions: "sys", input: [] });
    assert.equal(seen.url, "https://gateway.example.com/v1/responses");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer test-key");
    assert.equal(JSON.parse(seen.init.body).model, "custom-model");
  });
  it("falls back to OPENAI_MODEL and then the default model", async () => {
    process.env.LLM_BASE_URL = "https://gateway.example.com/v1";
    process.env.LLM_API_KEY = "test-key";
    delete process.env.LLM_MODEL;
    process.env.OPENAI_MODEL = "gpt-x";
    await postResponses({ instructions: "sys", input: [] });
    assert.equal(JSON.parse(seen.init.body).model, "gpt-x");
    delete process.env.OPENAI_MODEL;
    await postResponses({ instructions: "sys", input: [] });
    assert.equal(JSON.parse(seen.init.body).model, "gpt-4.1-mini");
  });
  it("rejects with AI provider HTTP on non-OK response", async () => {
    process.env.LLM_API_KEY = "test-key";
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await assert.rejects(() => postResponses({ instructions: "sys", input: [] }), /AI provider HTTP/);
  });
  it("rejects when no key is configured", async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(() => postResponses({ instructions: "sys", input: [] }), /not configured/);
  });
});
