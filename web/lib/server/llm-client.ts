// The ONLY module that talks to a language model. Everything else (helpdesk,
// WhatsApp/Telegram handlers) calls these helpers. This speaks the
// OpenAI-compatible Chat Completions shape, so any gateway works — Kilo,
// OpenAI, OpenRouter, Groq, ... — by setting LLM_BASE_URL / LLM_API_KEY /
// LLM_MODEL. No code change to swap providers.
// The extension is explicit so this module also loads under plain `node --test`,
// which does not apply Next's extensionless resolution.
import { answerBudgetMs, minAttemptMs, perAttemptMs } from "./llm-tuning.ts";

const DEFAULT_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";

// Default model: a FIXED model, not an auto-router.
//
// kilo-auto/* routes each request to a different upstream model. Measured over
// repeated runs, kilo-auto/small answered 5/5 but ranged 1.25s–23.6s on the
// same question — one slow outlier is exactly what makes the bot "feel slow".
// cohere/north-mini-code:free answered 5/5 in 1.0s–1.4s, and produced grounded,
// one-round replies for the real helpdesk questions.
//
// Selection criteria, in order: (1) returns visible text, (2) answers every
// time, (3) consistent latency, not just a good median.
const DEFAULT_MODEL = "cohere/north-mini-code:free";

export function llmConfig() {
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}
// Ordered by measured consistency, not by best-case speed. Every entry must
// return real text: a reasoning-only model (kilo-auto/free) returns empty
// `content` and costs ~12s before we discover that.
const DEFAULT_FALLBACKS = [
  "cohere/north-mini-code:free",
  "openrouter/free",
  "kilo-auto/small",
  "reflection/beam-free",
];
export function modelChain(): string[] {
  const configured = (process.env.LLM_MODEL_FALLBACKS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const chain = [llmConfig().model, ...(configured.length ? configured : DEFAULT_FALLBACKS)];
  return [...new Set(chain)];
}
export function hasLlmKey(): boolean {
  return llmConfig().apiKey.length > 0;
}

export type ChatToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments?: string };
};
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
};
export type ChatTool = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};
export type ChatCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "none" | "required" | Record<string, unknown>;
  max_tokens?: number;
  temperature?: number;
};
export type ChatCompletionResponse = {
  choices?: Array<{ message?: ChatMessage; finish_reason?: string }>;
};

export async function chatCompletion(
  body: ChatCompletionRequest,
  budgetMs = answerBudgetMs(),
): Promise<ChatCompletionResponse> {
  const { baseUrl, apiKey } = llmConfig();
  if (!apiKey) throw new Error("LLM API key is not configured");
  const requested = body.model || llmConfig().model;
  const chain = [...new Set([requested, ...modelChain()])];
  const start = Date.now();
  const perAttempt = perAttemptMs();
  const minAttempt = minAttemptMs();
  let lastError: unknown = null;
  for (const model of chain) {
    const remaining = budgetMs - (Date.now() - start);
    if (remaining < minAttempt) break;
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model }),
        signal: AbortSignal.timeout(Math.min(perAttempt, remaining)),
      });
      if (!res.ok) {
        lastError = new Error(`AI provider HTTP ${res.status} (${model})`);
        continue;
      }
      const data = (await res.json()) as ChatCompletionResponse;
      const message = data.choices?.[0]?.message;
      const hasToolCalls = Array.isArray(message?.tool_calls) && message!.tool_calls!.length > 0;
      const hasText = typeof message?.content === "string" && message.content.trim().length > 0;
      if (!hasToolCalls && !hasText) {
        lastError = new Error(`Empty response from ${model}`);
        continue;
      }
      return data;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No model available");
}

// Providers differ on whether assistant content is a string or a content-part
// array; flatten both to plain text.
export function messageText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return (content as Array<{ text?: string }>)
      .map((c) => c?.text || "")
      .join("");
  return "";
}
