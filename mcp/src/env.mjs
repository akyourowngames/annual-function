// Loads `mcp/.env.local` before anything reads a setting.
//
// Ankita starts this server by path, not through `npm`, so `dotenv`-style
// loading has to happen here rather than in a script. Small on purpose: the
// file format is KEY=VALUE, and a dependency for fifteen lines is not worth it.
//
// Rules: never override a value the operator already set in the real
// environment, and never print a value — the file holds a password.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENV_FILE = path.join(here, "..", ".env.local");

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Tests must not inherit a real database.
 *
 * Once `.env.local` exists, loading it inside `node --test` would make the
 * suite talk to the live school database — slow, non-deterministic, and a test
 * that asserts "no database configured" would silently start passing real data
 * through. Test runs therefore ignore the file and use only what the test sets.
 */
function underTestRunner() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes("--test");
}

export function loadEnvFile(file = ENV_FILE) {
  if (underTestRunner()) return false;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    // No file is not an error: the real environment may already have everything.
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(trimmed.slice(eq + 1));
  }
  return true;
}

loadEnvFile();
