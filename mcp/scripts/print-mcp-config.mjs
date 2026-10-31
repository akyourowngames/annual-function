#!/usr/bin/env node
// Prints the exact entry to paste into Ankita's MCP config.
//
// Why this exists: Ankita only starts a server whose stored approval hash
// matches its command, and her `/mcp add` splits on spaces — which breaks this
// project's path ("3D Objects"). So the entry is written by hand, and the hash
// has to be correct or the server is silently skipped on every restart. This
// script computes it with Ankita's own algorithm so the paste always works.

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "..", "src", "server.mjs").replace(/\\/g, "/");

/** Same formula as copilot-chat `mcp-store.mjs` `commandHash()`. */
function commandHash(command, args = []) {
  const blob = JSON.stringify({ command: String(command || ""), args: args.map(String) });
  return createHash("sha256").update(blob, "utf8").digest("hex").slice(0, 16);
}

const command = "node";
const args = [serverPath];
const hash = commandHash(command, args);

const entry = {
  id: "annual-function",
  name: "annual-function",
  command,
  args,
  env: {},
  transport: "stdio",
  enabled: true,
  commandHash: hash,
  approvedHash: hash,
  approvedAt: new Date().toISOString(),
};

console.error("Paste this entry into ~/.copilot-chat-cli/mcp.json under \"servers\":");
console.error("");
console.log(JSON.stringify(entry, null, 2));
console.error("");
console.error("If the path above is not where this folder really is, do not edit it by hand —");
console.error("run this script from the real folder again and use its output.");
