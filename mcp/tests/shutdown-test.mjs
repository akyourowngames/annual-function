// The server must answer every request it was given, even though its input
// (stdin) closes immediately in a pipe.
//
// This is the bug that shipped first. Piped input closes the moment the last
// line is read, which triggered a pool shutdown while the last query was still
// running. Measured against the live database: the old server returned ONE
// reply for TWO requests — the tool call simply vanished — and on other runs
// it surfaced as "write CONNECTION_ENDED", which the assistant would have read
// out as an event website failure.
//
// The fix waits for in-flight work before closing the pool. The test below
// runs the real server as a child process with stdin closed at once, which is
// exactly what the assistant creates.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.mjs");
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

/** The live database, if the operator has set one up. Never required for CI. */
function liveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync(ENV_FILE)) return null;
  const line = readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("DATABASE_URL="));
  const value = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  return value || null;
}

function runPiped(messages, { env = process.env, timeoutMs = 40_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not finish in ${timeoutMs}ms; stderr: ${err.slice(0, 400)}`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const replies = out
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      resolve({ replies, err });
    });
    // Write the whole batch and close stdin at once — no waiting between them.
    child.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  });
}

const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } };
const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };

describe("piped stdin closes before the work is done", () => {
  it("still answers every request in the batch", async () => {
    const { replies } = await runPiped([init, list], { env: { ...process.env, DATABASE_URL: "" } });
    assert.equal(replies.length, 2, "one reply per request");
    assert.equal(replies[0].result.serverInfo.name, "annual-function");
    assert.equal(replies[1].result.tools.length, 16);
  });

  it("answers a real, slow database call instead of dropping it at shutdown", async (t) => {
    const url = liveDatabaseUrl();
    if (!url) {
      t.skip("no DATABASE_URL; the live variant of this test needs one");
      return;
    }
    // A real query: it takes long enough to still be running when stdin closes,
    // which is the exact race. The old server answered nothing here.
    const { replies } = await runPiped(
      [init, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rsvp_report", arguments: { limit: 3 } } }],
      { env: { ...process.env, DATABASE_URL: url } },
    );
    assert.equal(replies.length, 2, "the tool call must get a reply, not vanish");
    const call = replies.find((r) => r.id === 2);
    assert.equal(call.result.isError, false, "a live query must succeed, not be cut off");
    const payload = JSON.parse(call.result.content[0].text);
    assert.ok(payload.summary, "the report shape is intact");
    assert.equal(typeof payload.summary.attending, "number");
  });
});
