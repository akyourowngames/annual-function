// Security unit tests for the family verification primitives.
//
// These run with plain `node --test` (Node 24 type stripping) and require no
// database or network. They cover the cryptographic and parsing invariants that
// the OTP + session design depends on.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FAMILY_SESSION_TTL_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  OTP_TRUSTED_SOURCES,
  generateOtp,
  isOtpTrustedSource,
  maskDestination,
  newFamilySessionPayload,
  newOtpSalt,
  normalizeInvitationCode,
  normalizeOtp,
  otpDigest,
  rateLimitKey,
  secureEqual,
  signFamilySession,
  verifyFamilySession,
} from "../lib/security/family.ts";

const SECRET = "test-secret-do-not-use-in-production";

test("OTP is exactly six ASCII digits and uses the whole keyspace", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const otp = generateOtp();
    assert.match(otp, /^[0-9]{6}$/);
    assert.equal(otp.length, 6);
    seen.add(otp);
  }
  // 500 draws from 1,000,000 should not collide constantly.
  assert.ok(seen.size > 400, `expected varied OTPs, got ${seen.size}`);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
  assert.equal(OTP_TTL_MS, 5 * 60 * 1000);
});

test("OTP digest is stable and bound to invitation, purpose, salt and value", () => {
  const input = {
    invitationId: "11111111-1111-4111-8111-111111111111",
    purpose: "family_manage",
    salt: "salt-a",
    otp: "123456",
  };
  const base = otpDigest(SECRET, input);
  assert.equal(base, otpDigest(SECRET, { ...input }));

  assert.notEqual(
    base,
    otpDigest(SECRET, { ...input, invitationId: "22222222-2222-4222-8222-222222222222" }),
  );
  assert.notEqual(base, otpDigest(SECRET, { ...input, purpose: "other" }));
  assert.notEqual(base, otpDigest(SECRET, { ...input, salt: "salt-b" }));
  assert.notEqual(base, otpDigest(SECRET, { ...input, otp: "654321" }));
  assert.notEqual(base, otpDigest("another-key", input));
  assert.ok(!base.includes("123456"), "digest must not contain the plaintext OTP");
});

test("salt is random and sufficiently long", () => {
  const a = newOtpSalt();
  const b = newOtpSalt();
  assert.notEqual(a, b);
  assert.ok(a.length >= 20);
});

test("OTP parsing rejects malformed, Unicode and oversized values", () => {
  assert.equal(normalizeOtp("123456"), "123456");
  assert.equal(normalizeOtp(" 123456 "), "123456");
  for (const bad of [
    "12345",
    "1234567",
    "12345a",
    "１２３４５６", // full-width digits
    "١٢٣٤٥٦", // Arabic-Indic digits
    "",
    " ",
    null,
    undefined,
    123456,
  ])
    assert.equal(normalizeOtp(bad), null, `should reject ${String(bad)}`);
});

test("invitation code parsing is strict and normalises case", () => {
  assert.equal(normalizeInvitationCode(" anl-abc123 "), "ANL-ABC123");
  for (const bad of [
    "",
    "ANL",
    "ANL<script>",
    "ANL/../../etc",
    "ANL ABC",
    null,
    42,
    "A".repeat(65),
  ])
    assert.equal(normalizeInvitationCode(bad), null, `should reject ${String(bad)}`);
});

test("secureEqual is length-safe and correct", () => {
  assert.equal(secureEqual("abc", "abc"), true);
  assert.equal(secureEqual("abc", "abd"), false);
  assert.equal(secureEqual("abc", "abcd"), false);
  assert.equal(secureEqual("", ""), true);
});

test("destination masking never reveals the full contact", () => {
  const wa = maskDestination("whatsapp", "+91 98765 43210");
  assert.ok(wa.includes("3210"));
  assert.ok(!wa.includes("98765"));
  assert.ok(!wa.includes("+91"));

  const tg = maskDestination("telegram", "123456789");
  assert.ok(tg.startsWith("Telegram"));
  assert.ok(!tg.includes("123456789"));

  assert.ok(!maskDestination("email", "parent@example.com").includes("parent@"));
});

test("family session round-trips and carries an expiry", () => {
  const payload = newFamilySessionPayload({
    invitationId: "11111111-1111-4111-8111-111111111111",
    code: "ANL-ABC123",
  });
  assert.equal(payload.v, 1);
  assert.equal(payload.scope, "family");
  assert.equal(payload.exp - payload.iat, FAMILY_SESSION_TTL_MS);

  const token = signFamilySession(SECRET, payload);
  const parsed = verifyFamilySession(SECRET, token);
  assert.deepEqual(parsed, payload);
});

test("family session rejects tampering, wrong keys, expiry and wrong scope", () => {
  const payload = newFamilySessionPayload({
    invitationId: "11111111-1111-4111-8111-111111111111",
    code: "ANL-ABC123",
  });
  const token = signFamilySession(SECRET, payload);

  // Flip one character of the signature.
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(verifyFamilySession(SECRET, tampered), null);

  // Re-encode the payload but keep the old signature.
  const sig = token.split(".")[2];
  const forgedPayload = Buffer.from(
    JSON.stringify({ ...payload, code: "ANL-OTHER" }),
  ).toString("base64url");
  assert.equal(verifyFamilySession(SECRET, `fs.${forgedPayload}.${sig}`), null);

  assert.equal(verifyFamilySession("wrong-key", token), null);
  assert.equal(verifyFamilySession(SECRET, token, payload.exp + 1), null);
  assert.equal(verifyFamilySession(SECRET, undefined), null);
  assert.equal(verifyFamilySession(SECRET, "fs.."), null);

  // A token signed with a non-family scope must not be accepted as a family
  // session even when the signature is valid.
  const wrongScope = signFamilySession(SECRET, {
    ...payload,
    scope: "admin",
  });
  assert.equal(verifyFamilySession(SECRET, wrongScope), null);
});

test("each session gets a unique id (rotation on verification)", () => {
  const input = {
    invitationId: "11111111-1111-4111-8111-111111111111",
    code: "ANL-ABC123",
  };
  assert.notEqual(
    newFamilySessionPayload(input).sid,
    newFamilySessionPayload(input).sid,
  );
});

test("rate limit keys are stable and non-reversible", () => {
  const a = rateLimitKey(SECRET, "ip:203.0.113.9");
  assert.equal(a, rateLimitKey(SECRET, "ip:203.0.113.9"));
  assert.notEqual(a, rateLimitKey(SECRET, "ip:203.0.113.10"));
  assert.notEqual(a, rateLimitKey("other", "ip:203.0.113.9"));
  assert.ok(!a.includes("203.0.113.9"));
});

test("only school-verified contacts can receive an OTP", () => {
  // An admin-approved contact is a genuine possession anchor.
  assert.equal(isOtpTrustedSource("admin_approved"), true);
  // A chat endpoint learned from a guessed identity triple is knowledge, not
  // possession. Treating it as trusted let an attacker receive the family's OTP
  // on their own phone and open the invitation.
  assert.equal(isOtpTrustedSource("verified_chat"), false);
  assert.deepEqual([...OTP_TRUSTED_SOURCES], ["admin_approved"]);
});
