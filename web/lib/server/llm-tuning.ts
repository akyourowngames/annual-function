// Tunable numbers for the assistant's model calls, in one place.
//
// Every value here is a policy choice with a stated unit and a reason, and each
// can be overridden from the environment without a code change. Nothing in the
// helpdesk or the LLM client should contain a bare number for these concepts —
// see AGENTS.md Rule 8.
//
// Read through functions rather than a frozen object at import time, so a test
// can change the environment and see the effect.

/** Read a positive integer from the environment, else fall back. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Like envInt, but 0 is a meaningful value ("disabled") rather than a typo.
 * Negative and non-numeric values still fall back.
 */
function envIntAllowingZero(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// --- Time (milliseconds) ----------------------------------------------------

/** Total wall-clock budget for one complete answer, across all model attempts. */
export function answerBudgetMs(): number {
  return envInt("LLM_ANSWER_BUDGET_MS", 45_000);
}

/**
 * Ceiling for a single model attempt. A healthy model answers in ~1–2 s; one
 * that has not replied by this point is a slow/плохой provider, so we move on
 * rather than making the family wait for the whole answer budget.
 */
export function perAttemptMs(): number {
  return envInt("LLM_PER_ATTEMPT_MS", 8_000);
}

/** Do not start another attempt with less time than this left. */
export function minAttemptMs(): number {
  return envInt("LLM_MIN_ATTEMPT_MS", 1_500);
}

// --- Output size (tokens) ---------------------------------------------------

/** Tokens allowed for a normal family-facing answer. */
export function answerMaxTokens(): number {
  return envInt("LLM_ANSWER_MAX_TOKENS", 700);
}

/** Tokens allowed for the short staff-triage summary draft. */
export function triageMaxTokens(): number {
  return envInt("LLM_TRIAGE_MAX_TOKENS", 400);
}

// --- Context size (characters) ---------------------------------------------

/**
 * How much of a matched document goes into a tool result. Prompt size is the
 * largest single latency cost measured on this gateway, so these are ceilings,
 * not targets.
 */
export function documentChars(): number {
  return envInt("LLM_DOC_CHARS", 1_200);
}

/** How much of one knowledge snippet goes into a tool result. */
export function knowledgeChars(): number {
  return envInt("LLM_KNOWLEDGE_CHARS", 900);
}

/** How many knowledge snippets are returned per search. */
export function knowledgeHits(): number {
  return envInt("LLM_KNOWLEDGE_HITS", 3);
}

/** How many document matches are returned per search. */
export function documentHits(): number {
  return envInt("LLM_DOC_HITS", 5);
}

// --- Conversation -----------------------------------------------------------

/** How many past turns are replayed to the model. */
export function historyTurns(): number {
  return envInt("LLM_HISTORY_TURNS", 8);
}

/** How many tool calls one assistant turn may make. */
export function toolCallsPerRound(): number {
  return envInt("LLM_TOOL_CALLS_PER_ROUND", 3);
}

/** How many model rounds one answer may take (tool → answer → tool …). */
export function maxToolRounds(): number {
  return envInt("LLM_MAX_TOOL_ROUNDS", 3);
}

// --- Caching ----------------------------------------------------------------

/**
 * How long the event settings row is cached in memory, in milliseconds. It
 * changes only when staff edit it, but it is read on every message; a short
 * cache removes a database round trip from the hot path. 0 disables caching.
 */
export function eventCacheMs(): number {
  return envIntAllowingZero("LLM_EVENT_CACHE_MS", 30_000);
}
