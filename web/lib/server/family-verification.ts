import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  familyChallenges,
  familyContacts,
  invitationContacts,
  invitations,
} from "@/lib/db/schema";
import {
  OTP_DAILY_GLOBAL,
  OTP_DAILY_PER_FAMILY,
  OTP_GUESSES_PER_FAMILY,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  generateOtp,
  isOtpTrustedSource,
  maskDestination,
  newOtpSalt,
  normalizeInvitationCode,
  normalizeOtp,
  otpDigest,
  secureEqual,
} from "@/lib/security/family";
import { HttpError } from "./http";
import {
  createFamilySession,
  familyOtpSecret,
} from "./family-auth";
import { audit } from "./audit";
import { sendTextTo } from "./delivery";
import { clientKey, enforceRateLimits } from "./rate-limit";
import { invitationDetail, type InvitationDetail } from "./invitation-view";

export const OTP_PURPOSE = "family_manage";

export type VerifiedContact = {
  channel: "whatsapp" | "telegram";
  address: string;
  source: "admin_approved" | "verified_chat";
  trusted: boolean;
};

/**
 * Resolve a contact the school has verified for this invitation.
 *
 * Precedence:
 *   1. family_contacts — explicitly approved by an administrator. This is the
 *      only *trusted* source: a staff member confirmed the destination belongs
 *      to the family.
 *   2. invitation_contacts — the WhatsApp/Telegram endpoint captured after a
 *      chat session passed the admission-number + name + class identity check.
 *      That triple is knowledge a classmate can plausibly obtain, so this is
 *      NOT treated as proof of possession: `trusted` is false and it is never
 *      used to deliver a verification code or a QR pass.
 *
 * We never accept a contact supplied in the OTP request itself: otherwise an
 * attacker who knows an invitation code could point delivery at their own phone.
 */
export async function resolveVerifiedContact(
  invitationId: string,
  code: string,
): Promise<VerifiedContact | null> {
  const db = getDb();
  const [approved] = await db
    .select()
    .from(familyContacts)
    .where(eq(familyContacts.invitationId, invitationId))
    .limit(1);
  if (approved && (approved.channel === "whatsapp" || approved.channel === "telegram"))
    return {
      channel: approved.channel,
      address: approved.address,
      source: "admin_approved",
      trusted: isOtpTrustedSource("admin_approved"),
    };

  const [chat] = await db
    .select()
    .from(invitationContacts)
    .where(eq(invitationContacts.invitationCode, code))
    .limit(1);
  if (chat && (chat.channel === "whatsapp" || chat.channel === "telegram"))
    return {
      channel: chat.channel,
      address: chat.address,
      source: "verified_chat",
      trusted: isOtpTrustedSource("verified_chat"),
    };
  return null;
}

/**
 * True when this invitation has an OTP destination the school itself verified.
 * Used by the chat handlers so they never promise "enter the code we sent" when
 * no code can ever be sent — that wording sent families into a dead end.
 */
export async function hasTrustedContact(code: string): Promise<boolean> {
  const [invitation] = await getDb()
    .select({ id: invitations.id })
    .from(invitations)
    .where(eq(invitations.invitationCode, code))
    .limit(1);
  if (!invitation) return false;
  const contact = await resolveVerifiedContact(invitation.id, code);
  return Boolean(contact?.trusted);
}

const GENERIC_NO_CONTACT =
  "If your family has a verified contact on file, a code has been sent. Otherwise contact your class teacher to verify your contact.";

const GENERIC_SENT =
  "If this invitation has a verified contact on file, a 6-digit code has been sent. It expires in 5 minutes.";

export type StartResult = {
  ok: true;
  nextStep: "enter_otp" | "contact_teacher";
  message: string;
  destination?: string;
  expiresAt?: string;
  retryAfterSeconds?: number;
};

/**
 * Begin verification: validate the invitation, resolve a *verified* contact,
 * issue a bound OTP, and deliver it. Responses are deliberately uniform so an
 * attacker cannot use this endpoint to enumerate students or phone numbers.
 */
