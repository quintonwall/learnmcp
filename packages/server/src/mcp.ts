import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Signal } from "@learnmcp/schema";
import type { CartridgeRegistry } from "./registry.js";
import { ProgressService, type RecordResult } from "./service.js";
import type { ProgressStore } from "./store.js";
import { scanProject } from "./scanner.js";
import { generateCartridge } from "./generate.js";
import { httpFetchText, createAnthropicComplete } from "./generate-anthropic.js";
import { userCartridgesDir } from "./config.js";

export interface McpServerDeps {
  registry: CartridgeRegistry;
  store: ProgressStore;
  /** Default scope (project identifier) when a tool call omits one. */
  defaultScope: string;
  version?: string;
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

function summarizeRecord(r: RecordResult): RecordResult & { message: string } {
  const parts: string[] = [];
  for (const b of r.newBadges) parts.push(`🏅 ${b.name} (+${b.points})`);
  for (const o of r.newObjectives) parts.push(`✅ ${o.title}`);
  if (r.rank.next) {
    parts.push(`${r.rank.rank.name} · ${r.points} pts (${r.rank.pointsToNext} to ${r.rank.next.name})`);
  } else {
    parts.push(`${r.rank.rank.name} · ${r.points} pts`);
  }
  return { ...r, message: parts.join("  ·  ") };
}

/**
 * Build the learnmcp MCP server. Portable core — the same server is used by the
 * Claude Code plugin (fed by hooks) and by Codex (fed by scan_project + tool calls).
 */
export function createMcpServer(deps: McpServerDeps): McpServer {
  const { registry, store, defaultScope } = deps;
  const service = new ProgressService(registry, store);
  const scope = (s?: string) => s?.trim() || defaultScope;

  const server = new McpServer({
    name: "learnmcp",
    version: deps.version ?? "0.1.0",
  });

  server.registerTool(
    "record_activity",
    {
      title: "Record a session activity",
      description:
        "Ingest one observed signal (a bash command, file change, dependency, MCP server/tool use). Returns any newly-earned badges, completed objectives, and your current points/rank.",
      inputSchema: { signal: Signal, scope: z.string().optional() },
    },
    async ({ signal, scope: s }) => ok(summarizeRecord(service.record(scope(s), signal))),
  );

  server.registerTool(
    "learn_next",
    {
      title: "What to learn next",
      description:
        "Return the single best next objective for this project — a best practice or feature to try, with why it matters and a docs link.",
      inputSchema: { scope: z.string().optional() },
    },
    async ({ scope: s }) => {
      const rec = service.learnNext(scope(s));
      return ok(rec ?? { message: "Nothing suggested yet — add a cartridge or start building." });
    },
  );

  server.registerTool(
    "list_badges",
    {
      title: "List earned badges",
      description: "List earned badges with total points and current rank.",
      inputSchema: { scope: z.string().optional() },
    },
    async ({ scope: s }) => ok(service.listBadges(scope(s))),
  );

  server.registerTool(
    "progress",
    {
      title: "Progress summary",
      description:
        "Summarize progress: active cartridges, objectives completed vs. total, points, rank, and pending checks.",
      inputSchema: { scope: z.string().optional() },
    },
    async ({ scope: s }) => ok(service.progress(scope(s))),
  );

  server.registerTool(
    "scan_project",
    {
      title: "Scan a project",
      description:
        "Introspect a project directory (dependencies, files, configured MCP servers, skills) and record the resulting signals. Idempotent — safe to call on every session start.",
      inputSchema: { dir: z.string(), scope: z.string().optional() },
    },
    async ({ dir, scope: s }) => {
      const sc = scope(s);
      const signals = scanProject(dir);
      let last: RecordResult | null = null;
      for (const sig of signals) last = service.record(sc, sig);
      const result = last ?? service.recompute(sc);
      return ok({ scannedSignals: signals.length, ...summarizeRecord(result) });
    },
  );

  server.registerTool(
    "resolve_judgement",
    {
      title: "Resolve a subjective check",
      description:
        "Supply an LLM verdict (0–1 confidence) for a pending llm_judge check surfaced by record_activity/scan_project, then re-evaluate.",
      inputSchema: {
        key: z.string(),
        confidence: z.number().min(0).max(1),
        scope: z.string().optional(),
      },
    },
    async ({ key, confidence, scope: s }) =>
      ok(summarizeRecord(service.resolveJudgement(scope(s), key, confidence))),
  );

  server.registerTool(
    "list_cartridges",
    {
      title: "List installed cartridges",
      description: "List cartridges currently loaded in the registry.",
      inputSchema: {},
    },
    async () =>
      ok(
        registry.list().map((c) => ({
          id: c.id,
          name: c.provider.name,
          version: c.version,
          trust: c.trust,
          objectives: c.objectives.length,
          badges: c.badges.length,
        })),
      ),
  );

  server.registerTool(
    "generate_cartridge",
    {
      title: "Generate a cartridge from a docs URL",
      description:
        "Introspect a product's documentation at the given URL and author a learning cartridge for it (trust: generated). Writes it to the user cartridge dir and hot-loads it. Requires ANTHROPIC_API_KEY.",
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      try {
        const res = await generateCartridge({
          url,
          fetchText: httpFetchText,
          complete: createAnthropicComplete(),
          outDir: userCartridgesDir(),
          repair: true,
        });
        if (!res.ok) return ok({ error: res.error });
        await registry.reload();
        return ok({
          generated: res.cartridge.id,
          name: res.cartridge.provider.name,
          trust: res.cartridge.trust,
          objectives: res.cartridge.objectives.length,
          badges: res.cartridge.badges.length,
          path: res.path,
          note: "Generated cartridge — review before publishing to the registry.",
        });
      } catch (err) {
        return ok({ error: `generation failed: ${(err as Error).message}` });
      }
    },
  );

  server.registerTool(
    "reload_cartridges",
    {
      title: "Reload cartridges",
      description:
        "Re-scan cartridge source directories (project, user, registry cache) without restarting the server.",
      inputSchema: {},
    },
    async () => {
      const cartridges = await registry.reload();
      return ok({ reloaded: cartridges.length, ids: cartridges.map((c) => c.id) });
    },
  );

  return server;
}
