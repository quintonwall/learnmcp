import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CartridgeRegistry } from "../src/registry.js";
import { SqliteStore } from "../src/store.js";
import { ProgressService } from "../src/service.js";
import { scanProject } from "../src/scanner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundledCartridges = path.resolve(here, "../../../cartridges");

const SCOPE = "/proj/demo";

describe("SqliteStore + ProgressService (in-memory)", () => {
  let registry: CartridgeRegistry;
  let store: SqliteStore;
  let service: ProgressService;
  let clock: number;

  beforeEach(async () => {
    registry = new CartridgeRegistry({ sources: [bundledCartridges] });
    await registry.load();
    clock = 1000;
    store = new SqliteStore({ path: ":memory:", now: () => clock++ });
    service = new ProgressService(registry, store);
  });

  afterEach(() => store.close());

  it("persists a signal log and credits a badge exactly once", () => {
    const r1 = service.record(SCOPE, { kind: "file", path: "src/api/openapi.yaml" });
    expect(r1.newBadges.map((b) => b.badgeId)).toContain("spec-author");
    expect(r1.points).toBeGreaterThan(0);

    // Same fact again → idempotent: no new badge, no duplicate signal.
    const r2 = service.record(SCOPE, { kind: "file", path: "src/api/openapi.yaml" });
    expect(r2.newBadges).toHaveLength(0);
    expect(store.getSignals(SCOPE)).toHaveLength(1);
    expect(store.getGrantedBadges(SCOPE)).toHaveLength(1);
  });

  it("counts non-idempotent activity signals and awards the gold threshold badge", () => {
    let last;
    for (let i = 0; i < 10; i++) {
      last = service.record(SCOPE, { kind: "mcp_tool", server: "postman", tool: "run-collection" });
    }
    expect(store.getSignals(SCOPE)).toHaveLength(10);
    const ids = store.getGrantedBadges(SCOPE).map((b) => b.badgeId);
    expect(ids).toContain("collection-runner");
    expect(ids).toContain("collection-runner-gold");
    // The gold badge is only newly-granted on the 10th call.
    expect(last!.newBadges.map((b) => b.badgeId)).toContain("collection-runner-gold");
  });

  it("recommends the first objective of an active cartridge", () => {
    service.record(SCOPE, { kind: "mcp.added", server: "postman" });
    const rec = service.learnNext(SCOPE);
    expect(rec?.cartridgeId).toBe("postman");
    expect(rec?.objectiveId).toBe("generate-openapi-spec");
    expect(rec?.docs).toBeTruthy();
  });

  it("holds an llm_judge badge until a verdict is resolved", () => {
    const rec = service.record(SCOPE, { kind: "file", path: "api/openapi.yaml", content: "openapi: 3.0.0" });
    const judge = rec.pending.find((p) => p.files.some((f) => f.path === "api/openapi.yaml"));
    expect(judge, "expected a pending judge over the openapi file").toBeTruthy();
    expect(rec.newBadges.map((b) => b.badgeId)).not.toContain("agent-ready");

    const resolved = service.resolveJudgement(SCOPE, judge!.key, 0.95);
    expect(resolved.newBadges.map((b) => b.badgeId)).toContain("agent-ready");
  });

  it("accumulates points into a rank", () => {
    service.record(SCOPE, { kind: "mcp.added", server: "postman" });
    service.record(SCOPE, { kind: "mcp_tool", server: "postman", tool: "generate-spec" });
    const { points, rank } = service.listBadges(SCOPE);
    expect(points).toBeGreaterThanOrEqual(10);
    expect(rank.rank.name).not.toBe("Novice");
  });

  it("survives reopening the same database file (durable)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "learnmcp-db-"));
    const dbPath = path.join(dir, "state.sqlite");
    try {
      const s1 = new SqliteStore({ path: dbPath });
      const svc1 = new ProgressService(registry, s1);
      svc1.record(SCOPE, { kind: "mcp_tool", server: "postman", tool: "generate-spec" });
      s1.close();

      const s2 = new SqliteStore({ path: dbPath });
      expect(s2.getGrantedBadges(SCOPE).map((b) => b.badgeId)).toContain("spec-author");
      s2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("scanProject", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "learnmcp-scan-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("emits dependency, file, and mcp signals from a project", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@playwright/test": "^1.0.0" } }),
    );
    await writeFile(path.join(dir, ".gitignore"), "node_modules\n.env\n");
    await writeFile(
      path.join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { postman: { command: "x" } } }),
    );

    const signals = scanProject(dir);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("dependency");
    expect(kinds).toContain("mcp.added");
    const gitignore = signals.find((s) => s.kind === "file" && s.path === ".gitignore");
    expect(gitignore && "content" in gitignore ? gitignore.content : "").toContain(".env");

    // Feeding the scan activates cartridges and credits already-satisfied work.
    const registry = new CartridgeRegistry({ sources: [bundledCartridges] });
    await registry.load();
    const store = new SqliteStore({ path: ":memory:" });
    const service = new ProgressService(registry, store);
    for (const s of signals) service.record("scan-scope", s);
    expect(service.progress("scan-scope").activeCartridgeIds).toEqual(
      expect.arrayContaining(["playwright", "postman"]),
    );
    store.close();
  });
});
