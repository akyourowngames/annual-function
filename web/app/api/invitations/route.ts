import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, sameOrigin, integer, text, HttpError } from "@/lib/server/http";
import {
  countCheckIns,
  createStudentWithInvitation,
  getGuestUsage,
  listGuests,
} from "@/lib/db/queries";
/** GET /api/invitations?code=ANL-XXXXX — invitation status + guest usage. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  try {
    const usage = await getGuestUsage(code);
    const guests = await listGuests(usage.invitation.id);
    const checkInCount = await countCheckIns(usage.invitation.id);
    return NextResponse.json({
      invitation: {
        code: usage.invitation.invitationCode,
        status: usage.invitation.status,
        guestLimit: usage.invitation.guestLimit,
        qrToken: usage.invitation.qrToken,
      },
      studentName: usage.studentName,
      registered: usage.registered,
      remaining: usage.remaining,
      checkIns: checkInCount,
      guests,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    const status = message === "Invitation not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
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
