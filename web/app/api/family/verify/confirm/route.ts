import { NextResponse } from "next/server";
import { body, fail, sameOrigin } from "@/lib/server/http";
import { confirmFamilyVerification } from "@/lib/server/family-verification";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/family/verify/confirm — redeem the OTP and issue a family session.
 *
 * Body: { code: "ANL-...", otp: "123456" }
 *
 * The session cookie is HttpOnly, Secure in production, SameSite=Strict, and
 * bound to exactly one invitation. It is rotated on every successful verify.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const result = await confirmFamilyVerification(b.code, b.otp, request);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Record repeated failures without leaking whether the code exists.
    if (e instanceof Error && /verification code/i.test(e.message))
      await audit({
        actorType: "anonymous",
        action: "otp.confirm_rejected",
        ip: clientKey(request),
      });
    return fail(e);
  }
}
