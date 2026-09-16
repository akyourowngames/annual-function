"""Backstage — the event team's private voice assistant.

Run it:  uvicorn main:app --host 127.0.0.1 --port 8000
"""

import asyncio
import json
import pathlib
from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from assistant import actions, db, identity, llm, router, session as sessions, tools, tts
from assistant.prompts import greeting, system_prompt

Emit = Callable[[dict[str, Any]], Awaitable[None]]
STATIC_DIR = pathlib.Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await db.start()
        await tools.event_overview({}, {})  # warm the cache so the first ask is instant
    except Exception as exc:  # noqa: BLE001
        print(f"[backstage] database warm-up skipped: {exc}")
    llm.client()  # open the connection pool
    if config.ADMIN_ACCESS_KEY:
        await actions.warm()  # sign in early so the first action is instant
    yield
    await db.close()
    await llm.aclose()


app = FastAPI(title="Backstage", version="1.0", lifespan=lifespan)


class ChatRequest(BaseModel):
    session_id: str
    message: str


def auth(x_assistant_key: str | None = Header(default=None)) -> bool:
    if config.ASSISTANT_KEY and x_assistant_key != config.ASSISTANT_KEY:
        raise HTTPException(status_code=401, detail="Bad assistant key")
    return True


def auth_flexible(
    x_assistant_key: str | None = Header(default=None), key: str | None = None
) -> bool:
    """For <audio src="...">, which cannot send headers — the key may be a query param."""
    if not config.ASSISTANT_KEY:
        return True
    if x_assistant_key == config.ASSISTANT_KEY or key == config.ASSISTANT_KEY:
        return True
    raise HTTPException(status_code=401, detail="Bad assistant key")


