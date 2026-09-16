"""The tool registry — everything Backstage can look up or propose.

Reads hit Postgres directly (fast, indexed, one small pool). Writes are never
performed here: action tools only record a proposal on the session, and the
app executes it after the organizer confirms.
"""

from typing import Any, Callable, Awaitable

from assistant import db, knowledge

Ctx = dict[str, Any]
Handler = Callable[[dict[str, Any], Ctx], Awaitable[dict[str, Any]]]


# --------------------------------------------------------------------------
# reads
# --------------------------------------------------------------------------
async def event_overview(_args: dict, _ctx: Ctx) -> dict:
    cached = db.cached("overview")
    if cached is not None:
        return cached
    event = await db.one(
        "select event_name, event_date, start_time, venue, dress_code, entry_info, "
        "parking_info, gallery_enabled from event_settings order by updated_at desc limit 1"
    ) or {}
    counts = await db.one(
        """
        select
          (select count(*) from invitations)                          as invitations,
          (select count(*) from guests)                               as guests_registered,
          (select count(*) from check_ins)                            as check_ins,
          (select count(*) from support_tickets where status <> 'resolved') as open_tickets,
          (select count(*) from invitations where rsvp_status = 'attending') as attending,
          (select coalesce(sum(rsvp_guests), 0) from invitations
             where rsvp_status = 'attending')                         as expected_guests,
          (select count(*) from invitations where rsvp_status = 'pending')  as awaiting_reply,
          (select count(*) from invitation_contacts)                  as reachable,
          (select count(*) from photos where status = 'approved')     as photos_approved,
          (select count(*) from photos where status = 'pending')      as photos_pending
        """
    ) or {}
    return db.remember("overview", {"event": event, "counts": counts})


async def what_needs_attention(_args: dict, _ctx: Ctx) -> dict:
    tickets = await db.rows(
        "select coalesce(ai_summary, description) as summary, category, "
        "invitation_code as code from support_tickets "
        "where status <> 'resolved' order by created_at desc limit 4"
    )
    counts = await db.one(
        """
        select
          (select count(*) from support_tickets where status <> 'resolved') as open_tickets,
          (select count(*) from invitations) - (select count(*) from invitation_contacts) as unreachable,
          (select count(*) from invitations where rsvp_status = 'pending') as awaiting_reply,
          (select count(*) from photos where status = 'pending') as photos_pending,
          (select count(*) from invitations where status <> 'active') as disabled_passes
        """
    ) or {}
    return {"counts": counts, "top_requests": tickets}


async def briefing(_args: dict, _ctx: Ctx) -> dict:
    overview = await event_overview({}, _ctx)
    attention = await what_needs_attention({}, _ctx)
    return {"overview": overview, "attention": attention}


async def find_family(args: dict, _ctx: Ctx) -> dict:
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "No name, admission number, class or code given."}
    like = f"%{query}%"
    found = await db.rows(
        """
        select s.student_id as admission, s.name, s.class as class_name,
               i.invitation_code as code, i.status, i.guest_limit,
               i.rsvp_status, i.rsvp_guests, i.rsvp_note,
               (select count(*) from guests g where g.invitation_id = i.id)          as registered,
               (select count(*) from check_ins c where c.invitation_id = i.id)       as checked_in
        from students s join invitations i on i.student_id = s.id
        where s.student_id ilike %s or s.name ilike %s
           or i.invitation_code ilike %s or s.class ilike %s
        order by s.name limit 5
        """,
        (like, like, like, like),
    )
    return {"matches": found, "count": len(found)}


async def list_guests(args: dict, _ctx: Ctx) -> dict:
    code = (args.get("code") or "").strip().upper()
    if not code:
        return {"error": "No invitation code given."}
    guests = await db.rows(
        "select g.name, g.relationship, g.status from guests g "
        "join invitations i on i.id = g.invitation_id "
        "where i.invitation_code = %s order by g.created_at",
        (code,),
    )
    return {"code": code, "guests": guests, "count": len(guests)}


