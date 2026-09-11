import { NextResponse } from "next/server";
import { answerQuestion } from "@/lib/server/helpdesk";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { recoverInvitation } from "@/lib/server/invitation-recovery";
import { parseRecoveryMessage } from "@/lib/invitations/identity";
const requests = new Map<string, { count: number; until: number }>();
export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: process.env.OPENAI_API_KEY ? "ai" : "official_information",
  });
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const message = text(b.message, "Question", 2000, !b.recovery);
    const key =
      request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
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
    const code =
      text(b.code, "Invitation code", 64, false).toUpperCase() || undefined;
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
