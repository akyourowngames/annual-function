// Every setting this server reads, named, with its unit and its why.
//
// Nothing here has a bare number in the code that uses it, so an operator can
// change behaviour from `.env.local` without editing a file.

/** Read once at startup; the process is short-lived and owned by the assistant. */
export const env = (name) => (process.env[name] || "").trim();

// --- where the event lives ----------------------------------------------

/**
 * The website this tool talks to for anything that changes data.
 *
 * Writes go over HTTP on purpose: the website owns the rules (guest limits,
 * duplicate check-ins, audit rows), so an assistant and a person pressing the
 * same button behave identically. Reading is direct, which is why
 * DATABASE_URL is also needed.
 *
 * `NEXTJS_BASE_URL` must point at a site that is actually serving with a
 * database. A site that is reachable but returns 503 has no DB configured and
 * cannot change anything either, so `site_status` checks more than the socket.
 */
export function nextBaseUrl() {
  const value = env("NEXTJS_BASE_URL") || "http://127.0.0.1:3000";
  return value.replace(/\/+$/, "");
}

/** True when this tool is expected to talk to a site on this machine. */
export function isLocalSite() {
  try {
    const host = new URL(nextBaseUrl()).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

/** How long to wait when only asking "are you there?"; a live check must be quick. */
export const PROBE_TIMEOUT_MS = 5_000;

export function databaseUrl() {
  return env("DATABASE_URL");
}

// --- the assistant's own identity ---------------------------------------

/**
 * The school account the log should name for anything this tool changes.
 *
 * A real account (not the shared access key) is what makes "who did what"
 * mean a person. Credentials live in `.env.local` on the operator's machine
 * and are never written to the log.
 */
export function assistantCredentials() {
  return {
    email: env("ANKITA_EMAIL"),
    password: env("ANKITA_PASSWORD"),
  };
}

// --- limits -------------------------------------------------------------

/**
 * Rows per report page. A report that dumps thousands of rows is unusable in
 * chat and slow to generate, so the model is told about this cap and the query
 * enforces it.
 */
export const MAX_REPORT_ROWS = 200;
export const DEFAULT_REPORT_ROWS = 25;

/** Hours of activity a report looks back by default. A shift's worth. */
export const DEFAULT_ACTIVITY_HOURS = 1;
export const MAX_ACTIVITY_HOURS = 24 * 90;

/** Longest announcement accepted, matching the website's own 2,000-char rule. */
export const MAX_ANNOUNCEMENT_CHARS = 2000;

/** Highest guest limit accepted, matching the website's own ceiling of 100. */
export const MAX_GUEST_LIMIT = 100;

/**
 * Most invitations one bulk change may touch. Matches the website's own cap in
 * `app/api/admin/route.ts`; a larger set is refused there, so refusing here
 * first gives a clearer sentence.
 */
export const MAX_BULK_CODES = 1000;

/**
 * HTTP timeout per call to the website. A healthy local call finishes in tens
 * of milliseconds and a Vercel one in under two seconds; a minute means the
 * network is broken and the tool should say so rather than hang the chat.
 */
export const WEB_TIMEOUT_MS = 60_000;

/** A stale login is refreshed after this long instead of on every call. */
export const LOGIN_TTL_MS = 10 * 60_000;
