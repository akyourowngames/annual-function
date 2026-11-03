import { NextResponse, type NextRequest } from "next/server";
import {
  checkInByQrToken,
  countCheckIns,
  eventPassExpiry,
  getInvitationByQrToken,
  listGuests,
  studentForCode,
} from "@/lib/db/queries";
import { passClosedMessage, passState } from "@/lib/passes/expiry";
import { requireCheckIn } from "@/lib/server/auth";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";
import {
  body,
  fail,
  HttpError,
  sameOrigin,
  text,
  uuid,
} from "@/lib/server/http";
export async function GET(request: NextRequest) {
  try {
    await requireCheckIn();
    const token = text(
      request.nextUrl.searchParams.get("qrToken"),
      "QR token",
      100,
    );
    const invitation = await getInvitationByQrToken(token);
    if (!invitation) throw new HttpError("Invalid QR token", 404);
    const [checkIns, guests, student, expiresAt] = await Promise.all([
      countCheckIns(invitation.id),
      listGuests(invitation.id),
      studentForCode(invitation.invitationCode),
      eventPassExpiry(),
    ]);
    // One verdict, computed by the same rule the check-in itself uses: the gate
    // must never show a green pass that the next tap would refuse.
    const state = passState({
      status: invitation.status,
      expiresAt,
    });
    return NextResponse.json({
      valid: state === "valid",
      state,
      message: passClosedMessage(state, expiresAt),
      passExpiresAt: expiresAt,
      invitationCode: invitation.invitationCode,
      status: invitation.status,
      guestLimit: invitation.guestLimit,
      checkIns,
      guests,
      studentName: student.name,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const staff = await requireCheckIn();
    const b = await body(request);
    const result = await checkInByQrToken({
      qrToken: text(b.qrToken, "QR token", 100),
      guestId: b.guestId ? uuid(b.guestId) : undefined,
      checkedInBy: staff.id,
    });
    await audit({
      actorType: staff.role === "gate" ? "gate" : staff.role,
      actorId: staff.id,
      action: "admission.checked_in",
      invitationId: result.invitation.id,
      invitationCode: result.invitation.invitationCode,
      ip: clientKey(request),
      detail: { guestId: result.checkIn.guestId },
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
  } catch (e) {
    return fail(e);
  }
}
