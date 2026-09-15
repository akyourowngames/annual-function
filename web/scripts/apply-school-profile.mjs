import { config } from "dotenv";
import postgres from "postgres";
import { SCHOOL_LANDING } from "../lib/landing.ts";
config({ path: ".env.local", quiet: true });

// Applies the school's real profile: event settings + published landing content.
// Idempotent — safe to re-run. Date, time, dress and access details are left
// blank for the office to fill in the staff workspace.
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
try {
  const rows = await sql`select id from event_settings order by updated_at desc limit 1`;
  const json = sql.json(SCHOOL_LANDING);
  if (rows.length) {
    await sql`
      update event_settings set
        event_name = 'Annual Function 2026',
        event_date = null,
        start_time = null,
        venue = 'School Ground',
        dress_code = null,
        parking_info = null,
        entry_info = null,
        landing_content = ${json},
        updated_at = now()
      where id = ${rows[0].id}`;
    console.log("updated event_settings row");
  } else {
    await sql`
      insert into event_settings
        (event_name, venue, landing_content)
      values ('Annual Function 2026', 'School Ground', ${json})`;
    console.log("inserted event_settings row");
  }
  const check = await sql`
    select event_name, venue, event_date,
           (landing_content->>'schoolName') as school,
           (landing_content->>'isDemo') as is_demo
    from event_settings order by updated_at desc limit 1`;
  console.log("now:", JSON.stringify(check[0]));
} finally {
  await sql.end({ timeout: 2 });
}
