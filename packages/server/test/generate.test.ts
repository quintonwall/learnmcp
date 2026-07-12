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
});
