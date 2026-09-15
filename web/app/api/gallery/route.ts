import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings, photos } from "@/lib/db/schema";
import { signedPhotoUrl } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Public, no auth. Only runs when staff have published the gallery, and only
// ever returns APPROVED photos, served through short-lived signed URLs. Any
// problem degrades to "not available" rather than leaking anything.
export async function GET() {
  try {
    const db = getDb();
    const [event] = await db
      .select()
      .from(eventSettings)
      .orderBy(desc(eventSettings.updatedAt))
      .limit(1);
    if (!event?.galleryEnabled)
      return NextResponse.json(
        { enabled: false, photos: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    const rows = await db
      .select()
      .from(photos)
      .where(eq(photos.status, "approved"))
      .orderBy(desc(photos.createdAt))
      .limit(300);
    const items = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        caption: p.caption,
        createdAt: p.createdAt,
        url: await signedPhotoUrl(p.storagePath, 3600).catch(() => null),
      })),
    );
    return NextResponse.json(
      { enabled: true, photos: items.filter((i) => i.url) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("gallery failed", e);
    return NextResponse.json(
      { enabled: false, photos: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
