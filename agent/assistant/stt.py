"""Speech in — the browser records a clip, Whisper turns it into words.

The page used to lean on the browser's own speech recognition: it exists only in
Chrome and Edge, quietly uploads to Google, and stops dead when it feels like
it. Recording here and transcribing on the server keeps one brain for both the
family bot and the organizers' assistant, and it sounds consistent.

Groq's Whisper takes the browser's own audio (webm/ogg/mp4) as it comes, so
there is nothing to convert.
"""

from __future__ import annotations

from config import GROQ_API_KEY, GROQ_BASE_URL, STT_MODEL

from . import llm

# Groq refuses a single upload beyond this, and a clip that long is a mistake
# anyway — the page stops recording well before it.
MAX_BYTES = 20 * 1024 * 1024

_SUFFIX = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/flac": "flac",
}


class SttUnavailable(RuntimeError):
    """No key, or Groq would not take the clip."""


def ready() -> bool:
    return bool(GROQ_API_KEY)


def _filename(mime: str) -> str:
    base = (mime or "").split(";")[0].strip().lower()
    return "clip." + _SUFFIX.get(base, "webm")


async def transcribe(audio: bytes, mime: str = "") -> str:
    """Return what was said, or "" when the clip holds no words.

    The language is left for Whisper to work out, because the roster mixes
    English and Hindi in the same sentence.
    """
    if not GROQ_API_KEY:
        raise SttUnavailable("No Groq key, so I cannot hear.")
    if not audio:
        return ""
    if len(audio) > MAX_BYTES:
        raise SttUnavailable("That clip is too long to send.")

    resp = await llm.client().post(
        f"{GROQ_BASE_URL}/audio/transcriptions",
        headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
        files={"file": (_filename(mime), audio, mime or "audio/webm")},
        data={"model": STT_MODEL, "response_format": "json", "temperature": "0"},
        timeout=60.0,
    )
    if resp.status_code != 200:
        raise SttUnavailable(f"Groq said {resp.status_code}.")
    return (resp.json().get("text") or "").strip()
