// The write client's plumbing, without a website or a real account.
//
// `globalThis.fetch` is replaced with a recorder, so these tests prove the
// things that are easy to get silently wrong: the origin/host headers the
// website demands, that the login cookie is reused, that a stale session is
// retried exactly once, and that a refusal becomes a readable sentence.
//
// The client remembers its login on the module, which is correct in production
// but would leak between tests. Each test therefore imports a fresh copy
// (`?case=n`) instead of the client growing a test-only reset function.

import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
let calls = [];

function installFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const record = { url: String(url), init, headers: init.headers ?? {}, body: init.body };
    calls.push(record);
    const reply = handler(record);
    return {
      status: reply.status ?? 200,
      ok: (reply.status ?? 200) < 400,
      headers: { get: (name) => (name.toLowerCase() === "set-cookie" ? (reply.setCookie ?? null) : null) },
      json: async () => reply.body ?? {},
    };
  };
}

const loginOk = { body: { staff: { id: "u-1" } }, setCookie: "annual_staff=abc; Path=/; HttpOnly" };
const defaultHandler = (record) => (record.url.endsWith("/api/auth") ? loginOk : { body: { ok: true } });

/** A fresh client, so the remembered session never carries across a test. */
let caseNo = 0;
async function freshClient() {
  caseNo += 1;
  return import(`../src/write.mjs?case=${caseNo}`);
}

beforeEach(() => {
  process.env.NEXTJS_BASE_URL = "http://127.0.0.1:3000";
  process.env.ANKITA_EMAIL = "ankita@example.test";
  process.env.ANKITA_PASSWORD = "not-a-real-password";
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ANKITA_EMAIL;
  delete process.env.ANKITA_PASSWORD;
});

describe("write client plumbing", () => {
  it("signs in once, then sends origin, host and the login cookie", async () => {
    installFetch(defaultHandler);
    const actions = await freshClient();
    await actions.setGallery(true);
    assert.equal(calls.length, 2, "one login, one change");
    const change = calls.at(-1);
    assert.equal(change.url, "http://127.0.0.1:3000/api/album");
    assert.equal(change.init.method, "PATCH");
    assert.equal(change.headers.origin, "http://127.0.0.1:3000");
    assert.equal(change.headers.host, "127.0.0.1:3000");
    assert.match(change.headers.cookie, /annual_staff=abc/);
  });

  it("does not sign in again while the session is fresh", async () => {
    installFetch(defaultHandler);
    const actions = await freshClient();
    await actions.setGallery(true);
    await actions.setGallery(false);
    const logins = calls.filter((c) => c.url.endsWith("/api/auth"));
    assert.equal(logins.length, 1, "one login covers both changes");
  });

  it("retries exactly once after a stale session, then succeeds", async () => {
    let albumCalls = 0;
    installFetch((record) => {
      if (record.url.endsWith("/api/auth")) return loginOk;
      albumCalls += 1;
      // The first attempt on the remembered cookie is refused; the retry works.
      return albumCalls === 1
        ? { status: 401, body: { error: "Sign in" } }
        : { body: { galleryEnabled: true } };
    });
    const actions = await freshClient();
    // Prime a session, then make it stale by clearing the clock is not exposed;
    // instead the first album call is refused, which is the same situation.
    const result = await actions.setGallery(true);
    assert.deepEqual(result, { galleryEnabled: true });
    assert.equal(calls.filter((c) => c.url.endsWith("/api/album")).length, 2);
    assert.equal(calls.filter((c) => c.url.endsWith("/api/auth")).length, 2, "one login, one re-login");
  });

  it("turns a refusal into the website's own words", async () => {
    installFetch((record) =>
      record.url.endsWith("/api/auth")
        ? loginOk
        : { status: 409, body: { error: "Cannot set the guest limit below existing registrations." } },
    );
    const actions = await freshClient();
    await assert.rejects(
      () => actions.setGuestLimit("ANL-X", 1),
      (e) => e.message === "Cannot set the guest limit below existing registrations." && e.status === 409,
    );
  });

  it("says the website is unreachable instead of hanging", async () => {
    globalThis.fetch = async () => {
      const e = new Error("nope");
      e.name = "TimeoutError";
      throw e;
    };
    const actions = await freshClient();
    await assert.rejects(() => actions.setGallery(true), /took too long to answer/);
  });

  it("refuses an out-of-range limit before calling anyone", async () => {
    installFetch(defaultHandler);
    const actions = await freshClient();
    await assert.rejects(() => actions.setGuestLimit("ANL-X", 101), /0 to 100/);
    assert.equal(calls.length, 0, "no request should be made");
  });

  it("sends an announcement as 'send', not a draft", async () => {
    installFetch(defaultHandler);
    const actions = await freshClient();
    await actions.sendAnnouncement({ message: "Hello", audience: "all" });
    const change = calls.at(-1);
    assert.equal(change.url, "http://127.0.0.1:3000/api/announcements");
    const sent = JSON.parse(change.body);
    assert.equal(sent.action, "send");
    assert.equal(sent.body, "Hello");
  });
});
