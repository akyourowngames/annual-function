"""Backstage — the event team's private voice assistant.

Run it:  uvicorn main:app --host 127.0.0.1 --port 8000
"""

import asyncio
import json
import pathlib
from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from assistant import actions, db, identity, llm, router, session as sessions, stt, tools, tts
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
        if kind == "guest_limit":
            out = await actions.set_guest_limit(
                scope=pending.get("scope", "all"),
                class_name=pending.get("className"),
                limit=int(pending.get("limit") or 0),
            )
            skipped = out.get("skipped") or []
            line = f"Guest limit set to {out['limit']} for {out['updated']} students."
            if skipped:
                line += f" {len(skipped)} were skipped because they already have more guests than that."
            return line
        if kind == "send_invitations":
            out = await actions.send_invitations(
                scope=pending.get("scope", "all"), class_name=pending.get("className")
            )
            line = f"Sent {out['sent']} invitation passes."
            if out.get("failed"):
                line += f" {out['failed']} failed."
            if out.get("remaining"):
                line += f" {out['remaining']} are still queued."
            return line
        if kind == "create_student":
            out = await actions.create_student(
                admission=pending["admission"],
                name=pending["name"],
                class_name=pending["className"],
                guest_limit=pending.get("guestLimit"),
            )
            return (
                f"Added {out['name']}, admission {out['admission']}, class {out['className']}. "
                f"Invitation code {out.get('code')}. Nothing has been sent."
            )
        if kind == "regenerate_pass":
            out = await actions.regenerate_pass(pending["code"])
            return (
                f"Done. The new code is {out['code']}. "
                f"The old code {out['oldCode']} no longer works."
            )
        if kind == "invitation_status":
            out = await actions.set_invitation_status(pending["code"], bool(pending.get("active")))
            return f"The pass is now {out.get('status') or ('active' if pending.get('active') else 'disabled')}."
        if kind == "add_guest":
            out = await actions.add_guest(
                pending["code"], pending["name"], pending.get("relationship")
            )
            registered = out.get("registered")
            remaining = out.get("remaining")
            return (
                f"Added {out['name']}. {registered} "
                f"{'guest' if registered == 1 else 'guests'} registered, {remaining} "
                f"{'seat' if remaining == 1 else 'seats'} left."
            )
        if kind == "remove_guest":
            out = await actions.remove_guest(pending["code"], pending["guestName"])
            return f"Removed {out['removed']} from {out['code']}."
        if kind == "resend_pass":
            out = await actions.resend_pass(pending["code"])
            if out.get("sent"):
                return f"Sent their pass just now ({out['code']})."
            if out.get("unreachable"):
                return "I could not reach that family on chat yet, so nothing was sent."
            return f"That did not send: {out.get('failed', 0)} failed."
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
        reply = "Cancelled. Nothing was changed."
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
    cut_off = False

    for _round in range(config.TOOL_ROUNDS):
        try:
            msg, model = await llm.complete(
                messages, tools=tools.TOOL_SCHEMAS, max_tokens=config.ANSWER_TOKENS
            )
        except Exception as exc:  # noqa: BLE001
            text = f"My brain is not reachable right now ({type(exc).__name__})."
            break
        calls = msg.get("tool_calls") or []
        if not calls:
            text = (msg.get("content") or "").strip()
            cut_off = llm.was_cut_off(msg)
            break
        messages.append(llm._clean(msg))
        picked = calls[:4]
        results = await asyncio.gather(*(_run_tool_call(c, ctx) for c in picked))
        messages.extend(results)
        used.extend((c.get("function") or {}).get("name") or "tool" for c in picked)
    else:
        text = "That needed too many steps — ask me for one thing at a time."

    if cut_off and text:
        # It ran out of room mid-sentence. Ask once more with headroom rather
        # than trailing off in the organizer's ear.
        try:
            whole, model = await llm.complete(messages, max_tokens=config.ANSWER_TOKENS * 2)
            fuller = (whole.get("content") or "").strip()
            if fuller and not llm.was_cut_off(whole):
                text = fuller
        except Exception as exc:  # noqa: BLE001
            print(f"[backstage] could not finish the answer: {exc}")

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
        "hearing": stt.ready(),
        "hearing_model": config.STT_MODEL if stt.ready() else "",
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


@app.post("/api/transcribe")
async def transcribe(request: Request, _: bool = Depends(auth)) -> dict[str, Any]:
    """Hear a clip the page recorded. The audio is the raw body, not a form.

    Sending the bytes straight through keeps the browser free of any speech
    library: it only has to record.
    """
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="No audio")
    try:
        heard = await stt.transcribe(audio, request.headers.get("content-type", ""))
    except stt.SttUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": heard}


@app.get("/api/speak")
async def speak(
    text: str,
    voice: str | None = None,
    _: bool = Depends(auth_flexible),
) -> StreamingResponse:
    """Stream natural speech as MP3. Point an <audio> element straight at it."""
    # Generous, because a real answer can now be a full class list. Long enough
    # that this should never fire; if it does, cut on a word rather than leaving
    # a chopped word in the organizer's ear.
    spoken = (text or "").strip()
    if len(spoken) > config.MAX_SPOKEN_CHARS:
        spoken = spoken[: config.MAX_SPOKEN_CHARS].rsplit(" ", 1)[0].rstrip(" ,;:")
    if not spoken:
        raise HTTPException(status_code=400, detail="Nothing to say")
    return StreamingResponse(
        tts.stream(spoken, voice),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
