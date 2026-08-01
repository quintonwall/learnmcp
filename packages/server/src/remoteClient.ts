import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Signal } from "@learnmcp/schema";
import type { FetchLike } from "./remote.js";

/**
 * Client the plugin's hooks use to talk to the hosted learnmcp MCP.
 *
 * A remote MCP can't see your machine, so hooks stay local: they observe the session and
 * POST the resulting signals to the server, which is what keeps badges landing passively.
 *
 * Identity is anonymous-first. The first call sends no token; the server mints a learner
 * and returns one in a response header, which is saved to ~/.learnmcp/token and reused.
 */

export const DEFAULT_REMOTE_URL = "https://learnmcp.dev/mcp";
const TOKEN_HEADER = "x-learnmcp-token";

export function tokenPath(): string {
  return path.join(os.homedir(), ".learnmcp", "token");
}

export function loadToken(): string | undefined {
  try {
    return readFileSync(tokenPath(), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(token: string): void {
  const file = tokenPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, token, "utf8");
  // It's a bearer credential — don't leave it world-readable.
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort (e.g. Windows) */
  }
}

/**
 * Where progress goes. Cloud is the default so learners show up on the leaderboard;
 * LEARNMCP_LOCAL=1 opts out entirely and keeps everything in local SQLite.
 */
export function remoteUrl(): string | null {
  if (process.env.LEARNMCP_LOCAL === "1") return null;
  return process.env.LEARNMCP_URL || DEFAULT_REMOTE_URL;
}

/** Streamable HTTP may answer as JSON or as SSE; accept either. */
async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("text/event-stream")) return text ? JSON.parse(text) : null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload) return JSON.parse(payload);
    }
  }
  return null;
}

export interface RemoteCallOptions {
  url?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Call one tool on the remote MCP. Returns the tool's parsed JSON payload, or null if the
 * server couldn't be reached — hooks must fail open, never block a session on learnmcp.
 */
export async function callRemoteTool(
  name: string,
  args: Record<string, unknown>,
  opts: RemoteCallOptions = {},
): Promise<unknown | null> {
  const url = opts.url ?? remoteUrl();
  if (!url) return null;
  const fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
  if (!fetchImpl) return null;

  const token = loadToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });

    // Save the identity the server just minted for us.
    const issued = res.headers.get(TOKEN_HEADER);
    if (issued && issued !== token) saveToken(issued);

    if (!res.ok) return null;
    const body = (await parseBody(res)) as
      | { result?: { content?: Array<{ type: string; text?: string }> } }
      | null;
    const text = body?.result?.content?.find((c) => c.type === "text")?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null; // offline, timeout, or a bad response — stay quiet
  } finally {
    clearTimeout(timer);
  }
}

export interface RemoteRecordResult {
  newBadges: Array<{ name: string; points: number }>;
  newObjectives: Array<{ title: string }>;
  points: number;
  message?: string;
}

/** Send a batch of observed signals, returning the aggregate of what they earned. */
export async function recordRemote(
  signals: Signal[],
  opts: RemoteCallOptions = {},
): Promise<RemoteRecordResult | null> {
  let last: RemoteRecordResult | null = null;
  const badges: RemoteRecordResult["newBadges"] = [];
  const objectives: RemoteRecordResult["newObjectives"] = [];

  for (const signal of signals) {
    const res = (await callRemoteTool("record_activity", { signal }, opts)) as RemoteRecordResult | null;
    if (!res) continue;
    last = res;
    badges.push(...(res.newBadges ?? []));
    objectives.push(...(res.newObjectives ?? []));
  }

  return last ? { ...last, newBadges: badges, newObjectives: objectives } : null;
}