async def checkin_status(_args: dict, _ctx: Ctx) -> dict:
    totals = await db.one(
        "select (select count(*) from check_ins) as entries, "
        "(select count(distinct invitation_id) from check_ins) as families_arrived"
    ) or {}
    by_gate = await db.rows(
        "select coalesce(gate, 'gate') as gate, count(*) as entries "
        "from check_ins group by 1 order by 2 desc"
    )
    recent = await db.rows(
        "select coalesce(g.name, s.name) as who, c.checked_in_at as at "
        "from check_ins c join invitations i on i.id = c.invitation_id "
        "join students s on s.id = i.student_id "
        "left join guests g on g.id = c.guest_id "
        "order by c.checked_in_at desc limit 5"
    )
    return {"totals": totals, "by_gate": by_gate, "recent": recent}


async def unchecked_families(args: dict, _ctx: Ctx) -> dict:
    """Active families with nobody checked in — the chase-up list at the gate.

    Returns the true total as well as the short list, so nobody mistakes the
    page size for the whole picture.
    """
    limit = int(args.get("limit") or 12)
    limit = max(1, min(limit, 50))
    class_name = (args.get("class_name") or "").strip()
    clauses = ["i.status = 'active'"]
    params: list[Any] = []
    if class_name:
        clauses.append("lower(trim(coalesce(s.class, ''))) = lower(trim(%s))")
        params.append(class_name)
    clauses.append("(select count(*) from check_ins c where c.invitation_id = i.id) = 0")
    where = " and ".join(clauses)
    total = await db.scalar(
        "select count(*) from invitations i join students s on s.id = i.student_id where " + where,
        tuple(params),
    )
    rows = await db.rows(
        "select s.name, s.class as class_name, i.invitation_code as code, "
        "i.rsvp_status, i.rsvp_guests, "
        "(select count(*) from guests g where g.invitation_id = i.id) as registered "
        "from invitations i join students s on s.id = i.student_id "
        "where " + where + " order by s.class nulls last, s.name limit %s",
        tuple(params) + (limit,),
    )
    return {
        # The count first, and the list named as a sample: at a gate with 400
        # families still out, the twelve names are a starting point, not the
        # whole answer.
        "total_still_to_arrive": int(total or 0),
        "sample": rows,
        "class_name": class_name or None,
    }


async def rsvp_report(_args: dict, _ctx: Ctx) -> dict:
    return await db.one(
        """
        select
          (select count(*) from invitations)                                   as total,
          (select count(*) from invitations where rsvp_status = 'attending')   as attending,
          (select count(*) from invitations where rsvp_status = 'declined')    as declined,
          (select count(*) from invitations where rsvp_status = 'pending')     as awaiting_reply,
          (select coalesce(sum(rsvp_guests), 0) from invitations
             where rsvp_status = 'attending')                                  as expected_guests
        """
    ) or {}


async def class_breakdown(_args: dict, _ctx: Ctx) -> dict:
    """Per-class headcount, biggest first.

    Field names say what they are, because the phrasing model has to tell
    students from the guests they are bringing without being told twice.
    """
    rows = await db.rows(
        """
        select coalesce(s.class, 'Unassigned') as class_name,
               count(*) as students,
               count(*) filter (where i.rsvp_status = 'attending') as coming,
               coalesce(sum(i.rsvp_guests) filter (where i.rsvp_status = 'attending'), 0) as expected_guests
        from invitations i join students s on s.id = i.student_id
        group by 1 order by students desc, class_name
        """
    )
    total = sum(int(r["students"]) for r in rows)
    return {
        "classes": rows,
        "class_count": len(rows),
        "total_students": total,
    }


async def open_tickets(args: dict, _ctx: Ctx) -> dict:
    limit = int(args.get("limit") or 10)
    limit = max(1, min(limit, 25))
    rows = await db.rows(
        "select t.id, t.category, t.status, coalesce(t.ai_summary, t.description) as summary, "
        "t.suggested_reply, t.invitation_code as code, s.name as student "
        "from support_tickets t left join students s on s.id = t.student_id "
        "where t.status <> 'resolved' order by t.created_at desc limit %s",
        (limit,),
    )
    return {"tickets": rows, "count": len(rows)}


