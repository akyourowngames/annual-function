import { NextResponse } from "next/server";

/**
 * Health for the Next.js backend + reachability of the Python agent.
 * The agent is a dependency, never a authority: it may REQUEST actions,
 * this backend + the DB validate everything.
 */
export async function GET() {
  const agentUrl = process.env.AGENT_URL ?? "http://127.0.0.1:8000";
  let agent: { status: string; detail?: string };
  try {
    const res = await fetch(`${agentUrl}/health`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    agent = res.ok
      ? { status: "reachable", detail: await res.text() }
      : { status: "unhealthy", detail: `HTTP ${res.status}` };
  } catch (err) {
    agent = {
      status: "unreachable",
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
  return NextResponse.json({
    ok: true,
    route: "agent",
    agentUrl,
    agent,
  });
}

