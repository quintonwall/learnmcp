import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCartridge, judgeKey, type Signal, type Cartridge } from "@learnmcp/schema";
import { evaluateProject, detectActive, nextObjective } from "../src/detection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const postmanPath = path.resolve(here, "../../../cartridges/postman/postman.json");

async function loadPostman(): Promise<Cartridge> {
  const parsed = JSON.parse(await readFile(postmanPath, "utf8"));
  const res = validateCartridge(parsed);
  if (!res.ok) throw new Error(`Postman cartridge is invalid: ${res.error}`);
  return res.cartridge;
}

describe("Postman cartridge — the §9 walkthrough, executed", () => {
  it("is a valid cartridge", async () => {
    await expect(loadPostman()).resolves.toBeDefined();
  });

  it("activates when the Postman MCP is added", async () => {
    const c = await loadPostman();
    const active = detectActive([c], [{ kind: "mcp.added", server: "postman" }]);
    expect(active).toEqual(["postman"]);
    expect(detectActive([c], [{ kind: "mcp.added", server: "supabase" }])).toEqual([]);
  });

  it("recommends generating the OpenAPI spec first", async () => {
    const c = await loadPostman();
    const state = evaluateProject([c], [{ kind: "mcp.added", server: "postman" }]);
    expect(nextObjective(c, state)?.id).toBe("generate-openapi-spec");
  });

  it("grants Spec Author when an openapi.yaml appears (either anyOf branch)", async () => {
    const c = await loadPostman();
    const viaFile = evaluateProject([c], [{ kind: "file", path: "src/api/openapi.yaml" }]);
    expect(viaFile.grantedBadges.map((b) => b.badgeId)).toContain("spec-author");

    const viaTool = evaluateProject([c], [
      { kind: "mcp_tool", server: "postman", tool: "generate-spec" },
    ]);
    expect(viaTool.grantedBadges.map((b) => b.badgeId)).toContain("spec-author");
  });

  it("upgrades to the gold run-collection badge on the 10th run", async () => {
    const c = await loadPostman();
    const runs = (n: number): Signal[] =>
      Array.from({ length: n }, () => ({ kind: "mcp_tool", server: "postman", tool: "run-collection" }));

    const nine = evaluateProject([c], runs(9)).grantedBadges.map((b) => b.badgeId);
    expect(nine).toContain("collection-runner");
    expect(nine).not.toContain("collection-runner-gold");

    const ten = evaluateProject([c], runs(10)).grantedBadges.map((b) => b.badgeId);
    expect(ten).toContain("collection-runner-gold");
  });

  it("holds Agent-Ready pending until the llm_judge verdict clears the bar", async () => {
    const c = await loadPostman();
    const signals: Signal[] = [{ kind: "file", path: "api/openapi.yaml", content: "openapi: 3.0.0" }];

    const pendingState = evaluateProject([c], signals);
    expect(pendingState.pending.length).toBeGreaterThan(0);
    expect(pendingState.grantedBadges.map((b) => b.badgeId)).not.toContain("agent-ready");

    // Simulate the engine running the judge and caching a passing verdict.
    const req = pendingState.pending[0];
    const judged = evaluateProject([c], signals, new Map([[req.key, { confidence: 0.92 }]]));
    expect(judged.grantedBadges.map((b) => b.badgeId)).toContain("agent-ready");

    // Sanity: our key derivation matches what the objective's matcher produces.
    const objective = c.bestPractices.find((o) => o.id === "agent-ready-descriptions")!;
    expect(judgeKey(objective.criteria as any)).toBe(req.key);
  });
});
