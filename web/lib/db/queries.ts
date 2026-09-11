import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  checkIns,
  guests,
  invitations,
  students,
  supportTickets,
  type Guest,
} from "./schema";
import { newInvitationCode, newQrToken } from "@/lib/invitations/codes";
import { identityMatches } from "@/lib/invitations/identity";
import { HttpError } from "@/lib/server/http";
/**
 * Backend-owned queries. The agent may REQUEST these actions, but the
 * database + this logic validate everything. The AI can never bypass
 * the guest limit through here.
 */
export async function getInvitationByCode(invitationCode: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.invitationCode, invitationCode))
    .limit(1);
  return rows[0] ?? null;
}
export async function countRegisteredGuests(invitationId: string) {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(guests)
    .where(eq(guests.invitationId, invitationId));
  return rows[0]?.value ?? 0;
}
export async function getGuestUsage(invitationCode: string) {
  const db = getDb();
  const rows = await db
    .select({ invitation: invitations, studentName: students.name })
    .from(invitations)
    .innerJoin(students, eq(invitations.studentId, students.id))
    .where(eq(invitations.invitationCode, invitationCode))
    .limit(1);
  const found = rows[0];
  if (!found) throw new Error("Invitation not found");
  const registered = await countRegisteredGuests(found.invitation.id);
  return {
    invitation: found.invitation,
    studentName: found.studentName,
    registered,
    remaining: found.invitation.guestLimit - registered,
  };
}
export async function registerGuest(
  invitationCode: string,
  input: {
    name: string;
    relationship?: string;
  },
): Promise<{
  guest: Guest;
  registered: number;
  remaining: number;
}> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.invitationCode, invitationCode))
      .limit(1)
      .for("update");
    const invitation = found[0];
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "active") {
      throw new Error("Invitation is not active");
    }
    const counted = await tx
      .select({ value: count() })
      .from(guests)
      .where(eq(guests.invitationId, invitation.id));
    const registered = counted[0]?.value ?? 0;
    // THE rule: no registration past the limit, no exceptions, no AI override.
    if (registered >= invitation.guestLimit) {
      throw new Error(
        `Guest limit reached (limit: ${invitation.guestLimit}, registered: ${registered})`,
      );
    }
    const inserted = await tx
      .insert(guests)
      .values({
        invitationId: invitation.id,
        name: input.name,
        relationship: input.relationship,
      })
      .returning();
    const guest = inserted[0];
    if (!guest) throw new Error("Failed to register guest");
    const next = registered + 1;
    return {
      guest,
      registered: next,
      remaining: invitation.guestLimit - next,
    };
  });
}
/** Admin: create a student + their one invitation (idempotent per student_id). */
export async function createStudentWithInvitation(input: {
  studentId: string;
  name: string;
  className?: string;
  guestLimit?: number;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.insert(students).values({
      studentId: input.studentId,
      name: input.name,
      className: input.className,
    }).onConflictDoNothing({ target: students.studentId });
    const foundStudent = await tx
      .select()
      .from(students)
      .where(eq(students.studentId, input.studentId))
      .limit(1)
      .for("update");
    const student = foundStudent[0];
    if (!student) throw new Error("Failed to create student");
    if (!identityMatches(student, { admissionNumber: input.studentId, name: input.name, className: input.className || "" }))
      throw new HttpError("This admission number already belongs to a student with different details. Check the name and class before continuing.", 409);
    const foundInv = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.studentId, student.id))
      .limit(1);
    const invitation = foundInv[0];
    if (invitation) return { student, invitation, created: false };
    const insertedInv = await tx
      .insert(invitations)
      .values({
        studentId: student.id,
        invitationCode: newInvitationCode(),
        qrToken: newQrToken(),
        guestLimit: input.guestLimit ?? 4,
      })
      .returning();
    const created = insertedInv[0];
    if (!created) throw new Error("Failed to create invitation");
    return { student, invitation: created, created: true };
  });
}
export async function listGuests(invitationId: string): Promise<Guest[]> {
  const db = getDb();
  return db
    .select()
    .from(guests)
    .where(eq(guests.invitationId, invitationId))
    .orderBy(asc(guests.createdAt));
}
export async function getInvitationByQrToken(qrToken: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.qrToken, qrToken))
    .limit(1);
  return rows[0] ?? null;
}
/** Staff gate: check in by scanning the QR (invitation-level or per-guest). */
export async function checkInByQrToken(input: {
  qrToken: string;
  guestId?: string;
  checkedInBy?: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.qrToken, input.qrToken))
      .limit(1)
      .for("update");
    const invitation = found[0];
    if (!invitation) throw new Error("Invalid QR token");
    if (invitation.status !== "active")
      throw new Error("Invitation is not active");
    const [total] = await tx
      .select({ value: count() })
      .from(checkIns)
      .where(eq(checkIns.invitationId, invitation.id));
    if (total.value >= invitation.guestLimit)
      throw new Error("Guest limit reached for check-in");
    // Every entry is tied to a registered guest, including manual invitation entry.
    let guestId = input.guestId;
    if (!guestId) {
      const [next] = await tx
        .select()
        .from(guests)
        .where(
          and(
            eq(guests.invitationId, invitation.id),
            eq(guests.status, "registered"),
          ),
        )
        .orderBy(asc(guests.createdAt))
        .limit(1);
      if (!next) throw new Error("No registered guest remains to check in");
      guestId = next.id;
    }
    if (guestId) {
      const g = await tx
        .select()
        .from(guests)
        .where(eq(guests.id, guestId))
        .limit(1);
      const guest = g[0];
      if (!guest || guest.invitationId !== invitation.id) {
        throw new Error("Guest does not belong to this invitation");
      }
      const [existing] = await tx
        .select()
        .from(checkIns)
        .where(eq(checkIns.guestId, guest.id))
        .limit(1);
      if (existing || guest.status === "checked_in")
        throw new Error("Guest is already checked in");
      await tx
        .update(guests)
        .set({ status: "checked_in" })
        .where(eq(guests.id, guest.id));
    }
    const inserted = await tx
      .insert(checkIns)
      .values({
        invitationId: invitation.id,
        guestId,
        checkedInBy: input.checkedInBy ?? "gate-staff",
      })
      .returning();
    const checkIn = inserted[0];
    if (!checkIn) throw new Error("Failed to record check-in");
    return { checkIn, invitation };
  });
}
export async function countCheckIns(invitationId: string) {
  const db = getDb();
  const rows = await db
    .select({ value: count() })
    .from(checkIns)
    .where(eq(checkIns.invitationId, invitationId));
  return rows[0]?.value ?? 0;
}
/** Create a support ticket. Accepts the student's roll ID, resolves to FK. */
export async function createTicket(input: {
  studentId: string;
  category?: string;
  description: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(students)
      .where(eq(students.studentId, input.studentId))
      .limit(1);
    const student = found[0];
    if (!student) throw new Error("Student not found");
    const inserted = await tx
      .insert(supportTickets)
      .values({
        studentId: student.id,
        category: input.category ?? "other",
        description: input.description,
      })
      .returning();
    const ticket = inserted[0];
    if (!ticket) throw new Error("Failed to create ticket");
    return { ticket, student };
  });
}
export async function listTickets(studentRollId?: string) {
  const db = getDb();
  if (studentRollId) {
    return db
      .select({ ticket: supportTickets, student: students })
      .from(supportTickets)
      .innerJoin(students, eq(supportTickets.studentId, students.id))
      .where(eq(students.studentId, studentRollId))
      .orderBy(desc(supportTickets.createdAt));
  }
  return db
    .select({ ticket: supportTickets, student: students })
    .from(supportTickets)
    .innerJoin(students, eq(supportTickets.studentId, students.id))
    .orderBy(desc(supportTickets.createdAt));
}
export async function removeGuest(code: string, guestId: string) {
  return getDb().transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.invitationCode, code))
      .limit(1)
      .for("update");
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "active")
      throw new Error("Invitation is not active");
    const [guest] = await tx
      .select()
      .from(guests)
      .where(
        and(eq(guests.id, guestId), eq(guests.invitationId, invitation.id)),
      )
      .limit(1);
    if (!guest) throw new Error("Guest not found");
    const [entry] = await tx
      .select()
      .from(checkIns)
      .where(eq(checkIns.guestId, guestId))
      .limit(1);
    if (entry || guest.status === "checked_in")
      throw new Error("Cannot remove a guest who has already checked in");
    await tx.delete(guests).where(eq(guests.id, guestId));
  });
}
export async function studentForCode(code: string) {
  const [row] = await getDb()
    .select({ student: students })
    .from(invitations)
    .innerJoin(students, eq(invitations.studentId, students.id))
    .where(eq(invitations.invitationCode, code))
    .limit(1);
  if (!row) throw new Error("Invitation not found");
  return row.student;
}
