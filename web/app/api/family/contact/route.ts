import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { familyContacts, invitations } from "@/lib/db/schema";
import { requireStaff } from "@/lib/server/auth";
import { body, fail, HttpError, sameOrigin, text } from "@/lib/server/http";
import { audit } from "@/lib/server/audit";
import { clientKey } from "@/lib/server/rate-limit";
import { maskDestination, normalizeInvitationCode } from "@/lib/security/family";

export const dynamic = "force-dynamic";

/**
 * GET /api/family/contact?code=ANL-…
 *
 * Read the approved contact for one invitation, masked. Staff need this to
 * know whether a family can self-verify at all, and to confirm a change landed.
 */
export async function GET(request: Request) {
  try {
    await requireStaff(true);
    const url = new URL(request.url);
    const code = normalizeInvitationCode(url.searchParams.get("code"));
    if (!code) throw new HttpError("Enter a valid invitation code.");
    const db = getDb();
    const [invitation] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(eq(invitations.invitationCode, code))
      .limit(1);
    if (!invitation) throw new HttpError("Invitation not found.", 404);
    const [contact] = await db
      .select()
      .from(familyContacts)
      .where(eq(familyContacts.invitationId, invitation.id))
      .limit(1);
    return NextResponse.json(
      {
        verified: Boolean(contact),
        contact: contact
          ? {
              channel: contact.channel,
              destination: maskDestination(contact.channel, contact.address),
              verifiedAt: contact.verifiedAt,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}

/**
 * Admin-approved recovery contact.
 *
 * POST /api/family/contact  { code, channel: "whatsapp"|"telegram", address }
 * DELETE /api/family/contact { code }
 *
 * This is the *only* way to add or replace the contact that receives OTPs.
 * Families cannot point verification at a number they control without a staff
 * member approving it, which defeats code-only account takeover.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const staff = await requireStaff(true);
    const b = await body(request);
    const code = normalizeInvitationCode(b.code);
    if (!code) throw new HttpError("Enter a valid invitation code.");
    const channel = text(b.channel, "Channel", 20).toLowerCase();
    if (channel !== "whatsapp" && channel !== "telegram")
      throw new HttpError("Choose WhatsApp or Telegram.");
    const address = text(b.address, "Contact address", 200);

    const db = getDb();
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.invitationCode, code))
      .limit(1);
    if (!invitation) throw new HttpError("Invitation not found.", 404);

    const [saved] = await db
      .insert(familyContacts)
      .values({
        invitationId: invitation.id,
        channel,
        address,
        verifiedBy: `${staff.role}:${staff.id}`,
      })
      .onConflictDoUpdate({
        target: familyContacts.invitationId,
        set: {
          channel,
          address,
          verifiedAt: new Date(),
          verifiedBy: `${staff.role}:${staff.id}`,
        },
      })
      .returning();

    await audit({
      actorType: staff.role === "admin" ? "admin" : "staff",
      actorId: staff.id,
      action: "family_contact.upserted",
      invitationId: invitation.id,
      invitationCode: code,
      ip: clientKey(request),
      detail: { channel },
    });

    return NextResponse.json({
      contact: saved
        ? { channel: saved.channel, destination: maskDestination(saved.channel, saved.address) }
        : null,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const staff = await requireStaff(true);
    const b = await body(request);
    const code = normalizeInvitationCode(b.code);
    if (!code) throw new HttpError("Enter a valid invitation code.");
    const db = getDb();
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.invitationCode, code))
      .limit(1);
    if (!invitation) throw new HttpError("Invitation not found.", 404);
    await db
      .delete(familyContacts)
      .where(eq(familyContacts.invitationId, invitation.id));
    await audit({
      actorType: staff.role === "admin" ? "admin" : "staff",
      actorId: staff.id,
      action: "family_contact.removed",
      invitationId: invitation.id,
      invitationCode: code,
      ip: clientKey(request),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
