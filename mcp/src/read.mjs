// Reporting queries. Read-only by construction: there is no INSERT, UPDATE or
// DELETE in this file, so a reporting tool can never change the event.
//
// Every function takes plain values and returns plain rows, because that is
// what the model is given to phrase an answer from.
//
// Column names follow web/lib/db/schema.ts exactly: the class is `students.class`,
// RSVP is `rsvp_status` (pending | attending | declined) with `rsvp_guests`.
// Getting one of these wrong must fail loudly, not quietly return zero.

import { sql } from "./db.mjs";
import {
  DEFAULT_REPORT_ROWS,
  MAX_REPORT_ROWS,
  DEFAULT_ACTIVITY_HOURS,
  MAX_ACTIVITY_HOURS,
} from "./config.mjs";

/** Whole numbers only, within [min,max]; anything unreadable becomes `fallback`. */
export function bounded(value, { min = 1, max = MAX_REPORT_ROWS, fallback = DEFAULT_REPORT_ROWS } = {}) {
  // An empty or missing count means "not asked for", not "zero" — and
  // `Number("")` is 0, so this case has to be handled before the conversion.
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (text === "") return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  const whole = Math.trunc(n);
  if (whole < min) return min;
  if (whole > max) return max;
  return whole;
}

export function activityHours(value) {
  return bounded(value, { min: 1, max: MAX_ACTIVITY_HOURS, fallback: DEFAULT_ACTIVITY_HOURS });
}

/** Families, registered guests and how many are inside right now. */
export async function eventOverview() {
  const db = sql();
  const [row] = await db`
    select
      (select count(*)::int from invitations)                           as invitations,
      (select count(*)::int from invitations where status = 'active')   as active_invitations,
      (select count(*)::int from guests)                                as guests,
      (select count(distinct invitation_id)::int from check_ins)        as families_inside,
      (select count(*)::int from check_ins)                             as entries_inside,
      (select count(*)::int from invitations i
        where not exists (select 1 from check_ins c
                          where c.invitation_id = i.id))                as families_not_arrived
  `;
  return row;
}

/**
 * The activity log: who did what, newest first.
 *
 * Filters are optional and combine. `actor` matches the actor type or id, so
 * "gate" and "ankita" both work without the caller knowing the column layout.
 */
export async function whoDidWhat({ hours, actor, action, limit } = {}) {
  const db = sql();
  const windowHours = activityHours(hours);
  const rows = bounded(limit);
  const actorFilter = (actor ?? "").trim();
  const actionFilter = (action ?? "").trim();
  return db`
    select at, actor_type, actor_id, action, invitation_code, detail
    from security_audit_log
    where at >= now() - make_interval(hours => ${windowHours})
      ${actorFilter ? db`and (actor_type = ${actorFilter} or actor_id ilike ${"%" + actorFilter + "%"})` : db``}
      ${actionFilter ? db`and action ilike ${"%" + actionFilter + "%"}` : db``}
    order by at desc
    limit ${rows}
  `;
}

/** The latest admissions at the gate, newest first. */
export async function recentCheckIns({ limit } = {}) {
  const db = sql();
  return db`
    select
      c.checked_in_at as at,
      c.gate,
      c.checked_in_by,
      i.invitation_code,
      s.name      as student_name,
      s.class     as class_name,
      g.name      as guest_name
    from check_ins c
    join invitations i on i.id = c.invitation_id
    join students    s on s.id = i.student_id
    left join guests g on g.id = c.guest_id
    order by c.checked_in_at desc
    limit ${bounded(limit)}
  `;
}

/** Families on the list who have not been checked in yet. */
export async function uncheckedFamilies({ limit, className } = {}) {
  const db = sql();
  const cls = (className ?? "").trim();
  return db`
    select i.invitation_code, s.name as student_name, s.class as class_name, i.guest_limit,
           (select count(*)::int from guests g where g.invitation_id = i.id) as registered_guests
    from invitations i
    join students s on s.id = i.student_id
    where not exists (select 1 from check_ins c where c.invitation_id = i.id)
      ${cls ? db`and lower(trim(coalesce(s.class, ''))) = lower(trim(${cls}))` : db``}
    order by s.class, s.name
    limit ${bounded(limit)}
  `;
}

/** Headcount per class: families, registered guests, and people inside. */
export async function attendanceByClass() {
  const db = sql();
  return db`
    select
      s.class                                  as class_name,
      count(distinct i.id)::int                as families,
      count(distinct g.id)::int                as registered_guests,
      count(c.id)::int                         as entries_inside
    from students s
    join invitations i on i.student_id = s.id
    left join guests g on g.invitation_id = i.id
    left join check_ins c on c.invitation_id = i.id
    group by s.class
    order by s.class nulls last
  `;
}

