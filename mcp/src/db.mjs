// Read-only access to the event database.
//
// Reports (who did what, who is inside, who has not arrived) are answered
// straight from Postgres because the activity log has no public page and a
// direct SELECT is the cheapest, fastest path. Every function here only ever
// reads. Writes go through the website instead — see write.mjs.
//
// The connection is opened lazily so `--test` and a missing DATABASE_URL do not
// crash the server on startup; a tool that needs data reports the problem in
// plain words instead.

import postgres from "postgres";
import { databaseUrl } from "./config.mjs";

let _sql = null;

export function sql() {
  if (_sql) return _sql;
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the event database connection string to mcp/.env.local.",
    );
  }
  // Supabase's transaction pooler does not keep named prepared statements.
  // `max` small: this server answers one question at a time for one operator.
  _sql = postgres(url, { prepare: false, max: 4 });
  return _sql;
}

export async function closeDb() {
  if (_sql) {
    const conn = _sql;
    _sql = null;
    await conn.end({ timeout: 2 });
  }
}
