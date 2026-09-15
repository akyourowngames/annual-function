// Pure helpers for inbound photo handling — dependency-free so they unit-test
// under plain `node --test`.
export const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export function isSupportedImageMime(mime: string): boolean {
  return SUPPORTED_IMAGE_MIMES.includes((mime || "").toLowerCase().split(";")[0].trim());
}

export function photoExtension(mime: string): string {
  const m = (mime || "").toLowerCase().split(";")[0].trim();
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/heic" || m === "image/heif") return "heic";
  return "jpg";
}

// Storage object path: <channel>/<yyyy-mm>/<id>.<ext>
export function photoPath(channel: string, id: string, ext: string, at: Date = new Date()): string {
  const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  const safeChannel = channel.replace(/[^a-z0-9_-]/gi, "") || "unknown";
  return `${safeChannel}/${month}/${id}.${ext}`;
}

export function sanitizeCaption(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 300) : null;
}
