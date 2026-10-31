import {
  countCheckIns,
  getGuestUsage,
  listGuests,
} from "@/lib/db/queries";
import type { Guest } from "@/lib/db/schema";

export type InvitationDetail = {
  invitation: {
    code: string;
    status: string;
    guestLimit: number;
    qrToken: string;
  };
  studentName: string;
  registered: number;
  remaining: number;
  checkIns: number;
  guests: Guest[];
  rsvp: {
    status: string;
    guests: number | null;
    note: string | null;
  } | null;
};

/**
 * The single sensitive invitation projection. Callers MUST enforce a verified
 * family session (or a staff session) before using it: it includes the student
 * name, the guest list, and the bearer QR token.
 */
export async function invitationDetail(code: string): Promise<InvitationDetail> {
  const usage = await getGuestUsage(code);
  const [guests, checkIns] = await Promise.all([
    listGuests(usage.invitation.id),
    countCheckIns(usage.invitation.id),
  ]);
  return {
    invitation: {
      code: usage.invitation.invitationCode,
      status: usage.invitation.status,
      guestLimit: usage.invitation.guestLimit,
      qrToken: usage.invitation.qrToken,
    },
    studentName: usage.studentName,
    registered: usage.registered,
    remaining: usage.remaining,
    checkIns,
    guests,
    rsvp: {
      status: usage.invitation.rsvpStatus,
      guests: usage.invitation.rsvpGuests,
      note: usage.invitation.rsvpNote,
    },
  };
}
