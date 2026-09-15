import { NextResponse } from "next/server";
import { setRsvp } from "@/lib/db/queries";
import { body, fail, HttpError, integer, sameOrigin, text } from "@/lib/server/http";

// Families RSVP from the portal (or via the chat agent). The invitation code
// is the credential; the guest count is still bounded by the invitation limit.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    const code = text(b.code, "Invitation code", 64).toUpperCase();
    const status = text(b.status, "Reply", 20);
    if (status !== "attending" && status !== "declined")
      throw new HttpError("Please choose attending or declined.");
    const guestCount = b.guests === undefined ? undefined : integer(b.guests, "Guest count", 100);
    const note = typeof b.note === "string" ? b.note.slice(0, 500) : undefined;
    try {
      const updated = await setRsvp(code, { status, guestCount, note });
      return NextResponse.json({
        rsvp: {
          status: updated.rsvpStatus,
          guests: updated.rsvpGuests,
          note: updated.rsvpNote,
          at: updated.rsvpAt,
        },
      });
    } catch (e) {
      if (e instanceof Error && /not found/i.test(e.message))
        throw new HttpError(e.message, 404);
      if (e instanceof Error) throw new HttpError(e.message, 409);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
