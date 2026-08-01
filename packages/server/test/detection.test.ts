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

/**
 * The tool surface the Postman MCP server actually exposes, taken from the `allowed-tools`
 * declarations shipped in the official Postman Claude Code plugin. The cartridge's first
 * version invented names from the plugin's *slash commands* (`mock`, `run-collection`),
 * none of which exist as MCP tools — so three of four objectives could never fire. This
 * list is the guard against that regressing.
 */
const REAL_POSTMAN_MCP_TOOLS = new Set([
  "authenticate",
  "complete_authentication",
  "createCollectionFolder",
  "createCollectionRequest",
  "createCollectionResponse",
  "createEnvironment",
  "createMock",
  "createSpec",
  "generateCollection",
  "getAllSpecs",
  "getAsyncSpecTaskStatus",
  "getAuthenticatedUser",
  "getCollection",
  "getCollectionRequest",
  "getCollectionResponse",
  "getCollectionUpdatesTasks",
  "getCollections",
  "getEnabledTools",
  "getEnvironment",
  "getEnvironments",
  "getGeneratedCollectionSpecs",
  "getMock",
  "getMocks",
  "getSpecCollections",
  "getSpecDefinition",
  "getTaggedEntities",
  "getWorkspaces",
  "publishDocumentation",
  "publishMock",
  "putEnvironment",
  "runCollection",
  "searchLearningCenter",
  "searchPostmanElements",
  "syncCollectionWithSpec",
  "syncSpecWithCollection",
  "unpublishDocumentation",
  "unpublishMock",
  "updateCollectionRequest",
  "updateCollectionResponse",
  "updateSpecFile",
]);

/** Every command the official Postman plugin ships (its `commands/` directory). */
const REAL_POSTMAN_COMMANDS = [
  "deploy-flow",
  "docs",
  "generate-spec",
  "get-flow-run",
  "learn",
  "list-flows",
  "mock",
  "run-collection",
  "search",
  "security",
  "send-request",
  "setup",
  "sync",
  "test",
  "trigger-flow",
];

function collectMatchers(node: unknown, out: any[] = []): any[] {
  if (Array.isArray(node)) for (const v of node) collectMatchers(v, out);
  else if (node && typeof node === "object") {
    if ("type" in (node as any)) out.push(node);
    for (const v of Object.values(node as any)) collectMatchers(v, out);
  }
  return out;
}

describe("Postman cartridge — matchers match the real plugin surface", () => {
  it("is a valid cartridge", async () => {
    await expect(loadPostman()).resolves.toBeDefined();
  });

  it("only references MCP tools the Postman server actually exposes", async () => {
    const c = await loadPostman();
    const bogus = collectMatchers(c)
      .filter((m) => m.type === "mcp_tool")
      .filter((m) => !REAL_POSTMAN_MCP_TOOLS.has(m.tool))
      .map((m) => `${m.server}::${m.tool}`);
    expect(bogus).toEqual([]);
  });

  it("only references slash commands the Postman plugin actually ships", async () => {
    const c = await loadPostman();
    const bogus = collectMatchers(c)
      .filter((m) => m.type === "command")
      .filter((m) => {
        const re = new RegExp(`^(?:${m.name})$`);
        // `postman:.*` (the detect matcher) is a deliberate catch-all.
        return !REAL_POSTMAN_COMMANDS.some((cmd) => re.test(`postman:${cmd}`));
      })
      .map((m) => m.name);
    expect(bogus).toEqual([]);
  });
});

describe("Postman cartridge — the walkthrough, executed", () => {
  it("activates when a Postman tool is called or a command is run", async () => {
    const c = await loadPostman();
    expect(detectActive([c], [{ kind: "mcp.added", server: "postman" }])).toEqual(["postman"]);
    expect(detectActive([c], [{ kind: "command", name: "postman:setup" }])).toEqual(["postman"]);
    expect(detectActive([c], [{ kind: "mcp.added", server: "supabase" }])).toEqual([]);
    expect(detectActive([c], [{ kind: "command", name: "git:status" }])).toEqual([]);
  });

  it("leads with an objective reachable in minutes, not the whole spec workflow", async () => {
    const c = await loadPostman();
    const state = evaluateProject([c], [{ kind: "mcp.added", server: "postman" }]);
    expect(nextObjective(c, state)?.id).toBe("send-first-request");
  });

  it("covers the product broadly, not just the happy path", async () => {
    const c = await loadPostman();
    // A thin cartridge is the failure mode that makes learnmcp look inert: a developer
    // uses the tool all day and earns nothing.
    expect(c.objectives.length).toBeGreaterThanOrEqual(8);

    const covered = new Set(c.objectives.map((o) => o.id));
    for (const id of [
      "send-first-request",
      "generate-openapi-spec",
      "sync-collection",
      "create-mock-server",
      "save-examples",
      "use-environments",
      "run-collection",
      "security-audit",
      "publish-docs",
      "automate-with-flows",
    ]) {
      expect(covered, `missing objective: ${id}`).toContain(id);
    }
  });

  it("grants Spec Author via the command, the MCP tool, or the file", async () => {
    const c = await loadPostman();
    const granted = (s: Signal) =>
      evaluateProject([c], [s]).grantedBadges.map((b) => b.badgeId);

    expect(granted({ kind: "command", name: "postman:generate-spec" })).toContain("spec-author");
    expect(granted({ kind: "mcp_tool", server: "postman", tool: "createSpec" })).toContain(
      "spec-author",
    );
    expect(granted({ kind: "file", path: "src/api/openapi.yaml" })).toContain("spec-author");
  });

  it("grants the mock, security, and docs badges the plugin's own way", async () => {
    const c = await loadPostman();
    const granted = (s: Signal) =>
      evaluateProject([c], [s]).grantedBadges.map((b) => b.badgeId);

    // /postman:mock is a command; createMock is what it calls underneath.
    expect(granted({ kind: "command", name: "postman:mock" })).toContain("mocker");
    expect(granted({ kind: "mcp_tool", server: "postman", tool: "createMock" })).toContain("mocker");

    // /postman:security has NO dedicated MCP tool — the command is the only signal.
    expect(granted({ kind: "command", name: "postman:security" })).toContain("hardened");

    expect(granted({ kind: "command", name: "postman:docs" })).toContain("documentarian");
  });

  it("counts a collection run whether it came from the command, the tool, or the CLI", async () => {
    const c = await loadPostman();
    const granted = (s: Signal) =>
      evaluateProject([c], [s]).grantedBadges.map((b) => b.badgeId);

    expect(granted({ kind: "command", name: "postman:run-collection" })).toContain(
      "collection-runner",
    );
    expect(granted({ kind: "command", name: "postman:test" })).toContain("collection-runner");
    expect(granted({ kind: "mcp_tool", server: "postman", tool: "runCollection" })).toContain(
      "collection-runner",
    );
    expect(granted({ kind: "bash", command: "postman collection run 45288920-e06bf878" })).toContain(
      "collection-runner",
    );
  });

  it("upgrades to the gold run-collection badge on the 10th run", async () => {
    const c = await loadPostman();
    const runs = (n: number): Signal[] =>
      Array.from({ length: n }, () => ({ kind: "command", name: "postman:run-collection" }));

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
