import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import type { LandingContent, ProgrammeItem } from "@/lib/landing";

function safeUrl(value: unknown, label: string): string {
  const s = text(value, label, 300);
  if (!/^https?:\/\//i.test(s) && !s.startsWith("/"))
    throw new HttpError(`${label} must be a web link or a site path.`);
  return s;
}
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
      isDemo: b.isDemo === true,
      contactPhone: text(b.contactPhone, "Phone", 120, false) || undefined,
      contactEmail: text(b.contactEmail, "Email", 150, false) || undefined,
      website: b.website ? safeUrl(b.website, "Website") : undefined,
      logoUrl: b.logoUrl ? safeUrl(b.logoUrl, "Logo URL") : undefined,
      socials:
        Array.isArray(b.socials) && b.socials.length
          ? b.socials.slice(0, 8).map((s) => {
              const link = (s ?? {}) as Record<string, unknown>;
              return {
                label: text(link.label, "Social label", 40),
                url: safeUrl(link.url, "Social link"),
              };
            })
          : undefined,
      principal: b.principal
        ? (() => {
            const p = b.principal as Record<string, unknown>;
            return {
              name: text(p.name, "Principal name", 100),
              title: text(p.title, "Principal title", 150),
              message: text(p.message, "Principal message", 600),
              photoUrl: p.photoUrl ? safeUrl(p.photoUrl, "Principal photo") : "",
            };
          })()
        : undefined,
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