/** RSVP answers: how many said yes, and the expected headcount. */
export async function rsvpReport({ limit } = {}) {
  const db = sql();
  const rows = await db`
    select
      i.invitation_code, s.name as student_name, s.class as class_name,
      i.rsvp_status, i.rsvp_guests
    from invitations i
    join students s on s.id = i.student_id
    where i.rsvp_status <> 'pending'
    order by i.rsvp_status, s.class, s.name
    limit ${bounded(limit, { fallback: MAX_REPORT_ROWS })}
  `;
  const [summary] = await db`
    select
      count(*) filter (where rsvp_status = 'attending')::int as attending,
      count(*) filter (where rsvp_status = 'declined')::int  as declined,
      count(*) filter (where rsvp_status = 'pending')::int   as waiting,
      coalesce(sum(rsvp_guests) filter (where rsvp_status = 'attending'), 0)::int as expected_people
    from invitations
  `;
  return { summary, rows };
}

/**
 * The QR token for an invitation code. Needed only so `check_in_family` can
 * call the website's scanner, which works by token, not by code.
 * Returns null when the code is unknown; never leaks other fields.
 */
export async function qrTokenForCode(code) {
  const db = sql();
  const rows = await db`
    select qr_token from invitations where invitation_code = ${code} limit 1
  `;
  return rows[0]?.qr_token ?? null;
}

/**
 * Families that a limit change would move, before it happens.
 *
 * "How many will actually change, and who gets skipped?" is the question that
 * makes a bulk edit safe to approve, so it is answerable without making the
 * edit. A family is skipped when the new limit is below what it already
 * registered or checked in.
 */
export async function guestLimitPreview({ limit, className, all = false } = {}) {
  const db = sql();
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("Choose a whole-number guest limit first.");
  }
  const cls = (className ?? "").trim();
  const before = await db`
    select
      count(*)::int as families,
      count(*) filter (where s.class is not null)::int as with_class,
      min(i.guest_limit)::int as lowest_now,
      max(i.guest_limit)::int as highest_now
    from invitations i join students s on s.id = i.student_id
    ${cls ? db`where lower(trim(coalesce(s.class, ''))) = lower(trim(${cls}))` : db``}
  `;
  const skip = await db`
    select i.invitation_code, s.name as student_name, s.class as class_name,
           i.guest_limit,
           (select count(*)::int from guests g where g.invitation_id = i.id) as registered_guests,
           (select count(*)::int from check_ins c where c.invitation_id = i.id) as check_ins
    from invitations i join students s on s.id = i.student_id
    where (select count(*) from guests g where g.invitation_id = i.id) > ${limit}
       or (select count(*) from check_ins c where c.invitation_id = i.id) > ${limit}
      ${cls ? db`and lower(trim(coalesce(s.class, ''))) = lower(trim(${cls}))` : db``}
    order by s.class, s.name
    limit ${MAX_REPORT_ROWS}
  `;
  const summary = before[0] ?? { families: 0 };
  return {
    target: cls || (all ? "everyone" : "not chosen"),
    newLimit: limit,
    families: summary.families,
    currentLimits: { lowest: summary.lowest_now, highest: summary.highest_now },
    willChange: Math.max(0, summary.families - skip.length),
    willBeSkipped: skip.length,
    skipped: skip,
  };
}

/** Support tickets waiting for a reply, newest first. */
export async function openTickets({ limit, status } = {}) {
  const db = sql();
  const wanted = (status ?? "").trim();
  return db`
    select t.id, t.status, t.category, t.description, t.suggested_reply,
           t.invitation_code, t.created_at,
           s.name as student_name, s.class as class_name
    from support_tickets t
    left join students s on s.id = t.student_id
    where ${wanted ? db`t.status = ${wanted}` : db`t.status <> 'resolved'`}
    order by t.created_at desc
    limit ${bounded(limit)}
  `;
}

/** Recent announcements, and whether each one actually went out. */
export async function recentAnnouncements({ limit } = {}) {
  const db = sql();
  return db`
    select a.id, a.title, a.audience, a.status, a.sent_at, a.created_at,
           (select count(*)::int from deliveries d where d.announcement_id = a.id) as deliveries,
           (select count(*)::int from deliveries d
             where d.announcement_id = a.id and d.sent_at is not null) as delivered
    from announcements a
    order by a.created_at desc
    limit ${bounded(limit)}
  `;
}
