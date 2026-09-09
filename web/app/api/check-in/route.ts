import { NextResponse, type NextRequest } from "next/server";
import { checkInByQrToken, countCheckIns, getInvitationByQrToken } from "@/lib/db/queries";

/** GET /api/check-in?qrToken=... — lookup what a scanned QR points to. */
export async function GET(request: NextRequest) {
  const qrToken = request.nextUrl.searchParams.get("qrToken")?.trim();
  if (!qrToken) {
    return NextResponse.json({ error: "qrToken is required" }, { status: 400 });
  }
  try {
    const invitation = await getInvitationByQrToken(qrToken);
    if (!invitation) {
      return NextResponse.json({ error: "Invalid QR token" }, { status: 404 });
    }
    const checkInCount = await countCheckIns(invitation.id);
    return NextResponse.json({
      valid: true,
      invitationCode: invitation.invitationCode,
      status: invitation.status,
      guestLimit: invitation.guestLimit,
      checkIns: checkInCount,
    });
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}

/** POST /api/check-in — record a gate check-in by QR token. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const qrToken = typeof body.qrToken === "string" ? body.qrToken.trim() : "";
  if (!qrToken) {
    return NextResponse.json({ error: "qrToken is required" }, { status: 400 });
  }

  try {
    const result = await checkInByQrToken({
      qrToken,
      guestId: typeof body.guestId === "string" ? body.guestId : undefined,
      checkedInBy: typeof body.checkedInBy === "string" ? body.checkedInBy : undefined,
    });
    return NextResponse.json(
      {
        checkedIn: true,
        invitationCode: result.invitation.invitationCode,
        at: result.checkIn.checkedInAt,
        guestId: result.checkIn.guestId,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Check-in failed";
    const status =
      message === "Invalid QR token"
        ? 404
        : message === "Guest does not belong to this invitation"
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

