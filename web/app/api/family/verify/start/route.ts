import { NextResponse } from "next/server";
import { fail, sameOrigin } from "@/lib/server/http";
import { startFamilyVerification } from "@/lib/server/family-verification";

export const dynamic = "force-dynamic";

/**
 * POST /api/family/verify/start — begin two-factor family verification.
 *
 * Body: { code: "ANL-..." }
 *
 * Always returns 200 with a `nextStep`; the response is intentionally uniform
 * so it cannot be used to enumerate students or registered phone numbers.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await startFamilyVerification(b.code, request);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
