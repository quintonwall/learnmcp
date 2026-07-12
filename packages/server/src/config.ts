import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CartridgeRegistry, defaultSources } from "./registry.js";
import { SqliteStore } from "./store.js";
import { ProgressService } from "./service.js";

/**
 * Shared runtime wiring used by BOTH the MCP server (bin.ts) and the hook CLI (cli.ts),
 * so they resolve the same cartridge sources, database, and project scope. This is what
 * lets hooks write signals to the exact store the MCP server reads.
 *
 * Env:
 *   LEARNMCP_PROJECT     project dir = progress scope        (default: cwd)
 *   LEARNMCP_DB          sqlite path                         (default: ~/.learnmcp/state.sqlite)
 *   LEARNMCP_CARTRIDGES  extra cartridge dirs, ':'-separated (highest precedence)
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

/** Where generated / user cartridges are written (second-highest precedence source). */
export function userCartridgesDir(): string {
  return path.join(os.homedir(), ".learnmcp", "cartridges");
}

/** Bundled first-party cartridges ship lowest-precedence (repo/cartridges in dev). */
export function bundledCartridgesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "cartridges");
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
