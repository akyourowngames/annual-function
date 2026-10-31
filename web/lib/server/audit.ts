import { getDb } from "@/lib/db";
import { securityAuditLog } from "@/lib/db/schema";
import { hashedKey } from "./rate-limit";

export type AuditActor =
  | "family"
  | "staff"
  | "admin"
  | "gate"
  | "anonymous"
  | "system";

export type AuditInput = {
  actorType: AuditActor;
  actorId?: string | null;
  action: string;
  invitationId?: string | null;
  invitationCode?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Append an audit record for a sensitive action. Audit writes must never break
 * the request they describe, so failures are logged and swallowed.
 *
 * Invariants: never pass an OTP, session token, or full contact address here.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await getDb()
      .insert(securityAuditLog)
      .values({
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        invitationId: input.invitationId ?? null,
        invitationCode: input.invitationCode ?? null,
        ipHash: input.ip ? hashedKey(`ip:${input.ip}`) : null,
        detail: input.detail ?? null,
      });
  } catch (e) {
    console.error(
      "audit write failed",
      input.action,
      e instanceof Error ? e.name : "unknown",
    );
  }
}
