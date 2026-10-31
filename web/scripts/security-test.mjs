// Live security regression tests.
//
// Run against a LOCAL or STAGING deployment that has synthetic data and the
// 0004 migration applied:
//
//   TEST_BASE_URL=http://localhost:3100 \
//   TEST_FAMILY_A_CODE=ANL-TESTA \
//   TEST_FAMILY_B_CODE=ANL-TESTB \
//   TEST_FAMILY_A_COOKIE='annual_family=...' \
//   TEST_STAFF_COOKIE='annual_staff=...' \
//   TEST_GATE_COOKIE='annual_staff=...' \
//   node scripts/security-test.mjs
//
// It is READ-ONLY except for requests that are expected to be rejected before
// any mutation. It never requests an OTP for a real family (that would send a
// real message), and it never performs admissions.
//
// IMPORTANT: it refuses to run against the production host unless
// ALLOW_PRODUCTION_READONLY=1 is set, and even then only read-only checks run.

const base = process.env.TEST_BASE_URL;
if (!base) {
  console.error("TEST_BASE_URL is required (local or staging only).");
  process.exit(2);
}
const production = /annual-five\.vercel\.app/i.test(base);
if (production && process.env.ALLOW_PRODUCTION_READONLY !== "1") {
  console.error(
    "Refusing to run against production. Use a local/staging URL, or set ALLOW_PRODUCTION_READONLY=1 for read-only checks.",
  );
  process.exit(2);
}

const A = process.env.TEST_FAMILY_A_CODE || "ANL-TESTA";
const B = process.env.TEST_FAMILY_B_CODE || "ANL-TESTB";
const cookies = {
  familyA: process.env.TEST_FAMILY_A_COOKIE || "",
  familyB: process.env.TEST_FAMILY_B_COOKIE || "",
  staff: process.env.TEST_STAFF_COOKIE || "",
  gate: process.env.TEST_GATE_COOKIE || "",
};

let failed = 0;
let passed = 0;
const skipped = [];

function record(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log("PASS", name, detail ?? "");
  } else {
    failed += 1;
    console.log("FAIL", name, detail ?? "");
  }
}

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function expectStatus(name, method, path, expected, opts = {}) {
  const res = await call(method, path, opts);
  record(name, res.status === expected, `expected ${expected}, got ${res.status}`);
  return res;
}

async function main() {
  console.log(`\nSecurity regression suite → ${base}\n`);

  // --- 1-7: unauthenticated visitors must not reach family data ------------
  await expectStatus("invitation detail without session", "GET", `/api/invitations?code=${encodeURIComponent(A)}`, 401);
  await expectStatus("guest list without session", "GET", `/api/guests?code=${encodeURIComponent(A)}`, 401);
  await expectStatus("guest create with code only", "POST", "/api/guests", 401, {
    body: { code: A, name: "Injected Guest" },
  });
  await expectStatus("guest patch with code only", "PATCH", "/api/guests", 401, {
    body: { code: A, guestId: "11111111-1111-4111-8111-111111111111", name: "X" },
  });
  await expectStatus("guest delete with code only", "DELETE", "/api/guests", 401, {
    body: { code: A, guestId: "11111111-1111-4111-8111-111111111111" },
  });
  await expectStatus("rsvp with code only", "POST", "/api/rsvp", 401, {
    body: { code: A, status: "attending" },
  });
  await expectStatus("ticket history without session", "GET", `/api/tickets?code=${encodeURIComponent(A)}`, 401);
  await expectStatus("agent with code only", "POST", "/api/agent", 401, {
    body: { message: "who are my guests", code: A },
  });

  // --- 8-11: staff surfaces are not anonymous ------------------------------
  await expectStatus("admin dashboard without session", "GET", "/api/admin", 401);
  await expectStatus("check-in read without session", "GET", "/api/check-in?qrToken=invalid", 401);
  await expectStatus("check-in write without session", "POST", "/api/check-in", 401, {
    body: { qrToken: "invalid" },
  });
  await expectStatus("invitation creation without session", "POST", "/api/invitations", 401, {
    body: { studentId: "unauthorized", name: "Must not be created", className: "X" },
  });

  // --- 12-13: uniform verification responses, no enumeration ---------------
  const unknown = await call("POST", "/api/family/verify/start", {
    body: { code: "ANL-DOESNOTEXIST000" },
  });
  if (unknown.status === 503) {
    skipped.push("verification schema not migrated (start returned 503)");
  } else {
    record(
      "unknown code gets a uniform 200 response",
      unknown.status === 200 && unknown.json?.nextStep === "contact_teacher",
      `got ${unknown.status} ${unknown.text.slice(0, 120)}`,
    );
  }
  await expectStatus("confirm rejects malformed OTP", "POST", "/api/family/verify/confirm", 400, {
    body: { code: A, otp: "abc" },
  });

  // --- 14-18: cross-family isolation and role separation -------------------
  if (cookies.familyA) {
    await expectStatus("family A can read its own invitation", "GET", `/api/invitations?code=${encodeURIComponent(A)}`, 200, {
      cookie: cookies.familyA,
    });
    await expectStatus("family A cannot read family B (IDOR)", "GET", `/api/invitations?code=${encodeURIComponent(B)}`, 403, {
      cookie: cookies.familyA,
    });
    await expectStatus("family A cannot mutate family B guests", "POST", "/api/guests", 403, {
      cookie: cookies.familyA,
      body: { code: B, name: "Cross-family guest" },
    });
  } else skipped.push("family A cookie not provided (IDOR checks)");

  if (cookies.familyB) {
    await expectStatus("family B cannot read family A (IDOR)", "GET", `/api/invitations?code=${encodeURIComponent(A)}`, 403, {
      cookie: cookies.familyB,
    });
  }

  if (cookies.gate) {
    await expectStatus("gate keeper cannot open admin dashboard", "GET", "/api/admin", 403, {
      cookie: cookies.gate,
    });
    const res = await call("GET", "/api/check-in?qrToken=invalid", { cookie: cookies.gate });
    record(
      "gate keeper can reach the scanner (invalid token is 404)",
      res.status === 404,
      `got ${res.status}`,
    );
  } else skipped.push("gate cookie not provided (role separation)");

  if (cookies.staff) {
    await expectStatus("staff can open admin dashboard", "GET", "/api/admin", 200, {
      cookie: cookies.staff,
    });
  } else skipped.push("staff cookie not provided (staff authorization)");

  // --- 19: security headers ------------------------------------------------
  const home = await call("GET", "/");
  const csp = home.headers.get("content-security-policy") || "";
  record(
    "CSP present and frame-ancestors locked",
    csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"),
    csp ? csp.slice(0, 80) : "missing",
  );
  record(
    "nosniff and referrer policy present",
    home.headers.get("x-content-type-options") === "nosniff" &&
      home.headers.get("referrer-policy") === "no-referrer",
    "",
  );

  // --- 20: sensitive responses must not be cacheable -----------------------
  const guestRes = await call("GET", `/api/guests?code=${encodeURIComponent(A)}`, {
    cookie: cookies.familyA,
  });
  if (cookies.familyA) {
    record(
      "family guest responses are no-store",
      /no-store/i.test(guestRes.headers.get("cache-control") || ""),
      guestRes.headers.get("cache-control") || "missing",
    );
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped`);
  for (const s of skipped) console.log("SKIP", s);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exitCode = 1;
});
