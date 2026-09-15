import { NextResponse } from "next/server";
import { count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { checkIns, guests, invitations, students } from "@/lib/db/schema";
import { rsvpSummary } from "@/lib/db/queries";
import { requireStaff } from "@/lib/server/auth";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Live event view: attendance in real time + RSVP headcount. Polled by the
// staff workspace while the event runs.
export async function GET() {
  try {
    await requireStaff();
    const db = getDb();
    const [invCount] = await db.select({ value: count() }).from(invitations);
    const [checkedInv] = await db
      .select({ value: sql<number>`count(distinct ${checkIns.invitationId})::int` })
      .from(checkIns);
    const [totalEntries] = await db.select({ value: count() }).from(checkIns);
    const [registered] = await db.select({ value: count() }).from(guests);
    const byGate = await db
      .select({ gate: checkIns.gate, n: sql<number>`count(*)::int` })
      .from(checkIns)
      .groupBy(checkIns.gate);
    const byClass = await db
      .select({
        className: students.className,
        entries: sql<number>`count(${checkIns.id})::int`,
      })
      .from(checkIns)
      .innerJoin(invitations, eq(checkIns.invitationId, invitations.id))
      .innerJoin(students, eq(invitations.studentId, students.id))
      .groupBy(students.className);
    const trend = (await db.execute(sql`
      select to_char(date_trunc('hour', checked_in_at), 'HH24:00') as bucket,
             count(*)::int as n
      from check_ins
      group by 1
      order by 1
    `)) as unknown as Array<{ bucket: string; n: number }>;
    const recent = await db
      .select({
        id: checkIns.id,
        at: checkIns.checkedInAt,
        gate: checkIns.gate,
        guestName: guests.name,
        code: invitations.invitationCode,
        studentName: students.name,
      })
      .from(checkIns)
      .innerJoin(invitations, eq(checkIns.invitationId, invitations.id))
      .innerJoin(students, eq(invitations.studentId, students.id))
      .leftJoin(guests, eq(checkIns.guestId, guests.id))
      .orderBy(desc(checkIns.checkedInAt))
      .limit(15);
    const rsvp = await rsvpSummary();
    return NextResponse.json(
      {
        attendance: {
          invitations: invCount.value,
          checkedInInvitations: checkedInv.value,
          totalEntries: totalEntries.value,
          registeredGuests: registered.value,
          byGate,
          byClass,
          trend,
          recent,
        },
        rsvp,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
