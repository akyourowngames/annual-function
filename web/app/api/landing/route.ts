import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import type { LandingContent, ProgrammeItem } from "@/lib/landing";
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    if (!Array.isArray(b.guests) || b.guests.length < 1 || b.guests.length > 6)
      throw new HttpError("Add between one and six guests.");
    if (
      !Array.isArray(b.programme) ||
      b.programme.length < 1 ||
      b.programme.length > 15
    )
      throw new HttpError("Add between one and fifteen programme moments.");
    const content: LandingContent = {
      schoolName: text(b.schoolName, "School name", 150),
      theme: text(b.theme, "Event theme", 100),
      introduction: text(b.introduction, "Introduction", 600),
      contact: text(b.contact, "Contact information", 1000),
      isDemo: b.isDemo !== false,
      guests: b.guests.map((g) => {
        if (!g || typeof g !== "object")
          throw new HttpError("Invalid guest information.");
        return {
          name: text(g.name, "Guest name", 100),
          title: text(g.title, "Guest title", 150),
          role: text(g.role, "Guest role", 70),
          note: text(g.note, "Guest introduction", 500),
        };
      }),
      programme: b.programme.map((p) => {
        if (!p || typeof p !== "object")
          throw new HttpError("Invalid programme information.");
        if (
          !["welcome", "music", "dance", "theatre", "celebration"].includes(
            p.kind,
          )
        )
          throw new HttpError("Choose a valid programme category.");
        return {
          time: text(p.time, "Programme time", 30),
          title: text(p.title, "Programme title", 150),
          description: text(p.description, "Programme description", 800),
          kind: p.kind as ProgrammeItem["kind"],
        };
      }),
    };
    const db = getDb();
    const [current] = await db
      .select()
      .from(eventSettings)
      .orderBy(desc(eventSettings.updatedAt))
      .limit(1);
    if (!current) throw new HttpError("Save your event details first.", 409);
    await db
      .update(eventSettings)
      .set({ landingContent: content, updatedAt: new Date() })
      .where(eq(eventSettings.id, current.id));
    return NextResponse.json({ content });
  } catch (e) {
    return fail(e);
  }
}
