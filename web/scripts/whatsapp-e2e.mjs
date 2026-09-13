import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
process.env.WHATSAPP_VERIFY_TOKEN ??= "e2e-verify-token";
process.env.WHATSAPP_APP_SECRET ??= "e2e-app-secret";
const VT = process.env.WHATSAPP_VERIFY_TOKEN;

const BASE = "http://127.0.0.1:3102";
let server;
async function waitReady(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not start");
}
const sign = (raw) =>
  "sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex");

describe("whatsapp webhook e2e", () => {
  before(async () => {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3102", "--hostname", "127.0.0.1"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    await waitReady();
  });
  after(() => server?.kill());

  it("answers the Meta verification challenge", async () => {
    const r = await fetch(
      `${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VT}&hub.challenge=CHALLENGE123`,
    );
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "CHALLENGE123");
  });
  it("rejects wrong verify tokens with 403", async () => {
    const r = await fetch(
      `${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`,
    );
    assert.equal(r.status, 403);
  });
  it("rejects unsigned POSTs with 401", async () => {
    const r = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [] }),
    });
    assert.equal(r.status, 401);
  });
  it("accepts a signed Hi and still returns 200", async () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: "919999999999", type: "text", text: { body: "Hi" } }] } }] }],
    });
    const r = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(raw) },
      body: raw,
    });
    assert.equal(r.status, 200);
    assert.deepStrictEqual(await r.json(), { ok: true });
  });
});
