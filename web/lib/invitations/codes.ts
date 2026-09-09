import { randomUUID } from "node:crypto";

/** Opaque token encoded in the QR. Carries no personal data. */
export function newQrToken(): string {
  return randomUUID().replace(/-/g, "");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Human-readable invitation code, e.g. "ANL-8F29K". */
export function newInvitationCode(prefix = "ANL"): string {
  let suffix = "";
  for (let i = 0; i < 5; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}
