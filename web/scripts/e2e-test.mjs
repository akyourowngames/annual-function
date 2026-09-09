// E2E test: hits the running dev server's APIs end to end.
const BASE = "http://localhost:3000";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

// resolve test invitation from DB directly
import { fileURLToPath } from "node:url";
const { config } = await import("dotenv");
config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)) });
const postgres = (await import("postgres")).default;
const sql = postgres(process.env.DATABASE_URL);

// --- reset state created by previous runs so the test is repeatable ---
await sql`delete from check_ins where invitation_id in (
  select i.id from invitations i join students s on s.id = i.student_id
  where s.student_id in ('10234', '99999'))`;
await sql`delete from guests where invitation_id in (
  select i.id from invitations i join students s on s.id = i.student_id
  where s.student_id in ('10234', '99999'))`;
await sql`delete from support_tickets where student_id in (
  select id from students where student_id in ('10234', '99999'))`;
await sql`delete from invitations where student_id in (
  select id from students where student_id = '99999')`;
await sql`delete from students where student_id = '99999'`;

const row = (
  await sql`select i.invitation_code AS code, i.qr_token AS token, i.guest_limit AS lim
            from invitations i join students s on s.id = i.student_id
            where s.student_id = '10234'`
)[0];
await sql.end();
console.log("test invitation:", row.code, "limit", row.lim);

let failures = 0;
function check(label, cond, detail) {
  console.log(cond ? `PASS  ${label}` : `FAIL  ${label} -> ${detail}`);
  if (!cond) failures++;
}

// 1. invitation lookup
let r = await api("GET", `/api/invitations?code=${row.code}`);
check("GET /api/invitations", r.status === 200 && r.json.invitation.code === row.code, JSON.stringify(r));
check("remaining starts at limit", r.json?.remaining === row.lim, `remaining=${r.json?.remaining}`);

// 2. register guest 1
r = await api("POST", "/api/guests", { code: row.code, name: "Guest One", relationship: "parent" });
check("POST guest 1", r.status === 201 && r.json.remaining === row.lim - 1, JSON.stringify(r));

// 3. register guest 2 (fills limit=2)
r = await api("POST", "/api/guests", { code: row.code, name: "Guest Two", relationship: "sibling" });
check("POST guest 2 (fills limit)", r.status === 201 && r.json.remaining === 0, JSON.stringify(r));

// 4. THE RULE: third guest must be blocked
r = await api("POST", "/api/guests", { code: row.code, name: "Guest Three" });
check("POST guest 3 blocked by limit", r.status === 409 && String(r.json?.error).startsWith("Guest limit reached"), JSON.stringify(r));

// 5. guests list
r = await api("GET", `/api/guests?code=${row.code}`);
check("GET /api/guests lists 2", r.status === 200 && r.json.guests.length === 2, JSON.stringify(r.json?.guests?.length));

// 6. check-in by QR
r = await api("POST", "/api/check-in", { qrToken: row.token, checkedInBy: "gate-A" });
check("POST /api/check-in", r.status === 201 && r.json.checkedIn === true, JSON.stringify(r));

// 7. QR lookup
r = await api("GET", `/api/check-in?qrToken=${row.token}`);
check("GET /api/check-in", r.status === 200 && r.json.valid === true && r.json.checkIns >= 1, JSON.stringify(r));

// 8. bad QR rejected
r = await api("GET", "/api/check-in?qrToken=not-a-token");
check("bad QR rejected 404", r.status === 404, JSON.stringify(r));

// 9. ticket create + list
r = await api("POST", "/api/tickets", { studentId: "10234", category: "passes", description: "Need one extra guest pass" });
check("POST /api/tickets", r.status === 201, JSON.stringify(r));
r = await api("GET", "/api/tickets?studentId=10234");
check("GET /api/tickets", r.status === 200 && r.json.tickets.length >= 1, JSON.stringify(r.json?.tickets?.length));

// 10. admin create student + invitation (idempotent second call)
r = await api("POST", "/api/invitations", { studentId: "99999", name: "Test Kid", className: "12-C", guestLimit: 1 });
check("POST /api/invitations create", r.status === 201 && r.json.created === true, JSON.stringify(r));
r = await api("POST", "/api/invitations", { studentId: "99999", name: "Test Kid" });
check("POST /api/invitations idempotent", r.status === 200 && r.json.created === false, JSON.stringify(r));

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
