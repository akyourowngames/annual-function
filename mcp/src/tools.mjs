// The tools this server offers, and the labels that decide whether the
// assistant asks before running one.
//
// The labels are the safety mechanism, not decoration. Ankita's approval gate
// reads `annotations.readOnlyHint`: a read-only tool may run on its own, and
// anything else is shown to the operator first. So every reporter below is
// marked read-only, and every doer is deliberately NOT marked read-only — with
// `destructiveHint: true` on the ones whose effect other people can see (a sent
// message, a published photo). Getting a label wrong makes a write look free.

import {
  MAX_REPORT_ROWS,
  DEFAULT_REPORT_ROWS,
  DEFAULT_ACTIVITY_HOURS,
  MAX_ACTIVITY_HOURS,
  MAX_ANNOUNCEMENT_CHARS,
  MAX_GUEST_LIMIT,
  MAX_BULK_CODES,
} from "./config.mjs";

const count = {
  type: "integer",
  minimum: 1,
  maximum: MAX_REPORT_ROWS,
  description: `How many rows to return (1–${MAX_REPORT_ROWS}, default ${DEFAULT_REPORT_ROWS}).`,
};

const readOnly = (description, inputSchema, fn) => ({
  description,
  inputSchema,
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: fn,
});

const write = ({ description, inputSchema, fn, destructive = false, idempotent = false }) => ({
  description,
  inputSchema,
  annotations: { readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent },
  run: fn,
});

