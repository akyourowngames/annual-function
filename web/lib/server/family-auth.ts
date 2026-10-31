import { cookies } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { familySessions, type Invitation } from "@/lib/db/schema";
import {
  FAMILY_SESSION_TTL_MS,
  newFamilySessionPayload,
  signFamilySession,
  verifyFamilySession,
  type FamilySessionPayload,
} from "@/lib/security/family";
import { HttpError } from "./http";
import { hashedKey } from "./rate-limit";

const COOKIE = "annual_family";

/**
 * Server-only secret for signing family sessions. A dedicated secret is
 * preferred; ADMIN_ACCESS_KEY is accepted as a fallback so an existing
 * deployment keeps working until it is rotated onto the new variable.
 */
export function familySessionSecret(): string {
  const secret =
    process.env.FAMILY_SESSION_SECRET || process.env.ADMIN_ACCESS_KEY;
  if (!secret)
    throw new HttpError(
      "Family verification is not configured. Contact the event team.",
      503,
    );
  return secret;
}

export function familyOtpSecret(): string {
  const secret =
    process.env.FAMILY_OTP_SECRET ||
    process.env.FAMILY_SESSION_SECRET ||
    process.env.ADMIN_ACCESS_KEY;
  if (!secret)
    throw new HttpError(
      "Family verification is not configured. Contact the event team.",
      503,
    );
  return secret;
}

export type ActiveFamilySession = {
  session: typeof familySessions.$inferSelect;
  payload: FamilySessionPayload;
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * Issue a fresh family session. Any previous active session for the same
 * invitation is revoked first (rotation + single active browser session), and
 * the new cookie is HttpOnly/Secure/SameSite=Strict.
 */
export async function createFamilySession(
  invitation: Pick<Invitation, "id" | "invitationCode">,
  request?: Request,
  ttlMs = FAMILY_SESSION_TTL_MS,
): Promise<FamilySessionPayload> {
  const db = getDb();
  const payload = newFamilySessionPayload({
    invitationId: invitation.id,
    code: invitation.invitationCode,
    ttlMs,
  });
  const ip =
    request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request?.headers.get("x-real-ip") ||
    null;
  const userAgent = request?.headers.get("user-agent")?.slice(0, 300) || null;

  await db.transaction(async (tx) => {
    await tx
      .update(familySessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(familySessions.invitationId, invitation.id),
          isNull(familySessions.revokedAt),
        ),
      );
    await tx.insert(familySessions).values({
      id: payload.sid,
      invitationId: invitation.id,
      code: invitation.invitationCode,
      scope: payload.scope,
      expiresAt: new Date(payload.exp),
      ipHash: ip ? hashedKey(`ip:${ip}`) : null,
      userAgent,
    });
  });

  const token = signFamilySession(familySessionSecret(), payload);
  (await cookies()).set(COOKIE, token, cookieOptions(Math.floor(ttlMs / 1000)));
  return payload;
}

/** Read and validate the cookie plus its server-side revocation record. */
export async function readFamilySession(): Promise<ActiveFamilySession | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(COOKIE)?.value;
  } catch {
    return null;
  }
  // No cookie: unauthenticated. Don't require the signing secret just to say so.
  if (!token) return null;
  const payload = verifyFamilySession(familySessionSecret(), token);
  if (!payload) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(familySessions)
    .where(
      and(
        eq(familySessions.id, payload.sid),
        isNull(familySessions.revokedAt),
        gt(familySessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (
    row.invitationId !== payload.invitationId ||
    row.code !== payload.code ||
    row.scope !== payload.scope
  )
    return null;
  // Touch last-seen without blocking the response on failure.
  db.update(familySessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(familySessions.id, row.id))
    .catch(() => undefined);
  return { session: row, payload };
}

/**
 * Enforce a verified family session. When `code` is supplied the session must
 * be bound to exactly that invitation (prevents cross-family IDOR even if a
 * caller mixes a valid cookie with another family's code).
 */
export async function requireFamily(code?: string): Promise<ActiveFamilySession> {
  const found = await readFamilySession();
  if (!found)
    throw new HttpError(
      "Verify your family contact before opening this invitation.",
      401,
    );
  if (code && found.payload.code !== code)
    throw new HttpError("This session is not valid for that invitation.", 403);
  return found;
}

/** Revoke the current session server-side and clear the cookie. */
export async function revokeFamilySession(): Promise<void> {
  const found = await readFamilySession().catch(() => null);
  if (found) {
    await getDb()
      .update(familySessions)
      .set({ revokedAt: new Date() })
      .where(eq(familySessions.id, found.session.id));
  }
  (await cookies()).delete(COOKIE);
}

export function familyCookieName(): string {
  return COOKIE;
}
