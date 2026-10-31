import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deliveries, familyContacts, invitationContacts, invitations, students } from "@/lib/db/schema";
import { getGuestUsage } from "@/lib/db/queries";
import { buildInvitationPdf } from "./whatsapp/pass";
import { sendMessage as tgSendMessage, sendDocument as tgSendDocument } from "./telegram/client";
import {
  sendDocument as waSendDocument,
  sendTextWithTemplateFallback,
  uploadMedia,
} from "./whatsapp/client";
import {
  audienceMatches,
  parseChannelKey,
  type Audience,
  type Channel,
} from "./channels";

type DeliveryRow = typeof deliveries.$inferInsert;

async function logDelivery(entry: DeliveryRow): Promise<void> {
  await getDb().insert(deliveries).values(entry);
}

// Remember a family's messaging endpoint when they verify their invitation.
export async function recordContact(key: string, code: string): Promise<void> {
  const parsed = parseChannelKey(key);
  if (!parsed) return;
  await getDb()
    .insert(invitationContacts)
    .values({ invitationCode: code, channel: parsed.channel, address: parsed.address })
    .onConflictDoUpdate({
      target: invitationContacts.invitationCode,
      set: { channel: parsed.channel, address: parsed.address, updatedAt: new Date() },
    });
}

export async function sendTextTo(channel: Channel, address: string, text: string) {
  return channel === "telegram"
    ? tgSendMessage(address, text)
    : sendTextWithTemplateFallback(address, text);
}

async function sendDocumentTo(
  channel: Channel,
  address: string,
  buffer: Buffer,
  filename: string,
  caption: string,
) {
  if (channel === "telegram") return tgSendDocument(address, buffer, filename, caption);
  const mediaId = await uploadMedia(buffer, filename);
  return waSendDocument(address, mediaId, filename, caption);
}

export type DeliveryOutcome = { status: "sent" | "failed" | "skipped"; channel?: Channel; error?: string };

// Send one family their personalized PDF pass + QR. Falls back to a text-only
// message (with the code) if the document can't be delivered.
//
// The QR token inside the PDF is a bearer admission credential. A messaging
// endpoint learned from a chat identity match is attacker-controllable (whoever
// knows the admission triple can claim the code and overwrite the address), so
// it may only ever receive the code, never the pass. The pass requires an
// administrator-approved contact on file (/api/family/contact).
export async function deliverInvitation(code: string): Promise<DeliveryOutcome> {
  const db = getDb();
  const [contact] = await db
    .select()
    .from(invitationContacts)
    .where(eq(invitationContacts.invitationCode, code))
    .limit(1);
  // Is there an administrator-approved contact for this invitation? That, and
  // only that, unlocks the QR pass.
  const [invitation] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(eq(invitations.invitationCode, code))
    .limit(1);
  const [approved] = invitation
    ? await db
        .select()
        .from(familyContacts)
        .where(eq(familyContacts.invitationId, invitation.id))
        .limit(1)
    : [];
  const target = approved
    ? { channel: approved.channel as Channel, address: approved.address }
    : contact
      ? { channel: contact.channel as Channel, address: contact.address }
      : null;
  if (!target) return { status: "skipped", error: "No messaging contact yet" };
  const channel = target.channel;

  // No verified contact: hand over only the reference code. The family opens the
  // pass in the portal behind the OTP check.
  if (!approved) {
    try {
      await sendTextTo(
        channel,
        target.address,
        `Aapka Annual Function invitation code: ${code}. Pass aur QR portal par code + OTP ke saath dekhein: /portal`,
      );
      await logDelivery({
        kind: "invitation",
        invitationCode: code,
        channel,
        address: target.address,
        status: "sent",
        sentAt: new Date(),
        error: "unverified contact; code only (no QR pass)",
      });
      return { status: "sent", channel };
    } catch (e) {
      const error = e instanceof Error ? e.message : "send failed";
      await logDelivery({
        kind: "invitation",
        invitationCode: code,
        channel,
        address: target.address,
        status: "failed",
        error,
      });
      return { status: "failed", channel, error };
    }
  }

  try {
    const u = await getGuestUsage(code);
    const pdf = await buildInvitationPdf({
      code: u.invitation.invitationCode,
      studentName: u.studentName,
      guestLimit: u.invitation.guestLimit,
      qrToken: u.invitation.qrToken,
    });
    await sendDocumentTo(
      channel,
      target.address,
      pdf,
      `invitation-${code}.pdf`,
      `Aapka Annual Function invitation taiyaar hai! Code: ${code}. Gate par ye QR dikhayein.`,
    );
    await logDelivery({
      kind: "invitation",
      invitationCode: code,
      channel,
      address: target.address,
      status: "sent",
      sentAt: new Date(),
    });
    return { status: "sent", channel };
  } catch (e) {
    const error = e instanceof Error ? e.message : "send failed";
    if (channel === "whatsapp") {
      try {
        await sendTextWithTemplateFallback(
          target.address,
          `Aapka invitation code: ${code}. PDF portal se download karein: /portal`,
        );
        await logDelivery({
          kind: "invitation",
          invitationCode: code,
          channel,
          address: target.address,
          status: "sent",
          sentAt: new Date(),
          error: "document failed; text fallback sent",
        });
        return { status: "sent", channel };
      } catch {
        /* fall through to failed */
      }
    }
    await logDelivery({
      kind: "invitation",
      invitationCode: code,
      channel,
      address: target.address,
      status: "failed",
      error,
    });
    return { status: "failed", channel, error };
  }
}

