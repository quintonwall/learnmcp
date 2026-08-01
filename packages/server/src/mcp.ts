import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Signal, validateCartridge } from "@learnmcp/schema";
import type { CartridgeRegistry } from "./registry.js";
import { ProgressService, type RecordResult } from "./service.js";
import type { ProgressStore } from "./store.js";
import { scanProject, claudeEnvSignals } from "./scanner.js";
import { generateCartridge } from "./generate.js";
import { httpFetchText, createAnthropicComplete } from "./generate-anthropic.js";
import { userCartridgesDir, registryCacheDir, buildSync } from "./config.js";
import { syncGithubCartridges, cartridgeRepoUrl } from "./github.js";
import type { IdentityStore, Learner } from "./identity.js";

export interface CloudContext {
  identity: IdentityStore;
  learner: Learner;
  /** Set only on the request that minted the learner — surfaced once so the client saves it. */
  issuedToken?: string;
  /** Base URL of the web app, for the claim link. */
  webUrl?: string;
}

export interface McpServerDeps {
  registry: CartridgeRegistry;
  store: ProgressStore;
  /** Default scope (project identifier) when a tool call omits one. */
  defaultScope: string;
  version?: string;
  /**
   * Present when running as the hosted remote MCP: progress belongs to a learner in the
   * database rather than a local file, and the identity/leaderboard tools are exposed.
   */
  cloud?: CloudContext;
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
      // Plugin/user-level MCP servers too — on Codex (no hooks) this scan is the only
      // chance to notice them, and the project itself never references them.
      const signals = [...scanProject(dir), ...claudeEnvSignals(homedir())];
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
    "add_cartridge",
    {
      title: "Add a cartridge",
      description:
        "Install a learning cartridge from its JSON document so learnmcp can teach a new service. Validated, written to the user cartridge dir, and hot-loaded immediately — no restart or redeploy. Use scope 'project' to check it into the current repo instead of installing it for just this user.",
      inputSchema: {
        cartridge: z
          .union([z.string(), z.record(z.unknown())])
          .describe("The cartridge document, as JSON text or an object."),
        scope: z.enum(["user", "project"]).optional(),
      },
    },
    async ({ cartridge, scope: where }) => {
      let parsed: unknown;
      try {
        parsed = typeof cartridge === "string" ? JSON.parse(cartridge) : cartridge;
      } catch (err) {
        return ok({ error: `not valid JSON: ${(err as Error).message}` });
      }

      // Validate before writing: an invalid cartridge is skipped at load time with only a
      // warning, which is a confusing way to find out it never installed.
      const res = validateCartridge(parsed);
      if (!res.ok) return ok({ error: `invalid cartridge: ${res.error}` });

      const dir =
        where === "project"
          ? path.join(defaultScope, ".learnmcp", "cartridges")
          : userCartridgesDir();
      const file = path.join(dir, `${res.cartridge.id}.json`);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, JSON.stringify(res.cartridge, null, 2));
      } catch (err) {
        return ok({ error: `could not write ${file}: ${(err as Error).message}` });
      }

      await registry.reload();
      const loaded = registry.list().some((c) => c.id === res.cartridge.id);
      return ok({
        added: res.cartridge.id,
        name: res.cartridge.provider.name,
        trust: res.cartridge.trust,
        objectives: res.cartridge.objectives.length,
        badges: res.cartridge.badges.length,
        path: file,
        loaded,
      });
    },
  );

  server.registerTool(
    "reload_cartridges",
    {
      title: "Reload cartridges",
      description:
        "Refresh the cartridge registry from GitHub and re-scan local sources (project, user, cache) without restarting. Picks up cartridges merged into the repo since the last refresh.",
      inputSchema: {
        skipFetch: z
          .boolean()
          .optional()
          .describe("Reload from local sources only, without hitting GitHub."),
      },
    },
    async ({ skipFetch }) => {
      // Refresh from the GitHub registry first so a merged PR shows up in the same call.
      // Best-effort: offline, or a rate-limit, must still allow a local reload.
      let fetched: Awaited<ReturnType<typeof syncGithubCartridges>> | null = null;
      let fetchError: string | undefined;
      if (!skipFetch) {
        try {
          fetched = await syncGithubCartridges(registryCacheDir(), {});
        } catch (err) {
          fetchError = (err as Error).message;
        }
      }

      const cartridges = await registry.reload();
      return ok({
        reloaded: cartridges.length,
        ids: cartridges.map((c) => c.id),
        registry: {
          source: `${cartridgeRepoUrl()} (open a PR to add one)`,
          fetched: fetched?.cartridges.length ?? 0,
          skipped: fetched?.skipped ?? [],
          ...(fetchError ? { error: fetchError, note: "served from the local cache" } : {}),
        },
      });
    },
  );

  server.registerTool(
    "sync_progress",
    {
      title: "Sync progress to the server",
      description:
        "Push earned badges, points, and rank to the configured learnmcp server (profile + leaderboards), and pull approved community cartridges. No-op if the server isn't configured.",
      inputSchema: { scope: z.string().optional() },
    },
    async ({ scope: s }) => {
      const sync = buildSync(service);
      if (!sync) {
        return ok({
          synced: false,
          reason:
            "server not configured — set LEARNMCP_SERVER_URL, LEARNMCP_SERVER_KEY, and LEARNMCP_USER_ID (see HOSTING.md)",
        });
      }
      const pushed = await sync.pushProgress(scope(s));
      const pulled = await sync.pullCartridges(registryCacheDir());
      await registry.reload();
      return ok({ synced: true, ...pushed, pulledFromRegistry: pulled.length });
    },
  );

  if (deps.cloud) registerCloudTools(server, service, deps.cloud, scope);

  return server;
}

