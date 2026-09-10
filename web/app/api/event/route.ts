import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
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
    return NextResponse.json({ event });
  } catch (e) {
    return fail(e);
  }
}
