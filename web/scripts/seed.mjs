// Seed event settings for testing. Student invitations are now imported from
// the real roster — see scripts/import-students.mjs. Do NOT re-add demo
// students here: the real roster owns the students table, and seed records
// would collide with admission numbers as fake data.
import { config } from "dotenv";
config({ path: ".env.local" });

const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL);

try {
  const esCount = await sql`SELECT count(*)::int AS n FROM event_settings`;
  if (esCount[0].n === 0) {
    await sql`
      INSERT INTO event_settings
        (event_name, event_date, start_time, venue, dress_code, parking_info, entry_info)
      VALUES
        ('Annual Function 2026', '2026-12-19', '5:00 PM',
         'School Main Auditorium', 'Formal / Ethnic',
         'Gate 2 parking lot, free for guests',
         'Enter via Gate 1 with invitation QR')
    `;
    console.log("seeded: event_settings");
  }

  const totals = await sql`
    SELECT
      (SELECT count(*)::int FROM students) AS students,
      (SELECT count(*)::int FROM invitations) AS invitations
  `;
  console.log("totals:", totals[0]);
} finally {
  await sql.end();
}
