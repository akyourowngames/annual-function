// Channel + audience helpers. Pure and dependency-free so they unit-test under
// plain `node --test`; the network side lives in lib/server/delivery.ts.
export type Channel = "telegram" | "whatsapp";

// Sessions are stored under `tg:<chatId>` / `wa:<waId>`. This is how we learn a
// family's reachable messaging endpoint when they verify their invitation.
export function parseChannelKey(key: string): { channel: Channel; address: string } | null {
  if (key.startsWith("tg:")) return { channel: "telegram", address: key.slice(3) };
  if (key.startsWith("wa:")) return { channel: "whatsapp", address: key.slice(3) };
  return null;
}

export function channelKey(channel: Channel, address: string): string {
  return `${channel === "telegram" ? "tg" : "wa"}:${address}`;
}

export type Audience =
  | "all"
  | "attending"
  | "declined"
  | "rsvp:none"
  | `class:${string}`;

export function parseAudience(value: string): Audience {
  const v = value.trim();
  if (v === "all" || v === "attending" || v === "declined" || v === "rsvp:none") return v;
  if (v.startsWith("class:")) return v as Audience;
  return "all";
}

export function audienceLabel(audience: Audience): string {
  if (audience === "all") return "Everyone";
  if (audience === "attending") return "Families attending";
  if (audience === "declined") return "Families who declined";
  if (audience === "rsvp:none") return "Families who haven't replied";
  return `Class ${audience.slice("class:".length)}`;
}

export type AudienceRow = {
  className?: string | null;
  rsvpStatus?: string | null;
};

export function audienceMatches(audience: Audience, row: AudienceRow): boolean {
  const status = row.rsvpStatus ?? "pending";
  if (audience === "all") return true;
  if (audience === "attending") return status === "attending";
  if (audience === "declined") return status === "declined";
  if (audience === "rsvp:none") return status === "pending";
  return (row.className ?? "").trim().toLowerCase() === audience.slice("class:".length).trim().toLowerCase();
}
