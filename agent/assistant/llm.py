"""The model client: OpenAI-compatible chat completions with a fast model chain.

Groq (LPU) is primary — measured at ~450ms for a phrasing round and ~1.2s for a
full two-round tool flow. If it errors, times out or returns nothing usable we
fall through to NIM, then the Kilo gateway.

Groq's open models are *reasoning* models, so we ask for low effort: it cuts the
hidden thinking tokens (and the latency) without hurting the short answers this
assistant gives.
"""

import json
from typing import Any, AsyncIterator

import httpx

from config import (
    FALLBACK_API_KEY,
    FALLBACK_BASE_URL,
    FALLBACK_MODELS,
    GROQ_API_KEY,
    GROQ_BASE_URL,
    GROQ_MODEL,
    GROQ_MODEL_FALLBACK,
    GROQ_REASONING_EFFORT,
    MODEL_TIMEOUT,
    NIM_BASE_URL,
    NIM_MODEL,
    NVIDIA_API_KEY,
)

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(MODEL_TIMEOUT, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=40),
            headers={"Connection": "keep-alive"},
        )
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def chain() -> list[tuple[str, str, str]]:
    """[(base_url, api_key, model)] — fastest first, then fallbacks."""
    out: list[tuple[str, str, str]] = []
    if GROQ_API_KEY:
        if GROQ_MODEL:
            out.append((GROQ_BASE_URL, GROQ_API_KEY, GROQ_MODEL))
        if GROQ_MODEL_FALLBACK and GROQ_MODEL_FALLBACK != GROQ_MODEL:
            out.append((GROQ_BASE_URL, GROQ_API_KEY, GROQ_MODEL_FALLBACK))
    if NVIDIA_API_KEY and NIM_MODEL:
        out.append((NIM_BASE_URL, NVIDIA_API_KEY, NIM_MODEL))
    if FALLBACK_API_KEY:
        out.extend((FALLBACK_BASE_URL, FALLBACK_API_KEY, m) for m in FALLBACK_MODELS)
    return out


def phrase_chain() -> list[tuple[str, str, str]]:
    """Wording a known answer is easy — use only the fast, non-reasoning routes.

    NIM's big models are deliberately excluded: they are slow and some of them
    put their thinking in the answer, which sounds broken out loud.
    """
    out = [
        (base, key, model)
        for base, key, model in chain()
        if not base.startswith(NIM_BASE_URL)
    ]
    return out or chain()


def _payload(
    base: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    tools: list[dict[str, Any]] | None = None,
    stream: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if "groq" in base and GROQ_REASONING_EFFORT:
        payload["reasoning_effort"] = GROQ_REASONING_EFFORT
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if stream:
        payload["stream"] = True
    return payload


def _usable(message: dict[str, Any]) -> bool:
    return bool(message.get("tool_calls")) or bool((message.get("content") or "").strip())


def _clean(message: dict[str, Any]) -> dict[str, Any]:
    """Keep only what the next round needs — some gateways reject stray keys."""
    out: dict[str, Any] = {"role": "assistant", "content": message.get("content") or ""}
    if message.get("tool_calls"):
        out["tool_calls"] = message["tool_calls"]
    return out


async def complete(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    max_tokens: int = 320,
    temperature: float = 0.2,
    routes: list[tuple[str, str, str]] | None = None,
) -> tuple[dict[str, Any], str]:
    """One non-streamed round. Returns (message, model_used)."""
    last: Exception | None = None
    for base, key, model in routes or chain():
        try:
            res = await client().post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=_payload(base, model, messages, temperature, max_tokens, tools),
            )
            if res.status_code != 200:
                last = RuntimeError(f"{model}: HTTP {res.status_code}")
                print(f"[backstage] {model} -> HTTP {res.status_code} {res.text[:120]}")
                continue
            message = (res.json().get("choices") or [{}])[0].get("message") or {}
            if _usable(message):
                return message, model
            last = RuntimeError(f"{model}: empty response")
            print(f"[backstage] {model} -> empty response")
        except Exception as exc:  # noqa: BLE001 — try the next model
            last = exc
            print(f"[backstage] {model} -> {type(exc).__name__}: {exc}")
    raise last or RuntimeError("No model available")


async def stream(
    messages: list[dict[str, Any]],
    max_tokens: int = 320,
    temperature: float = 0.2,
) -> AsyncIterator[str]:
    """Yield answer text deltas. Falls through the chain on failure."""
    last: Exception | None = None
    for base, key, model in chain():
        try:
            got = False
            async with client().stream(
                "POST",
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json=_payload(base, model, messages, temperature, max_tokens, stream=True),
            ) as res:
                if res.status_code != 200:
                    last = RuntimeError(f"{model}: HTTP {res.status_code}")
                    await res.aread()
                    continue
                async for line in res.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        got = True
                        yield piece
            if got:
                return
            last = RuntimeError(f"{model}: empty stream")
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise last or RuntimeError("No model available")
