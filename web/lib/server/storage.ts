import { createClient } from "@supabase/supabase-js";

// Private Supabase Storage for family-contributed event photos.
// Only the server (service-role key) touches the bucket; staff view via
// short-lived signed URLs. Dependency-light so it can be verified by scripts.
export function storageConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const bucket = process.env.ALBUM_BUCKET || "album";
  return { url, key, bucket };
}
export function storageReady(): boolean {
  const c = storageConfig();
  return Boolean(c.url && c.key);
}
function client() {
  const { url, key } = storageConfig();
  if (!url || !key) throw new Error("Supabase Storage is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensureBucket(): Promise<string> {
  const { bucket } = storageConfig();
  const supabase = client();
  const { data } = await supabase.storage.getBucket(bucket);
  if (!data) {
    const { error } = await supabase.storage.createBucket(bucket, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  }
  return bucket;
}

export async function uploadPhoto(bytes: Uint8Array, path: string, mime: string): Promise<string> {
  const { bucket } = storageConfig();
  const { error } = await client()
    .storage.from(bucket)
    .upload(path, bytes, { contentType: mime || "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

export async function signedPhotoUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { bucket } = storageConfig();
  const { data, error } = await client()
    .storage.from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function deletePhoto(path: string): Promise<void> {
  const { bucket } = storageConfig();
  await client().storage.from(bucket).remove([path]);
}
