import { NextResponse } from "next/server";
import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { announcements } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { parseAudience } from "@/lib/server/channels";
import { sendAnnouncement } from "@/lib/server/delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Drains due scheduled announcements. Authorized either by Vercel Cron
// (Authorization: Bearer $CRON_SECRET) or an admin session, so the staff
// dashboard can also trigger it.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bySecret = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  let byStaff = false;
  if (!bySecret) {
    try {
      await requireStaff(true);
      byStaff = true;
    } catch {
      /* not staff */
    }
  }
  if (!bySecret && !byStaff)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const db = getDb();
    const due = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.status, "scheduled"), lte(announcements.sendAt, new Date())))
      .limit(5);
    const results: Array<{ id: string; sent: number; failed: number; remaining: number }> = [];
    for (const a of due) {
      const result = await sendAnnouncement({
        id: a.id,
        body: a.body,
        audience: parseAudience(a.audience),
      });
      if (result.remaining === 0)
        await db
          .update(announcements)
          .set({ status: "sent", sentAt: new Date() })
          .where(eq(announcements.id, a.id));
      results.push({ id: a.id, sent: result.sent, failed: result.failed, remaining: result.remaining });
    }
    return NextResponse.json({ processed: results.length, results });
  } catch (e) {
    console.error("cron failed", e);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
