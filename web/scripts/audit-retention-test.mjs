import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auditRetentionDays,
  auditTrimBatch,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_TRIM_BATCH,
  MAX_RETENTION_DAYS,
  MAX_TRIM_BATCH,
  MIN_RETENTION_DAYS,
  MIN_TRIM_BATCH,
} from "../lib/server/audit-retention-rules.ts";

describe("audit retention window", () => {
  it("uses 90 days when nothing is configured", () => {
    assert.equal(auditRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
    assert.equal(DEFAULT_RETENTION_DAYS, 90);
  });
  it("reads a plain number from the environment", () => {
    assert.equal(auditRetentionDays("180"), 180);
    assert.equal(auditRetentionDays(180), 180);
  });
  it("never lets a zero or negative window mean 'delete everything'", () => {
    assert.equal(auditRetentionDays("0"), DEFAULT_RETENTION_DAYS);
    assert.equal(auditRetentionDays("-5"), DEFAULT_RETENTION_DAYS);
    assert.equal(auditRetentionDays(0), DEFAULT_RETENTION_DAYS);
  });
  it("falls back instead of guessing at garbage", () => {
    assert.equal(auditRetentionDays("abc"), DEFAULT_RETENTION_DAYS);
    assert.equal(auditRetentionDays(""), DEFAULT_RETENTION_DAYS);
    assert.equal(auditRetentionDays(Number.NaN), DEFAULT_RETENTION_DAYS);
    assert.equal(auditRetentionDays(null), DEFAULT_RETENTION_DAYS);
  });
  it("clamps a too-short window up to the floor", () => {
    assert.equal(auditRetentionDays(3), MIN_RETENTION_DAYS);
  });
  it("clamps an absurd window down to the ceiling", () => {
    assert.equal(auditRetentionDays(999999), MAX_RETENTION_DAYS);
  });
  it("truncates a fractional day", () => {
    assert.equal(auditRetentionDays(30.9), 30);
  });
});

describe("audit trim batch", () => {
  it("uses the default when nothing is configured", () => {
    assert.equal(auditTrimBatch(undefined), DEFAULT_TRIM_BATCH);
  });
  it("reads a batch size from the environment", () => {
    assert.equal(auditTrimBatch("2000"), 2000);
  });
  it("keeps batches inside the safe range", () => {
    assert.equal(auditTrimBatch("1"), MIN_TRIM_BATCH);
    assert.equal(auditTrimBatch("10000000"), MAX_TRIM_BATCH);
  });
  it("treats a zero or negative batch as a typo, not a policy", () => {
    assert.equal(auditTrimBatch("-1"), DEFAULT_TRIM_BATCH);
    assert.equal(auditTrimBatch("0"), DEFAULT_TRIM_BATCH);
  });
  it("falls back on garbage", () => {
    assert.equal(auditTrimBatch("lots"), DEFAULT_TRIM_BATCH);
  });
});
