// Live smoke test: hits a deployed instance and asserts the core surfaces work.
// Runs in CI (see .github/workflows/ci.yml) and locally:
//   SMOKE_URL=https://annual-five.vercel.app node scripts/smoke.mjs
const BASE = (process.env.SMOKE_URL || "https://annual-five.vercel.app").replace(/\/+$/, "");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(20000) });
  return res;
}

try {
  const landing = await get("/");
  const html = await landing.text();
  check("landing responds 200", landing.status === 200, `HTTP ${landing.status}`);
  check("landing has content", /annual/i.test(html));

  const agent = await get("/api/agent");
  const agentBody = await agent.json().catch(() => ({}));
  check("agent endpoint up", agent.status === 200, `HTTP ${agent.status}`);
  check(
    "agent mode reported",
    ["ai", "official_information"].includes(agentBody.mode),
    String(agentBody.mode),
  );

  const event = await get("/api/event");
  check("event endpoint up", event.status === 200, `HTTP ${event.status}`);

  const reply = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Namaste" }),
    signal: AbortSignal.timeout(45000),
  });
  const replyBody = await reply.json().catch(() => ({}));
  check("agent answers a question", reply.status === 200 && typeof replyBody.reply === "string" && replyBody.reply.length > 0, `HTTP ${reply.status}`);
} catch (e) {
  check("smoke run", false, e instanceof Error ? e.message : "unknown error");
}

if (failures) {
  console.error(`\n${failures} smoke check(s) failed against ${BASE}`);
  process.exit(1);
}
console.log(`\nAll smoke checks passed against ${BASE}`);