async def album_status(_args: dict, _ctx: Ctx) -> dict:
    return await db.one(
        """
        select
          (select count(*) from photos where status = 'pending')  as pending,
          (select count(*) from photos where status = 'approved') as approved,
          (select count(*) from photos where status = 'hidden')   as hidden,
          (select gallery_enabled from event_settings order by updated_at desc limit 1) as published
        """
    ) or {}


async def reachability(_args: dict, _ctx: Ctx) -> dict:
    return await db.one(
        """
        select
          (select count(*) from invitations) as total,
          (select count(*) from invitation_contacts) as reachable,
          (select count(*) from invitation_contacts where channel = 'telegram') as telegram,
          (select count(*) from invitation_contacts where channel = 'whatsapp') as whatsapp
        """
    ) or {}


async def search_knowledge(args: dict, _ctx: Ctx) -> dict:
    question = (args.get("question") or "").strip()
    if not question:
        return {"error": "No question given."}
    hits = await knowledge.search(question)
    return {"passages": hits, "count": len(hits)}


# --------------------------------------------------------------------------
# action proposals — recorded on the session, executed only after a confirm
# --------------------------------------------------------------------------
def _propose(ctx: Ctx, pending: dict[str, Any], speak: str) -> dict:
    ctx["session"]["pending"] = pending
    return {"needs_confirmation": True, "draft": speak, "instruction": "Read the draft back and ask them to confirm."}


async def propose_announcement(args: dict, ctx: Ctx) -> dict:
    body = (args.get("body") or "").strip()
    audience = (args.get("audience") or "all").strip()
    if not body:
        return {"error": "No message supplied."}
    reach = await reachability({}, ctx)
    return _propose(
        ctx,
        {"kind": "announcement", "body": body, "audience": audience},
        f'To {reach.get("reachable", 0)} reachable families: {body}',
    )


async def propose_ticket_reply(args: dict, ctx: Ctx) -> dict:
    ticket_id = (args.get("ticket_id") or "").strip()
    message = (args.get("message") or "").strip()
    if not ticket_id or not message:
        return {"error": "Need both a request id and a reply."}
    return _propose(
        ctx,
        {"kind": "ticket_reply", "ticket_id": ticket_id, "message": message},
        f"Reply to request {ticket_id[:8]}: {message}",
    )


async def propose_gallery(args: dict, ctx: Ctx) -> dict:
    enabled = bool(args.get("enabled", True))
    return _propose(
        ctx,
        {"kind": "gallery", "enabled": enabled},
        "Publish the public photo gallery" if enabled else "Take the public photo gallery offline",
    )


async def propose_check_in(args: dict, ctx: Ctx) -> dict:
    code = (args.get("code") or "").strip().upper()
    if not code:
        return {"error": "No invitation code given."}
    return _propose(ctx, {"kind": "check_in", "code": code}, f"Check in the family on pass {code}")


# --------------------------------------------------------------------------
# helpers for the operator tools
# --------------------------------------------------------------------------
async def _lookup_people(query: str) -> list[dict[str, Any]]:
    like = f"%{query}%"
    return await db.rows(
        "select s.name, s.student_id as admission, s.class as class_name, "
        "i.invitation_code as code "
        "from students s join invitations i on i.student_id = s.id "
        "where s.student_id ilike %s or s.name ilike %s "
        "or i.invitation_code ilike %s or s.class ilike %s "
        "order by s.name limit 5",
        (like, like, like, like),
    )


