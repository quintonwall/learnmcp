import { EventEmitter } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { validateCartridge, type Cartridge } from "@learnmcp/schema";

/**
 * Runtime cartridge registry. The server compiles in ZERO cartridges — it loads them
 * from source directories at runtime, so adding a cartridge never requires a redeploy.
 *
 * Sources are listed highest-precedence first (e.g. project, then user, then the
 * registry cache). Duplicate ids resolve to the highest-precedence source. Invalid
 * cartridges are skipped with a warning and never crash the server.
 */

export interface LoadedCartridge {
  cartridge: Cartridge;
  /** Absolute path the cartridge was loaded from. */
  file: string;
  /** Index into the sources array (0 = highest precedence). */
  sourceIndex: number;
}

export interface RegistryOptions {
  /** Directories to scan, highest precedence first. */
  sources: string[];
  onWarn?: (message: string) => void;
  /** Poll the filesystem instead of using native events. Deterministic; used in tests. */
  usePolling?: boolean;
}

export type RegistryEvent = "change";

export class CartridgeRegistry extends EventEmitter {
  private readonly sources: string[];
  private readonly onWarn: (m: string) => void;
  private readonly usePolling: boolean;
  private byId = new Map<string, LoadedCartridge>();
  private watcher?: FSWatcher;

  constructor(opts: RegistryOptions) {
    super();
    this.sources = opts.sources;
    this.onWarn = opts.onWarn ?? (() => {});
    this.usePolling = opts.usePolling ?? false;
  }

  /** (Re)scan every source directory and rebuild the registry. Safe to call anytime. */
  async load(): Promise<void> {
    const next = new Map<string, LoadedCartridge>();
    for (let i = 0; i < this.sources.length; i++) {
      const files = await this.jsonFilesIn(this.sources[i]);
      for (const file of files) {
        const loaded = await this.readOne(file, i);
        if (!loaded) continue;
        const id = loaded.cartridge.id;
        const existing = next.get(id);
        if (existing) {
          const winner = existing.sourceIndex <= i ? existing : loaded;
          const loser = existing.sourceIndex <= i ? loaded : existing;
          // Only worth saying when the versions actually differ. The registry cache
          // mirrors the same cartridges that ship bundled, so identical shadowing is the
          // normal case — warning on it once per source per load is pure noise, and hooks
          // run this on every tool use.
          if (winner.cartridge.version !== loser.cartridge.version) {
            this.onWarn(
              `cartridge "${id}" v${loser.cartridge.version} at ${loser.file} shadowed by ` +
                `v${winner.cartridge.version} at ${winner.file}`,
            );
          }
          if (winner === existing) continue;
        }
        next.set(id, loaded);
      }
    }
    this.byId = next;
  }

  /** Explicit refresh — backs the `reload_cartridges` tool / `/cartridge reload`. */
  async reload(): Promise<Cartridge[]> {
    await this.load();
    this.emit("change", this.list());
    return this.list();
  }

  /**
   * Start watching source dirs; hot-reloads on add/change/unlink and emits "change".
   * Resolves once the watcher is live (chokidar only emits reliably after `ready`),
   * so callers can trust that subsequent filesystem changes will be picked up.
   */
  async watch(): Promise<void> {
    if (this.watcher) return;
    const watcher = chokidar.watch(this.sources, {
      ignoreInitial: true,
      depth: 2,
      usePolling: this.usePolling,
      interval: 50,
    });
    this.watcher = watcher;
    const onFsEvent = (p: string) => {
      if (!p.endsWith(".json")) return;
      void this.reload();
    };
    watcher.on("add", onFsEvent).on("change", onFsEvent).on("unlink", onFsEvent);
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  list(): Cartridge[] {
    return [...this.byId.values()].map((l) => l.cartridge);
  }

  get(id: string): Cartridge | undefined {
    return this.byId.get(id)?.cartridge;
  }

  getLoaded(id: string): LoadedCartridge | undefined {
    return this.byId.get(id);
  }

  size(): number {
    return this.byId.size;
  }

  private async readOne(
    file: string,
    sourceIndex: number,
  ): Promise<LoadedCartridge | undefined> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      this.onWarn(`skipping ${file}: not valid JSON (${(err as Error).message})`);
      return undefined;
    }
    const result = validateCartridge(parsed);
    if (!result.ok) {
      this.onWarn(`skipping ${file}: invalid cartridge — ${result.error}`);
      return undefined;
    }
    return { cartridge: result.cartridge, file, sourceIndex };
  }

  /** All *.json under a dir, up to 2 levels deep. Missing dirs are simply empty. */
  private async jsonFilesIn(dir: string, depth = 2): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return []; // source dir doesn't exist yet — fine
    }
    const out: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) {
        out.push(...(await this.jsonFilesIn(full, depth - 1)));
      } else if (e.isFile() && e.name.endsWith(".json")) {
        out.push(full);
      }
    }
    return out;
  }
}

/** Default source precedence: project → user → registry cache. */
export function defaultSources(opts: {
  projectDir?: string;
  homeDir: string;
  cacheDir?: string;
}): string[] {
  const sources: string[] = [];
  if (opts.projectDir) sources.push(path.join(opts.projectDir, ".learnmcp", "cartridges"));
  sources.push(path.join(opts.homeDir, ".learnmcp", "cartridges"));
  sources.push(opts.cacheDir ?? path.join(opts.homeDir, ".learnmcp", "registry-cache"));
  return sources;
}
