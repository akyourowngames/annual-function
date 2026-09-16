"""Backstage — configuration from the environment.

Everything is optional except DATABASE_URL: without an LLM key the assistant
still answers from the database, it just loses the conversation layer.
"""

import os
import sys
import asyncio

from dotenv import load_dotenv

load_dotenv(override=True)

# psycopg's async connections cannot run on Windows' default Proactor loop.
# Setting the policy here (config is imported before any loop is created) keeps
# `uvicorn main:app`, smoke.py and the tests all working on Windows and Linux.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


# --- data ---------------------------------------------------------------
DATABASE_URL = _env("DATABASE_URL")
NEXTJS_BASE_URL = _env("NEXTJS_BASE_URL", "https://annual-five.vercel.app").rstrip("/")
ADMIN_ACCESS_KEY = _env("ADMIN_ACCESS_KEY")
ASSISTANT_KEY = _env("ASSISTANT_KEY", "backstage")

# --- brain: fastest first ------------------------------------------------
# Groq (LPU, ~1000 tok/s on gpt-oss-20b, free tier, no card)
# console.groq.com/keys — measured here at ~1.2s for a full two-round tool flow.
GROQ_BASE_URL = _env("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
GROQ_API_KEY = _env("GROQ_API_KEY")
GROQ_MODEL = _env("GROQ_MODEL", "openai/gpt-oss-20b")
GROQ_MODEL_FALLBACK = _env("GROQ_MODEL_FALLBACK", "openai/gpt-oss-120b")
# Groq's open models are reasoning models; low effort keeps answers snappy and
# stops hidden thinking from eating the token budget. Set "" to disable.
GROQ_REASONING_EFFORT = _env("GROQ_REASONING_EFFORT", "low")

# NVIDIA NIM — the key you have. Default to the clean, non-reasoning instruct
# model: NIM's big reasoning models are slow and can leak their thinking.
NIM_BASE_URL = _env("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_API_KEY = _env("NVIDIA_API_KEY")
NIM_MODEL = _env("NIM_MODEL", "nvidia/nemotron-3.5-lightning-30b-a3b")

# Kilo (or any OpenAI-compatible gateway) as the last resort
FALLBACK_BASE_URL = _env("FALLBACK_BASE_URL", "https://api.kilo.ai/api/gateway").rstrip("/")
FALLBACK_API_KEY = _env("FALLBACK_API_KEY")
FALLBACK_MODELS = [
    m.strip()
    for m in _env(
        "FALLBACK_MODELS",
        "kilo-auto/free,inclusionai/ling-3.0-flash-sante:free,stepfun/step-3.7-flash:free,openrouter/free",
    ).split(",")
    if m.strip()
]

# --- retrieval: NIM embeddings (2048-dim, matches the app's halfvec column) ---
EMBED_BASE_URL = _env("EMBED_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
EMBED_API_KEY = _env("EMBED_API_KEY") or NVIDIA_API_KEY
EMBED_MODEL = _env("EMBED_MODEL", "nvidia/nemotron-3-embed-1b")

# --- voice --------------------------------------------------------------
# Speech in: the page records a clip and posts it to /api/transcribe, where
# Groq Whisper turns it into words. Same key as the brain — one provider, one
# quota. Whisper takes the browser's own webm/ogg/mp4 audio as-is.
STT_MODEL = _env("STT_MODEL", "whisper-large-v3-turbo")

# Speech out: Edge TTS (edge-tts) neural voices: free, no key, natural. The page
# streams MP3 from /api/speak. Swap the voice, or pick another in the UI.
TTS_VOICE = _env("TTS_VOICE", "en-IN-NeerjaExpressiveNeural")
TTS_RATE = _env("TTS_RATE", "+8%")

# --- server -------------------------------------------------------------
HOST = _env("AGENT_HOST", "127.0.0.1")
PORT = int(_env("AGENT_PORT", "8000"))

# --- latency knobs ------------------------------------------------------
ANSWER_TOKENS = int(_env("ANSWER_TOKENS", "320"))
TOOL_ROUNDS = int(_env("TOOL_ROUNDS", "3"))
CACHE_TTL = float(_env("CACHE_TTL", "4"))
MODEL_TIMEOUT = float(_env("MODEL_TIMEOUT", "45"))
# How the fast path words a fetched answer: "model" (natural, ~0.4s) or
# "template" (instant, mechanical, offline-safe).
PHRASE_MODE = _env("PHRASE_MODE", "model")
