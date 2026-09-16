"""In-memory conversation sessions.

One organizer, one session: short history for context, plus a pending action
that only fires after an explicit confirmation. Deliberately not persisted —
this is a live backstage tool, and the data belongs in the database, not here.
"""

import re
import time
import uuid
from typing import Any

TTL_SECONDS = 60 * 60 * 6
HISTORY_TURNS = 8

YES = re.compile(r"^\s*(yes|y|yeah|yep|ok|okay|sure|confirm|confirmed|do it|go ahead|haan?|ha|theek|thik|kar do|kardo|bhej do|send it)\b", re.I)
NO = re.compile(r"^\s*(no|n|nope|nahi?|nah|cancel|stop|mat|don'?t|dont|ruko|wait)\b", re.I)

_sessions: dict[str, dict[str, Any]] = {}


def new() -> str:
    sid = uuid.uuid4().hex
    _sessions[sid] = {"history": [], "pending": None, "touched": time.time()}
    return sid


def get(sid: str) -> dict[str, Any] | None:
    session = _sessions.get(sid)
    if session is None:
        return None
    session["touched"] = time.time()
    return session


def prune() -> None:
    now = time.time()
    for key in [k for k, v in _sessions.items() if now - v["touched"] > TTL_SECONDS]:
        _sessions.pop(key, None)


def remember(session: dict[str, Any], role: str, content: str) -> None:
    history = session.setdefault("history", [])
    history.append({"role": role, "content": content})
    del history[:-HISTORY_TURNS]


def affirmative(text: str) -> bool:
    return bool(YES.match(text))


def negative(text: str) -> bool:
    return bool(NO.match(text))
