import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { announcements, deliveries } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text, uuid } from "@/lib/server/http";
import { parseAudience } from "@/lib/server/channels";
import { sendAnnouncement } from "@/lib/server/delivery";

export const maxDuration = 60;

type Row = typeof announcements.$inferSelect;

async function withStats(rows: Row[]) {
  if (!rows.length) return [];
  const stats = await getDb()
    .select({
      refId: deliveries.refId,
      status: deliveries.status,
      n: sql<number>`count(*)::int`,
    })
    .from(deliveries)
    .where(eq(deliveries.kind, "announcement"))
    .groupBy(deliveries.refId, deliveries.status);
  const byId = new Map<string, { sent: number; failed: number }>();
  for (const s of stats) {
    if (!s.refId) continue;
    const entry = byId.get(s.refId) ?? { sent: 0, failed: 0 };
    if (s.status === "sent") entry.sent += s.n;
    if (s.status === "failed") entry.failed += s.n;
    byId.set(s.refId, entry);
  }
  return rows.map((r) => ({
    ...r,
    sent: byId.get(r.id)?.sent ?? 0,
    failed: byId.get(r.id)?.failed ?? 0,
  }));
}

export async function GET() {
  try {
    await requireStaff(true);
    const rows = await getDb()
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(50);
    return NextResponse.json({ announcements: await withStats(rows) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const title = text(b.title, "Title", 200, false).trim() || null;
    const bodyText = text(b.body, "Message", 2000);
    const audience = parseAudience(text(b.audience ?? "all", "Audience", 120));
    const action = b.action === "schedule" ? "schedule" : b.action === "send" ? "send" : "draft";
    let sendAt: Date | null = null;
    if (action === "schedule") {
      const parsed = new Date(text(b.sendAt, "Send time", 40));
      if (Number.isNaN(parsed.getTime())) throw new HttpError("Choose a valid send time.");
      sendAt = parsed;
    }
    const status = action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "sending";
    const [created] = await getDb()
      .insert(announcements)
      .values({ title, body: bodyText, audience, status, sendAt })
      .returning();
    if (action !== "send")
      return NextResponse.json({ announcement: { ...created, sent: 0, failed: 0 } }, { status: 201 });
    // "Send now": fire the first batch immediately; the UI keeps draining.
    const result = await sendAnnouncement({ id: created.id, body: bodyText, audience });
    if (result.remaining === 0) {
      const [done] = await getDb()
        .update(announcements)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(announcements.id, created.id))
        .returning();
      return NextResponse.json(
        { announcement: { ...done, sent: result.sent, failed: result.failed }, result },
        { status: 201 },
      );
    }
    return NextResponse.json(
      { announcement: { ...created, sent: result.sent, failed: result.failed }, result },
      { status: 201 },
    );
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const id = uuid(b.id);
    const db = getDb();
    const [row] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    if (!row) throw new HttpError("Announcement not found", 404);
    if (b.action === "cancel") {
      if (row.status === "sent") throw new HttpError("This announcement was already sent.", 409);
      const [updated] = await db
        .update(announcements)
        .set({ status: "cancelled" })
        .where(eq(announcements.id, id))
        .returning();
      return NextResponse.json({ announcement: { ...updated, sent: 0, failed: 0 } });
    }
    if (b.action === "send-batch" || b.action === "send-now") {
      const result = await sendAnnouncement({ id, body: row.body, audience: parseAudience(row.audience) });
      const done = result.remaining === 0;
      const [updated] = done
        ? await db
            .update(announcements)
            .set({ status: "sent", sentAt: new Date() })
            .where(eq(announcements.id, id))
            .returning()
        : [row];
      return NextResponse.json({ announcement: { ...updated, sent: result.sent, failed: result.failed }, result });
    }
    throw new HttpError("Unknown action.");
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    await getDb().delete(announcements).where(eq(announcements.id, uuid(b.id)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
