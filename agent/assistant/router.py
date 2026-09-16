"""The fast path.

Two deliberate choices, and it is worth being explicit about which is which:

* ROUTING is a small declarative table of patterns. It only decides **which
  tool to run**, so the common questions skip the model's tool-selection round
  trip. It never decides what the answer says.
* WORDING belongs to the model. The fetched data is handed to the model with
  PHRASE_PROMPT, so the reply is written in the organizer's own language and
  changes with the data. The templates further down are a **fallback for when no
  model is reachable** — mechanical on purpose, not a scripted voice.

Set PHRASE_MODE=template to skip the model and always use the templates.
"""

import json
import re
from typing import Any

from assistant import llm, tools
from assistant.prompts import PHRASE_PROMPT

Ctx = dict[str, Any]

# Anything needing judgement, drafting or an action goes to the model directly.
_NEEDS_MODEL = re.compile(
    r"\b(draft|write|compose|reword|rewrite|suggest|recommend|explain|why|should|"
    r"announce|announcement|message to|send|broadcast|reply to|publish|hide|"
    r"check in|check-in|likho|banao|bhej|message)\b",
    re.I,
)

# (tool, pattern, capture-group name) — declarative, not logic.
INTENTS: list[tuple[str, str, str | None]] = [
    ("briefing", r"\b(brief|status|update|overview|summary|haal|hal|kya chal)\b", None),
    ("what_needs_attention", r"\b(attention|problem|issue|worry|risk|kya dekh|kya karu)\b", None),
    ("rsvp_report", r"\b(rsvp|replied|replies|response|confirm|confirmed|kitne log|kitni family)\b", None),
    ("reachability", r"\b(reach|reachable|contact|telegram|whatsapp|unreachable)\b", None),
    (
        "unchecked_families",
        r"\b(not arrived|haven'?t arrived|hasn'?t arrived|have not arrived|"
        r"unchecked|pending arrival|still to arrive|yet to arrive|nahi aay[ae])\b",
        None,
    ),
    ("checkin_status", r"\b(arriv|arrived|check-?in|checked|gate|entry|enter|aa gaye)\b", None),
    ("album_status", r"\b(photo|photos|album|gallery|picture|tasveer)\b", None),
    ("open_tickets", r"\b(ticket|tickets|request|requests|complaint|complaints|support)\b", None),
    ("class_breakdown", r"\b(class|classes|wing|section)\b", None),
    (
        "find_family",
        r"(?:find|look ?up|search|who is|where is|dhoondo|dhundo|dikhao)\s+(.+)",
        "query",
    ),
    (
        "list_guests",
        # Skip filler ("guest list for X"), then take something that actually
        # looks like a code — a hyphenated one, or a long unbroken token. Taking
        # the next word blindly used to capture "for" as the code.
        r"(?:guest list|guests? (?:of|on|for))\b.*?\b([A-Za-z]{2,6}-[A-Za-z0-9]{3,}|[A-Za-z0-9]{7,})",
        "code",
    ),
]


def _route(message: str) -> tuple[str, dict[str, Any]] | None:
    for tool, pattern, capture in INTENTS:
        match = re.search(pattern, message, re.I)
        if not match:
            continue
        if capture and match.groups():
            return tool, {capture: match.group(1).strip(" .?!")}
        return tool, {}
    return None


# A model that starts narrating its own reasoning sounds broken out loud.
_REASONING_MARKERS = re.compile(
    r"\b(we must|we need to|the user|so we|let me|i should|the data|in json|as an ai|we can say)\b",
    re.I,
)

# Long enough for a real list ("...twelve classes, 467 students in all: ..."),
# short enough that a runaway paragraph is still caught.
MAX_PHRASED_CHARS = 900

# Room for a full list. A reasoning model spends part of this budget thinking
# before it writes anything, which is what used to chop a class list in half.
PHRASE_TOKENS = 600


