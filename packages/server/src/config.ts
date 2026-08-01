import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CartridgeRegistry, defaultSources } from "./registry.js";
import { SqliteStore } from "./store.js";
import { ProgressService } from "./service.js";
import { SyncService } from "./sync.js";
import { SupabaseBackend } from "./remote.js";

/**
 * Shared runtime wiring used by BOTH the MCP server (bin.ts) and the hook CLI (cli.ts),
 * so they resolve the same cartridge sources, database, and project scope. This is what
 * lets hooks write signals to the exact store the MCP server reads.
 *
 * Env:
 *   LEARNMCP_PROJECT     project dir = progress scope        (default: cwd)
 *   LEARNMCP_DB          sqlite path                         (default: ~/.learnmcp/state.sqlite)
 *   LEARNMCP_CARTRIDGES  extra cartridge dirs, ':'-separated (highest precedence)
 *
 * Optional server sync (see HOSTING.md) — all four required, or sync stays off:
 *   LEARNMCP_SERVER_URL  Supabase project URL
 *   LEARNMCP_SERVER_KEY  anon key, or a per-user JWT
 *   LEARNMCP_USER_ID     stable id for this user (must match the JWT's sub under RLS)
 *   LEARNMCP_HANDLE      optional display name for the leaderboard
 */

export interface Runtime {
  registry: CartridgeRegistry;
  store: SqliteStore;
  service: ProgressService;
  scope: string;
  dbPath: string;
}

export function resolveScope(project?: string): string {
  return project || process.env.LEARNMCP_PROJECT || process.cwd();
}

export function resolveDbPath(): string {
  return process.env.LEARNMCP_DB || path.join(os.homedir(), ".learnmcp", "state.sqlite");
}

/** Where cartridges pulled from the registry are cached (lowest-precedence source). */
export function registryCacheDir(): string {
  return path.join(os.homedir(), ".learnmcp", "registry-cache");
}

/**
 * Build a SyncService from the environment, or null when the server isn't configured.
 * Sync is strictly optional: learnmcp is local-first and fully functional offline.
 */
export function buildSync(service: ProgressService): SyncService | null {
  const url = process.env.LEARNMCP_SERVER_URL;
  const key = process.env.LEARNMCP_SERVER_KEY;
  const userId = process.env.LEARNMCP_USER_ID;
  if (!url || !key || !userId) return null;

  return new SyncService(service, new SupabaseBackend({ url, key }), {
    userId,
    handle: process.env.LEARNMCP_HANDLE,
  });
}

/** Where generated / user cartridges are written (second-highest precedence source). */
export function userCartridgesDir(): string {
  return path.join(os.homedir(), ".learnmcp", "cartridges");
}

/**
 * Bundled first-party cartridges, lowest precedence. Two layouts to support: a published
 * npm tarball (cartridges copied into the package by `prepack`) and this repo (a single
 * shared `cartridges/` at the root). Without the first, an `npx` install would start up
 * with zero cartridges and teach nothing.
 */
export function bundledCartridgesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // …/packages/server/dist
  const published = path.resolve(here, "..", "cartridges");
  const inRepo = path.resolve(here, "..", "..", "..", "cartridges");
  return existsSync(published) ? published : inRepo;
}

export function resolveSources(projectDir: string): string[] {
  const extra = (process.env.LEARNMCP_CARTRIDGES || "").split(":").filter(Boolean);
  return [...extra, ...defaultSources({ projectDir, homeDir: os.homedir() }), bundledCartridgesDir()];
}

export interface BuildRuntimeOptions {
  project?: string;
  watch?: boolean;
  onWarn?: (m: string) => void;
}

export async function buildRuntime(opts: BuildRuntimeOptions = {}): Promise<Runtime> {
  const scope = resolveScope(opts.project);
  const dbPath = resolveDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const registry = new CartridgeRegistry({
    sources: resolveSources(scope),
    onWarn: opts.onWarn ?? ((m) => console.error(`[learnmcp] ${m}`)),
  });
  await registry.load();
  if (opts.watch) await registry.watch();

  const store = new SqliteStore({ path: dbPath });
  const service = new ProgressService(registry, store);
  return { registry, store, service, scope, dbPath };
}
