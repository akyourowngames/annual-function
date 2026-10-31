import { NextResponse } from "next/server";
import { fail } from "@/lib/server/http";
import {
  readFamilySession,
  revokeFamilySession,
} from "@/lib/server/family-auth";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/family/session — is this browser already verified? */
export async function GET() {
  try {
    const found = await readFamilySession();
    if (!found)
      return NextResponse.json(
        { verified: false },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        verified: true,
        code: found.payload.code,
        expiresAt: new Date(found.payload.exp).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/family/session — revoke server-side and clear the cookie. */
export async function DELETE(request: Request) {
  try {
    const found = await readFamilySession().catch(() => null);
    await revokeFamilySession();
    if (found)
      await audit({
        actorType: "family",
        action: "session.revoked",
        invitationId: found.session.invitationId,
        invitationCode: found.session.code,
        ip: clientKey(request),
      });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
