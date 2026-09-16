"""Work out who "everyone" or a class name means — from the roster, never a list.

Two rules, both deliberate:

* No class name is ever written into this code. The classes are whatever the
  school put in `students.class`; we read them and match against them.
* It fails safe. If the words match nothing, or match more than one class, we
  ask which one instead of acting on a guess. A mis-heard voice command must
  never move the wrong 200 students.
"""

import re
from typing import Any

from assistant import db

EVERYONE = re.compile(
    r"^(all|everyone|every ?body|every ?one|every ?student|every ?class|"
    r"whole ?school|entire ?school|sab|sabhi|sab ?log|sabhi ?log|"
    r"sab ?students?|sabhi ?students?)$",
    re.I,
)

CACHE_KEY = "classes"
TTL = 30.0


def normalise(text: str) -> str:
    """Lower-case and drop everything that is not a letter or digit.

    So "2ND LILY", "2nd lily" and "2nd-lily" all compare equal, and a
    transcription of "tulip" still matches "TULIP 1" on the unique-part rule.
    """
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


async def class_rows() -> list[dict[str, Any]]:
    """The classes that actually exist, with how many students are in each."""
    hit = db.cached(CACHE_KEY)
    if hit is not None:
        return hit
    rows = await db.rows(
        "select coalesce(class, '') as class, count(*) as students "
        "from students group by 1 order by 1"
    )
    return db.remember(CACHE_KEY, rows, TTL)


async def names() -> list[str]:
    return [r["class"] for r in await class_rows() if r["class"]]


async def resolve(target: str) -> dict[str, Any]:
    """Return one of:

    {"scope": "all"}                        — everyone
    {"scope": "class", "className": "TULIP 1"}
    {"error": "...", "classes": [...]}      — ask, do not act
    """
    text = (target or "").strip()
    if not text:
        return {"error": "Who should this apply to — everyone, or a class?", "classes": await names()}
    if EVERYONE.match(text):
        return {"scope": "all"}

    wanted = normalise(text)
    known = await class_rows()
    exact = [r for r in known if r["class"] and normalise(r["class"]) == wanted]
    if len(exact) == 1:
        return {"scope": "class", "className": exact[0]["class"]}

    partial = [r for r in known if r["class"] and wanted and wanted in normalise(r["class"])]
    if len(partial) == 1:
        return {"scope": "class", "className": partial[0]["class"]}

    available = await names()
    if partial:
        return {
            "error": f"That could be more than one class ({', '.join(r['class'] for r in partial)}). Which one?",
            "classes": available,
        }
    return {"error": f"I don't have a class called “{text}”.", "classes": available}


def describe(resolved: dict[str, Any]) -> str:
    if resolved.get("scope") == "all":
        return "everyone"
    return resolved.get("className") or "that class"
