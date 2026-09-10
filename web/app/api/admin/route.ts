import { NextResponse } from "next/server";
import { count, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  checkIns,
  guests,
  invitations,
  students,
  supportTickets,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import {
  body,
  fail,
  HttpError,
  integer,
  sameOrigin,
  text,
} from "@/lib/server/http";
import { newInvitationCode, newQrToken } from "@/lib/invitations/codes";
export async function GET() {
  try {
    const staff = await requireStaff();
    const db = getDb();
    const [roster, guestRows, tickets, entries, totals] = await Promise.all([
      db
        .select({
          id: invitations.id,
          code: invitations.invitationCode,
          status: invitations.status,
          guestLimit: invitations.guestLimit,
          studentId: students.studentId,
          name: students.name,
          className: students.className,
          createdAt: invitations.createdAt,
          registered: sql<number>`(select count(*)::int from guests where invitation_id = ${invitations.id})`,
          checkIns: sql<number>`(select count(*)::int from check_ins where invitation_id = ${invitations.id})`,
        })
        .from(invitations)
        .innerJoin(students, eq(invitations.studentId, students.id))
        .orderBy(desc(invitations.createdAt)),
      db
        .select({
          id: guests.id,
          name: guests.name,
          relationship: guests.relationship,
          status: guests.status,
          code: invitations.invitationCode,
          studentName: students.name,
        })
        .from(guests)
        .innerJoin(invitations, eq(guests.invitationId, invitations.id))
        .innerJoin(students, eq(invitations.studentId, students.id))
        .orderBy(desc(guests.createdAt)),
      db
        .select({
          ticket: supportTickets,
          student: { name: students.name, studentId: students.studentId },
        })
        .from(supportTickets)
        .leftJoin(students, eq(supportTickets.studentId, students.id))
        .orderBy(desc(supportTickets.createdAt)),
      db
        .select({
          id: checkIns.id,
          at: checkIns.checkedInAt,
          by: checkIns.checkedInBy,
          guestName: guests.name,
          code: invitations.invitationCode,
          studentName: students.name,
        })
        .from(checkIns)
        .innerJoin(invitations, eq(checkIns.invitationId, invitations.id))
        .innerJoin(students, eq(invitations.studentId, students.id))
        .leftJoin(guests, eq(checkIns.guestId, guests.id))
        .orderBy(desc(checkIns.checkedInAt))
        .limit(100),
      db.select({ value: count() }).from(checkIns),
    ]);
    return NextResponse.json({
      staff,
      invitations: roster,
      guests: guestRows,
      tickets: tickets.map((r) => ({ ...r.ticket, student: r.student })),
      entries,
      stats: {
        invitations: roster.length,
        guests: guestRows.length,
        checkIns: totals[0].value,
        openTickets: tickets.filter((r) => r.ticket.status !== "resolved")
          .length,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    await requireStaff(true);
    const b = await body(request);
    const code = text(b.code, "Invitation code", 64).toUpperCase();
    const result = await getDb().transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.invitationCode, code))
        .limit(1)
        .for("update");
      if (!inv) throw new HttpError("Invitation not found", 404);
      const values: Partial<typeof invitations.$inferInsert> = {};
      if (b.guestLimit !== undefined) {
        const limit = integer(b.guestLimit, "Guest limit");
        const [used] = await tx
          .select({ value: count() })
          .from(guests)
          .where(eq(guests.invitationId, inv.id));
        const [entered] = await tx
          .select({ value: count() })
          .from(checkIns)
          .where(eq(checkIns.invitationId, inv.id));
        if (limit < Math.max(used.value, entered.value))
          throw new HttpError(
            "Cannot set the guest limit below existing registrations or check-ins.",
            409,
          );
        values.guestLimit = limit;
      }
      if (b.status !== undefined) {
        const status = text(b.status, "Status", 20);
        if (!["active", "disabled"].includes(status))
          throw new HttpError("Choose active or disabled.");
        values.status = status;
      }
      if (b.regenerate === true) {
        values.invitationCode = newInvitationCode();
        values.qrToken = newQrToken();
      }
      if (!Object.keys(values).length)
        throw new HttpError("No changes supplied.");
      const [updated] = await tx
        .update(invitations)
        .set(values)
        .where(eq(invitations.id, inv.id))
        .returning();
      return updated;
    });
    return NextResponse.json({ invitation: result });
  } catch (e) {
    return fail(e);
  }
}
