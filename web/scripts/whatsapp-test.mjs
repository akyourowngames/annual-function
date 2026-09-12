import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hasLlmKey, llmConfig } from "../lib/server/llm-client.ts";

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
