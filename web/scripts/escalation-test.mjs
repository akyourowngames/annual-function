import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEscalation } from "../lib/server/escalation.ts";

describe("parseEscalation", () => {
  it("parses a clean JSON draft", () => {
    const r = parseEscalation(
      '{"summary":"Needs parking info","suggestedReply":"Namaste! We will confirm shortly."}',
      "fallback",
    );
    assert.equal(r.summary, "Needs parking info");
    assert.match(r.suggestedReply, /Namaste/);
  });
  it("tolerates prose around the JSON", () => {
    const r = parseEscalation('Here you go:\n{"summary":"S","suggestedReply":""}\nThanks', "q");
    assert.equal(r.summary, "S");
    assert.equal(r.suggestedReply, "");
  });
  it("falls back to the question when there is no JSON", () => {
    const r = parseEscalation("no json here", "Where do we park?");
    assert.equal(r.summary, "Where do we park?");
    assert.equal(r.suggestedReply, "");
  });
  it("falls back when the JSON is malformed", () => {
    const r = parseEscalation('{"summary": "oops"', "Parking question");
    assert.equal(r.summary, "Parking question");
  });
});
