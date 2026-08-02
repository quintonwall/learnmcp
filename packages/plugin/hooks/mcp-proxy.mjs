#!/usr/bin/env node
/**
 * Local stdio <-> remote HTTP bridge for the learnmcp MCP server.
 *
 * Why this exists: identity on the remote server is a bearer token, saved at
 * ~/.learnmcp/token, and only learnmcp-hook.mjs knows how to read/write it. Claude Code's
 * built-in MCP client has no way to attach a custom header to a plain `"type": "http"`
 * server declaration — it can't send that token, and can't persist the one the server
 * mints on first contact either. The result: every *interactive* tool call (the model
 * calling `progress` or `learn_next` directly) hit the remote server with no token,
 * mismatched the hook-tracked identity, and always got a brand-new, empty learner —
 * while session-start (which goes through the hook) showed real progress. Same person,
 * two identities, one looked broken.
 *
 * This process is what Claude Code actually spawns for the "learnmcp" MCP server. It
 * speaks newline-delimited JSON-RPC on stdio (exactly what every stdio MCP server speaks),
 * attaches the saved token to each request it forwards over HTTP, and saves back whatever
 * token the server issues — the same file the hooks use. That's what unifies the two
 * channels onto one identity.
 *
 * Self-contained on purpose, same as learnmcp-hook.mjs: a marketplace install only ships
 * this plugin directory, never a sibling workspace package.
 */

import { createInterface } from "node:readline";
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_URL = "https://learnmcp.ai/mcp";
const TOKEN_HEADER = "x-learnmcp-token";
const TIMEOUT_MS = 30000; // generous: some tools (generate_cartridge) call an LLM

const tokenPath = () => path.join(os.homedir(), ".learnmcp", "token");

function loadToken() {
  try {
    return readFileSync(tokenPath(), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token) {
  try {
    mkdirSync(path.dirname(tokenPath()), { recursive: true });
    writeFileSync(tokenPath(), token, "utf8");
    chmodSync(tokenPath(), 0o600); // it's a bearer credential
  } catch {
    /* best effort — worst case we mint a fresh learner next call */
  }
}

/**
 * null under LEARNMCP_LOCAL=1. The hook (learnmcp-hook.mjs) already checks this and goes
 * silent — this proxy IS the interactive tool-call channel, so without the same check here
 * "opt out of sending anything" would be false: every `progress`/`learn_next` call the
 * model makes would still leave the machine.
 */
function remoteUrl() {
  if (process.env.LEARNMCP_LOCAL === "1") return null;
  return process.env.LEARNMCP_URL || DEFAULT_URL;
}

/** Streamable HTTP may answer as a plain JSON body or as one SSE frame; accept either. */
function extractMessage(text, contentType) {
  if (!text) return null;
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload) return JSON.parse(payload);
    }
  }
  return null;
}

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/** Forward one JSON-RPC message. Notifications (no `id`) get no reply on stdout either way. */
/**
 * Answer the bare minimum of the MCP handshake locally, with no tools, when tracking is
 * opted out. Claude Code still needs a valid `initialize` response to treat the
 * connection as healthy rather than crashed — an empty tool list is the honest way to say
 * "nothing here to call" without silently phoning home to explain why.
 */
function localModeReply(message) {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "learnmcp (LEARNMCP_LOCAL=1, tracking disabled)", version: "0.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id, result: { tools: [] } };
  }
  if ("id" in message) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: "LEARNMCP_LOCAL=1 — tracking is disabled, nothing to call" },
    };
  }
  return null;
}

async function forward(message) {
  const isRequest = message && typeof message === "object" && "id" in message;

  if (!remoteUrl()) {
    const reply = localModeReply(message);
    if (reply) writeLine(reply);
    return;
  }

  const token = loadToken();
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(remoteUrl(), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(message),
    });

    const issued = res.headers.get(TOKEN_HEADER);
    if (issued && issued !== token) saveToken(issued);

    const text = await res.text();
    if (!res.ok) {
      if (isRequest) {
        writeLine({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: `learnmcp server error (${res.status})` },
        });
      }
      return;
    }

    const reply = extractMessage(text, res.headers.get("content-type") ?? "");
    if (isRequest && reply) writeLine(reply);
  } catch (err) {
    if (isRequest) {
      writeLine({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: `learnmcp unreachable: ${err.message}` },
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

// Responses are correlated by `id`, not by arrival order, so requests are dispatched
// concurrently rather than serialized — a slow tool call must not stall the rest.
//
// stdin can hit EOF while a forward() is still awaiting its fetch (Claude Code tearing
// down the connection mid-call, or — as in local testing — a piped, finite stdin reaching
// its end before the response comes back). Exiting immediately on 'close' would silently
// drop that in-flight response, so track outstanding calls and drain them first.
let pending = 0;
let closed = false;
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return; // not our protocol violation to report — nothing sane to do with it
  }
  pending++;
  forward(message).finally(() => {
    pending--;
    if (closed && pending === 0) process.exit(0);
  });
});

rl.on("close", () => {
  closed = true;
  if (pending === 0) process.exit(0);
  // Belt and braces: forward() already races itself against TIMEOUT_MS, but bound the
  // total wait so a hung connection can't keep the process alive forever.
  setTimeout(() => process.exit(0), TIMEOUT_MS + 1000).unref();
});
