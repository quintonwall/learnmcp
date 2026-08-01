import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { Signal } from "@learnmcp/schema";

/**
 * Resolved lazily, on first SqliteStore construction — NOT at module load.
 *
 * `node:sqlite` only exists in Node 22.5+, but this module is reachable from the package
 * entrypoint, which the hosted MCP server imports on Vercel. Loading it eagerly would
 * crash the whole serverless function on an older runtime over a store it never uses.
 *
 * createRequire keeps bundlers (vitest/vite) from pre-resolving the builtin at transform
 * time; the type-only import above preserves types.
 */
let DatabaseSync: typeof import("node:sqlite").DatabaseSync | undefined;

function loadSqlite(): typeof import("node:sqlite").DatabaseSync {
  if (DatabaseSync) return DatabaseSync;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite"));
  } catch (err) {
    throw new Error(
      `local progress storage needs Node 22.5+ for node:sqlite (${(err as Error).message}). ` +
        "Upgrade Node, or use the hosted server instead of LEARNMCP_LOCAL=1.",
    );
  }
  return DatabaseSync!;
}

/**
 * Persistent progress store backed by Node's built-in SQLite (no native dep).
 *
 * We keep an append-only log of signals plus the *derived* facts we care about
 * historically (when a badge/objective was first earned, cached judge verdicts).
 * Current state is always recomputed from signals via the detection engine — the
 * store just remembers what's already been credited so we can report deltas.
 *
 * `scope` isolates progress per project/workspace (e.g. an absolute project path).
 */

export interface StoredBadge {
  cartridgeId: string;
  badgeId: string;
  name: string;
  points: number;
  earnedAt: number;
}

export interface StoredObjective {
  cartridgeId: string;
  objectiveId: string;
  completedAt: number;
}

export interface ProgressStore {
  recordSignal(scope: string, signal: Signal): void;
  getSignals(scope: string): Signal[];
  getGrantedBadges(scope: string): StoredBadge[];
  /** Persist a grant; returns true if it was newly granted (false if already held). */
  grantBadge(scope: string, badge: Omit<StoredBadge, "earnedAt">): boolean;
  getCompletedObjectives(scope: string): StoredObjective[];
  completeObjective(scope: string, cartridgeId: string, objectiveId: string): boolean;
  getJudgements(scope: string): Map<string, { confidence: number }>;
  setJudgement(scope: string, key: string, confidence: number): void;
  close(): void;
}

export interface SqliteStoreOptions {
  /** File path, or ":memory:" for an ephemeral store (tests). */
  path?: string;
  /** Injectable clock so tests are deterministic; defaults to Date.now. */
  now?: () => number;
}

export class SqliteStore implements ProgressStore {
  private db: DatabaseSyncT;
  private now: () => number;

  constructor(opts: SqliteStoreOptions = {}) {
    this.db = new (loadSqlite())(opts.path ?? ":memory:");
    this.now = opts.now ?? (() => Date.now());
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        kind  TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope);

      CREATE TABLE IF NOT EXISTS badges (
        scope TEXT NOT NULL,
        cartridge_id TEXT NOT NULL,
        badge_id TEXT NOT NULL,
        name TEXT NOT NULL,
        points INTEGER NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (scope, cartridge_id, badge_id)
      );

      CREATE TABLE IF NOT EXISTS objectives (
        scope TEXT NOT NULL,
        cartridge_id TEXT NOT NULL,
        objective_id TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (scope, cartridge_id, objective_id)
      );

      CREATE TABLE IF NOT EXISTS judgements (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        confidence REAL NOT NULL,
        PRIMARY KEY (scope, key)
      );
    `);
  }

  /**
   * State signals (a file exists, a dep is present, an MCP server is added) are
   * idempotent — re-scanning a project must not inflate counts. Activity signals
   * (`bash`, `mcp_tool`) are intentionally NOT deduped: their repetition is the count.
   */
  private static readonly IDEMPOTENT = new Set<Signal["kind"]>([
    "file",
    "dependency",
    "mcp.added",
    "skill",
    "env",
  ]);

  recordSignal(scope: string, signal: Signal): void {
    const payload = JSON.stringify(signal);
    if (SqliteStore.IDEMPOTENT.has(signal.kind)) {
      const dup = this.db
        .prepare("SELECT 1 FROM events WHERE scope = ? AND kind = ? AND payload = ? LIMIT 1")
        .get(scope, signal.kind, payload);
      if (dup) return;
    }
    this.db
      .prepare("INSERT INTO events (scope, kind, payload, ts) VALUES (?, ?, ?, ?)")
      .run(scope, signal.kind, payload, this.now());
  }

  getSignals(scope: string): Signal[] {
    const rows = this.db
      .prepare("SELECT payload FROM events WHERE scope = ? ORDER BY id ASC")
      .all(scope) as Array<{ payload: string }>;
    return rows.map((r) => Signal.parse(JSON.parse(r.payload)));
  }

  getGrantedBadges(scope: string): StoredBadge[] {
    const rows = this.db
      .prepare(
        "SELECT cartridge_id, badge_id, name, points, earned_at FROM badges WHERE scope = ? ORDER BY earned_at ASC",
      )
      .all(scope) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      cartridgeId: r.cartridge_id as string,
      badgeId: r.badge_id as string,
      name: r.name as string,
      points: r.points as number,
      earnedAt: r.earned_at as number,
    }));
  }

  grantBadge(scope: string, badge: Omit<StoredBadge, "earnedAt">): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO badges (scope, cartridge_id, badge_id, name, points, earned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(scope, badge.cartridgeId, badge.badgeId, badge.name, badge.points, this.now());
    return res.changes > 0;
  }

  getCompletedObjectives(scope: string): StoredObjective[] {
    const rows = this.db
      .prepare(
        "SELECT cartridge_id, objective_id, completed_at FROM objectives WHERE scope = ?",
      )
      .all(scope) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      cartridgeId: r.cartridge_id as string,
      objectiveId: r.objective_id as string,
      completedAt: r.completed_at as number,
    }));
  }

  completeObjective(scope: string, cartridgeId: string, objectiveId: string): boolean {
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO objectives (scope, cartridge_id, objective_id, completed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(scope, cartridgeId, objectiveId, this.now());
    return res.changes > 0;
  }

  getJudgements(scope: string): Map<string, { confidence: number }> {
    const rows = this.db
      .prepare("SELECT key, confidence FROM judgements WHERE scope = ?")
      .all(scope) as Array<{ key: string; confidence: number }>;
    return new Map(rows.map((r) => [r.key, { confidence: r.confidence }]));
  }

  setJudgement(scope: string, key: string, confidence: number): void {
    this.db
      .prepare(
        `INSERT INTO judgements (scope, key, confidence) VALUES (?, ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET confidence = excluded.confidence`,
      )
      .run(scope, key, confidence);
  }

  close(): void {
    this.db.close();
  }
}