async def _run_tool_call(call: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    name = (call.get("function") or {}).get("name") or ""
    try:
        args = json.loads((call.get("function") or {}).get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    result = await tools.execute(name, args, ctx)
    return {
        "role": "tool",
        "tool_call_id": call.get("id"),
        "content": json.dumps(result, default=str),
    }


async def _execute_pending(pending: dict[str, Any]) -> str:
    kind = pending.get("kind")
    try:
        if kind == "announcement":
            out = await actions.send_announcement(pending["body"], pending.get("audience", "all"))
            return f"Sent to {out['sent']} families" + (f", {out['failed']} failed." if out["failed"] else ".")
        if kind == "ticket_reply":
            await actions.reply_to_ticket(pending["ticket_id"], pending["message"])
            return "Reply sent and the request is marked resolved."
        if kind == "gallery":
            state = "published" if pending.get("enabled") else "taken offline"
            await actions.set_gallery(bool(pending.get("enabled")))
            return f"The public gallery is now {state}."
        if kind == "check_in":
            out = await actions.check_in_family(pending["code"])
            return f"Checked in {out['checked_in']} for {out.get('student') or out['code']}."
        return "I do not know how to do that."
    except Exception as exc:  # noqa: BLE001
        return f"That did not go through: {exc}"


async def run_turn(session_id: str, message: str, emit: Emit) -> dict[str, Any]:
    """One organizer turn: tools in parallel, terse spoken answer out."""
    session = sessions.get(session_id) or sessions.get(sessions.new())
    if session is None:
        session = {"history": [], "pending": None}
    sessions.remember(session, "user", message)

    pending = session.get("pending")
    if pending and sessions.affirmative(message):
        session["pending"] = None
        reply = await _execute_pending(pending)
        sessions.remember(session, "assistant", reply)
        await emit({"type": "answer", "text": reply, "tools": ["confirm"], "model": "actions"})
        return {"text": reply, "tools": ["confirm"], "model": "actions"}
    if pending and sessions.negative(message):
        session["pending"] = None
        reply = "Cancelled. Nothing was sent."
        sessions.remember(session, "assistant", reply)
        await emit({"type": "answer", "text": reply, "tools": [], "model": "actions"})
        return {"text": reply, "tools": [], "model": "actions"}
    if pending:
        session["pending"] = None  # a new instruction supersedes the proposal

    ctx = {"sid": session_id, "session": session, "emit": emit}

    # Fast path: a data question is answered from the database and a template in
    # a few milliseconds, with no model call at all. Only creative work and
    # action proposals go to the model.
    try:
        fast = await router.try_handle(message, ctx)
    except Exception as exc:  # noqa: BLE001 — always fall through to the model
        print(f"[backstage] fast path skipped: {exc}")
        fast = None
    if fast:
        sessions.remember(session, "assistant", fast["text"])
        await emit({"type": "answer", **fast})
        return fast

    await emit({"type": "status", "text": "thinking"})

    who = await identity.current()
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt(who)}]
    messages.extend(session.get("history", [])[-sessions.HISTORY_TURNS :])
    messages.append({"role": "user", "content": message})

    used: list[str] = []
    model = ""
    text = ""

    for _round in range(config.TOOL_ROUNDS):
        try:
            msg, model = await llm.complete(messages, tools=tools.TOOL_SCHEMAS, max_tokens=500)
        except Exception as exc:  # noqa: BLE001
            text = f"My brain is not reachable right now ({type(exc).__name__})."
            break
        calls = msg.get("tool_calls") or []
        if not calls:
            text = (msg.get("content") or "").strip()
            break
        messages.append(llm._clean(msg))
        picked = calls[:4]
        results = await asyncio.gather(*(_run_tool_call(c, ctx) for c in picked))
        messages.extend(results)
        used.extend((c.get("function") or {}).get("name") or "tool" for c in picked)
    else:
        text = "That needed too many steps — ask me for one thing at a time."

    if not text:
        text = "I could not put that into words. Try asking again."

    sessions.remember(session, "assistant", text)
    await emit({"type": "answer", "text": text, "tools": used, "model": model})
    return {"text": text, "tools": used, "model": model}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    who = {}
    try:
        who = await identity.current()
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": True,
        "database": bool(config.DATABASE_URL),
        "groq": bool(config.GROQ_API_KEY),
        "nim": bool(config.NVIDIA_API_KEY),
        "fallback": bool(config.FALLBACK_API_KEY),
        "models": [model for _, _, model in llm.chain()],
        "phrase_mode": config.PHRASE_MODE,
        "actions": bool(config.ADMIN_ACCESS_KEY),
        "identity": who,
    }


@app.post("/api/session")
async def create_session(_: bool = Depends(auth)) -> dict[str, str]:
    sessions.prune()
    return {"session_id": sessions.new(), "greeting": greeting(await identity.current())}


@app.post("/api/chat")
async def chat(req: ChatRequest, _: bool = Depends(auth)) -> dict[str, Any]:
    events: list[dict[str, Any]] = []

    async def collect(event: dict[str, Any]) -> None:
        events.append(event)

    answer = await run_turn(req.session_id, req.message, collect)
    return {"reply": answer["text"], "tools": answer["tools"], "model": answer["model"], "events": events}


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest, _: bool = Depends(auth)) -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def emit(event: dict[str, Any]) -> None:
        await queue.put(event)

    task = asyncio.create_task(run_turn(req.session_id, req.message, emit))

    async def generate():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, default=str)}\n\n"
                if event.get("type") == "answer":
                    break
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/api/voices")
async def list_voices(_: bool = Depends(auth)) -> dict[str, Any]:
    return {"voices": await tts.voices(), "default": config.TTS_VOICE}


@app.get("/api/speak")
async def speak(
    text: str,
    voice: str | None = None,
    _: bool = Depends(auth_flexible),
) -> StreamingResponse:
    """Stream natural speech as MP3. Point an <audio> element straight at it."""
    spoken = (text or "").strip()[:1200]
    if not spoken:
        raise HTTPException(status_code=400, detail="Nothing to say")
    return StreamingResponse(
        tts.stream(spoken, voice),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
