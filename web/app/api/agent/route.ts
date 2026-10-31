import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/server/helpdesk";
import { hasLlmKey, chatCompletion, llmConfig, messageText } from "@/lib/server/llm-client";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { recoverInvitation } from "@/lib/server/invitation-recovery";
import { parseRecoveryMessage } from "@/lib/invitations/identity";
import { requireFamily } from "@/lib/server/family-auth";
import { normalizeInvitationCode } from "@/lib/security/family";
import { clientKey, enforceRateLimits } from "@/lib/server/rate-limit";

// Legacy in-process counter. The database limiter below is authoritative —
// it survives serverless cold starts and is shared across instances. This map
// only keeps a second line of defence if the database is briefly unreachable.
const requests = new Map<string, { count: number; until: number }>();

/** Shared-across-instances throttle; degrades to the local map if the DB fails. */
async function limitQuestions(key: string) {
  try {
    await enforceRateLimits([
      { key: `agent:ask:ip:${key}`, limit: 30, windowSeconds: 600 },
    ]);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw e;
    const now = Date.now();
    if (requests.size > 10000)
      for (const [k, v] of requests) if (v.until < now) requests.delete(k);
    const usage = requests.get(key);
    if (usage && usage.until > now && usage.count >= 30)
      throw new HttpError(
        "You’ve sent several questions. Please try again in a few minutes, or use Support.",
        429,
      );
    requests.set(key, {
      count: usage && usage.until > now ? usage.count + 1 : 1,
      until: usage && usage.until > now ? usage.until : now + 600000,
    });
  }
}

export const maxDuration = 60;

/**
 * Health probe for the assistant. Reports whether a model key is present and
 * whether a real call succeeds, so a broken provider is visible from outside
 * without reading function logs. Never returns the key or its length.
 */
export async function GET() {
  const configured = hasLlmKey();
  const result: Record<string, unknown> = {
    ok: true,
    mode: configured ? "ai" : "official_information",
    model: llmConfig().model,
    baseUrl: llmConfig().baseUrl,
  };
  if (configured) {
    const started = Date.now();
    try {
      const probe = await chatCompletion(
        {
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: 16,
        },
        12_000,
      );
      const text = messageText(probe.choices?.[0]?.message?.content).trim();
      result.probe = text ? "ok" : "empty_response";
      result.probeMs = Date.now() - started;
    } catch (e) {
      result.probe = "failed";
      result.probeMs = Date.now() - started;
      result.probeError = e instanceof Error ? `${e.name}: ${e.message}` : "unknown";
    }
  }
  return NextResponse.json(result);
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const message = text(b.message, "Question", 2000, !b.recovery);
    const key = clientKey(request);
    await limitQuestions(key);
    // A code-scoped chat may read the guest list, RSVP, and tickets. That
    // requires a verified family session for exactly that invitation. Anonymous
    // visitors can still ask general event questions and use identity recovery.
    const code =
      normalizeInvitationCode(
        text(b.code, "Invitation code", 64, false),
      ) || undefined;
    if (code) await requireFamily(code);
    if (b.recovery && (typeof b.recovery !== "object" || Array.isArray(b.recovery)))
      throw new HttpError("Please enter your admission number, full name, and class.");
    const recovery = b.recovery || (!code && parseRecoveryMessage(message));
    if (recovery) {
      if (code) throw new HttpError("Close your current invitation before looking up another.");
      return NextResponse.json(
        await recoverInvitation(recovery as Record<string, unknown>, key),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const history = Array.isArray(b.history)
      ? b.history
          .slice(-8)
          .filter(
            (h) =>
              h &&
              ["user", "assistant"].includes(h.role) &&
              typeof h.content === "string",
          )
          .map((h) => ({
            role: h.role as string,
            content: h.content.slice(0, 2000),
          }))
      : [];
    return NextResponse.json(await answerQuestion(message, code, history, key), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
