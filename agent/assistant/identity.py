"""Who the assistant is working for — read from the database, not the code.

The school name, event name, venue and dates belong to the school, not to a
string literal. Change them in the staff workspace and the assistant follows.
"""

from typing import Any

from assistant import db

CACHE_KEY = "identity"
TTL = 300.0


async def current() -> dict[str, Any]:
    hit = db.cached(CACHE_KEY)
    if hit is not None:
        return hit
    row = await db.one(
        "select event_name, event_date, start_time, venue, "
        "(landing_content->>'schoolName') as school_name "
        "from event_settings order by updated_at desc limit 1"
    ) or {}
    identity = {
        "school": row.get("school_name") or "",
        "event": row.get("event_name") or "",
        "venue": row.get("venue") or "",
        "date": row.get("event_date"),
        "time": row.get("start_time") or "",
    }
    return db.remember(CACHE_KEY, identity, TTL)


def describe(identity: dict[str, Any]) -> str:
    """A clause for the prompt, omitting whatever the school has not set."""
    school = identity.get("school") or "the school"
    event = identity.get("event")
    parts = [f"{school}'s {event}" if event else school]
    if identity.get("venue"):
        parts.append(f"at the {identity['venue']}")
    if identity.get("date"):
        parts.append(f"on {identity['date']}")
    if identity.get("time"):
        parts.append(f"starting {identity['time']}")
    return " ".join(parts)


def invalidate() -> None:
    db._cache.pop(CACHE_KEY, None)