/**
 * Identity and leaderboard tools — only meaningful when progress lives in the database,
 * so they're registered for the hosted remote MCP and absent from the local server.
 */
function registerCloudTools(
  server: McpServer,
  service: ProgressService,
  cloud: CloudContext,
  scope: (s?: string) => string,
): void {
  const { identity, learner } = cloud;

  server.registerTool(
    "my_progress",
    {
      title: "My points, rank and standing",
      description:
        "Your total points, current rank, how far to the next one, badge count, and your position on the global leaderboard.",
      inputSchema: {},
    },
    async () => {
      const local = service.listBadges(scope());
      const board = await identity.leaderboard(500).catch(() => []);
      const me = board.find((r) => r.points === local.points);
      return ok({
        learnerId: learner.id,
        handle: learner.handle,
        claimed: learner.claimed,
        points: local.points,
        rank: local.rank.rank.name,
        nextRank: local.rank.next?.name ?? null,
        pointsToNextRank: local.rank.pointsToNext ?? null,
        badges: local.badges.length,
        leaderboardPosition: me?.position ?? null,
        ...(learner.claimed
          ? {}
          : { tip: "You're anonymous. Run claim_profile to put a handle on the leaderboard." }),
      });
    },
  );

  server.registerTool(
    "my_badges",
    {
      title: "My badges",
      description: "Every badge you've earned, with tier points and which cartridge awarded it.",
      inputSchema: {},
    },
    async () => {
      const { badges, points, rank } = service.listBadges(scope());
      return ok({
        points,
        rank: rank.rank.name,
        badges: badges.map((b) => ({
          name: b.name,
          cartridge: b.cartridgeId,
          points: b.points,
          earnedAt: new Date(b.earnedAt).toISOString(),
        })),
      });
    },
  );

  server.registerTool(
    "leaderboard",
    {
      title: "Learner leaderboard",
      description:
        "Top learners by points. Pass a cartridge id for that cartridge's board instead of the global one.",
      inputSchema: {
        cartridge: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ cartridge, limit }) => {
      try {
        return ok(
          cartridge
            ? { cartridge, entries: await identity.cartridgeLeaderboard(cartridge, limit ?? 10) }
            : { entries: await identity.leaderboard(limit ?? 20) },
        );
      } catch (err) {
        return ok({ error: `leaderboard unavailable: ${(err as Error).message}` });
      }
    },
  );

  server.registerTool(
    "cartridge_popularity",
    {
      title: "Which cartridges people actually use",
      description: "Distinct learners and points awarded per cartridge, most-used first.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ cartridges: await identity.popularity() });
      } catch (err) {
        return ok({ error: `popularity unavailable: ${(err as Error).message}` });
      }
    },
  );

  server.registerTool(
    "claim_profile",
    {
      title: "Claim your profile",
      description:
        "Link your anonymous progress to a signed-in account so your handle appears on the leaderboard. Returns a URL to open; progress is already saved either way.",
      inputSchema: {},
    },
    async () => {
      if (learner.claimed) {
        return ok({ claimed: true, handle: learner.handle, message: "Already claimed." });
      }
      const web = cloud.webUrl ?? "https://learnmcp.dev";
      return ok({
        claimed: false,
        url: `${web.replace(/\/$/, "")}/claim?learner=${learner.id}`,
        message:
          "Open this URL and sign in with GitHub to claim your progress. Nothing is lost if you don't — your badges are already saved.",
      });
    },
  );
}