export function buildTools({ read, write: act }) {
  return {
    // --- reporters: safe to run any time --------------------------------

    event_overview: readOnly(
      "How big the function is right now: how many families have a pass, how many guests are registered, how many families are inside, and how many have not arrived. Use this for 'how are we doing' questions.",
      { type: "object", properties: {}, additionalProperties: false },
      () => read.eventOverview(),
    ),

    who_did_what: readOnly(
      "The activity log, newest first: who did what, when, and which family it touched. Use this for 'what happened', 'who changed X', 'what did Ankita do', or any audit question. Times are the database's own clock.",
      {
        type: "object",
        properties: {
          hours: {
            type: "integer",
            minimum: 1,
            maximum: MAX_ACTIVITY_HOURS,
            description: `How far back to look, in hours (default ${DEFAULT_ACTIVITY_HOURS}).`,
          },
          actor: { type: "string", description: "Only lines by this kind of person or id, e.g. 'gate', 'staff', 'ankita'." },
          action: { type: "string", description: "Only lines whose action contains this, e.g. 'check_in' or 'guest'." },
          limit: count,
        },
        additionalProperties: false,
      },
      (args) => read.whoDidWhat(args),
    ),

    recent_checkins: readOnly(
      "The last people let in at the gate, newest first, with their class and gate. Use for 'who just came in'.",
      { type: "object", properties: { limit: count }, additionalProperties: false },
      (args) => read.recentCheckIns(args),
    ),

    unchecked_families: readOnly(
      "Families on the list who have not arrived yet. Optionally narrow to one class. Use for 'who is missing' or 'who hasn't come'.",
      {
        type: "object",
        properties: {
          className: { type: "string", description: "Restrict to one class, e.g. '5TH DAISY'. Leave out for everyone." },
          limit: count,
        },
        additionalProperties: false,
      },
      (args) => read.uncheckedFamilies(args),
    ),

    attendance_by_class: readOnly(
      "Headcount per class: families, registered guests, and how many entries are inside. Use for class-by-class comparisons.",
      { type: "object", properties: {}, additionalProperties: false },
      () => read.attendanceByClass(),
    ),

    rsvp_report: readOnly(
      "Who said they are coming and who said no, plus the expected headcount. Use for 'how many are we expecting'.",
      { type: "object", properties: { limit: count }, additionalProperties: false },
      (args) => read.rsvpReport(args),
    ),

    site_status: readOnly(
      "Whether the website that carries out changes is awake. Call this BEFORE any change if a previous change failed, or if the operator says the site was restarted. Reads never need it.",
      { type: "object", properties: {}, additionalProperties: false },
      () => act.siteStatus(),
    ),

    guest_limit_preview: readOnly(
      "What a guest-limit change would actually do, without doing it: how many families change and which ones get skipped. Use this to answer 'what happens if I lower it' or before a bulk change.",
      {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 0, maximum: MAX_GUEST_LIMIT, description: "The limit you are considering." },
          className: { type: "string", description: "Restrict to one class. Leave out for everyone." },
          all: { type: "boolean", description: "true means the whole school." },
        },
        required: ["limit"],
        additionalProperties: false,
      },
      (args) => read.guestLimitPreview(args),
    ),

    open_tickets: readOnly(
      "Support messages from families that are not resolved yet, newest first. Use for 'what are people asking' or before replying.",
      {
        type: "object",
        properties: {
          status: { type: "string", description: "Only this status: pending, in_progress or resolved. Leave out for all open ones." },
          limit: count,
        },
        additionalProperties: false,
      },
      (args) => read.openTickets(args),
    ),

    recent_announcements: readOnly(
      "Recent announcements and whether each one actually went out (how many were delivered). Use for 'did the message send'.",
      { type: "object", properties: { limit: count }, additionalProperties: false },
      (args) => read.recentAnnouncements(args),
    ),

    // --- doers: the assistant must ask the operator before running ------

    check_in_family: write({
      description:
        "Mark a family as arrived, using their invitation code. Refused if they are already inside or the pass is disabled. Ask the operator before running this.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The invitation code, e.g. 'ANL-8F29K'." },
        },
        required: ["code"],
        additionalProperties: false,
      },
      fn: ({ code }) => act.checkInFamily(code),
      idempotent: true,
    }),

    set_guest_limit: write({
      description: `Change how many guests ONE family may bring (0–${MAX_GUEST_LIMIT}). Refused if the new limit is below what they already registered or checked in. For a class or the whole school, use set_guest_limit_bulk instead — one request, not hundreds.`,
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The invitation code." },
          limit: { type: "integer", minimum: 0, maximum: MAX_GUEST_LIMIT, description: "The new guest limit." },
        },
        required: ["code", "limit"],
        additionalProperties: false,
      },
      fn: ({ code, limit }) => act.setGuestLimit(code, limit),
      idempotent: true,
    }),

    set_guest_limit_bulk: write({
      description: `Change the guest limit for a whole class or for everyone in ONE request (0–${MAX_GUEST_LIMIT}). Families already holding more guests than the new limit are skipped by the website and reported back, never lowered silently. Prefer this over calling set_guest_limit repeatedly; a loop over hundreds of families stops halfway if anything fails.`,
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 0, maximum: MAX_GUEST_LIMIT, description: "The new guest limit." },
          className: { type: "string", description: "One class, e.g. '5TH DAISY'. Matched against the real roster." },
          all: { type: "boolean", description: "true changes every family in the school." },
          codes: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_BULK_CODES,
            description: "An explicit list of invitation codes, instead of a class or everyone.",
          },
        },
        required: ["limit"],
        additionalProperties: false,
      },
      fn: (args) => act.setGuestLimitBulk(args),
      idempotent: true,
    }),

    send_announcement: write({
      description: `Send one message now to a class or to everyone. Other people see it, so always read it back and get a yes first. Max ${MAX_ANNOUNCEMENT_CHARS} characters.`,
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", minLength: 1, maxLength: MAX_ANNOUNCEMENT_CHARS, description: "The exact words to send." },
          audience: { type: "string", description: "'all' for everyone, or a class name like '5TH DAISY'." },
        },
        required: ["message"],
        additionalProperties: false,
      },
      fn: ({ message, audience }) => act.sendAnnouncement({ message, audience }),
      destructive: true,
    }),

    reply_to_ticket: write({
      description:
        "Send a reply to a family's support message, in their own chat, and mark it resolved. The family sees it — read it back first.",
      inputSchema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "The support ticket id." },
          message: { type: "string", minLength: 1, maxLength: MAX_ANNOUNCEMENT_CHARS, description: "The exact reply to send." },
        },
        required: ["ticketId", "message"],
        additionalProperties: false,
      },
      fn: ({ ticketId, message }) => act.replyToTicket(ticketId, message),
      destructive: true,
    }),

    set_gallery: write({
      description:
        "Show or hide the public photo gallery. Hiding removes it from anyone who is not signed in. Ask before running this.",
      inputSchema: {
        type: "object",
        properties: { enabled: { type: "boolean", description: "true shows the gallery, false hides it." } },
        required: ["enabled"],
        additionalProperties: false,
      },
      fn: ({ enabled }) => act.setGallery(enabled),
      idempotent: true,
    }),
  };
}

/** The MCP tool list, with `run` stripped, in a stable order. */
export function toolList(tools) {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}
