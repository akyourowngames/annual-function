import { NextResponse, type NextRequest } from "next/server";
import {
  getGuestUsage,
  listGuests,
  registerGuest,
  removeGuest,
  updateGuest,
} from "@/lib/db/queries";
import { body, fail, sameOrigin, text, uuid } from "@/lib/server/http";
export async function GET(request: NextRequest) {
  try {
    const code = text(
      request.nextUrl.searchParams.get("code"),
      "Invitation code",
      64,
    ).toUpperCase();
    const usage = await getGuestUsage(code);
    return NextResponse.json({
      invitationCode: code,
      guestLimit: usage.invitation.guestLimit,
      registered: usage.registered,
      remaining: usage.remaining,
      guests: await listGuests(usage.invitation.id),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const result = await registerGuest(
      text(b.code, "Invitation code", 64).toUpperCase(),
      {
        name: text(b.name, "Guest name", 100),
        relationship: text(b.relationship, "Relationship", 50, false),
      },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const guest = await updateGuest(
      text(b.code, "Invitation code", 64).toUpperCase(),
      uuid(b.guestId),
      {
        name: text(b.name, "Guest name", 100),
        relationship: b.relationship
          ? text(b.relationship, "Relationship", 50, false)
          : undefined,
      },
    );
    const usage = await getGuestUsage(
      text(b.code, "Invitation code", 64).toUpperCase(),
    );
    return NextResponse.json({
      guest,
      registered: usage.registered,
      remaining: usage.remaining,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    await removeGuest(
      text(b.code, "Invitation code", 64).toUpperCase(),
      uuid(b.guestId),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
