// Unit tests for the ticket-pass expiry rule (lib/passes/expiry.ts).
//
// Run with: npm run test:passes
// No database and no network: this is the single rule the gate and the family
// pass both use, so it is worth testing on its own.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPassMoment,
  passClosedMessage,
  passState,
  toInstant,
} from "../lib/passes/expiry.ts";

// 6:30 pm on 20 Nov 2026, India time — the moment the gate closes.
const CLOSES_AT = "2026-11-20T18:30:00+05:30";
const BEFORE = new Date("2026-11-20T18:29:59.999+05:30");
const AFTER = new Date("2026-11-20T18:30:00.000+05:30");

test("a pass with no expiry set keeps working", () => {
  assert.equal(passState({ status: "active" }), "valid");
  assert.equal(passState({ status: "active", expiresAt: null }), "valid");
});

test("a pass works right up to the expiry moment", () => {
  assert.equal(
    passState({ status: "active", expiresAt: CLOSES_AT, now: BEFORE }),
    "valid",
  );
});

test("the pass is closed AT its expiry moment, not a moment later", () => {
  assert.equal(
    passState({ status: "active", expiresAt: CLOSES_AT, now: AFTER }),
    "expired",
  );
});

test("a switched-off invitation is closed even before its expiry", () => {
  assert.equal(
    passState({ status: "disabled", expiresAt: CLOSES_AT, now: BEFORE }),
    "inactive",
  );
});

test("switching an invitation back on re-opens a pass that has not expired", () => {
  assert.equal(
    passState({ status: "active", expiresAt: CLOSES_AT, now: BEFORE }),
    "valid",
  );
});

test("a Date and an ISO string describe the same moment", () => {
  assert.equal(
    toInstant(new Date(CLOSES_AT))?.getTime(),
    toInstant(CLOSES_AT)?.getTime(),
  );
});

test("an unreadable expiry is treated as no expiry, so a data slip cannot lock the gate", () => {
  assert.equal(toInstant("not a date"), null);
  assert.equal(passState({ status: "active", expiresAt: "not a date" }), "valid");
});

test("closed-pass sentences say which reason and which moment", () => {
  assert.match(String(passClosedMessage("inactive")), /switched off/);
  const expired = String(passClosedMessage("expired", CLOSES_AT));
  assert.match(expired, /expired at/);
  assert.match(expired, /20 November 2026/);
  assert.equal(passClosedMessage("valid", CLOSES_AT), null);
});

test("the expiry moment is shown in the event's own timezone", () => {
  // 6:30 pm IST is 1:00 pm UTC — the screen must not read 1:00 pm.
  assert.match(formatPassMoment(CLOSES_AT), /6:30/);
});