async def _one_person(args: dict) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Resolve exactly one family from a code or a name/admission/class query.

    Never guesses: no match, or several, comes back as an error for the model to
    read out so the organizer can be precise.
    """
    code = str(args.get("code") or "").strip().upper()
    if code:
        found = await db.rows(
            "select s.name, s.student_id as admission, s.class as class_name, "
            "i.invitation_code as code "
            "from students s join invitations i on i.student_id = s.id "
            "where i.invitation_code = %s limit 1",
            (code,),
        )
        if found:
            return found[0], None
        return None, {"error": f"No invitation found for {code}."}
    query = str(args.get("query") or "").strip()
    if not query:
        return None, {"error": "Which family? Give me a name, admission number or code."}
    found = await _lookup_people(query)
    if not found:
        return None, {"error": f"I could not find anyone matching “{query}”."}
    if len(found) > 1:
        return None, {"error": "That matches more than one family — which one?", "candidates": found}
    return found[0], None


async def propose_guest_limit(args: dict, ctx: Ctx) -> dict:
    from assistant import audience

    try:
        limit = int(args.get("limit"))
    except (TypeError, ValueError):
        return {"error": "What guest limit should I set?"}
    if limit < 0 or limit > 100:
        return {"error": "The guest limit must be between 0 and 100."}
    resolved = await audience.resolve(str(args.get("target") or ""))
    if resolved.get("error"):
        return resolved
    label = audience.describe(resolved)
    return _propose(
        ctx,
        {
            "kind": "guest_limit",
            "scope": resolved["scope"],
            "className": resolved.get("className"),
            "limit": limit,
        },
        f"Set the guest limit to {limit} for {label}. Any family already above that is skipped, not broken",
    )


async def propose_send_invitations(args: dict, ctx: Ctx) -> dict:
    from assistant import audience

    resolved = await audience.resolve(str(args.get("target") or ""))
    if resolved.get("error"):
        return resolved
    label = audience.describe(resolved)
    reach = await reachability({}, ctx)
    return _propose(
        ctx,
        {
            "kind": "send_invitations",
            "scope": resolved["scope"],
            "className": resolved.get("className"),
        },
        f"Send invitation passes to {label} — {reach.get('reachable', 0)} families can be reached on chat",
    )


async def propose_create_student(args: dict, ctx: Ctx) -> dict:
    admission = str(args.get("admission") or "").strip()
    name = str(args.get("name") or "").strip()
    class_name = str(args.get("class_name") or "").strip()
    if not admission or not name or not class_name:
        return {"error": "I need the admission number, the full name and the class."}
    limit = args.get("guest_limit")
    return _propose(
        ctx,
        {
            "kind": "create_student",
            "admission": admission,
            "name": name,
            "className": class_name,
            "guestLimit": int(limit) if limit is not None else None,
        },
        f"Add {name}, admission {admission}, class {class_name}. Nothing will be sent",
    )


async def propose_regenerate_pass(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    return _propose(
        ctx,
        {"kind": "regenerate_pass", "code": person["code"]},
        f"Replace {person['name']}'s pass ({person['code']}). The old code and QR stop working immediately",
    )


async def propose_set_invitation_status(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    active = bool(args.get("active", False))
    return _propose(
        ctx,
        {"kind": "invitation_status", "code": person["code"], "active": active},
        f"{'Re-enable' if active else 'Disable'} the pass for {person['name']} ({person['code']})",
    )


async def propose_add_guest(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    guest = str(args.get("guest_name") or "").strip()
    if not guest:
        return {"error": "What is the guest's name?"}
    relationship = str(args.get("relationship") or "").strip() or None
    suffix = f" ({relationship})" if relationship else ""
    return _propose(
        ctx,
        {"kind": "add_guest", "code": person["code"], "name": guest, "relationship": relationship},
        f"Add {guest}{suffix} to {person['name']}'s invitation ({person['code']})",
    )


async def propose_remove_guest(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    guest = str(args.get("guest_name") or "").strip()
    if not guest:
        return {"error": "Which guest should I remove?"}
    return _propose(
        ctx,
        {"kind": "remove_guest", "code": person["code"], "guestName": guest},
        f"Remove {guest} from {person['name']}'s invitation ({person['code']})",
    )


async def propose_rename_guest(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    current = str(args.get("current_name") or "").strip()
    new_name = str(args.get("new_name") or "").strip()
    relationship = str(args.get("relationship") or "").strip()
    if not current or not new_name:
        return {"error": "Tell me which guest to change, and what the name should be."}
    pending: dict[str, Any] = {
        "kind": "rename_guest",
        "code": person["code"],
        "currentName": current,
        "newName": new_name,
    }
    if relationship:
        pending["relationship"] = relationship
    tail = f" as {relationship}" if relationship else ""
    return _propose(
        ctx,
        pending,
        f"Rename {current} to {new_name}{tail} on {person['name']}'s invitation ({person['code']})",
    )


async def propose_check_in_by_name(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    return _propose(
        ctx,
        {"kind": "check_in", "code": person["code"]},
        f"Check in {person['name']}'s guests ({person['code']})",
    )


async def propose_resend_pass(args: dict, ctx: Ctx) -> dict:
    person, err = await _one_person(args)
    if err:
        return err
    return _propose(
        ctx,
        {"kind": "resend_pass", "code": person["code"]},
        f"Send {person['name']}'s invitation pass again ({person['code']})",
    )


# --------------------------------------------------------------------------
# schemas
# --------------------------------------------------------------------------
def _tool(name: str, description: str, properties: dict | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "additionalProperties": False,
            },
        },
    }


TOOL_SCHEMAS: list[dict] = [
    _tool("event_overview", "Event details plus headline numbers: families, guests, replies, expected headcount, arrivals, open requests, reachable families, photos."),
    _tool("briefing", "A full status brief: overview plus what needs attention. Use for 'give me the brief' or 'how are we doing'."),
    _tool("what_needs_attention", "The current problems worth looking at: open requests with their AI summaries, unreachable families, unanswered RSVPs, photos waiting for review, disabled passes."),
    _tool("find_family", "Look up a family by admission number, student name, class or invitation code.", {"query": {"type": "string"}}),
    _tool("list_guests", "List the guests registered on an invitation.", {"code": {"type": "string"}}),
    _tool("checkin_status", "Arrivals: totals, per gate, and the most recent entries."),
    _tool("unchecked_families", "Active families with nobody checked in yet — who still has to arrive. Optionally for one class.", {"class_name": {"type": "string"}, "limit": {"type": "number"}}),
    _tool("rsvp_report", "RSVP totals: attending, declined, awaiting reply, and expected guest count."),
    _tool("class_breakdown", "Per-class headcount, biggest class first: students, how many are coming, and the guests they expect."),
    _tool("open_tickets", "Open support requests with their summaries.", {"limit": {"type": "number"}}),
    _tool("album_status", "Photo album: pending, approved, hidden, and whether the public gallery is published."),
    _tool("reachability", "How many families can be messaged on Telegram or WhatsApp."),
    _tool("search_knowledge", "Search the school's uploaded documents for an answer.", {"question": {"type": "string"}}),
    _tool("propose_announcement", "Propose sending an announcement to families. The organizer must confirm before it sends.", {"body": {"type": "string"}, "audience": {"type": "string"}}),
    _tool("propose_ticket_reply", "Propose replying to a support request. The organizer must confirm.", {"ticket_id": {"type": "string"}, "message": {"type": "string"}}),
    _tool("propose_gallery", "Propose publishing or hiding the public photo gallery. The organizer must confirm.", {"enabled": {"type": "boolean"}}),
    _tool("propose_check_in", "Propose checking in a family at the gate. The organizer must confirm.", {"code": {"type": "string"}}),
    _tool("propose_guest_limit", "Propose changing the guest allowance for everyone, or for one class. `target` is 'everyone' or the class name as the organizer said it; it is matched against the school's real classes.", {"target": {"type": "string"}, "limit": {"type": "number"}}),
    _tool("propose_send_invitations", "Propose bulk-sending invitation passes to everyone or to one class.", {"target": {"type": "string"}}),
    _tool("propose_create_student", "Propose adding a new student and their invitation record. Nothing is ever sent automatically.", {"admission": {"type": "string"}, "name": {"type": "string"}, "class_name": {"type": "string"}, "guest_limit": {"type": "number"}}),
    _tool("propose_regenerate_pass", "Propose replacing a leaked or lost pass. Identify the family by code, name, admission number or class.", {"query": {"type": "string"}}),
    _tool("propose_set_invitation_status", "Propose disabling a pass, or re-enabling one.", {"query": {"type": "string"}, "active": {"type": "boolean"}}),
    _tool("propose_add_guest", "Propose adding a guest to a family's invitation. The database still enforces the guest limit.", {"query": {"type": "string"}, "guest_name": {"type": "string"}, "relationship": {"type": "string"}}),
    _tool("propose_remove_guest", "Propose removing a guest from a family's invitation.", {"query": {"type": "string"}, "guest_name": {"type": "string"}}),
    _tool(
        "propose_rename_guest",
        "Propose changing a guest's name on a family's invitation — use this when the wrong person was registered, such as a parent entered as someone else. Give the name as it is now and what it should become.",
        {
            "query": {"type": "string"},
            "current_name": {"type": "string"},
            "new_name": {"type": "string"},
            "relationship": {"type": "string"},
        },
    ),
    _tool("propose_check_in_by_name", "Propose checking in a family found by name, admission number or class.", {"query": {"type": "string"}}),
    _tool("propose_resend_pass", "Propose re-sending a family's invitation pass to their chat.", {"query": {"type": "string"}}),
]

HANDLERS: dict[str, Handler] = {
    "event_overview": event_overview,
    "briefing": briefing,
    "what_needs_attention": what_needs_attention,
    "find_family": find_family,
    "list_guests": list_guests,
    "checkin_status": checkin_status,
    "unchecked_families": unchecked_families,
    "rsvp_report": rsvp_report,
    "class_breakdown": class_breakdown,
    "open_tickets": open_tickets,
    "album_status": album_status,
    "reachability": reachability,
    "search_knowledge": search_knowledge,
    "propose_announcement": propose_announcement,
    "propose_ticket_reply": propose_ticket_reply,
    "propose_gallery": propose_gallery,
    "propose_check_in": propose_check_in,
    "propose_guest_limit": propose_guest_limit,
    "propose_send_invitations": propose_send_invitations,
    "propose_create_student": propose_create_student,
    "propose_regenerate_pass": propose_regenerate_pass,
    "propose_set_invitation_status": propose_set_invitation_status,
    "propose_add_guest": propose_add_guest,
    "propose_remove_guest": propose_remove_guest,
    "propose_rename_guest": propose_rename_guest,
    "propose_check_in_by_name": propose_check_in_by_name,
    "propose_resend_pass": propose_resend_pass,
}


def label(name: str) -> str:
    return {
        "event_overview": "Reading the event overview",
        "briefing": "Putting the brief together",
        "what_needs_attention": "Checking what needs attention",
        "find_family": "Looking up the family",
        "list_guests": "Reading the guest list",
        "checkin_status": "Checking arrivals",
        "unchecked_families": "Listing who has not arrived",
        "rsvp_report": "Counting RSVPs",
        "class_breakdown": "Breaking it down by class",
        "open_tickets": "Reading support requests",
        "album_status": "Checking the photo album",
        "reachability": "Counting reachable families",
        "search_knowledge": "Searching the school documents",
        "propose_announcement": "Drafting the announcement",
        "propose_ticket_reply": "Drafting the reply",
        "propose_gallery": "Preparing the gallery change",
        "propose_check_in": "Preparing the check-in",
        "propose_guest_limit": "Working out who that covers",
        "propose_send_invitations": "Checking who can be reached",
        "propose_create_student": "Preparing the new student",
        "propose_regenerate_pass": "Preparing a new pass",
        "propose_set_invitation_status": "Preparing the pass change",
        "propose_add_guest": "Preparing the guest",
        "propose_remove_guest": "Preparing the removal",
        "propose_rename_guest": "Correcting the name",
        "propose_check_in_by_name": "Finding the family",
        "propose_resend_pass": "Preparing the resend",
    }.get(name, name)


async def execute(name: str, args: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    handler = HANDLERS.get(name)
    if handler is None:
        return {"error": f"Unknown tool {name}"}
    if ctx.get("emit"):
        await ctx["emit"]({"type": "tool", "name": name, "label": label(name)})
    try:
        return await handler(args, ctx)
    except Exception as exc:  # noqa: BLE001 — never break the turn on one tool
        return {"error": f"{type(exc).__name__}: {exc}"}
