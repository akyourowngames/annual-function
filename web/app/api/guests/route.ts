import { NextResponse, type NextRequest } from "next/server";
import {
  getGuestUsage,
  listGuests,
  registerGuest,
  removeGuest,
  updateGuest,
} from "@/lib/db/queries";
import { body, fail, HttpError, sameOrigin, text, uuid } from "@/lib/server/http";
import { requireFamily } from "@/lib/server/family-auth";
import { normalizeInvitationCode } from "@/lib/security/family";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * Family guest management. Every method requires a verified family session
 * bound to the same invitation code:
 *   GET    — read the guest list
 *   POST   — register a guest
 *   PATCH  — edit a guest
 *   DELETE — remove a guest
 *
 * The invitation code alone is not accepted as authorization.
 */
function codeFrom(value: unknown): string {
  const code = normalizeInvitationCode(value);
  if (!code) throw new HttpError("Invitation code is required.");
  return code;
}

export async function GET(request: NextRequest) {
  try {
    const code = codeFrom(request.nextUrl.searchParams.get("code"));
    const session = await requireFamily(code);
    const usage = await getGuestUsage(code);
    return NextResponse.json(
      {
        invitationCode: code,
        guestLimit: usage.invitation.guestLimit,
        registered: usage.registered,
        remaining: usage.remaining,
        guests: await listGuests(usage.invitation.id),
        sessionExpiresAt: new Date(session.payload.exp).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const code = codeFrom(b.code);
    const session = await requireFamily(code);
    const result = await registerGuest(code, {
      name: text(b.name, "Guest name", 100),
      relationship: text(b.relationship, "Relationship", 50, false),
    });
    await audit({
      actorType: "family",
      action: "guest.registered",
      invitationId: session.session.invitationId,
      invitationCode: code,
      ip: clientKey(request),
      detail: { guestId: result.guest.id },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const code = codeFrom(b.code);
    const session = await requireFamily(code);
    const guest = await updateGuest(code, uuid(b.guestId), {
      name: text(b.name, "Guest name", 100),
      relationship: b.relationship
        ? text(b.relationship, "Relationship", 50, false)
        : undefined,
    });
    const usage = await getGuestUsage(code);
    await audit({
      actorType: "family",
      action: "guest.updated",
      invitationId: session.session.invitationId,
      invitationCode: code,
      ip: clientKey(request),
      detail: { guestId: guest.id },
    });
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
    const code = codeFrom(b.code);
    const session = await requireFamily(code);
    const guestId = uuid(b.guestId);
    await removeGuest(code, guestId);
    await audit({
      actorType: "family",
      action: "guest.removed",
      invitationId: session.session.invitationId,
      invitationCode: code,
      ip: clientKey(request),
      detail: { guestId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