def _looks_spoken(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < 15 or len(stripped) > MAX_PHRASED_CHARS:
        return False
    if re.fullmatch(r"[\s\d.,;:!?%\-–—]*", stripped):  # a bare number or two
        return False
    return not _REASONING_MARKERS.search(stripped)


def _pruned(value: Any) -> Any:
    """Drop zeros, empty strings and nulls before phrasing.

    The model should never be tempted to say "zero photos waiting"; if a number
    is zero it simply is not part of the story. Booleans are kept — false is
    meaningful ("the gallery is not published").
    """
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            kept = _pruned(item)
            if kept is not None:
                out[key] = kept
        return out or None
    if isinstance(value, list):
        kept_list = [item for item in (_pruned(v) for v in value) if item is not None]
        return kept_list or None
    if isinstance(value, bool):
        return value
    if value is None or value == "" or value == 0:
        return None
    return value


async def _speak(name: str, result: dict[str, Any], message: str) -> tuple[str, str] | None:
    """Word the fetched data. Model first, template only if the model is out."""
    import config

    if config.PHRASE_MODE != "template" and llm.chain() and not result.get("error"):
        payload = json.dumps(_pruned(result) or {}, default=str)
        if payload == "{}":
            # Everything was zero. Hand the model the raw numbers with a flag
            # so it can answer "nobody has arrived yet" instead of "nothing to
            # report" — a zero is the answer here, not noise.
            payload = json.dumps({"all_zero": True, "data": result}, default=str)
        # Two tries: a reasoning model spends part of the budget thinking, and a
        # long list can outgrow it. Better to ask again with room than to show
        # the organizer half a sentence.
        for budget in (PHRASE_TOKENS, PHRASE_TOKENS * 2):
            try:
                out, model = await llm.complete(
                    [
                        {"role": "system", "content": PHRASE_PROMPT},
                        {
                            "role": "user",
                            "content": (
                                f"Question: {message}\n"
                                f"Read: {name}\n"
                                f"Fetched data: {payload[:6000]}"
                            ),
                        },
                    ],
                    max_tokens=budget,
                    temperature=0.2,
                    routes=llm.phrase_chain(),
                )
            except Exception as exc:  # noqa: BLE001 — the templates are the safety net
                print(f"[backstage] phrasing fell back to template: {exc}")
                break
            text = (out.get("content") or "").strip()
            if text and llm.was_cut_off(out):
                print(f"[backstage] phrasing ran out of room at {budget} tokens; asking again")
                continue
            if text and _looks_spoken(text):
                return text, model
            if text:
                print(f"[backstage] phrasing rejected ({text[:60]!r}); using the template")
            break

    text = _template(name, result, message)
    return (text, "template") if text else None


async def try_handle(message: str, ctx: Ctx) -> dict[str, Any] | None:
    """Return a finished answer, or None to hand the whole turn to the model."""
    if _NEEDS_MODEL.search(message):
        return None
    route = _route(message)
    if route is None:
        return None
    name, args = route
    result = await tools.execute(name, args, ctx)
    spoken = await _speak(name, result, message)
    if spoken is None:
        return None
    text, model = spoken
    return {"text": text, "tools": [name], "model": model}


# --------------------------------------------------------------------------
# fallback templates — only used when no model is reachable
# --------------------------------------------------------------------------
def _plural(n: int, word: str) -> str:
    """Enough English for the words we actually use (family, entry, pass, ...)."""
    if n == 1:
        return f"{n} {word}"
    if word.endswith("y") and not word.endswith(("ay", "ey", "oy", "uy")):
        return f"{n} {word[:-1]}ies"
    if word.endswith(("s", "x", "ch", "sh")):
        return f"{n} {word}es"
    return f"{n} {word}s"


def _template(name: str, result: dict[str, Any], message: str) -> str | None:
    if not isinstance(result, dict) or result.get("error"):
        return None

    if name == "briefing":
        counts = result["overview"]["counts"]
        attention = result["attention"]["counts"]
        invitations = counts["invitations"]
        confirmed = counts["attending"]
        arrived = counts["check_ins"]
        first = (
            f"{_plural(invitations, 'invitation')} {'is' if invitations == 1 else 'are'} out. "
            f"{_plural(confirmed, 'family')} {'has' if confirmed == 1 else 'have'} confirmed "
            f"{_plural(counts['expected_guests'], 'guest')}"
            + (", and nobody has arrived yet." if not arrived else f", and {arrived} have arrived.")
        )
        waiting = []
        if counts["open_tickets"]:
            waiting.append(_plural(counts["open_tickets"], "open request"))
        if attention["photos_pending"]:
            waiting.append(f"{_plural(attention['photos_pending'], 'photo')} to review")
        second = (
            f"Waiting on you: {' and '.join(waiting)}."
            if waiting
            else "Nothing needs you right now."
        )
        third = (
            f"{attention['unreachable']} families still cannot be reached on chat."
            if attention["unreachable"]
            else ""
        )
        return " ".join(part for part in (first, second, third) if part)

    if name == "what_needs_attention":
        counts = result["counts"]
        parts: list[str] = []
        if counts["open_tickets"]:
            parts.append(_plural(counts["open_tickets"], "open request"))
        if counts["awaiting_reply"]:
            parts.append(f"{counts['awaiting_reply']} families yet to reply")
        if counts["unreachable"]:
            parts.append(f"{counts['unreachable']} unreachable on chat")
        if counts["photos_pending"]:
            parts.append(f"{_plural(counts['photos_pending'], 'photo')} to review")
        if counts["disabled_passes"]:
            parts.append(f"{_plural(counts['disabled_passes'], 'pass')} disabled")
        return "Right now: " + ", ".join(parts) + "." if parts else "Nothing needs your attention right now."

    if name == "rsvp_report":
        total = result.get("total") or 0
        if not total:
            return "There are no invitations yet."
        attending = result.get("attending") or 0
        declined = result.get("declined") or 0
        return (
            f"So far {_plural(attending, 'family')} {'has' if attending == 1 else 'have'} said yes, "
            f"{declined} {'has' if declined == 1 else 'have'} declined, and "
            f"{result.get('awaiting_reply', 0)} have not replied. We are expecting about "
            f"{_plural(result.get('expected_guests', 0), 'guest')}."
        )

    if name == "reachability":
        channels = []
        if result.get("telegram"):
            channels.append(f"{result['telegram']} on Telegram")
        if result.get("whatsapp"):
            channels.append(f"{result['whatsapp']} on WhatsApp")
        tail = f" — {' and '.join(channels)}" if channels else ""
        return f"{result.get('reachable', 0)} of {result.get('total', 0)} families can be messaged{tail}."

    if name == "checkin_status":
        totals = result.get("totals") or {}
        entries = totals.get("entries") or 0
        families = totals.get("families_arrived") or 0
        line = f"{_plural(entries, 'entry')} so far, {_plural(families, 'family')} arrived."
        gates = result.get("by_gate") or []
        if gates:
            line += " " + ", ".join(f"{g['gate']} {g['entries']}" for g in gates[:3]) + "."
        return line

    if name == "unchecked_families":
        families = result.get("sample") or []
        total = int(result.get("total_still_to_arrive") or len(families))
        if not total:
            return "Nobody is outstanding — every active family has arrived."
        names = ", ".join(f"{f['name']} ({f['class_name'] or 'no class'})" for f in families[:5])
        more = "" if len(families) <= 5 else f", and {len(families) - 5} more"
        return f"{_plural(total, 'family')} still to arrive. First up: {names}{more}."

    if name == "album_status":
        approved = result.get("approved") or 0
        pending = result.get("pending") or 0
        state = "published" if result.get("published") else "not published yet"
        line = f"{_plural(approved, 'photo')} approved"
        line += (
            f", {_plural(pending, 'photo')} waiting for review"
            if pending
            else ", nothing waiting for review"
        )
        return f"{line}. The public gallery is {state}."

    if name == "open_tickets":
        count = result.get("count", 0)
        if not count:
            return "No open support requests. You are all caught up."
        first = result["tickets"][0]
        who = first.get("student") or first.get("code") or "a family"
        return f"{_plural(count, 'open request')}. The latest is from {who}: {first.get('summary') or 'a request'}"

    if name == "class_breakdown":
        classes = result.get("classes") or []
        if not classes:
            return "No classes to report yet."
        total = result.get("total_students") or sum(int(c["students"]) for c in classes)
        head = f"{_plural(len(classes), 'class')}, {total} students in all."
        tail = ", ".join(f"{c['class_name']} {c['students']}" for c in classes)
        return f"{head} {tail}."

    if name == "find_family":
        matches = result.get("matches") or []
        if not matches:
            return f"I could not find anyone matching {message.split()[-1]}."
        if len(matches) > 1:
            names = ", ".join(m["name"] for m in matches[:3])
            return f"I found {len(matches)} matches: {names}. Which one?"
        person = matches[0]
        rsvp = {
            "attending": f"They are coming with {_plural(person.get('rsvp_guests') or 0, 'guest')}",
            "declined": "They are not coming",
            "pending": "They have not replied yet",
        }.get(person.get("rsvp_status") or "pending", "They have not replied yet")
        checked = person.get("checked_in") or 0
        tail = f"{_plural(checked, 'guest')} checked in" if checked else "nobody checked in yet"
        return (
            f"{person['name']}, admission {person['admission']}, class "
            f"{person.get('class_name') or 'unassigned'}. Code {person['code']}. {rsvp}, "
            f"{_plural(person.get('registered') or 0, 'guest')} registered, {tail}."
        )

    if name == "list_guests":
        guests = result.get("guests") or []
        if not guests:
            return f"No guests registered on {result.get('code')} yet."
        return f"{_plural(len(guests), 'guest')} on {result.get('code')}: " + ", ".join(
            g["name"] for g in guests[:6]
        ) + "."

    if name == "search_knowledge":
        passages = result.get("passages") or []
        if not passages:
            return "I could not find that in the school documents."
        return passages[0]["content"].replace("\n", " ").strip()[:400]

    return None
