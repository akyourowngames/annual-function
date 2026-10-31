// Guards against the mistake of replacing the model with a lookup table.
//
// The helpdesk must answer from a guidance prompt + tools, never from a
// keyword→canned-reply map. This inspects the source, because that rule is
// about shape, not runtime output: a passing reply test can be produced by a
// regex just as easily as by a model.
//
// See AGENTS.md Rule 7.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const HELPDesk = path.join(process.cwd(), "lib", "server", "helpdesk.ts");
const src = fs.readFileSync(HELPDesk, "utf8");

test("helpdesk sends a guidance system prompt to the model", () => {
  assert.match(src, /role:\s*"system"/, "must build a system prompt");
  assert.match(src, /const instructions\s*=/, "prompt must be a named instruction block");
  // The prompt must state the grounding rule: answer only from provided info.
  assert.match(src, /Never invent/i, "prompt must forbid inventing answers");
});

test("helpdesk gives the model tools to fetch real data", () => {
  for (const tool of [
    "get_invitation",
    "search_event_information",
    "list_my_guests",
    "check_ticket_status",
    "set_rsvp",
    "escalate_to_staff",
  ]) {
    assert.ok(src.includes(`"${tool}"`), `missing tool: ${tool}`);
  }
  assert.match(src, /tool_choice:\s*"auto"/, "model must choose its own tools");
});

test("no keyword-to-canned-reply table exists", () => {
  // A lookup table looks like: an array of { pattern, field } or { match, reply }.
  assert.doesNotMatch(
    src,
    /pattern:\s*\/.*\/i,\s*(field|reply)/,
    "found a regex→reply table: that is a hardcoded answer",
  );
  assert.doesNotMatch(src, /INSTANT_TOPICS/, "the instant-answer table must not return");
  assert.doesNotMatch(src, /instantAnswer\s*\(/, "the instant-answer function must not return");
});

test("no function returns a reply literal chosen by testing the message", () => {
  // The dangerous shape is `if (/x/.test(message)) return "..."`.
  // Allow the recovery hint (a fixed instruction, not an answer) but require
  // that it is not a factual claim about the event.
  const suspicious = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/if\s*\(\s*\/.*\/[a-z]*\.test\(\s*message\s*\)/.test(line)) {
      const window = lines.slice(i, i + 4).join("\n");
      if (/return\s*\{[\s\S]*reply:/.test(window)) suspicious.push(`${i + 1}: ${line.trim()}`);
    }
  }
  // One allowed case: the "find my invitation" redirect, which points the user
  // at the recovery form rather than answering an event question.
  assert.ok(
    suspicious.length <= 1,
    `keyword-chosen replies found (only the recovery redirect is allowed):\n${suspicious.join("\n")}`,
  );
});

test("the assistant-unavailable path shows published data, not invented answers", () => {
  // The fallback closure is declared before the hasLlmKey() guard, so inspect
  // the whole answerQuestion function rather than a window after the guard.
  const start = src.indexOf("export async function answerQuestion");
  const end = src.indexOf("const messages: ChatMessage[]");
  assert.ok(start > 0 && end > start, "could not locate answerQuestion");
  const body = src.slice(start, end);
  const idx = body.indexOf("if (!hasLlmKey())");
  assert.ok(idx > 0, "must handle the no-model case");
  const tail = body.slice(0, idx);

  // It may format the school's own fields...
  assert.match(tail, /eventDate|venue|dressCode/, "must show published event data");
  // ...but must say plainly that the assistant is unavailable.
  assert.match(tail, /unavailable/i, "must admit the assistant is unavailable");
  // ...and must not branch on question keywords to pick a field.
  assert.doesNotMatch(
    tail,
    /if\s*\(\s*\/.*\/[a-z]*\.test\(\s*message\s*\)/,
    "the fallback must not keyword-match the question",
  );
});
