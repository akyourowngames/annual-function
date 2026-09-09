import { NextResponse, type NextRequest } from "next/server";
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
      },
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
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!studentId || !name) {
    return NextResponse.json(
      { error: "studentId and name are required" },
      { status: 400 },
    );
  }
  const guestLimit =
    typeof body.guestLimit === "number" && Number.isInteger(body.guestLimit)
      ? body.guestLimit
      : undefined;

  try {
    const result = await createStudentWithInvitation({
      studentId,
      name,
      className: typeof body.className === "string" ? body.className : undefined,
      guestLimit,
    });
    return NextResponse.json(
      {
        student: {
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
    const message = err instanceof Error ? err.message : "Creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

