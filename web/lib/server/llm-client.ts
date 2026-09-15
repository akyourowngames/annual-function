// The ONLY module that talks to a language model. Everything else (helpdesk,
// WhatsApp/Telegram handlers) calls these helpers. This speaks the
// OpenAI-compatible Chat Completions shape, so any gateway works — Kilo,
// OpenAI, OpenRouter, Groq, ... — by setting LLM_BASE_URL / LLM_API_KEY /
// LLM_MODEL. No code change to swap providers.
export function llmConfig() {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.kilo.ai/api/gateway").replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "kilo-auto/free";
  return { baseUrl, apiKey, model };
}
// Free models come and go (one can start timing out mid-day). We try the
// configured model first, then these, so the family always gets an answer.
const DEFAULT_FALLBACKS = [
  "kilo-auto/free",
  "inclusionai/ling-3.0-flash-sante:free",
  "stepfun/step-3.7-flash:free",
  "openrouter/free",
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
  budgetMs = 45000,
): Promise<ChatCompletionResponse> {
  const { baseUrl, apiKey } = llmConfig();
  if (!apiKey) throw new Error("LLM API key is not configured");
  const requested = body.model || llmConfig().model;
  const chain = [...new Set([requested, ...modelChain()])];
  const start = Date.now();
  const perAttempt = 12000;
  let lastError: unknown = null;
  for (const model of chain) {
    const remaining = budgetMs - (Date.now() - start);
    if (remaining < 1500) break;
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
