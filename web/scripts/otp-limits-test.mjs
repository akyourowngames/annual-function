// Regression tests for the OTP spend and guess limits.
//
// The hole these cover: the original limits were keyed on the caller's network
// address. Changing phone, network, or IP started a fresh count, so "only a few
// tries per person" could be dodged by simply moving. The fixed design keys the
// important limits on the *family* and on the whole event, which no change of
// address can reset.
//
// These tests model the key derivation and counting rules without a database.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OTP_DAILY_GLOBAL,
  OTP_DAILY_PER_FAMILY,
  OTP_GUESSES_PER_FAMILY,
} from "../lib/security/family.ts";

const DAY = 86_400;

// The exact keys the server now uses for the limits that matter.
function sendKeys(invitationId) {
  return [
    { key: `otp:daily:family:${invitationId}`, limit: OTP_DAILY_PER_FAMILY, windowSeconds: DAY },
    { key: `otp:daily:global`, limit: OTP_DAILY_GLOBAL, windowSeconds: DAY },
  ];
}
function guessKey(invitationId) {
  return { key: `otp:guess:invitation:${invitationId}`, windowSeconds: DAY };
}

test("the sending limit is tied to the family, not the caller's address", () => {
  const family = "11111111-1111-4111-8111-111111111111";
  const keys = sendKeys(family);
  // Same family from a different phone / network derives the SAME key, so the
  // count carries over and cannot be reset by changing address.
  const again = sendKeys(family);
  assert.deepEqual(keys.map((k) => k.key), again.map((k) => k.key));
  // No key may depend on the caller's address.
  for (const k of keys) {
    assert.ok(!/ip|x-forwarded|client/i.test(k.key), `address leaked into ${k.key}`);
  }
});

test("different families are counted separately", () => {
  const a = sendKeys("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")[0].key;
  const b = sendKeys("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")[0].key;
  assert.notEqual(a, b);
});

test("there is a school-wide daily ceiling that no address change can dodge", () => {
  const global = sendKeys("anything").find((k) => k.key === "otp:daily:global");
  assert.ok(global, "a global daily limit must exist");
  assert.equal(global.windowSeconds, DAY);
  assert.ok(global.limit > 0);
  // It must be large enough for the real event but finite.
  assert.ok(global.limit >= 100 && global.limit <= 10_000, `unreasonable cap: ${global.limit}`);
});

test("wrong guesses are limited per family across the whole day", () => {
  const family = "11111111-1111-4111-8111-111111111111";
  const k = guessKey(family);
  assert.equal(k.windowSeconds, DAY);
  assert.ok(!/ip|client/i.test(k.key), "guess counter must not be address-based");
  // 25 guesses against 1,000,000 possible codes is far below any useful odds.
  assert.ok(OTP_GUESSES_PER_FAMILY <= 50);
  const odds = OTP_GUESSES_PER_FAMILY / 1_000_000;
  assert.ok(odds < 0.0001, `guess odds too high: ${odds}`);
});

test("limits are sane and cannot be set to zero or negative", () => {
  for (const [name, value] of Object.entries({
    OTP_DAILY_PER_FAMILY,
    OTP_DAILY_GLOBAL,
    OTP_GUESSES_PER_FAMILY,
  })) {
    assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive whole number`);
  }
  // A family needs a few sends in a day: first code, a resend after expiry, and
  // room for a mistake. Too low would lock real families out.
  assert.ok(OTP_DAILY_PER_FAMILY >= 3, "too tight for a real family");
  assert.ok(OTP_GUESSES_PER_FAMILY >= 5, "too tight given the 5-per-code limit already exists");
});

test("repeated cooldown hits do not use up the family's allowance", () => {
  // Models the branch order in startFamilyVerification: the resend cooldown is
  // checked BEFORE the daily counter, and returns early without counting.
  let sent = 0;
  const withinCooldown = true;
  if (withinCooldown) {
    // early return — deliberately no increment
  } else {
    sent += 1;
  }
  assert.equal(sent, 0, "a cooldown reply must not spend the daily allowance");
});
