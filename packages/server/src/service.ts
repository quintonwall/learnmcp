import {
  rankForPoints,
  type Signal,
  type JudgeRequest,
  type RankProgress,
} from "@learnmcp/schema";
import type { CartridgeRegistry } from "./registry.js";
import type { ProgressStore, StoredBadge } from "./store.js";
import {
  evaluateProject,
  nextObjective,
  type GrantedBadge,
  type ObjectiveRef,
} from "./detection.js";

export interface RecordResult {
  /** Badges newly earned by this signal (not previously credited). */
  newBadges: GrantedBadge[];
  /** Objectives newly completed by this signal. */
  newObjectives: ObjectiveRef[];
  activeCartridgeIds: string[];
  points: number;
  rank: RankProgress;
  /** Subjective checks awaiting an LLM verdict; resolve with resolveJudgement(). */
  pending: JudgeRequest[];
}

export interface Recommendation {
  cartridgeId: string;
  objectiveId: string;
  title: string;
  why?: string;
  docs?: string;
  badge?: string;
}

/**
 * The engine's stateful facade: ingest signals, persist progress, and answer
 * "what have I earned?" / "what should I do next?". Detection state is always
 * recomputed from the signal log so it stays consistent as cartridges change; the
 * store only remembers what's already been credited (for deltas + earned-at history).
 */
export class ProgressService {
  constructor(
    private readonly registry: CartridgeRegistry,
    private readonly store: ProgressStore,
  ) {}

  /** Ingest a signal, persist any newly-earned badges/objectives, return the deltas. */
  record(scope: string, signal: Signal): RecordResult {
    this.store.recordSignal(scope, signal);
    return this.recompute(scope);
  }

  /** Recompute state from the full signal log and reconcile it with the store. */
  recompute(scope: string): RecordResult {
    const signals = this.store.getSignals(scope);
    const judgements = this.store.getJudgements(scope);
    const state = evaluateProject(this.registry.list(), signals, judgements);

    const newBadges = state.grantedBadges.filter((b) =>
      this.store.grantBadge(scope, {
        cartridgeId: b.cartridgeId,
        badgeId: b.badgeId,
        name: b.name,
        points: b.points,
      }),
    );
    const newObjectives = state.completedObjectives.filter((o) =>
      this.store.completeObjective(scope, o.cartridgeId, o.objectiveId),
    );

    return {
      newBadges,
      newObjectives,
      activeCartridgeIds: state.activeCartridgeIds,
      points: state.points,
      rank: state.rank,
      pending: state.pending,
    };
  }

  /** Resolve a subjective (llm_judge) check, then re-evaluate. */
  resolveJudgement(scope: string, key: string, confidence: number): RecordResult {
    this.store.setJudgement(scope, key, confidence);
    return this.recompute(scope);
  }

  /**
   * The next thing to try — one recommendation, to avoid nagging. Prefers active
   * cartridges (their `detect` matched this project) with an unfinished objective.
   */
  learnNext(scope: string): Recommendation | null {
    const signals = this.store.getSignals(scope);
    const judgements = this.store.getJudgements(scope);
    const cartridges = this.registry.list();
    const state = evaluateProject(cartridges, signals, judgements);

    const active = state.activeCartridgeIds.length
      ? state.activeCartridgeIds
      : cartridges.map((c) => c.id);

    for (const id of active) {
      const cartridge = cartridges.find((c) => c.id === id);
      if (!cartridge) continue;
      const obj = nextObjective(cartridge, {
        ...state,
        // nextObjective only reads completedObjectives for this cartridge
      });
      if (obj) {
        return {
          cartridgeId: cartridge.id,
          objectiveId: obj.id,
          title: obj.title,
          why: obj.why,
          docs: obj.docs,
          badge: obj.badge,
        };
      }
    }
    return null;
  }

  listBadges(scope: string): {
    badges: StoredBadge[];
    points: number;
    rank: RankProgress;
  } {
    const badges = this.store.getGrantedBadges(scope);
    const points = badges.reduce((sum, b) => sum + b.points, 0);
    return { badges, points, rank: rankForPoints(points) };
  }

  progress(scope: string): {
    activeCartridgeIds: string[];
    points: number;
    rank: RankProgress;
    cartridges: Array<{ id: string; completed: number; total: number }>;
    earnedBadges: number;
    pending: number;
  } {
    const signals = this.store.getSignals(scope);
    const judgements = this.store.getJudgements(scope);
    const cartridges = this.registry.list();
    const state = evaluateProject(cartridges, signals, judgements);
    const completedByCartridge = new Map<string, number>();
    for (const o of state.completedObjectives) {
      completedByCartridge.set(o.cartridgeId, (completedByCartridge.get(o.cartridgeId) ?? 0) + 1);
    }
    return {
      activeCartridgeIds: state.activeCartridgeIds,
      points: state.points,
      rank: state.rank,
      cartridges: state.activeCartridgeIds.map((id) => {
        const c = cartridges.find((x) => x.id === id)!;
        return {
          id,
          completed: completedByCartridge.get(id) ?? 0,
          total: c.objectives.length + c.bestPractices.length,
        };
      }),
      earnedBadges: this.store.getGrantedBadges(scope).length,
      pending: state.pending.length,
    };
  }
}
