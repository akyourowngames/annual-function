// Tests for the assistant's tunable constants.
//
// These exist so latency policy is visible and overridable rather than buried
// as bare numbers (AGENTS.md Rule 8). They also lock two invariants that are
// easy to break by accident: a bad environment value must never disable the
// timeout, and the attempt ceiling must stay below the answer budget.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerBudgetMs,
  answerMaxTokens,
  documentChars,
  eventCacheMs,
  historyTurns,
  knowledgeChars,
  minAttemptMs,
  perAttemptMs,
  toolCallsPerRound,
} from "../lib/server/llm-tuning.ts";

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("defaults are sane positive numbers", () => {
  for (const [name, fn] of Object.entries({
    answerBudgetMs,
    perAttemptMs,
    minAttemptMs,
    answerMaxTokens,
    documentChars,
    knowledgeChars,
    historyTurns,
    toolCallsPerRound,
  })) {
    withEnv({ [`LLM_${name}`]: undefined }, () => {
      const v = fn();
      assert.ok(Number.isFinite(v) && v > 0, `${name} must be positive, got ${v}`);
    });
  }
});

test("a single attempt is shorter than the whole answer budget", () => {
  // If an attempt could consume the entire budget there would be no time left
  // to try a fallback model, which is the whole point of the chain.
  withEnv(
    { LLM_ANSWER_BUDGET_MS: undefined, LLM_PER_ATTEMPT_MS: undefined, LLM_MIN_ATTEMPT_MS: undefined },
    () => {
      assert.ok(
        perAttemptMs() < answerBudgetMs(),
        `perAttempt ${perAttemptMs()} must be below budget ${answerBudgetMs()}`,
      );
      assert.ok(
        minAttemptMs() < perAttemptMs(),
        `minAttempt ${minAttemptMs()} must be below perAttempt ${perAttemptMs()}`,
      );
    },
  );
});

test("environment overrides are honoured", () => {
  withEnv({ LLM_ANSWER_BUDGET_MS: "12345", LLM_DOC_CHARS: "999" }, () => {
    assert.equal(answerBudgetMs(), 12345);
    assert.equal(documentChars(), 999);
  });
});

test("bad environment values fall back instead of disabling the limit", () => {
  // A typo or a zero must not turn into "no timeout" / "unlimited".
  for (const bad of ["0", "-5", "abc", "", "NaN"]) {
    withEnv({ LLM_ANSWER_BUDGET_MS: bad }, () => {
      assert.ok(
        answerBudgetMs() > 0,
        `LLM_ANSWER_BUDGET_MS=${JSON.stringify(bad)} must fall back to a positive value`,
      );
    });
  }
});

test("the event cache can be disabled with 0, unlike the other limits", () => {
  // 0 is meaningful here: it means "always read fresh".
  withEnv({ LLM_EVENT_CACHE_MS: "0" }, () => {
    assert.equal(eventCacheMs(), 0);
  });
  withEnv({ LLM_EVENT_CACHE_MS: undefined }, () => {
    assert.ok(eventCacheMs() > 0);
  });
});
