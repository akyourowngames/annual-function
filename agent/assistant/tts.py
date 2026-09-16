"""Natural speech, streamed to the browser.

Uses Microsoft Edge's neural voices through `edge-tts` — free, no API key, and
far more natural than the browser's built-in `speechSynthesis`. Audio is MP3,
streamed as it is produced so playback starts quickly.
"""

from typing import Any, AsyncIterator

import edge_tts

from config import TTS_RATE, TTS_VOICE

# Curated for this event: Indian English first (it is an Indian school), then a
# few of the most natural English voices anywhere.
CURATED: list[dict[str, Any]] = [
    {"id": "en-IN-NeerjaExpressiveNeural", "label": "Neerja · Indian English, expressive", "recommended": True},
    {"id": "en-IN-NeerjaNeural", "label": "Neerja · Indian English"},
    {"id": "en-IN-PrabhatNeural", "label": "Prabhat · Indian English, male"},
    {"id": "en-US-AvaMultilingualNeural", "label": "Ava · warm, expressive"},
    {"id": "en-US-EmmaMultilingualNeural", "label": "Emma · cheerful, conversational"},
    {"id": "en-US-AndrewMultilingualNeural", "label": "Andrew · warm, male"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia · British"},
    {"id": "en-GB-RyanNeural", "label": "Ryan · British, male"},
]

_cache: tuple[float, list[dict[str, Any]]] | None = None
_CACHE_SECONDS = 3600.0


async def voices() -> list[dict[str, Any]]:
    """The curated list, minus anything this machine cannot reach."""
    import time

    global _cache
    if _cache and (time.monotonic() - _cache[0]) < _CACHE_SECONDS:
        return _cache[1]
    try:
        available = {v["ShortName"] for v in await edge_tts.list_voices()}
        picked = [v for v in CURATED if v["id"] in available] or CURATED
    except Exception:  # noqa: BLE001 — offline: still offer the defaults
        picked = CURATED
    _cache = (time.monotonic(), picked)
    return picked


async def stream(text: str, voice: str | None = None) -> AsyncIterator[bytes]:
    """Yield MP3 chunks for `text`."""
    communicate = edge_tts.Communicate(text, voice or TTS_VOICE, rate=TTS_RATE)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            yield chunk["data"]
