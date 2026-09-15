import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { eventSettings, photos } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text, uuid } from "@/lib/server/http";
import { deletePhoto, signedPhotoUrl } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireStaff();
    const db = getDb();
    const rows = await db
      .select()
      .from(photos)
      .orderBy(desc(photos.createdAt))
      .limit(200);
    const items = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        status: p.status,
        caption: p.caption,
        channel: p.channel,
        invitationCode: p.invitationCode,
        byteSize: p.byteSize,
        createdAt: p.createdAt,
        url: await signedPhotoUrl(p.storagePath, 3600).catch(() => null),
      })),
    );
    const counts = { pending: 0, approved: 0, hidden: 0 };
    for (const p of rows) {
      const key = p.status as keyof typeof counts;
      if (key in counts) counts[key]++;
    }
    const [event] = await db
      .select()
      .from(eventSettings)
      .orderBy(desc(eventSettings.updatedAt))
      .limit(1);
    return NextResponse.json(
      {
        photos: items,
        counts,
        total: rows.length,
        galleryEnabled: Boolean(event?.galleryEnabled),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const b = await body(request);
    // Publishing the public gallery is an administrator decision.
    if (typeof b.galleryEnabled === "boolean") {
      await requireStaff(true);
      const db = getDb();
      const [current] = await db
        .select()
        .from(eventSettings)
        .orderBy(desc(eventSettings.updatedAt))
        .limit(1);
      if (!current) throw new HttpError("Save your event details first.", 409);
      await db
        .update(eventSettings)
        .set({ galleryEnabled: b.galleryEnabled, updatedAt: new Date() })
        .where(eq(eventSettings.id, current.id));
      return NextResponse.json({ galleryEnabled: b.galleryEnabled });
    }
    await requireStaff();
    const status = text(b.status, "Status", 20);
    if (!["pending", "approved", "hidden"].includes(status))
      throw new HttpError("Choose a valid photo status.");
    const [updated] = await getDb()
      .update(photos)
      .set({ status })
      .where(eq(photos.id, uuid(b.id)))
      .returning();
    if (!updated) throw new HttpError("Photo not found.", 404);
    return NextResponse.json({ photo: updated });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff();
    const b = await body(request);
    const id = uuid(b.id);
    const [row] = await getDb().select().from(photos).where(eq(photos.id, id)).limit(1);
    if (!row) throw new HttpError("Photo not found.", 404);
    await deletePhoto(row.storagePath).catch(() => {});
    await getDb().delete(photos).where(eq(photos.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
