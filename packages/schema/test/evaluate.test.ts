import { describe, it, expect } from "vitest";
import {
  buildContext,
  evaluateMatcher,
  validateCartridge,
  matchesGlob,
  judgeKey,
  type Signal,
  type Matcher,
} from "../src/index.js";

const ctxFrom = (signals: Signal[]) => buildContext(signals);
const matched = (m: Matcher, signals: Signal[]) =>
  evaluateMatcher(m, ctxFrom(signals)).matched;

describe("glob", () => {
  it("handles ** , * and {a,b}", () => {
    expect(matchesGlob("src/api/openapi.yaml", "**/openapi.{json,yaml,yml}")).toBe(true);
    expect(matchesGlob("openapi.json", "**/openapi.{json,yaml,yml}")).toBe(true);
    expect(matchesGlob("src/index.ts", "**/openapi.{json,yaml}")).toBe(false);
    expect(matchesGlob("a/b/c.ts", "*.ts")).toBe(false); // * doesn't cross /
    expect(matchesGlob("c.ts", "*.ts")).toBe(true);
  });
});

describe("leaf matchers", () => {
  it("bash matches a regex with a count threshold", () => {
    const m: Matcher = { type: "bash", matches: "vercel (deploy|--prod)", gte: 2 };
    expect(matched(m, [{ kind: "bash", command: "vercel deploy" }])).toBe(false);
    expect(
      matched(m, [
        { kind: "bash", command: "vercel deploy" },
        { kind: "bash", command: "vercel --prod" },
      ]),
    ).toBe(true);
  });

  it("file matches by glob + contents", () => {
    const m: Matcher = { type: "file", path: ".gitignore", contains: "^\\.env" };
    expect(
      matched(m, [{ kind: "file", path: ".gitignore", content: "node_modules\n.env\n" }]),
    ).toBe(true);
    expect(
      matched(m, [{ kind: "file", path: ".gitignore", content: "node_modules\n" }]),
    ).toBe(false);
  });

  it("file exists:false means the path must be absent", () => {
    const m: Matcher = { type: "file", path: "secrets.txt", exists: false };
    expect(matched(m, [])).toBe(true);
    expect(matched(m, [{ kind: "file", path: "secrets.txt" }])).toBe(false);
  });

  it("mcp + mcp_tool with thresholds", () => {
    expect(matched({ type: "mcp", server: "postman" }, [{ kind: "mcp.added", server: "postman" }])).toBe(true);
    const tool: Matcher = { type: "mcp_tool", server: "postman", tool: "run-collection", gte: 3 };
    const three: Signal[] = Array.from({ length: 3 }, () => ({
      kind: "mcp_tool",
      server: "postman",
      tool: "run-collection",
    }));
    expect(matched(tool, three.slice(0, 2))).toBe(false);
    expect(matched(tool, three)).toBe(true);
  });

  it("count aggregates over a signal kind", () => {
    const m: Matcher = { type: "count", of: "mcp.added", gte: 10 };
    const nine: Signal[] = Array.from({ length: 9 }, (_, i) => ({ kind: "mcp.added", server: `s${i}` }));
    expect(matched(m, nine)).toBe(false);
    expect(matched(m, [...nine, { kind: "mcp.added", server: "s9" }])).toBe(true);
  });

  it("env absent_from git", () => {
    const m: Matcher = { type: "env", key: "POSTMAN_API_KEY", absent_from: "git" };
    expect(matched(m, [{ kind: "env", key: "POSTMAN_API_KEY", inGit: false }])).toBe(true);
    expect(matched(m, [{ kind: "env", key: "POSTMAN_API_KEY", inGit: true }])).toBe(false);
    expect(matched(m, [])).toBe(false);
  });
});

describe("composite matchers", () => {
  const objective: Matcher = {
    anyOf: [
      { type: "mcp_tool", server: "postman", tool: "generate-spec", gte: 1 },
      { type: "file", path: "**/openapi.{json,yaml,yml}", exists: true },
    ],
  };

  it("anyOf is satisfied by either branch (the Postman spec objective)", () => {
    expect(matched(objective, [{ kind: "mcp_tool", server: "postman", tool: "generate-spec" }])).toBe(true);
    expect(matched(objective, [{ kind: "file", path: "src/api/openapi.yaml" }])).toBe(true);
    expect(matched(objective, [{ kind: "file", path: "src/index.ts" }])).toBe(false);
  });

  it("allOf and not compose", () => {
    const m: Matcher = {
      allOf: [
        { type: "mcp", server: "postman" },
        { not: { type: "file", path: "secrets.txt" } },
      ],
    };
    expect(matched(m, [{ kind: "mcp.added", server: "postman" }])).toBe(true);
    expect(
      matched(m, [
        { kind: "mcp.added", server: "postman" },
        { kind: "file", path: "secrets.txt" },
      ]),
    ).toBe(false);
  });
});

describe("llm_judge (subjective escape valve)", () => {
  const m: Matcher = {
    type: "llm_judge",
    over: { file: "**/openapi.{yaml,json}" },
    rubric: "Are operations well described for an AI agent?",
    confidence_gte: 0.8,
  };

  it("surfaces a pending request with candidate files when unresolved", () => {
    const res = evaluateMatcher(m, ctxFrom([{ kind: "file", path: "api/openapi.yaml", content: "..." }]));
    expect(res.matched).toBe(false);
    expect(res.pending).toHaveLength(1);
    expect(res.pending[0].files.map((f) => f.path)).toContain("api/openapi.yaml");
  });

  it("matches once a verdict clears the confidence bar", () => {
    const ctx = ctxFrom([{ kind: "file", path: "api/openapi.yaml", content: "..." }]);
    ctx.judgements.set(judgeKey(m as any), { confidence: 0.9 });
    expect(evaluateMatcher(m, ctx).matched).toBe(true);
    ctx.judgements.set(judgeKey(m as any), { confidence: 0.5 });
    expect(evaluateMatcher(m, ctx).matched).toBe(false);
  });
});

describe("cartridge validation", () => {
  it("accepts a minimal valid cartridge and applies defaults", () => {
    const res = validateCartridge({
      id: "postman",
      version: "1.0.0",
      provider: { name: "Postman" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.cartridge.trust).toBe("community");
      expect(res.cartridge.objectives).toEqual([]);
    }
  });

  it("rejects a non-kebab id with a helpful path", () => {
    const res = validateCartridge({ id: "Postman!", version: "1", provider: { name: "P" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("id");
  });
});
