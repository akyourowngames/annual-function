import { NextResponse, type NextRequest } from "next/server";
import { requireCheckIn, requireStaff } from "@/lib/server/auth";
import { body, fail, sameOrigin, integer, text, HttpError } from "@/lib/server/http";
import { createStudentWithInvitation } from "@/lib/db/queries";
import { requireFamily } from "@/lib/server/family-auth";
import { invitationDetail } from "@/lib/server/invitation-view";
import { normalizeInvitationCode } from "@/lib/security/family";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * GET /api/invitations?code=ANL-XXXXX — sensitive invitation detail.
 *
 * Requires EITHER a verified family session bound to this code, OR a staff /
 * gate session (the scanner). An invitation code alone is no longer sufficient:
 * it would otherwise expose the student's name, guest list, and bearer QR token
 * to anyone who saw the printed code.
 */
export async function GET(request: NextRequest) {
  const code = normalizeInvitationCode(
    request.nextUrl.searchParams.get("code"),
  );
  if (!code)
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  try {
    let authorised = false;
    try {
      await requireCheckIn();
      authorised = true;
    } catch {
      // No staff/gate session — fall back to the verified family session.
    }
    if (!authorised) await requireFamily(code);
    return NextResponse.json(await invitationDetail(code), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return fail(err);
  }
}
/** POST /api/invitations — admin: create student + invitation. */
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    await requireStaff(true);
  } catch (e) {
    return fail(e);
  }
  try {
    const b = await body(request);
    const studentId = text(b.admissionNumber ?? b.studentId, "Admission number", 100);
    if (b.admissionNumber !== undefined && b.studentId !== undefined && text(b.studentId, "Admission number", 100) !== studentId)
      throw new HttpError("Conflicting admission numbers supplied.");
    const name = text(b.name, "Full name", 100).replace(/\s+/g, " ");
    const className = text(b.className, "Class", 100).replace(/\s+/g, " ");
    const guestLimit = b.guestLimit === undefined ? undefined : integer(b.guestLimit, "Guest limit");
    const result = await createStudentWithInvitation({
      studentId,
      name,
      className,
      guestLimit,
    });
    await audit({
      actorType: "admin",
      action: result.created ? "invitation.created" : "invitation.existing",
      invitationId: result.invitation.id,
      invitationCode: result.invitation.invitationCode,
      ip: clientKey(request),
    });
    return NextResponse.json(
      {
        student: {
          admissionNumber: result.student.studentId,
          studentId: result.student.studentId,
          name: result.student.name,
          className: result.student.className,
        },
        invitation: {
          code: result.invitation.invitationCode,
          qrToken: result.invitation.qrToken,
          guestLimit: result.invitation.guestLimit,
          status: result.invitation.status,
        },
        created: result.created,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    return fail(err);
  }
}
