// Everything that changes the event, kept deliberately small.
//
// This tool never writes to Postgres. It signs in as the assistant's own school
// account and asks the website to do the work, so the guest limit stays in a
// database transaction, duplicate check-ins stay refused, and every change is
// stamped in the activity log with the person who caused it. That is the same
// rule Backstage follows: the AI proposes, the website disposes.
//
// Only the five reviewed actions live here. Adding a sixth is a decision, not
// a config change.

import { nextBaseUrl, isLocalSite, assistantCredentials, WEB_TIMEOUT_MS, PROBE_TIMEOUT_MS, LOGIN_TTL_MS, MAX_GUEST_LIMIT, MAX_BULK_CODES } from "./config.mjs";
import { qrTokenForCode } from "./read.mjs";

let _cookie = "";
let _cookieAt = 0;

/** A refusal or a broken connection, phrased for a person rather than a log. */
export class ActionError extends Error {
  constructor(message, { status = 0, hint = "" } = {}) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

/** Sign in with the assistant's own account, so the log names it, not "admin". */
async function login() {
  const { email, password } = assistantCredentials();
  if (!email || !password) {
    throw new ActionError(
      "This assistant has no school account configured, so it cannot change anything yet.",
      { hint: "Add ANKITA_EMAIL and ANKITA_PASSWORD to mcp/.env.local." },
    );
  }
  const res = await request("/api/auth", {
    method: "POST",
    body: { email, password },
    cookie: "",
  });
  const cookie = res.setCookie;
  if (!cookie) {
    throw new ActionError("Signed in, but the website did not return a session.", { status: res.status });
  }
  _cookie = cookie;
  _cookieAt = Date.now();
  return _cookie;
}

async function sessionCookie() {
  if (_cookie && Date.now() - _cookieAt < LOGIN_TTL_MS) return _cookie;
  return login();
}

/**
 * One call to the website. `Host` and `Origin` are set by hand because the
 * website refuses cross-origin writes and a CLI has no origin of its own.
 *
 * A 401 means the remembered session went stale mid-tool; sign in once more
 * and retry the same call exactly once. Retrying twice would risk repeating a
 * change that actually succeeded.
 */
async function request(path, { method = "GET", body, cookie, retried = false } = {}) {
  const base = nextBaseUrl();
  const host = new URL(base).host;
  const headers = { "content-type": "application/json", origin: base, host };
  const useCookie = cookie === undefined ? await sessionCookie() : cookie;
  if (useCookie) headers.cookie = useCookie;

  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e?.name === "TimeoutError" ? "took too long to answer" : "could not be reached";
    throw new ActionError(`The event website ${reason}.`, {
      hint: isLocalSite()
        ? `Nothing is accepting connections at ${base}. Start it with: cd web && npm run build && npm start (or npm run dev). Writes need it running; the reports do not.`
        : `Check that ${base} is up and connected to the database.`,
    });
  }

  if (res.status === 401 && cookie === undefined && !retried) {
    _cookie = "";
    await login();
    return request(path, { method, body, retried: true });
  }

  const setCookie = res.headers.get("set-cookie");
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* a 502/504 may have no JSON body */
  }
  return { status: res.status, ok: res.ok, data, setCookie };
}

/** Unwrap a website reply, turning its error text into a sentence a person can read. */
function ok({ status, ok: good, data }) {
  if (good) return data ?? {};
  const message = typeof data?.error === "string" && data.error ? data.error : `The website refused this (code ${status}).`;
  throw new ActionError(message, {
    status,
    hint:
      status === 403
        ? "The assistant's account may not have permission for this action."
        : status === 404
          ? "Check the invitation code or ticket id."
          : status === 503
            ? "The site is up but its database is not configured, so it cannot change anything."
            : "",
  });
}

/**
 * Is the site ready for changes? Answers before anyone tries a write.
 *
 * Three outcomes matter, and they need different fixes:
 *   - nothing listens on the port        → the site is not running
 *   - the site answers but has no DB     → the site is running without settings
 *   - the site answers with data         → writes will work
 *
 * Without this, a dead site looked like "the change failed" five times over,
 * because each write reported only its own failure.
 */
