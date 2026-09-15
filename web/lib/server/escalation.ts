// Pure helpers for turning a model reply into a staff-facing escalation draft.
// Dependency-free so they unit-test under plain `node --test`.
export type EscalationDraft = { summary: string; suggestedReply: string };

export function parseEscalation(text: string, fallbackQuestion: string): EscalationDraft {
  const fallback: EscalationDraft = {
    summary: fallbackQuestion.trim().slice(0, 300) || "A family needs help with their request.",
    suggestedReply: "",
  };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return fallback;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      summary?: unknown;
      suggestedReply?: unknown;
    };
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 1000)
        : fallback.summary;
    const suggestedReply =
      typeof parsed.suggestedReply === "string" ? parsed.suggestedReply.trim().slice(0, 2000) : "";
    return { summary, suggestedReply };
  } catch {
    return fallback;
  }
}
