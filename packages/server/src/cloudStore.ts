import { Signal, rankForPoints } from "@learnmcp/schema";
import type { ProgressStore, StoredBadge, StoredObjective } from "./store.js";
import type { FetchLike } from "./remote.js";

/**
 * A ProgressStore backed by Supabase, for the remote MCP.
 *
 * ProgressStore is deliberately synchronous — the detection engine is pure and sync, and
 * that's worth keeping. So rather than making the whole interface async, a cloud request
 * runs as **hydrate → evaluate → flush**: pull this learner's state once, let the engine
 * work against memory, then write back only what changed. One round trip in, one out,
 * regardless of how many signals a call records.
 *
 * `scope` is the learner id here, not a project path: badges and points belong to a
 * person, which is what the leaderboard ranks.
 */

const IDEMPOTENT = new Set<Signal["kind"]>(["file", "dependency", "mcp.added", "skill", "env"]);

interface Row {
  [k: string]: unknown;
}

export interface CloudStoreOptions {
  url: string;
  /** service_role key — this store writes on behalf of every learner. */
  key: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class CloudStore implements ProgressStore {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  private signals: Signal[] = [];
  private badges: StoredBadge[] = [];
  private objectives: StoredObjective[] = [];
  private judgements = new Map<string, { confidence: number }>();

  private pendingSignals: Signal[] = [];
  private pendingBadges: StoredBadge[] = [];
  private pendingObjectives: StoredObjective[] = [];
  private pendingJudgements = new Map<string, number>();

  private learnerId?: string;

  constructor(opts: CloudStoreOptions) {
    this.base = opts.url.replace(/\/$/, "") + "/rest/v1";
    this.key = opts.key;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    this.now = opts.now ?? (() => Date.now());
    if (!this.fetchImpl) throw new Error("no fetch implementation available");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async req(method: string, path: string, body?: unknown, prefer?: string): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: this.headers(prefer ? { Prefer: prefer } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new Error(`supabase ${method} ${path} → ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
    return res;
  }

  /** Load one learner's full state into memory. Call before handing the store to the engine. */
  async hydrate(learnerId: string): Promise<void> {
    this.learnerId = learnerId;
    this.pendingSignals = [];
    this.pendingBadges = [];
    this.pendingObjectives = [];
    this.pendingJudgements = new Map();

    const q = `learner_id=eq.${learnerId}`;
    const [sig, bad, obj, jud] = await Promise.all([
      this.req("GET", `/learner_signals?${q}&select=payload&order=id.asc`).then((r) => r.json()),
      this.req("GET", `/learner_badges?${q}&select=cartridge_id,badge_id,name,points,earned_at`).then((r) => r.json()),
      this.req("GET", `/learner_objectives?${q}&select=cartridge_id,objective_id,completed_at`).then((r) => r.json()),
      this.req("GET", `/learner_judgements?${q}&select=key,confidence`).then((r) => r.json()),
    ]);

    this.signals = (sig as Row[]).flatMap((r) => {
      const parsed = Signal.safeParse(r.payload);
      return parsed.success ? [parsed.data] : []; // tolerate rows written by an older schema
    });
    this.badges = (bad as Row[]).map((r) => ({
      cartridgeId: r.cartridge_id as string,
      badgeId: r.badge_id as string,
      name: r.name as string,
      points: r.points as number,
      earnedAt: Date.parse(r.earned_at as string),
    }));
    this.objectives = (obj as Row[]).map((r) => ({
      cartridgeId: r.cartridge_id as string,
      objectiveId: r.objective_id as string,
      completedAt: Date.parse(r.completed_at as string),
    }));
    this.judgements = new Map(
      (jud as Row[]).map((r) => [r.key as string, { confidence: r.confidence as number }]),
    );
  }

  /** Write back everything the engine changed. Safe to call when nothing did. */
  async flush(): Promise<{ points: number }> {
    const learnerId = this.learnerId;
    if (!learnerId) throw new Error("flush() before hydrate()");

    if (this.pendingSignals.length) {
      // Idempotent kinds collide with the partial unique index by design; merge-duplicates
      // turns that collision into a no-op instead of a failed batch.
      await this.req(
        "POST",
        "/learner_signals",
        this.pendingSignals.map((s) => ({ learner_id: learnerId, kind: s.kind, payload: s })),
        "resolution=merge-duplicates,return=minimal",
      );
    }
    if (this.pendingBadges.length) {
      await this.req(
        "POST",
        "/learner_badges?on_conflict=learner_id,cartridge_id,badge_id",
        this.pendingBadges.map((b) => ({
          learner_id: learnerId,
          cartridge_id: b.cartridgeId,
          badge_id: b.badgeId,
          name: b.name,
          points: b.points,
        })),
        "resolution=ignore-duplicates,return=minimal",
      );
    }
    if (this.pendingObjectives.length) {
      await this.req(
        "POST",
        "/learner_objectives?on_conflict=learner_id,cartridge_id,objective_id",
        this.pendingObjectives.map((o) => ({
          learner_id: learnerId,
          cartridge_id: o.cartridgeId,
          objective_id: o.objectiveId,
        })),
        "resolution=ignore-duplicates,return=minimal",
      );
    }
    if (this.pendingJudgements.size) {
      await this.req(
        "POST",
        "/learner_judgements?on_conflict=learner_id,key",
        [...this.pendingJudgements].map(([key, confidence]) => ({
          learner_id: learnerId,
          key,
          confidence,
        })),
        "resolution=merge-duplicates,return=minimal",
      );
    }

    // Denormalised points/rank on the learner row are what the leaderboard reads. Rank
    // has to be recomputed here too — leaving it at its 'Novice' default made the board
    // disagree with what my_progress reported for the same learner.
    const points = this.badges.reduce((n, b) => n + b.points, 0);
    if (this.pendingBadges.length) {
      await this.req("PATCH", `/learners?id=eq.${learnerId}`, {
        points,
        rank: rankForPoints(points).rank.name,
        last_seen_at: new Date(this.now()).toISOString(),
      });
    }

    this.pendingSignals = [];
    this.pendingBadges = [];
    this.pendingObjectives = [];
    this.pendingJudgements = new Map();
    return { points };
  }

  // --- ProgressStore (synchronous, in-memory between hydrate and flush) -------------

  recordSignal(_scope: string, signal: Signal): void {
    if (IDEMPOTENT.has(signal.kind)) {
      const encoded = JSON.stringify(signal);
      if (this.signals.some((s) => s.kind === signal.kind && JSON.stringify(s) === encoded)) return;
    }
    this.signals.push(signal);
    this.pendingSignals.push(signal);
  }

  getSignals(): Signal[] {
    return this.signals;
  }

  getGrantedBadges(): StoredBadge[] {
    return this.badges;
  }

  grantBadge(_scope: string, badge: Omit<StoredBadge, "earnedAt">): boolean {
    if (this.badges.some((b) => b.cartridgeId === badge.cartridgeId && b.badgeId === badge.badgeId)) {
      return false;
    }
    const stored = { ...badge, earnedAt: this.now() };
    this.badges.push(stored);
    this.pendingBadges.push(stored);
    return true;
  }

  getCompletedObjectives(): StoredObjective[] {
    return this.objectives;
  }

  completeObjective(_scope: string, cartridgeId: string, objectiveId: string): boolean {
    if (this.objectives.some((o) => o.cartridgeId === cartridgeId && o.objectiveId === objectiveId)) {
      return false;
    }
    const stored = { cartridgeId, objectiveId, completedAt: this.now() };
    this.objectives.push(stored);
    this.pendingObjectives.push(stored);
    return true;
  }

  getJudgements(): Map<string, { confidence: number }> {
    return this.judgements;
  }

  setJudgement(_scope: string, key: string, confidence: number): void {
    this.judgements.set(key, { confidence });
    this.pendingJudgements.set(key, confidence);
  }

  close(): void {
    /* stateless HTTP — nothing to close */
  }
}
