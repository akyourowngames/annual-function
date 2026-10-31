#!/usr/bin/env node
// The MCP server Ankita talks to, over stdio.
//
// Protocol: JSON-RPC 2.0, one JSON object per line, exactly as the MCP spec
// frames it. Hand-rolled on purpose — it is a request/response loop over
// stdin/stdout, and pulling an SDK for that would add a dependency for no
// behaviour. The shapes below are the ones Ankita's own client sends and
// expects (initialize, notifications/initialized, tools/list, tools/call).
//
// Two rules this file enforces, so no tool can forget them:
//   1. A tool that fails returns a normal result with isError:true and a plain
//      sentence. It never throws a protocol error, because the assistant reads
//      the text, and a broken frame would surface as "the server crashed".
//   2. stdout is the protocol channel. Nothing else may ever write to it, so
//      every diagnostic goes to stderr.

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
// First import on purpose: every module below reads settings at call time.
import "./env.mjs";
import { buildTools, toolList } from "./tools.mjs";
import * as read from "./read.mjs";
import * as act from "./write.mjs";
import { closeDb } from "./db.mjs";
import { ActionError } from "./write.mjs";
import { SERVER_INSTRUCTIONS, SERVER_TITLE } from "./prompt.mjs";

const SERVER_NAME = "annual-function";
const SERVER_VERSION = "0.1.0";

/** Newest protocol this server speaks; an older client's version is echoed back. */
const LATEST_PROTOCOL = "2025-11-25";

/** JSON-RPC error codes that the spec assigns. */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const tools = buildTools({ read, write: act });

function log(message) {
  process.stderr.write(`[annual-function] ${message}\n`);
}

/** Turn any thrown value into words the assistant can read out unchanged. */
function describeFailure(e) {
  if (e instanceof ActionError) {
    return e.hint ? `${e.message} ${e.hint}` : e.message;
  }
  if (e instanceof Error) {
    // A database that is not configured is an operator problem, and the
    // message already says so; anything else is unexpected and worth the name.
    return e.message;
  }
  return "The tool failed for an unknown reason.";
}

async function callTool(name, args = {}) {
  const tool = tools[name];
  if (!tool) {
    return errorResult(`There is no tool called ${name}.`);
  }
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
    return errorResult("Tool arguments must be an object.");
  }
  try {
    const data = await tool.run(args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
      isError: false,
    };
  } catch (e) {
    log(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return errorResult(describeFailure(e));
  }
}

function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function handleListTools() {
  return { tools: toolList(tools) };
}

function handleInitialize(params) {
  const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  return {
    // Echo the client's version when it is one we understand; otherwise state ours.
    protocolVersion: requested || LATEST_PROTOCOL,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
    instructions: SERVER_INSTRUCTIONS,
  };
}

/** Build the reply for one decoded message, or null when no reply is due. */
export async function dispatch(message) {
  if (!message || typeof message !== "object") return null;
  const { id, method, params } = message;

  // A notification carries no id and gets no reply.
  const isNotification = id === undefined || id === null;
  if (isNotification) return null;

  try {
    let result;
    switch (method) {
      case "initialize":
        result = handleInitialize(params);
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = handleListTools();
        break;
      case "tools/call":
        if (!params || typeof params.name !== "string") {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: INVALID_PARAMS, message: "tools/call needs a tool name." },
          };
        }
        result = await callTool(params.name, params.arguments);
        break;
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${String(method)}` },
        };
    }
    return { jsonrpc: "2.0", id, result };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: INTERNAL_ERROR, message: "The tool server hit an unexpected problem." },
    };
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function start() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

  // Every request in flight is tracked so shutdown can wait for it. Without
  // this, closing the pool the moment input ends kills the last query and the
  // assistant is told "the connection ended" for work that was nearly done.
  const inFlight = new Set();

  function track(promise) {
    const entry = promise.finally(() => inFlight.delete(entry));
    inFlight.add(entry);
    return entry;
  }

  lines.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: INVALID_PARAMS, message: "Invalid JSON." } });
      return;
    }
    const work = (async () => {
      // A batch request is an array; handle it as a batch so nothing is dropped.
      if (Array.isArray(message)) {
        const replies = (await Promise.all(message.map((m) => dispatch(m)))).filter(Boolean);
        if (replies.length) send(replies);
        return;
      }
      const reply = await dispatch(message);
      if (reply) send(reply);
    })();
    track(work);
  });

  lines.on("close", async () => {
    // Answer everything already asked before letting the database go.
    await Promise.allSettled([...inFlight]);
    await closeDb().catch(() => {});
    process.exit(0);
  });
}

// Only start the loop when run as a program, so tests can import `dispatch`.
// `pathToFileURL` handles Windows drive letters, backslashes and spaces in the
// project path, which a hand-built `file://` string gets wrong.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMainModule()) start();
