import { NextResponse, type NextRequest } from "next/server";
import { getGuestUsage, listGuests, registerGuest } from "@/lib/db/queries";

/** GET /api/guests?code=ANL-XXXXX — guests registered on an invitation. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  try {
    const usage = await getGuestUsage(code);
    const guests = await listGuests(usage.invitation.id);
    return NextResponse.json({
      invitationCode: usage.invitation.invitationCode,
      guestLimit: usage.invitation.guestLimit,
      registered: usage.registered,
      remaining: usage.remaining,
      guests,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    const status = message === "Invitation not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** POST /api/guests — register a guest. Guest limit enforced in backend. */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!code || !name) {
    return NextResponse.json(
      { error: "code and name are required" },
      { status: 400 },
    );
  }

  try {
    const result = await registerGuest(code, {
      name,
      relationship:
        typeof body.relationship === "string" ? body.relationship.trim() : undefined,
    });
    return NextResponse.json(
      {
        guest: result.guest,
        registered: result.registered,
        remaining: result.remaining,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    const status =
      message === "Invitation not found"
        ? 404
        : message.startsWith("Guest limit reached") || message === "Invitation is not active"
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

