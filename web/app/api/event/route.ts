import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { invalidateEventCache } from "@/lib/server/helpdesk";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { toInstant } from "@/lib/passes/expiry";
/**
 * Read the optional pass-expiry field.
 *
 * `undefined` means "the form did not mention it" — leave whatever is stored.
 * Empty text clears the expiry (passes go back to working until switched off).
 * Anything else must be a real moment. The browser sends an ISO string with its
 * own offset, so the office's clock decides the instant, not the server's.
 */
function readPassExpiry(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new HttpError("Enter a valid date and time for the pass expiry.");
  const raw = value.trim();
  if (!raw) return null;
  const at = toInstant(raw);
  if (!at)
    throw new HttpError("Enter a valid date and time for the pass expiry.");
  return at;
}
export async function GET() {
  try {
    const [event] = await getDb()
      .select()
      .from(eventSettings)
      .orderBy(desc(eventSettings.updatedAt))
      .limit(1);
    return NextResponse.json({ event: event || null });
  } catch (e) {
    return fail(e);
  }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const expiry = readPassExpiry(b.passExpiresAt);
    const eventDate = text(b.eventDate, "Event date", 10, false);
    if (
      eventDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
        Number.isNaN(Date.parse(eventDate)) ||
        new Date(eventDate).toISOString().slice(0, 10) !== eventDate)
    )
      throw new HttpError("Enter a valid event date.");
    const values = {
      eventName: text(b.eventName, "Event name"),
      eventDate: eventDate || null,
      startTime: text(b.startTime, "Start time", 100, false) || null,
      venue: text(b.venue, "Venue", 500, false) || null,
      dressCode: text(b.dressCode, "Dress code", 1000, false) || null,
      parkingInfo:
        text(b.parkingInfo, "Parking information", 2000, false) || null,
      entryInfo: text(b.entryInfo, "Entry information", 2000, false) || null,
      // Optional: the moment the gate stops accepting any pass. An empty value
      // clears the expiry, which puts passes back to "works until switched off".
      ...(expiry === undefined ? {} : { passExpiresAt: expiry }),
      updatedAt: new Date(),
    };
    const db = getDb();
    const [current] = await db
      .select()
      .from(eventSettings)
      .orderBy(desc(eventSettings.updatedAt))
      .limit(1);
    const [event] = current
      ? await db
          .update(eventSettings)
          .set(values)
          .where(eq(eventSettings.id, current.id))
          .returning()
      : await db.insert(eventSettings).values(values).returning();
    // Drop the assistant's cached copy so the next family question sees the
    // edit immediately rather than up to LLM_EVENT_CACHE_MS later.
    invalidateEventCache();
    return NextResponse.json({ event });
  } catch (e) {
    return fail(e);
  }
}