export type Recipient = { code: string; name: string; channel: Channel; address: string };

export async function recipientsForAudience(audience: Audience): Promise<{
  reachable: Recipient[];
  matched: number;
  unreachable: number;
}> {
  const rows = await getDb()
    .select({
      code: invitations.invitationCode,
      name: students.name,
      className: students.className,
      rsvpStatus: invitations.rsvpStatus,
      channel: invitationContacts.channel,
      address: invitationContacts.address,
    })
    .from(invitations)
    .innerJoin(students, eq(invitations.studentId, students.id))
    .leftJoin(
      invitationContacts,
      eq(invitationContacts.invitationCode, invitations.invitationCode),
    );
  const matched = rows.filter((r) => audienceMatches(audience, r));
  const reachable = matched
    .filter((r) => r.channel && r.address)
    .map((r) => ({
      code: r.code,
      name: r.name,
      channel: r.channel as Channel,
      address: r.address as string,
    }));
  return { reachable, matched: matched.length, unreachable: matched.length - reachable.length };
}

async function alreadySent(kind: string, refId?: string | null): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ code: deliveries.invitationCode })
    .from(deliveries)
    .where(
      refId
        ? and(eq(deliveries.kind, kind), eq(deliveries.refId, refId), eq(deliveries.status, "sent"))
        : and(eq(deliveries.kind, kind), eq(deliveries.status, "sent")),
    );
  return new Set(rows.map((r) => r.code).filter((c): c is string => Boolean(c)));
}

async function sendBatch(
  kind: string,
  refId: string | null,
  recipients: Recipient[],
  send: (r: Recipient) => Promise<unknown>,
  limit: number,
): Promise<{ sent: number; failed: number; remaining: number }> {
  let sent = 0;
  let failed = 0;
  const batch = recipients.slice(0, limit);
  for (const r of batch) {
    try {
      await send(r);
      await logDelivery({
        kind,
        refId: refId ?? null,
        invitationCode: r.code,
        channel: r.channel,
        address: r.address,
        status: "sent",
        sentAt: new Date(),
      });
      sent++;
    } catch (e) {
      await logDelivery({
        kind,
        refId: refId ?? null,
        invitationCode: r.code,
        channel: r.channel,
        address: r.address,
        status: "failed",
        error: e instanceof Error ? e.message : "send failed",
      });
      failed++;
    }
  }
  return { sent, failed, remaining: Math.max(0, recipients.length - batch.length) };
}

// Bulk-send the personalized invitation PDF. `resend` re-sends to families who
// already received one. Batched so a single serverless call stays fast; the
// admin UI loops while `remaining > 0`.
export async function deliverInvitations(input: {
  audience: Audience;
  resend?: boolean;
  limit?: number;
}): Promise<{ sent: number; failed: number; remaining: number; unreachable: number }> {
  const { reachable, unreachable } = await recipientsForAudience(input.audience);
  const skip = input.resend ? new Set<string>() : await alreadySent("invitation");
  const targets = reachable.filter((r) => !skip.has(r.code));
  const batch = targets.slice(0, input.limit ?? 25);
  let sent = 0;
  let failed = 0;
  for (const r of batch) {
    // deliverInvitation writes its own delivery row.
    const outcome = await deliverInvitation(r.code);
    if (outcome.status === "sent") sent++;
    else failed++;
  }
  return { sent, failed, remaining: Math.max(0, targets.length - batch.length), unreachable };
}

// Send specific families their pass (one-off resends from the staff workspace
// or the voice assistant). Skips anyone who has no messaging contact yet.
export async function deliverToCodes(codes: string[]): Promise<{
  sent: number;
  failed: number;
  unreachable: number;
  remaining: number;
}> {
  let sent = 0;
  let failed = 0;
  let unreachable = 0;
  for (const code of codes) {
    const outcome = await deliverInvitation(code);
    if (outcome.status === "sent") sent++;
    else if (outcome.status === "skipped") unreachable++;
    else failed++;
  }
  return { sent, failed, unreachable, remaining: 0 };
}

// Send a free-text announcement (or reminder) to an audience. Doesn't re-send
// to anyone who already got this exact announcement.
export async function sendAnnouncement(input: {
  id: string;
  body: string;
  audience: Audience;
  limit?: number;
}): Promise<{ sent: number; failed: number; remaining: number; unreachable: number }> {
  const { reachable, unreachable } = await recipientsForAudience(input.audience);
  const skip = await alreadySent("announcement", input.id);
  const targets = reachable.filter((r) => !skip.has(r.code));
  const result = await sendBatch(
    "announcement",
    input.id,
    targets,
    (r) => sendTextTo(r.channel, r.address, input.body),
    input.limit ?? 40,
  );
  return { ...result, unreachable };
}
