// The ONLY module that talks to a language model. Everything else (helpdesk,
// whatsapp handler) calls these helpers. Swapping providers later = set the
// four LLM_* env vars, no code change. Uses the OpenAI Responses API shape
// (instructions + input + tools) because that is what helpdesk.ts uses today;
// most OpenAI-compatible gateways proxy /responses unchanged.
export function llmConfig() {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  return { baseUrl, apiKey, model };
}
export function hasLlmKey(): boolean {
  return llmConfig().apiKey.length > 0;
}
export type ResponseItem = { type?: string; name?: string; arguments?: string; id?: string; call_id?: string };
export type ResponsesRequest = {
  model?: string;
  instructions: string;
  input: unknown;
  tools?: unknown[];
  parallel_tool_calls?: boolean;
};
export type ResponsesResponse = { output?: ResponseItem[] };
export async function postResponses(body: ResponsesRequest, timeoutMs = 18000): Promise<ResponsesResponse> {
  const { baseUrl, apiKey, model } = llmConfig();
  if (!apiKey) throw new Error("LLM API key is not configured");
  const res = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model: body.model || model }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
  return (await res.json()) as ResponsesResponse;
}
