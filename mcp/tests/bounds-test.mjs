import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bounded, activityHours } from "../src/read.mjs";
import { MAX_REPORT_ROWS, DEFAULT_REPORT_ROWS, DEFAULT_ACTIVITY_HOURS, MAX_ACTIVITY_HOURS } from "../src/config.mjs";

describe("report row cap", () => {
  it("uses the default when nothing is asked for", () => {
    assert.equal(bounded(undefined), DEFAULT_REPORT_ROWS);
    assert.equal(bounded(""), DEFAULT_REPORT_ROWS);
    assert.equal(bounded("many"), DEFAULT_REPORT_ROWS);
  });

  it("never returns more than the cap, so a report stays readable", () => {
    assert.equal(bounded(99999), MAX_REPORT_ROWS);
  });

  it("never returns zero or fewer rows", () => {
    assert.equal(bounded(0), 1);
    assert.equal(bounded(-10), 1);
  });

  it("keeps a sensible request as asked", () => {
    assert.equal(bounded(50), 50);
    assert.equal(bounded("12"), 12);
  });
});

describe("activity window", () => {
  it("defaults to one hour", () => {
    assert.equal(activityHours(undefined), DEFAULT_ACTIVITY_HOURS);
    assert.equal(DEFAULT_ACTIVITY_HOURS, 1);
  });

  it("caps at the log's own retention window", () => {
    assert.equal(activityHours(999999), MAX_ACTIVITY_HOURS);
  });
});
