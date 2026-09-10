import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";
import { chromium } from "@playwright/test";
config({ path: ".env.local", quiet: true });
const port = 3101,
  base = `http://127.0.0.1:${port}`,
  key = randomBytes(32).toString("hex"),
  runId = `QA-${Date.now()}`;
const db = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  prepare: false,
});
const studentIds = [],
  documentIds = [];
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--port",
    String(port),
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: { ...process.env, ADMIN_ACCESS_KEY: key, NEXT_DIST_DIR: ".next-test" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let log = "";
server.stdout.on("data", (d) => {
  log = (log + d).slice(-8000);
});
server.stderr.on("data", (d) => {
  log = (log + d).slice(-8000);
});
let browser;
let cookie = "";
async function request(method, path, body, auth = true, origin = base) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      ...(auth && cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(70000),
  });
  const json = await res.json();
  return { res, json, status: res.status };
}
function check(label, value) {
  assert.ok(value, label);
  console.log("PASS", label);
}
async function create(suffix, limit) {
  const studentId = `${runId}-${suffix}`;
  studentIds.push(studentId);
  const r = await request("POST", "/api/invitations", {
    studentId,
    name: `Test Family ${suffix}`,
    className: "QA only",
    guestLimit: limit,
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.invitation;
}
try {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(base + "/api/auth", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 401) break;
    } catch {}
    if (i === 89) throw new Error("Test server did not start: " + log);
    await new Promise((r) => setTimeout(r, 500));
  }
  let r = await request("POST", "/api/auth", { accessKey: key }, false);
  check("staff login", r.status === 200);
  cookie = r.res.headers.get("set-cookie").split(";")[0];
  check(
    "staff session is HttpOnly",
    r.res.headers.get("set-cookie").includes("HttpOnly"),
  );
  r = await request(
    "POST",
    "/api/invitations",
    { studentId: runId, name: "Unauthorized" },
    false,
  );
  check("unauthorized invitation creation blocked", r.status === 401);
  r = await request(
    "POST",
    "/api/invitations",
    { studentId: runId, name: "Cross origin" },
    true,
    "https://untrusted.example",
  );
  check("cross-origin write blocked", r.status === 403);
  const inv = await create("capacity", 2),
    other = await create("other", 1);
  const registrations = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      request(
        "POST",
        "/api/guests",
        { code: inv.code, name: `Capacity Guest ${i}`, relationship: "Parent" },
        false,
      ),
    ),
  );
  check(
    "concurrent registration cannot exceed capacity",
    registrations.filter((r) => r.status === 201).length === 2 &&
      registrations.filter((r) => r.status === 409).length === 4,
  );
  const guest = registrations.find((r) => r.status === 201).json.guest;
  const second = registrations.filter((r) => r.status === 201)[1].json.guest;
  r = await request(
    "GET",
    `/api/invitations?code=${inv.code}`,
    undefined,
    false,
  );
  check(
    "invitation count stays consistent",
    r.json.remaining === 0 && r.json.registered === 2,
  );
  r = await request(
    "DELETE",
    "/api/guests",
    { code: other.code, guestId: guest.id },
    false,
  );
  check("guest deletion scoped to invitation", r.status === 404);
  r = await request("PATCH", "/api/admin", { code: inv.code, guestLimit: 1 });
  check("cannot lower limit below registrations", r.status === 409);
  const scans = await Promise.all([
    request("POST", "/api/check-in", {
      qrToken: inv.qrToken,
      guestId: guest.id,
    }),
    request("POST", "/api/check-in", {
      qrToken: inv.qrToken,
      guestId: guest.id,
    }),
  ]);
  if (
    scans.filter((r) => r.status === 201).length !== 1 ||
    scans.filter((r) => r.status === 409).length !== 1
  )
    console.log(
      "Scan diagnostics:",
      scans.map((r) => ({ status: r.status, body: r.json })),
    );
  check(
    "concurrent duplicate check-in rejected",
    scans.filter((r) => r.status === 201).length === 1 &&
      scans.filter((r) => r.status === 409).length === 1,
  );
  const [savedEntry] =
    await db`select status, (select count(*) from check_ins where guest_id=${guest.id}) as entries from guests where id=${guest.id}`;
  check(
    "successful entry persists exactly once",
    savedEntry.status === "checked_in" && Number(savedEntry.entries) === 1,
  );
  r = await request(
    "DELETE",
    "/api/guests",
    { code: inv.code, guestId: guest.id },
    false,
  );
  check("checked-in guest cannot be removed", r.status === 409);
  await request("PATCH", "/api/admin", { code: inv.code, status: "disabled" });
  r = await request("POST", "/api/check-in", {
    qrToken: inv.qrToken,
    guestId: second.id,
  });
  check("disabled invitation cannot enter", r.status === 409);
  r = await request(
    "POST",
    "/api/guests",
    { code: inv.code, name: "Blocked guest" },
    false,
  );
  check("disabled invitation cannot register guests", r.status === 409);
  await request("PATCH", "/api/admin", { code: inv.code, status: "active" });
  r = await request(
    "POST",
    "/api/tickets",
    {
      code: inv.code,
      category: "Guest limit",
      description: "Test support request for QA.",
    },
    false,
  );
  check("family can create a support request", r.status === 201);
  const ticketId = r.json.ticket.id;
  r = await request("GET", `/api/tickets?code=${other.code}`, undefined, false);
  check(
    "ticket history is private to the family",
    !r.json.tickets.some((t) => t.id === ticketId),
  );
  r = await request("GET", "/api/tickets?studentId=10234", undefined, false);
  check("roll number cannot expose tickets", r.status === 401);
  await request("PATCH", "/api/tickets", { id: ticketId, status: "resolved" });
  r = await request("GET", `/api/tickets?code=${inv.code}`, undefined, false);
  check(
    "resolved ticket visible to family",
    r.json.tickets[0].status === "resolved" && r.json.tickets[0].resolvedAt,
  );
  r = await request("POST", "/api/knowledge", {
    title: `QA article ${runId}`,
    content: `The secret rehearsal cue is bluebird-${runId}.`,
  });
  check("official knowledge article published", r.status === 201);
  documentIds.push(r.json.document.id);
  r = await request("PATCH", "/api/admin", {
    code: other.code,
    regenerate: true,
  });
  check(
    "invitation regenerated with new credentials",
    r.status === 200 &&
      r.json.invitation.invitationCode !== other.code &&
      r.json.invitation.qrToken !== other.qrToken,
  );
  r = await request("GET", `/api/check-in?qrToken=${other.qrToken}`);
  check("old QR invalid after regeneration", r.status === 404);
  const ui = await create("browser", 3);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  fs.mkdirSync("artifacts", { recursive: true });
  await page.goto(base + "/portal", { waitUntil: "networkidle" });
  await page
    .getByRole("textbox", { name: "Invitation code", exact: true })
    .fill(ui.code);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await page.getByText("Test Family browser, you’re on the list.").waitFor();
  check("student unlocks invitation in browser", true);
  await page.getByRole("button", { name: "My guests", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill("Browser Guest");
  await page
    .getByRole("button", { name: "Register guest", exact: true })
    .click();
  await page.getByText("Browser Guest", { exact: true }).waitFor();
  check("guest registration form saves to database", true);
  await page.screenshot({
    path: "artifacts/guest-management.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "My invitation", exact: true })
    .click();
  await page.getByRole("img", { name: `Entry QR for ${ui.code}` }).waitFor();
  await page.screenshot({
    path: "artifacts/invitation-pass.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: "artifacts/invitation-test.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  check("QR pass and printable PDF render", true);
  await page.goto(base + "/admin", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Access key", exact: true }).click();
  await page.getByLabel("Staff access key", { exact: true }).fill(key);
  await page
    .getByRole("button", { name: "Open staff workspace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Every detail. One place." })
    .waitFor();
  await page.getByRole("heading", { name: "Recent invitations" }).waitFor();
  await page.screenshot({
    path: "artifacts/staff-dashboard.png",
    fullPage: true,
  });
  check("staff dashboard authenticated through UI", true);
  await page
    .getByRole("button", { name: "Gate check-in", exact: true })
    .click();
  await page.getByLabel("Invitation code or QR token").fill(ui.code);
  await page
    .getByRole("button", { name: "Verify invitation", exact: true })
    .click();
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await page.getByText("Guest checked in. Welcome to the evening!").waitFor();
  check("staff can check in a guest through UI", true);
  await page.screenshot({
    path: "artifacts/gate-check-in.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Event & knowledge", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Event name", exact: true })
    .waitFor();
  check(
    "event editor loads saved information",
    (await page
      .getByRole("textbox", { name: "Event name", exact: true })
      .inputValue()) === "Annual Function 2026",
  );
  await page
    .getByRole("textbox", { name: "School name", exact: true })
    .waitFor();
  check(
    "landing editor loads demo school",
    (await page
      .getByRole("textbox", { name: "School name", exact: true })
      .inputValue()) === "Oakfield Public School",
  );
  const landingEditor = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Public landing page",
        exact: true,
      }),
    });
  await landingEditor
    .getByRole("button", { name: "Add guest", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove guest 4", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Remove guest 4", exact: true })
    .click();
  await landingEditor
    .getByRole("button", { name: "Add moment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove moment 6", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Public landing page", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/landing-editor.png" });
  r = await request("PUT", "/api/landing", { schoolName: "" });
  check("landing publication rejects invalid content", r.status === 400);
  check("landing editor guest and programme controls work", true);
  check("no browser runtime errors", errors.length === 0);
  console.log("ALL PRODUCT CHECKS PASSED");
} finally {
  if (browser) await browser.close();
  // Only records whose exact IDs were allocated by this run are removed.
  try {
    await db.begin(async (tx) => {
      for (const id of documentIds)
        await tx`delete from event_documents where id=${id}`;
      for (const studentId of studentIds) {
        const rows =
          await tx`select id from students where student_id=${studentId}`;
        for (const row of rows) {
          const invs =
            await tx`select id from invitations where student_id=${row.id}`;
          for (const inv of invs) {
            await tx`delete from check_ins where invitation_id=${inv.id}`;
            await tx`delete from guests where invitation_id=${inv.id}`;
          }
          await tx`delete from support_tickets where student_id=${row.id}`;
          await tx`delete from invitations where student_id=${row.id}`;
          await tx`delete from students where id=${row.id}`;
        }
      }
    });
    console.log("Isolated test records cleaned up.");
  } finally {
    await db.end({ timeout: 2 });
    server.kill();
  }
}
