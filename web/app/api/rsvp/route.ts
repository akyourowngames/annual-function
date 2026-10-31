import { NextResponse } from "next/server";
import { setRsvp } from "@/lib/db/queries";
import { body, fail, HttpError, integer, sameOrigin, text } from "@/lib/server/http";
import { requireFamily } from "@/lib/server/family-auth";
import { normalizeInvitationCode } from "@/lib/security/family";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";

/**
 * Families RSVP from the portal. A verified family session bound to the same
 * invitation is required; the guest count is still bounded by the invitation
 * limit in the database transaction (setRsvp).
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const code = normalizeInvitationCode(b.code);
    if (!code) throw new HttpError("Invitation code is required.");
    const session = await requireFamily(code);
    const status = text(b.status, "Reply", 20);
    if (status !== "attending" && status !== "declined")
      throw new HttpError("Please choose attending or declined.");
    const guestCount =
      b.guests === undefined ? undefined : integer(b.guests, "Guest count", 100);
    const note = typeof b.note === "string" ? b.note.slice(0, 500) : undefined;
    try {
      const updated = await setRsvp(code, { status, guestCount, note });
      await audit({
        actorType: "family",
        action: "rsvp.recorded",
        invitationId: session.session.invitationId,
        invitationCode: code,
        ip: clientKey(request),
        detail: { status, guests: updated.rsvpGuests },
      });
      return NextResponse.json({
        rsvp: {
          status: updated.rsvpStatus,
          guests: updated.rsvpGuests,
          note: updated.rsvpNote,
          at: updated.rsvpAt,
        },
      });
    } catch (e) {
      // Only surface the known, user-actionable business errors. Anything else
      // is an internal failure and must not echo driver/server messages.
      const message = e instanceof Error ? e.message : "";
      if (/not found/i.test(message)) throw new HttpError(message, 404);
      if (/not active|guestLimit|guest limit|allows at most|choose how many|choose attending/i.test(message))
        throw new HttpError(message, 409);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
