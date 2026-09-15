import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRole, canManage, canCheckIn, isAdmin, roleLabel } from "../lib/server/roles.ts";

describe("roles", () => {
  it("parses known roles only", () => {
    assert.equal(parseRole("admin"), "admin");
    assert.equal(parseRole("staff"), "staff");
    assert.equal(parseRole("gate"), "gate");
    assert.equal(parseRole("nope"), null);
    assert.equal(parseRole(undefined), null);
  });
  it("gate keepers scan passes but cannot manage", () => {
    assert.equal(canCheckIn("gate"), true);
    assert.equal(canManage("gate"), false);
    assert.equal(isAdmin("gate"), false);
    assert.equal(roleLabel("gate"), "Gate keeper");
  });
  it("staff manage but are not administrators", () => {
    assert.equal(canManage("staff"), true);
    assert.equal(isAdmin("staff"), false);
    assert.equal(canCheckIn("staff"), true);
  });
  it("administrators can do everything", () => {
    assert.equal(canManage("admin"), true);
    assert.equal(isAdmin("admin"), true);
    assert.equal(canCheckIn("admin"), true);
  });
});
