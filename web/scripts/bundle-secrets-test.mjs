// Client-bundle secret scan.
//
// A server-only secret that reaches a client bundle is readable by anyone who
// loads the page. This guards the invariant after a production build:
//
//   npm run build && node --test scripts/bundle-secrets-test.mjs
//
// It checks the emitted client bundles for the *names* of server-only
// environment variables (which only appear if code reads them in a client
// component) and for JWT-shaped credentials that would leak key material.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

// Only variables without the NEXT_PUBLIC_ prefix are secret. NEXT_PUBLIC_* is
// designed to be embedded in the browser bundle.
const SERVER_ONLY = [
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_ACCESS_KEY",
  "GATE_ACCESS_KEY",
  "FAMILY_SESSION_SECRET",
  "FAMILY_OTP_SECRET",
  "OPENAI_API_KEY",
  "LLM_API_KEY",
  "LLM_EMBED_API_KEY",
  "WHATSAPP_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "GROQ_VOICE_API_KEY",
  "CRON_SECRET",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no server-only secret names or credentials in client bundles", (t) => {
  const files = walk(STATIC_DIR);
  if (!files.length) {
    // No build present. Skipping is honest; run `npm run build` first.
    t.skip("no .next/static — run `npm run build` first");
    return;
  }

  const leaks = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const name of SERVER_ONLY) {
      if (source.includes(name)) leaks.push(`${path.relative(STATIC_DIR, file)} → ${name}`);
    }
    // A literal JWT is a credential regardless of which variable it came from.
    if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(source)) {
      leaks.push(`${path.relative(STATIC_DIR, file)} → JWT-shaped credential`);
    }
  }

  assert.deepEqual(leaks, [], `server secrets leaked into client bundles:\n${leaks.join("\n")}`);
});
