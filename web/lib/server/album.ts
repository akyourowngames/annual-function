import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { photos } from "@/lib/db/schema";
import { deletePhoto, ensureBucket, storageReady, uploadPhoto } from "./storage";
import { isSupportedImageMime, photoExtension, photoPath, sanitizeCaption } from "./photo-utils";

let bucketEnsured = false;
async function readyBucket() {
  if (bucketEnsured) return;
  await ensureBucket();
  bucketEnsured = true;
}

// Store a family's photo in private storage and record it for the album.
// Returns null (never throws) when storage isn't configured or the type is
// unsupported, so the chat keeps working regardless.
export async function saveIncomingPhoto(input: {
  channel: "telegram" | "whatsapp";
  address: string;
  code?: string | null;
  buffer: Buffer;
  mime: string;
  caption?: string | null;
}): Promise<{ id: string; path: string } | null> {
  if (!storageReady() || !isSupportedImageMime(input.mime)) return null;
  const id = randomUUID();
  const path = photoPath(input.channel, id, photoExtension(input.mime));
  await readyBucket();
  await uploadPhoto(new Uint8Array(input.buffer), path, input.mime);
  try {
    const [row] = await getDb()
      .insert(photos)
      .values({
        invitationCode: input.code ?? null,
        channel: input.channel,
        address: input.address,
        storagePath: path,
        mime: input.mime,
        byteSize: input.buffer.byteLength,
        caption: sanitizeCaption(input.caption),
      })
      .returning({ id: photos.id, storagePath: photos.storagePath });
    return row ? { id: row.id, path: row.storagePath } : null;
  } catch (e) {
    // Don't leave an orphaned object behind if the row couldn't be written.
    await deletePhoto(path).catch(() => {});
    throw e;
  }
}
