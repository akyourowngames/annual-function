// Embeddings seam. Same OpenAI-compatible shape as llm-client, so the moment
// an embeddings model is configured (LLM_EMBED_MODEL + a key) the knowledge
// base upgrades from lexical to semantic retrieval with no other code change.
// Works with the NVIDIA NIM endpoint (nvidia/nemotron-3-embed-1b, 2048-dim).
export function embeddingsConfig() {
  const baseUrl = (
    process.env.LLM_EMBED_BASE_URL ||
    process.env.LLM_BASE_URL ||
    "https://integrate.api.nvidia.com/v1"
  ).replace(/\/+$/, "");
  const apiKey =
    process.env.LLM_EMBED_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const model = process.env.LLM_EMBED_MODEL || "";
  // Some providers (NVIDIA NIM QA embedders) want query vs passage hints.
  const sendInputType = process.env.LLM_EMBED_INPUT_TYPE === "1";
  return { baseUrl, apiKey, model, sendInputType };
}
export function hasEmbeddings(): boolean {
  const c = embeddingsConfig();
  return c.model.length > 0 && c.apiKey.length > 0;
}
// Must match the `vector(N)` column in knowledge_chunks (migration 0006).
export const EMBED_DIM = Number(process.env.LLM_EMBED_DIM || 2048);

export async function embedTexts(
  texts: string[],
  inputType: "query" | "passage" = "passage",
  timeoutMs = 8000,
): Promise<number[][]> {
  const { baseUrl, apiKey, model, sendInputType } = embeddingsConfig();
  if (!model) throw new Error("LLM_EMBED_MODEL is not configured");
  if (!apiKey) throw new Error("Embeddings API key is not configured");
  const body: Record<string, unknown> = { model, input: texts, encoding_format: "float" };
  if (sendInputType) body.input_type = inputType;
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Embeddings provider HTTP ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  return (data.data ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((r) => r.embedding ?? []);
}

// pgvector accepts a JSON array cast to vector.
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