export async function siteStatus() {
  const base = nextBaseUrl();
  const result = { base, reachable: false, database: false, writable: false, hint: "" };
  try {
    const res = await fetch(`${base}/api/event`, {
      headers: { origin: base, host: new URL(base).host },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    result.reachable = true;
    if (res.status === 200) {
      result.database = true;
      result.writable = true;
      result.hint = "The site is running with its database. Changes will work.";
      return result;
    }
    result.hint =
      res.status === 503
        ? "The site is running, but it has no database settings, so it cannot change anything. Give it the same DATABASE_URL the reports use."
        : `The site answered with code ${res.status}.`;
    return result;
  } catch (e) {
    result.hint = isLocalSite()
      ? `Nothing is listening at ${base}. Start it: cd web && npm run build && npm start (build once, then start is instant). Reports still work without it.`
      : `${base} could not be reached. Reports still work; changes cannot.`;
    return result;
  }
}

/** Mark a family as arrived, by invitation code. */
export async function checkInFamily(code) {
  const token = await qrTokenForCode(code);
  if (!token) {
    throw new ActionError(`No family has the code ${code}.`, { status: 404 });
  }
  const reply = ok(
    await request("/api/check-in", { method: "POST", body: { qrToken: token } }),
  );
  return {
    checkedIn: true,
    invitationCode: reply.invitationCode ?? code,
    at: reply.at ?? null,
  };
}

/** Change how many people one family may bring. */
export async function setGuestLimit(code, limit) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_GUEST_LIMIT) {
    throw new ActionError(`The guest limit must be a whole number from 0 to ${MAX_GUEST_LIMIT}.`);
  }
  const reply = ok(
    await request("/api/admin", { method: "PATCH", body: { code, guestLimit: limit } }),
  );
  return {
    invitationCode: reply.invitation?.invitationCode ?? code,
    guestLimit: reply.invitation?.guestLimit ?? limit,
  };
}

/**
 * Change the guest limit for a whole class, or for everyone, in ONE request.
 *
 * The website already resolves "everyone" or a class name from the roster
 * itself and applies the change in a single transaction. Looping one family at
 * a time was both slow (468 round trips) and wrong for a live event: a change
 * that stops halfway leaves half the school at a different limit.
 *
 * Families whose new limit would fall below what they already registered or
 * checked in are skipped by the website's own guard, never lowered silently;
 * this returns them so the answer can name them.
 */
export async function setGuestLimitBulk({ limit, className, all = false, codes }) {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_GUEST_LIMIT) {
    throw new ActionError(`The guest limit must be a whole number from 0 to ${MAX_GUEST_LIMIT}.`);
  }
  const body = { guestLimit: limit };
  if (Array.isArray(codes) && codes.length) {
    if (codes.length > MAX_BULK_CODES) {
      throw new ActionError(`That is ${codes.length} families; at most ${MAX_BULK_CODES} can change at once.`);
    }
    body.codes = codes;
  } else if (typeof className === "string" && className.trim()) {
    body.className = className.trim();
  } else if (all) {
    body.audience = "all";
  } else {
    throw new ActionError("Say whether this is for everyone, one class, or a list of codes.");
  }
  const reply = ok(await request("/api/admin", { method: "PATCH", body }));
  const updated = Number(reply.invitation?.updated ?? 0);
  const skipped = Array.isArray(reply.invitation?.skipped) ? reply.invitation.skipped : [];
  return {
    guestLimit: limit,
    scope: body.codes ? "codes" : body.className ? body.className : "everyone",
    updated,
    skipped: skipped.length,
    skippedCodes: skipped.slice(0, 20),
  };
}
/** Send one message to a class, or to everyone. */
export async function sendAnnouncement({ message, audience = "all" }) {
  const reply = ok(
    await request("/api/announcements", {
      method: "POST",
      // "send" fires immediately; the website keeps draining the rest.
      body: { body: message, audience, action: "send" },
    }),
  );
  return {
    sent: reply.announcement?.sent ?? reply.result?.sent ?? 0,
    failed: reply.announcement?.failed ?? reply.result?.failed ?? 0,
    announcementId: reply.announcement?.id ?? null,
  };
}

/** Answer a family's support message in their chat. */
export async function replyToTicket(ticketId, message) {
  const reply = ok(
    await request("/api/tickets", {
      method: "PATCH",
      body: { id: ticketId, action: "reply", message },
    }),
  );
  return { delivered: Boolean(reply.delivered), ticketId };
}

/** Turn the public photo gallery on or off. */
export async function setGallery(enabled) {
  const reply = ok(
    await request("/api/album", { method: "PATCH", body: { galleryEnabled: enabled } }),
  );
  return { galleryEnabled: Boolean(reply.galleryEnabled) };
}
