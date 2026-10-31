import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/server.mjs";

const call = (method, params, id = 1) => dispatch({ jsonrpc: "2.0", id, method, params });

describe("protocol handshake", () => {
  it("answers initialize with capabilities, server info and guidance", async () => {
    const reply = await call("initialize", { protocolVersion: "2025-11-25", clientInfo: { name: "t" } });
    assert.equal(reply.id, 1);
    assert.equal(reply.result.protocolVersion, "2025-11-25");
    assert.ok(reply.result.capabilities.tools);
    assert.equal(reply.result.serverInfo.name, "annual-function");
    assert.match(reply.result.instructions, /who_did_what/);
  });

  it("echoes an older client's protocol version rather than forcing its own", async () => {
    const reply = await call("initialize", { protocolVersion: "2024-11-05" });
    assert.equal(reply.result.protocolVersion, "2024-11-05");
  });

  it("gives no reply to a notification", async () => {
    const reply = await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(reply, null);
  });

  it("answers ping", async () => {
    const reply = await call("ping");
    assert.deepEqual(reply.result, {});
  });

  it("refuses an unknown method with the spec's code", async () => {
    const reply = await call("tools/explode");
    assert.equal(reply.error.code, -32601);
  });
});

describe("tools/list", () => {
  it("lists every tool, each with a schema", async () => {
    const reply = await call("tools/list");
    const names = reply.result.tools.map((t) => t.name).sort();
    assert.equal(names.length, 16);
    for (const tool of reply.result.tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} needs an object schema`);
      assert.ok(tool.description.length > 20, `${tool.name} needs a real description`);
    }
  });

  it("offers exactly the ten reporters and six doers that were reviewed", async () => {
    const reply = await call("tools/list");
    const byName = Object.fromEntries(reply.result.tools.map((t) => [t.name, t]));
    const reporters = [
      "event_overview",
      "who_did_what",
      "recent_checkins",
      "unchecked_families",
      "attendance_by_class",
      "rsvp_report",
      "site_status",
      "guest_limit_preview",
      "open_tickets",
      "recent_announcements",
    ];
    const doers = [
      "check_in_family",
      "set_guest_limit",
      "set_guest_limit_bulk",
      "send_announcement",
      "reply_to_ticket",
      "set_gallery",
    ];
    for (const name of reporters) {
      assert.equal(byName[name].annotations.readOnlyHint, true, `${name} must be read-only`);
    }
    for (const name of doers) {
      assert.equal(byName[name].annotations.readOnlyHint, false, `${name} must not be read-only`);
    }
    assert.deepEqual(Object.keys(byName).sort(), [...reporters, ...doers].sort());
  });

  it("offers a bulk route, so nobody loops over hundreds of families", async () => {
    const reply = await call("tools/list");
    const bulk = reply.result.tools.find((t) => t.name === "set_guest_limit_bulk");
    const props = Object.keys(bulk.inputSchema.properties);
    assert.ok(props.includes("all"), "bulk must accept 'everyone'");
    assert.ok(props.includes("className"), "bulk must accept one class");
    assert.match(bulk.description, /ONE request|one request/);
  });

  it("marks what other people can see as destructive", async () => {
    const reply = await call("tools/list");
    const byName = Object.fromEntries(reply.result.tools.map((t) => [t.name, t]));
    assert.equal(byName.send_announcement.annotations.destructiveHint, true);
    assert.equal(byName.reply_to_ticket.annotations.destructiveHint, true);
  });
});

describe("tools/call", () => {
  it("reports an unknown tool as a readable error, not a crash", async () => {
    const reply = await call("tools/call", { name: "delete_everything", arguments: {} });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /no tool called delete_everything/);
  });

  it("needs a tool name", async () => {
    const reply = await call("tools/call", {});
    assert.equal(reply.error.code, -32602);
  });

  it("turns a missing database into a sentence, not a stack trace", async () => {
    // State the condition instead of assuming it: the suite must never depend
    // on whether this machine has a configured database.
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const reply = await call("tools/call", { name: "event_overview", arguments: {} });
      assert.equal(reply.result.isError, true);
      assert.match(reply.result.content[0].text, /DATABASE_URL is not set/);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  it("refuses a guest limit outside the allowed range before touching the website", async () => {
    const reply = await call("tools/call", {
      name: "set_guest_limit",
      arguments: { code: "ANL-TEST", limit: 500 },
    });
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /0 to 100/);
  });
});
