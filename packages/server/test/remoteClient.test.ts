import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { callRemoteTool, recordRemote, remoteUrl, DEFAULT_REMOTE_URL } from "../src/remoteClient.js";

const URL_ = "https://learn.example/mcp";

/** Build a JSON-RPC tool result the way the MCP SDK would. */
function toolResult(payload: unknown, opts: { sse?: boolean; token?: string } = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
  const headers = new Headers();
  if (opts.token) headers.set("x-learnmcp-token", opts.token);
  if (opts.sse) {
    headers.set("content-type", "text/event-stream");
    return new Response(`event: message\ndata: ${body}\n\n`, { headers });
  }
  headers.set("content-type", "application/json");
  return new Response(body, { headers });
}

describe("remoteUrl — cloud by default", () => {
  const saved = { url: process.env.LEARNMCP_URL, local: process.env.LEARNMCP_LOCAL };
  beforeEach(() => {
    delete process.env.LEARNMCP_URL;
    delete process.env.LEARNMCP_LOCAL;
  });
  afterEach(() => {
    saved.url ? (process.env.LEARNMCP_URL = saved.url) : delete process.env.LEARNMCP_URL;
    saved.local ? (process.env.LEARNMCP_LOCAL = saved.local) : delete process.env.LEARNMCP_LOCAL;
  });

  it("defaults to the hosted server", () => {
    expect(remoteUrl()).toBe(DEFAULT_REMOTE_URL);
  });

  it("LEARNMCP_LOCAL=1 opts out entirely", () => {
    process.env.LEARNMCP_LOCAL = "1";
    expect(remoteUrl()).toBeNull();
  });

  it("LEARNMCP_URL points at a self-hosted deployment", () => {
    process.env.LEARNMCP_URL = "https://mine.example/mcp";
    expect(remoteUrl()).toBe("https://mine.example/mcp");
  });
});

describe("callRemoteTool", () => {
  it("parses a JSON tool result", async () => {
    const fetchImpl = async () => toolResult({ points: 40 });
    expect(await callRemoteTool("progress", {}, { url: URL_, fetchImpl })).toEqual({ points: 40 });
  });

  it("parses an SSE tool result, which is what streamable HTTP usually sends", async () => {
    const fetchImpl = async () => toolResult({ points: 55 }, { sse: true });
    expect(await callRemoteTool("progress", {}, { url: URL_, fetchImpl })).toEqual({ points: 55 });
  });

  it("sends a well-formed tools/call body", async () => {
    let sent: any;
    const fetchImpl = async (_u: string, init: RequestInit = {}) => {
      sent = JSON.parse(init.body as string);
      return toolResult({});
    };
    await callRemoteTool("record_activity", { signal: { kind: "bash", command: "ls" } }, { url: URL_, fetchImpl });
    expect(sent).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "record_activity", arguments: { signal: { kind: "bash", command: "ls" } } },
    });
  });

  it("returns null instead of throwing when the server is down", async () => {
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    // Hooks must fail open — a learnmcp outage can't break someone's session.
    expect(await callRemoteTool("progress", {}, { url: URL_, fetchImpl })).toBeNull();
  });

  it("returns null on a non-2xx", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    expect(await callRemoteTool("progress", {}, { url: URL_, fetchImpl })).toBeNull();
  });
});

describe("recordRemote", () => {
  it("aggregates badges across a batch of signals", async () => {
    const replies = [
      { newBadges: [{ name: "Spec Author", points: 10 }], newObjectives: [], points: 10 },
      { newBadges: [], newObjectives: [{ title: "Run your collection" }], points: 10 },
      { newBadges: [{ name: "Locked Down", points: 25 }], newObjectives: [], points: 35 },
    ];
    let i = 0;
    const fetchImpl = async () => toolResult(replies[i++]);

    const res = await recordRemote(
      [
        { kind: "command", name: "postman:generate-spec" },
        { kind: "command", name: "postman:run-collection" },
        { kind: "command", name: "postman:security" },
      ],
      { url: URL_, fetchImpl },
    );

    expect(res!.newBadges.map((b) => b.name)).toEqual(["Spec Author", "Locked Down"]);
    expect(res!.newObjectives.map((o) => o.title)).toEqual(["Run your collection"]);
    expect(res!.points).toBe(35);
  });

  it("returns null when nothing could be sent", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    expect(await recordRemote([{ kind: "bash", command: "ls" }], { url: URL_, fetchImpl })).toBeNull();
  });
});
