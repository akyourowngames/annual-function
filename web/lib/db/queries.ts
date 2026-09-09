import { count, eq } from "drizzle-orm";
import { getDb } from "./index";
import { guests, invitations, type Guest } from "./schema";

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
