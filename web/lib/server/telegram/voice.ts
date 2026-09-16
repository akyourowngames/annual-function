// Voice notes -> text, via Groq's Whisper endpoint (OpenAI-compatible).
//
// Uses its own key (GROQ_VOICE_API_KEY) so the family-facing bot never shares a
// quota with the organizers' assistant. Telegram and WhatsApp both send
// OGG/Opus, which Whisper accepts as-is — no conversion needed.

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SECONDS = 180;

export function voiceReady(): boolean {
  return Boolean(process.env.GROQ_VOICE_API_KEY);
}

export function voiceModel(): string {
  return process.env.GROQ_VOICE_MODEL || DEFAULT_MODEL;
}

/** Extra text the family sees before the answer, so a mis-hearing is visible. */
export function heardPrefix(text: string): string | null {
  if (process.env.TELEGRAM_SHOW_TRANSCRIPT === "0") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean ? `Heard: “${clean}”` : null;
}

export function tooLong(seconds: number): boolean {
  return seconds > MAX_SECONDS;
}

function filenameFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "voice.m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "voice.mp3";
  if (mime.includes("wav")) return "voice.wav";
  if (mime.includes("webm")) return "voice.webm";
  return "voice.ogg";
}

export async function transcribe(bytes: Uint8Array, mime: string): Promise<string> {
  const key = process.env.GROQ_VOICE_API_KEY;
  if (!key) throw new Error("Voice transcription is not configured (GROQ_VOICE_API_KEY)");
  if (bytes.byteLength > MAX_BYTES) throw new Error("Voice note too large");
  const type = mime || "audio/ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), filenameFor(type));
  form.append("model", voiceModel());
  form.append("response_format", "json");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Transcription failed: HTTP ${res.status} ${detail.slice(0, 120)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: unknown };
  return typeof data.text === "string" ? data.text.replace(/\s+/g, " ").trim() : "";
}
