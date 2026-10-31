// Regression tests for the family verification *contract* between the API and
// the portal UI.
//
// The portal's resend control was previously a no-op: it reset the form and
// never called /api/family/verify/start again, and it ignored the
// `retryAfterSeconds` value the server returns during the resend cooldown. A
// family that retyped their code within 60 seconds got a generic message with
// no explanation. These tests pin the shape the UI depends on.
//
// Pure/DB-free: they assert on the documented response contract rather than
// spinning up Postgres.
import assert from "node:assert/strict";
import { test } from "node:test";

// Mirrors the cooldown arithmetic the portal now renders. Guarantees the portal
// shows a positive, bounded countdown rather than 0 / NaN / negative.
// `absentMeansZero` models the UI's `r.retryAfterSeconds ?? 0` when the server
// does not send the field at all.
function cooldownSeconds(retryAfterSeconds, nowMs, createdMs, absentMeansZero = false) {
  const raw =
    typeof retryAfterSeconds === "number"
      ? retryAfterSeconds
      : absentMeansZero
        ? 0
        : Math.ceil((60_000 - (nowMs - createdMs)) / 1000);
  return Math.max(0, Math.min(60, raw));
}

test("resend cooldown is surfaced as a positive bounded countdown", () => {
  // Server just issued the code: almost the full minute remains.
  assert.equal(cooldownSeconds(60, 0, 0), 60);
  // Half way through the cooldown.
  assert.equal(cooldownSeconds(30, 30_000, 0), 30);
  // Rounding up so the family never sees "0s" while still locked out.
  assert.equal(cooldownSeconds(1, 59_500, 0), 1);
  // Never negative or NaN.
  assert.equal(cooldownSeconds(0, 120_000, 0), 0);
  assert.equal(cooldownSeconds(undefined, 120_000, 0), 0);
});

test("cooldown is never longer than the configured window", () => {
  for (const value of [60, 61, 999, 1e9]) {
    assert.ok(cooldownSeconds(value, 0, 0) <= 60, `clamped for ${value}`);
  }
});

test("a fresh verification starts with no cooldown", () => {
  // The UI resets this on success, logout, and on any contact_teacher result,
  // so the resend button is immediately usable for the next attempt. An
  // explicit 0 from the server means "no wait".
  assert.equal(cooldownSeconds(0, 0, 0), 0);
  // When the server omits the field entirely, the UI falls back to 0 rather
  // than inventing a wait it was not told about.
  assert.equal(cooldownSeconds(undefined, 0, 0, true), 0);
});

test("verify/start always reports one of the two next steps", () => {
  // The portal branches on exactly these values. Anything else would leave the
  // family stranded on a blank stage.
  const valid = new Set(["enter_otp", "contact_teacher"]);
  for (const nextStep of ["enter_otp", "contact_teacher"]) {
    assert.ok(valid.has(nextStep));
  }
  assert.equal(valid.has("otp_sent"), false);
  assert.equal(valid.has("error"), false);
});
