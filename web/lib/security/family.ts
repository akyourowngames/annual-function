// Family verification primitives.
//
// Dependency-free on purpose (only `node:crypto`) so the security-critical
// logic can be unit-tested under plain `node --test` without a database.
//
// Threat model in one paragraph: the invitation code is shareable paper and is
// therefore NOT an identity credential. Sensitive family data requires a second
// factor: a one-time code delivered to a contact the school has previously
// verified. This module owns generation, keyed hashing, constant-time
// comparison, and the signed short-lived family session token.
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const FAMILY_SESSION_TTL_MS = 30 * 60 * 1000;

// Spend and guess limits.
//
// The important ones are keyed on the *family* and on the whole event, never on
// the caller's address. A limit tied to an address is defeated by changing
// network, which is the whole reason these exist.
export const OTP_DAILY_PER_FAMILY = 8;
/** Wrong 6-digit guesses per family per day, across any number of devices. */
export const OTP_GUESSES_PER_FAMILY = 25;
/** School-wide ceiling on verification messages per day. */
export const OTP_DAILY_GLOBAL = 600;

export type FamilySessionScope = "family";

export type FamilySessionPayload = {
  v: 1;
  sid: string;
  invitationId: string;
  code: string;
  scope: FamilySessionScope;
  iat: number;
  exp: number;
};

/** Cryptographically secure 6-digit one-time code. */
export function generateOtp(): string {
  let out = "";
  for (let i = 0; i < OTP_LENGTH; i += 1) out += String(randomInt(0, 10));
  return out;
}

/** Per-challenge salt: makes precomputed OTP tables useless even if the HMAC key leaks. */
export function newOtpSalt(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Keyed HMAC over (invitation, purpose, salt, otp). The plaintext OTP is never
 * stored. Binding all four fields means an OTP issued for one invitation or one
 * purpose can never authorise another.
 */
export function otpDigest(
  secret: string,
  input: { invitationId: string; purpose: string; salt: string; otp: string },
): string {
  return createHmac("sha256", secret)
    .update(
      `${input.invitationId}\u0000${input.purpose}\u0000${input.salt}\u0000${input.otp}`,
    )
    .digest("base64url");
}

/** Length-checked, constant-time comparison for secrets. */
export function secureEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Accept only exactly six ASCII digits; reject whitespace tricks and Unicode digits. */
export function normalizeOtp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9]{6}$/.test(trimmed) ? trimmed : null;
}

/** Normalise an invitation code exactly as the database stores it. */
export function normalizeInvitationCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{3,63}$/.test(code) ? code : null;
}

/**
 * Show enough of the destination for the family to recognise it, never the
 * whole value. Examples: "•••• 4821" for a phone, "Telegram (…9f2a)".
 */
export function maskDestination(channel: string, address: string): string {
  const clean = address.trim();
  const tail = clean.slice(-4);
  if (channel === "telegram") return `Telegram chat …${tail}`;
  if (channel === "whatsapp") {
    const digits = clean.replace(/\D/g, "");
    const last = digits.slice(-4) || tail;
    return `WhatsApp •••• ${last}`;
  }
  return `•••• ${tail}`;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Sign a short-lived family session. Format: `fs.<payload>.<signature>`.
 * The token is a bearer credential, so it is only ever stored in an HttpOnly,
 * Secure, SameSite=Strict cookie — never localStorage or a URL.
 */
export function signFamilySession(
  secret: string,
  payload: FamilySessionPayload,
): string {
  const encoded = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `fs.${encoded}.${sig}`;
}

/** Verify signature, structure and expiry. Returns null for anything suspicious. */
export function verifyFamilySession(
  secret: string,
  token: string | undefined | null,
  now: number = Date.now(),
): FamilySessionPayload | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "fs") return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!secureEqual(expected, sig)) return null;
  let parsed: FamilySessionPayload;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    !parsed ||
    parsed.v !== 1 ||
    parsed.scope !== "family" ||
    typeof parsed.sid !== "string" ||
    typeof parsed.invitationId !== "string" ||
    typeof parsed.code !== "string" ||
    typeof parsed.iat !== "number" ||
    typeof parsed.exp !== "number"
  )
    return null;
  if (!Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
  if (!Number.isFinite(parsed.iat) || parsed.iat > now + 60_000) return null;
  return parsed;
}

/** Build a fresh session payload with a new id (rotates on every verification). */
export function newFamilySessionPayload(input: {
  invitationId: string;
  code: string;
  now?: number;
  ttlMs?: number;
}): FamilySessionPayload {
  const now = input.now ?? Date.now();
  return {
    v: 1,
    sid: randomUUID(),
    invitationId: input.invitationId,
    code: input.code,
    scope: "family",
    iat: now,
    exp: now + (input.ttlMs ?? FAMILY_SESSION_TTL_MS),
  };
}

/**
 * Stable, non-reversible key for rate-limit counters. Keys are HMACed so the
 * database never stores raw IP addresses or invitation codes.
 */
export function rateLimitKey(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Contact trust policy
//
// An OTP is a *possession* factor only when it is delivered to a contact the
// school itself has verified. A messaging endpoint captured after a roster
// identity match is NOT such a contact: admission number + full name + class is
// knowledge a classmate can plausibly obtain, not proof of possession. If codes
// were sent there, an attacker who learned the triple could point delivery at
// their own phone and then read the family's guest list and QR pass.
//
// Keeping this policy pure means the invariant is enforced in one place and
// regression-tested without a database.
// ---------------------------------------------------------------------------

export type VerifiedContactSource = "admin_approved" | "verified_chat";

/** Only school-verified contacts may receive a verification code. */
export const OTP_TRUSTED_SOURCES: readonly VerifiedContactSource[] = [
  "admin_approved",
];

export function isOtpTrustedSource(source: VerifiedContactSource): boolean {
  return OTP_TRUSTED_SOURCES.includes(source);
}
