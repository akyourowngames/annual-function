import { asc, count, desc, eq } from "drizzle-orm";
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
  const invitation = await getInvitationByCode(invitationCode);
  if (!invitation) throw new Error("Invitation not found");
  const registered = await countRegisteredGuests(invitation.id);
  return {
    invitation,
    registered,
    remaining: invitation.guestLimit - registered,
  };
}

export async function registerGuest(
  invitationCode: string,
  input: { name: string; relationship?: string },
): Promise<{ guest: Guest; registered: number; remaining: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.invitationCode, invitationCode))
      .limit(1);
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
    const foundStudent = await tx
      .select()
      .from(students)
      .where(eq(students.studentId, input.studentId))
      .limit(1);
    let student = foundStudent[0];
    if (!student) {
      const inserted = await tx
        .insert(students)
        .values({
          studentId: input.studentId,
          name: input.name,
          className: input.className,
        })
        .returning();
      student = inserted[0];
      if (!student) throw new Error("Failed to create student");
    }

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
      .limit(1);
    const invitation = found[0];
    if (!invitation) throw new Error("Invalid QR token");

    if (input.guestId) {
      const g = await tx
        .select()
        .from(guests)
        .where(eq(guests.id, input.guestId))
        .limit(1);
      const guest = g[0];
      if (!guest || guest.invitationId !== invitation.id) {
        throw new Error("Guest does not belong to this invitation");
      }
    }

    const inserted = await tx
      .insert(checkIns)
      .values({
        invitationId: invitation.id,
        guestId: input.guestId ?? null,
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
