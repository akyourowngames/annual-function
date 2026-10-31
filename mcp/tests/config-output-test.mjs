// The printed config must actually be accepted by Ankita.
//
// Ankita only starts a server whose stored `approvedHash` equals the hash of
// its current command, and a mismatch is skipped silently. A typo here looks
// exactly like "the assistant is not connected", so the formula is duplicated
// from copilot-chat `mcp-store.mjs` and asserted against the generator's output.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATOR = path.join(HERE, "..", "scripts", "print-mcp-config.mjs");

/** Ankita's own formula: sha256 of {command, args}, first 16 hex chars. */
function ankitaCommandHash(command, args = []) {
  const blob = JSON.stringify({ command: String(command || ""), args: args.map(String) });
  return createHash("sha256").update(blob, "utf8").digest("hex").slice(0, 16);
}

function generated() {
  const out = execFileSync(process.execPath, [GENERATOR], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out);
}

describe("printed Ankita config", () => {
  it("carries an approval stamp that matches its own command", () => {
    const entry = generated();
    const expected = ankitaCommandHash(entry.command, entry.args);
    assert.equal(entry.commandHash, expected);
    assert.equal(entry.approvedHash, expected, "a mismatch means Ankita silently skips the server");
  });

  it("points at the real server file, as one argument", () => {
    const entry = generated();
    assert.equal(entry.command, "node");
    assert.equal(entry.args.length, 1, "the path contains a space and must stay one argument");
    assert.match(entry.args[0], /mcp\/src\/server\.mjs$/);
  });

  it("does depend on cwd, so no cwd field is needed or honoured", () => {
    // Ankita never passes `cwd` to the child process, and the server resolves
    // its own settings file from its own location, so an entry without one is
    // correct — asserting its absence stops someone adding a field that does
    // nothing and creating a false sense that it matters.
    const entry = generated();
    assert.equal("cwd" in entry, false);
  });
});
