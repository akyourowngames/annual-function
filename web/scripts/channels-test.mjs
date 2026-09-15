import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseChannelKey,
  channelKey,
  parseAudience,
  audienceMatches,
  audienceLabel,
} from "../lib/server/channels.ts";

describe("channel keys", () => {
  it("parses tg/wa session keys into channel + address", () => {
    assert.deepEqual(parseChannelKey("tg:12345"), { channel: "telegram", address: "12345" });
    assert.deepEqual(parseChannelKey("wa:919999999999"), {
      channel: "whatsapp",
      address: "919999999999",
    });
    assert.equal(parseChannelKey("nope"), null);
    assert.equal(channelKey("telegram", "1"), "tg:1");
    assert.equal(channelKey("whatsapp", "1"), "wa:1");
  });
});

describe("audiences", () => {
  it("parses and labels audiences, defaulting to everyone", () => {
    assert.equal(parseAudience("class:TULIP 1"), "class:TULIP 1");
    assert.equal(parseAudience("bogus"), "all");
    assert.equal(audienceLabel("rsvp:none"), "Families who haven't replied");
    assert.equal(audienceLabel("class:TULIP 1"), "Class TULIP 1");
  });
  it("matches rows by RSVP status and class (case-insensitive)", () => {
    assert.equal(audienceMatches("all", { rsvpStatus: "pending" }), true);
    assert.equal(audienceMatches("attending", { rsvpStatus: "attending" }), true);
    assert.equal(audienceMatches("attending", { rsvpStatus: "pending" }), false);
    assert.equal(audienceMatches("rsvp:none", { rsvpStatus: "pending" }), true);
    assert.equal(audienceMatches("declined", { rsvpStatus: "declined" }), true);
    assert.equal(audienceMatches("class:Tulip 1", { className: "tulip 1" }), true);
    assert.equal(audienceMatches("class:Tulip 1", { className: "Lily" }), false);
  });
});
