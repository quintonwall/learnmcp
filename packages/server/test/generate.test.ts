import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateCartridge, extractJson, buildGenerationPrompt } from "../src/generate.js";
import { CartridgeRegistry } from "../src/registry.js";

const VALID_CARTRIDGE = {
  id: "vercel",
  version: "1.0.0",
  provider: { name: "Vercel", homepage: "https://vercel.com", icon: "▲" },
  detect: [{ type: "dependency", name: "vercel" }],
  objectives: [
    {
      id: "first-deploy",
      title: "Ship your first deploy",
      docs: "https://vercel.com/docs",
      criteria: { type: "bash", matches: "vercel (deploy|--prod)" },
      badge: "shipped",
    },
  ],
  bestPractices: [
    {
      id: "env-safe",
      title: "Keep secrets out of git",
      recommended: true,
      criteria: { type: "env", key: "VERCEL_TOKEN", absent_from: "git" },
      badge: "vault",
    },
  ],
  badges: [
    { id: "shipped", name: "Shipped It", tier: "bronze" },
    { id: "vault", name: "Key Keeper", tier: "bronze" },
  ],
};

const fakeFetch = async () => "Vercel is a platform for deploying frontends. Run `vercel deploy`.";

describe("extractJson", () => {
  it("strips markdown fences and prose", () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('Here you go:\n{"a":2}\nThanks!'))).toEqual({ a: 2 });
  });
});

describe("buildGenerationPrompt", () => {
  it("includes the URL, the matcher vocabulary, and the docs", () => {
    const p = buildGenerationPrompt("https://vercel.com/docs", "DEPLOY GUIDE");
    expect(p).toContain("https://vercel.com/docs");
    expect(p).toContain("llm_judge");
    expect(p).toContain("DEPLOY GUIDE");
  });
});

describe("generateCartridge", () => {
  it("validates model output, forces trust=generated, and writes a hot-loadable file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "learnmcp-gen-"));
    try {
      const complete = async () => "```json\n" + JSON.stringify(VALID_CARTRIDGE) + "\n```";
      const res = await generateCartridge({ url: "https://vercel.com/docs", fetchText: fakeFetch, complete, outDir: dir });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.cartridge.id).toBe("vercel");
      expect(res.cartridge.trust).toBe("generated"); // never auto-trusted

      const onDisk = JSON.parse(await readFile(path.join(dir, "vercel.json"), "utf8"));
      expect(onDisk.trust).toBe("generated");

      // The registry hot-loads it from the same dir.
      const reg = new CartridgeRegistry({ sources: [dir] });
      await reg.load();
      expect(reg.get("vercel")?.provider.name).toBe("Vercel");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an error for non-JSON output", async () => {
    const complete = async () => "I could not generate a cartridge, sorry.";
    const res = await generateCartridge({ url: "https://x.dev", fetchText: fakeFetch, complete });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/);
  });

  it("repairs an invalid first attempt when repair is enabled", async () => {
    let calls = 0;
    const complete = async () => {
      calls++;
      return calls === 1
        ? JSON.stringify({ id: "Bad Id!", version: "1", provider: { name: "X" } }) // invalid id
        : JSON.stringify(VALID_CARTRIDGE);
    };
    const res = await generateCartridge({ url: "https://x.dev", fetchText: fakeFetch, complete, repair: true });
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });

  it("errors clearly when the page has no content", async () => {
    const res = await generateCartridge({ url: "https://x.dev", fetchText: async () => "", complete: async () => "{}" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no readable content/);
  });

  it("rejects an mcp_tool name the docs never mention", async () => {
    const withInventedTool = {
      ...VALID_CARTRIDGE,
      objectives: [
        { ...VALID_CARTRIDGE.objectives[0], criteria: { type: "mcp_tool", server: "vercel", tool: "totally_made_up_tool" } },
      ],
    };
    const complete = async () => JSON.stringify(withInventedTool);
    const res = await generateCartridge({
      url: "https://vercel.com/docs",
      fetchText: fakeFetch, // "Run `vercel deploy`." — never mentions this tool name
      complete,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/totally_made_up_tool/);
  });

  it("accepts an mcp_tool name that literally appears in the fetched docs", async () => {
    const docs = "Call resolve_library_id to look up a package, then get_library_docs.";
    const withRealTool = {
      ...VALID_CARTRIDGE,
      objectives: [
        { ...VALID_CARTRIDGE.objectives[0], criteria: { type: "mcp_tool", server: "context7", tool: "resolve_library_id" } },
      ],
    };
    const res = await generateCartridge({
      url: "https://example.com/docs",
      fetchText: async () => docs,
      complete: async () => JSON.stringify(withRealTool),
    });
    expect(res.ok).toBe(true);
  });

  it("tolerates markdown-escaped underscores in the source when matching a tool name", async () => {
    // Markdown docs commonly render as `resolve\_library\_id` — a name the model read
    // correctly must not be rejected just because of the source's own escaping.
    const docs = "### resolve\\_library\\_id\nLooks up a package by name.";
    const withRealTool = {
      ...VALID_CARTRIDGE,
      objectives: [
        { ...VALID_CARTRIDGE.objectives[0], criteria: { type: "mcp_tool", server: "context7", tool: "resolve_library_id" } },
      ],
    };
    const res = await generateCartridge({
      url: "https://example.com/docs",
      fetchText: async () => docs,
      complete: async () => JSON.stringify(withRealTool),
    });
    expect(res.ok).toBe(true);
  });

  it("repairs an invented tool name into a verified one", async () => {
    const invented = {
      ...VALID_CARTRIDGE,
      objectives: [
        { ...VALID_CARTRIDGE.objectives[0], criteria: { type: "mcp_tool", server: "vercel", tool: "not_a_real_tool" } },
      ],
    };
    let calls = 0;
    const complete = async () => {
      calls++;
      return calls === 1 ? JSON.stringify(invented) : JSON.stringify(VALID_CARTRIDGE);
    };
    const res = await generateCartridge({ url: "https://vercel.com/docs", fetchText: fakeFetch, complete, repair: true });
    expect(calls).toBe(2);
    expect(res.ok).toBe(true);
  });
});