export async function startFamilyVerification(
  rawCode: unknown,
  request: Request,
): Promise<StartResult> {
  const code = normalizeInvitationCode(rawCode);
  const ip = clientKey(request);
  if (!code) {
    await audit({
      actorType: "anonymous",
      action: "otp.start_invalid_code",
      ip,
    });
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  // Flood net only: stops one machine hammering the endpoint. This is keyed on
  // the caller's address, so it is NOT the control that matters — someone can
  // change address and start again. The per-family limits below are the real
  // ones, and they are deliberately counted only when a message is actually
  // sent (see the send-time block further down).
  await enforceRateLimits([
    { key: `otp:start:ip:${ip}`, limit: 10, windowSeconds: 900 },
  ]);

  const db = getDb();
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.invitationCode, code))
    .limit(1);
  if (!invitation || invitation.status !== "active") {
    await audit({
      actorType: "anonymous",
      action: "otp.start_unknown_invitation",
      ip,
    });
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  const contact = await resolveVerifiedContact(invitation.id, code);
  if (!contact) {
    await audit({
      actorType: "anonymous",
      action: "otp.start_no_verified_contact",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
    });
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  // A code may only go to a destination the school itself verified. A chat
  // endpoint learned from a guessed identity triple is not proof of possession,
  // so it falls back to the staff-approval path rather than granting a session.
  if (!contact.trusted) {
    await audit({
      actorType: "anonymous",
      action: "otp.start_untrusted_contact",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
      detail: { channel: contact.channel, source: contact.source },
    });
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  // Resend cooldown: reuse the most recent challenge instead of issuing a new
  // one. This stops OTP-spam without revealing whether delivery happened.
  const [latest] = await db
    .select()
    .from(familyChallenges)
    .where(
      and(
        eq(familyChallenges.invitationId, invitation.id),
        eq(familyChallenges.purpose, OTP_PURPOSE),
      ),
    )
    .orderBy(desc(familyChallenges.createdAt))
    .limit(1);
  if (
    latest &&
    !latest.consumedAt &&
    latest.expiresAt.getTime() > Date.now() &&
    Date.now() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return {
      ok: true,
      nextStep: "enter_otp",
      message: GENERIC_SENT,
      destination: maskDestination(latest.channel, latest.address),
      expiresAt: latest.expiresAt.toISOString(),
      retryAfterSeconds: Math.ceil(
        (OTP_RESEND_COOLDOWN_MS - (Date.now() - latest.createdAt.getTime())) /
          1000,
      ),
    };
  }

  // The real spend guard. Counted here, immediately before a message is sent,
  // and keyed on the family and the whole event — so changing network, phone or
  // IP does not reset it. A family that keeps hitting the cooldown above never
  // reaches this block and so never burns its allowance.
  //
  // Refusal is silent and uniform: the caller sees the same "contact your
  // teacher" message, so a blocked flood learns nothing about the invitation.
  try {
    await enforceRateLimits([
      {
        key: `otp:daily:family:${invitation.id}`,
        limit: OTP_DAILY_PER_FAMILY,
        windowSeconds: 86_400,
      },
      {
        key: `otp:daily:global`,
        limit: OTP_DAILY_GLOBAL,
        windowSeconds: 86_400,
      },
    ]);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 429) throw e;
    await audit({
      actorType: "anonymous",
      action: "otp.daily_cap_reached",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
      detail: { channel: contact.channel },
    });
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  const otp = generateOtp();
  const salt = newOtpSalt();
  const otpHash = otpDigest(familyOtpSecret(), {
    invitationId: invitation.id,
    purpose: OTP_PURPOSE,
    salt,
    otp,
  });
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  // Only one live challenge exists at a time: issuing a new code invalidates
  // every older unconsumed challenge for this invitation.
  await db
    .update(familyChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(familyChallenges.invitationId, invitation.id),
        isNull(familyChallenges.consumedAt),
      ),
    );

  await db.insert(familyChallenges).values({
    invitationId: invitation.id,
    purpose: OTP_PURPOSE,
    channel: contact.channel,
    address: contact.address,
    otpHash,
    salt,
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
  });

  await audit({
    actorType: "anonymous",
    action: "otp.issued",
    invitationId: invitation.id,
    invitationCode: code,
    ip,
    detail: { channel: contact.channel, source: contact.source },
  });

  try {
    await sendTextTo(
      contact.channel,
      contact.address,
      `Your Annual Function verification code is ${otp}. It expires in 5 minutes. Never share it with anyone. If you did not ask for this, ignore this message.`,
    );
  } catch (e) {
    // Do not leak provider state. Consume the challenge so a failed delivery
    // cannot be brute-forced, and let the family use the recovery path.
    await db
      .update(familyChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(familyChallenges.otpHash, otpHash));
    await audit({
      actorType: "system",
      action: "otp.delivery_failed",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
      detail: { channel: contact.channel },
    });
    console.error(
      "OTP delivery failed",
      contact.channel,
      e instanceof Error ? e.name : "unknown",
    );
    return { ok: true, nextStep: "contact_teacher", message: GENERIC_NO_CONTACT };
  }

  return {
    ok: true,
    nextStep: "enter_otp",
    message: GENERIC_SENT,
    destination: maskDestination(contact.channel, contact.address),
    expiresAt: expiresAt.toISOString(),
  };
}

export type ConfirmResult = {
  ok: true;
  invitation: InvitationDetail;
};

/**
 * Confirm the OTP. Attempts are counted atomically, the challenge is consumed
 * exactly once (safe under concurrent requests), and a fresh family session is
 * issued only after a constant-time comparison succeeds.
 */
export async function confirmFamilyVerification(
  rawCode: unknown,
  rawOtp: unknown,
  request: Request,
): Promise<ConfirmResult> {
  const code = normalizeInvitationCode(rawCode);
  const otp = normalizeOtp(rawOtp);
  const ip = clientKey(request);
  if (!code || !otp)
    throw new HttpError("Enter the 6-digit code from your verified contact.", 400);

  // Flood net for one machine. Not the guess control — see below.
  await enforceRateLimits([
    { key: `otp:confirm:ip:${ip}`, limit: 20, windowSeconds: 900 },
  ]);

  const db = getDb();
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.invitationCode, code))
    .limit(1);
  if (!invitation || invitation.status !== "active")
    throw new HttpError("That verification code is invalid or has expired.", 400);

  // The guess control that actually holds. It is keyed on the invitation, so
  // changing address or device does not reset it. The per-challenge attempt
  // counter further down stops guessing *one* code; this stops guessing across
  // many freshly requested codes, which is what an address-hopping attacker
  // would otherwise do.
  try {
    await enforceRateLimits([
      {
        key: `otp:guess:invitation:${invitation.id}`,
        limit: OTP_GUESSES_PER_FAMILY,
        windowSeconds: 86_400,
      },
    ]);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 429) throw e;
    await audit({
      actorType: "anonymous",
      action: "otp.guess_cap_reached",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
    });
    throw new HttpError(
      "Too many incorrect codes. Ask your class teacher to verify your contact again.",
      429,
    );
  }

  const [challenge] = await db
    .select()
    .from(familyChallenges)
    .where(
      and(
        eq(familyChallenges.invitationId, invitation.id),
        eq(familyChallenges.purpose, OTP_PURPOSE),
        isNull(familyChallenges.consumedAt),
      ),
    )
    .orderBy(desc(familyChallenges.createdAt))
    .limit(1);

  if (!challenge)
    throw new HttpError("That verification code is invalid or has expired.", 400);

  if (challenge.expiresAt.getTime() <= Date.now()) {
    await db
      .update(familyChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(familyChallenges.id, challenge.id));
    await audit({
      actorType: "anonymous",
      action: "otp.expired",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
    });
    throw new HttpError("That verification code has expired. Request a new one.", 400);
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    await db
      .update(familyChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(familyChallenges.id, challenge.id));
    throw new HttpError("Too many incorrect codes. Request a new one.", 429);
  }

  // Count the attempt before comparing so concurrent guesses all count.
  const [counted] = await db
    .update(familyChallenges)
    .set({ attempts: sql`${familyChallenges.attempts} + 1` })
    .where(eq(familyChallenges.id, challenge.id))
    .returning();

  const expected = otpDigest(familyOtpSecret(), {
    invitationId: invitation.id,
    purpose: OTP_PURPOSE,
    salt: challenge.salt,
    otp,
  });

  if (!secureEqual(expected, challenge.otpHash)) {
    const attempts = counted?.attempts ?? challenge.attempts + 1;
    if (attempts >= challenge.maxAttempts) {
      await db
        .update(familyChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(familyChallenges.id, challenge.id));
    }
    await audit({
      actorType: "anonymous",
      action: "otp.failed",
      invitationId: invitation.id,
      invitationCode: code,
      ip,
      detail: { attempts },
    });
    throw new HttpError(
      attempts >= challenge.maxAttempts
        ? "Too many incorrect codes. Request a new one."
        : "That verification code is incorrect.",
      attempts >= challenge.maxAttempts ? 429 : 400,
    );
  }

  // Atomically consume. If another concurrent request won the race, no row is
  // returned and the OTP cannot be redeemed twice.
  const [consumed] = await db
    .update(familyChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(familyChallenges.id, challenge.id),
        isNull(familyChallenges.consumedAt),
        gt(familyChallenges.expiresAt, new Date()),
      ),
    )
    .returning({ id: familyChallenges.id });
  if (!consumed)
    throw new HttpError("That verification code has already been used.", 409);

  await createFamilySession(invitation, request);
  await audit({
    actorType: "family",
    action: "otp.verified",
    invitationId: invitation.id,
    invitationCode: code,
    ip,
  });

  return { ok: true, invitation: await invitationDetail(code) };
}
