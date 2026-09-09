// Seed fake students + invitations for testing the invitation flow.
// Idempotent: safe to run repeatedly (ON CONFLICT DO NOTHING).
import { config } from "dotenv";
config({ path: ".env.local" });

const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL);

// guestLimit 2 on the first student so the limit block can be tested easily.
const seedStudents = [
  { studentId: "10234", name: "Anu Sharma", className: "10-A", guestLimit: 2 },
  { studentId: "10235", name: "Rahul Verma", className: "10-A", guestLimit: 4 },
  { studentId: "10236", name: "Priya Singh", className: "10-B", guestLimit: 4 },
  { studentId: "10237", name: "Arjun Patel", className: "11-A", guestLimit: 3 },
  { studentId: "10238", name: "Sneha Gupta", className: "11-B", guestLimit: 4 },
];

try {
  for (const s of seedStudents) {
    await sql`
      INSERT INTO students (student_id, name, class)
      VALUES (${s.studentId}, ${s.name}, ${s.className})
      ON CONFLICT (student_id) DO NOTHING
    `;
    const rows = await sql`
      SELECT id FROM students WHERE student_id = ${s.studentId} LIMIT 1
    `;
    const student = rows[0];
    if (!student) throw new Error(`seed: student ${s.studentId} missing after insert`);

    await sql`
      INSERT INTO invitations (student_id, invitation_code, qr_token, guest_limit)
      VALUES (
        ${student.id},
        ${"ANL-" + s.studentId.slice(-4) + String.fromCharCode(65 + (Number(s.studentId) % 26)) + String.fromCharCode(74 + (Number(s.studentId) % 13))},
        ${"qrseed" + s.studentId + "0123456789abcdef"},
        ${s.guestLimit}
      )
      ON CONFLICT (student_id) DO NOTHING
    `;
    console.log(`seeded: ${s.studentId} ${s.name} (limit ${s.guestLimit})`);
  }

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
