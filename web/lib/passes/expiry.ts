/**
 * When a ticket pass stops working at the gate.
 *
 * Two separate reasons a pass can be closed, and both the browser that shows a
 * pass and the server that admits people must agree on them, so the rule lives
 * here once:
 *
 *   - "inactive" — staff switched this one invitation off.
 *   - "expired"  — the event-wide moment in `event_settings.pass_expires_at`
 *                  has passed, so every pass is closed at once.
 *
 * A pass with no expiry set keeps working until staff switch it off, which is
 * exactly how the gate behaved before this rule existed.
 */

export type PassState = "valid" | "inactive" | "expired";

/**
 * The clock staff read on screen for the expiry moment. The event is in India
 * and the server runs in UTC, so a bare timestamp would be 5½ hours away from
 * what the office typed. Overridable for another venue without a deploy.
 */
export const PASS_TIME_ZONE =
  process.env.NEXT_PUBLIC_PASS_TIME_ZONE || "Asia/Kolkata";

/** A pass is closed AT its expiry moment, not one millisecond later. */
export function passState(input: {
  status: string;
  expiresAt?: Date | string | null;
  now?: Date;
}): PassState {
  if (input.status !== "active") return "inactive";
  const expiresAt = toInstant(input.expiresAt);
  if (expiresAt && (input.now ?? new Date()).getTime() >= expiresAt.getTime())
    return "expired";
  return "valid";
}

/** Turn whatever the database or JSON handed us into a real Date, or null. */
export function toInstant(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The sentence the gate and the family both see for a closed pass. */
export function passClosedMessage(
  state: PassState,
  expiresAt?: Date | string | null,
): string | null {
  if (state === "inactive")
    return "This invitation has been switched off by the event team. Entry is not allowed.";
  if (state === "expired")
    return `This pass expired at ${formatPassMoment(expiresAt)}. Entry is not allowed.`;
  return null;
}

/**
 * "20 November 2026, 11:30 pm" — one fixed shape, so the gate and the printed
 * pass word it the same way.
 */
export function formatPassMoment(value?: Date | string | null): string {
  const at = toInstant(value);
  if (!at) return "an unrecorded time";
  return at.toLocaleString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PASS_TIME_ZONE,
  });
}
