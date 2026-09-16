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
    rows = await db.rows(
        """
        select coalesce(s.class, 'Unassigned') as class_name,
               count(*) as families,
               count(*) filter (where i.rsvp_status = 'attending') as attending,
               coalesce(sum(i.rsvp_guests) filter (where i.rsvp_status = 'attending'), 0) as expected
        from invitations i join students s on s.id = i.student_id
        group by 1 order by expected desc
        """
    )
    return {"classes": rows}


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
    _tool("rsvp_report", "RSVP totals: attending, declined, awaiting reply, and expected guest count."),
    _tool("class_breakdown", "Per-class participation: families, attending, expected guests."),
    _tool("open_tickets", "Open support requests with their summaries.", {"limit": {"type": "number"}}),
    _tool("album_status", "Photo album: pending, approved, hidden, and whether the public gallery is published."),
    _tool("reachability", "How many families can be messaged on Telegram or WhatsApp."),
    _tool("search_knowledge", "Search the school's uploaded documents for an answer.", {"question": {"type": "string"}}),
    _tool("propose_announcement", "Propose sending an announcement to families. The organizer must confirm before it sends.", {"body": {"type": "string"}, "audience": {"type": "string"}}),
    _tool("propose_ticket_reply", "Propose replying to a support request. The organizer must confirm.", {"ticket_id": {"type": "string"}, "message": {"type": "string"}}),
    _tool("propose_gallery", "Propose publishing or hiding the public photo gallery. The organizer must confirm.", {"enabled": {"type": "boolean"}}),
    _tool("propose_check_in", "Propose checking in a family at the gate. The organizer must confirm.", {"code": {"type": "string"}}),
]

HANDLERS: dict[str, Handler] = {
    "event_overview": event_overview,
    "briefing": briefing,
    "what_needs_attention": what_needs_attention,
    "find_family": find_family,
    "list_guests": list_guests,
    "checkin_status": checkin_status,
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
}


def label(name: str) -> str:
    return {
        "event_overview": "Reading the event overview",
        "briefing": "Putting the brief together",
        "what_needs_attention": "Checking what needs attention",
        "find_family": "Looking up the family",
        "list_guests": "Reading the guest list",
        "checkin_status": "Checking arrivals",
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
