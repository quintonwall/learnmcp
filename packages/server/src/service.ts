import {
  rankForPoints,
  isComposite,
  type Signal,
  type JudgeRequest,
  type RankProgress,
  type Matcher,
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
  /**
   * Cartridges that became active *because of this signal*. Empty on recompute(), which
   * derives state from the whole log and so has no "before" to compare against.
   *
   * This is the only moment learnmcp can say "I know this tool" — without it, picking up
   * a new track is completely silent until the first badge lands, which reads as nothing
   * happening at all.
   */
  newCartridges: Array<{ id: string; name: string; objectives: number }>;
  /**
   * Set when this signal was the first sighting of an MCP server with no cartridge
   * detecting on it. Without this, adding a tool learnmcp doesn't know is silent — the
   * same silence a missing cartridge would produce, but here there's something concrete
   * to suggest: generate one, or check whether the registry already has it under review.
   */
  newMcpServerWithoutCartridge?: string;
  points: number;
  rank: RankProgress;
  /** Subjective checks awaiting an LLM verdict; resolve with resolveJudgement(). */
  pending: JudgeRequest[];
}

/** Does this detect matcher (searched recursively through allOf/anyOf/not) name this MCP server? */
function matcherReferencesMcpServer(m: Matcher, server: string): boolean {
  if (isComposite(m)) {
    if ("not" in m) return matcherReferencesMcpServer(m.not, server);
    const list = "allOf" in m ? m.allOf : m.anyOf;
    return list.some((x) => matcherReferencesMcpServer(x, server));
  }
  return (m.type === "mcp" || m.type === "mcp_tool") && m.server === server;
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
    const beforeSignals = this.store.getSignals(scope);
    // Snapshot which tracks were already known so we can tell the difference between
    // "postman track just activated" and "postman was already active". Evaluation is pure
    // and in-memory, so the extra pass is cheap.
    const before = new Set(
      evaluateProject(this.registry.list(), beforeSignals, this.store.getJudgements(scope))
        .activeCartridgeIds,
    );

    this.store.recordSignal(scope, signal);
    const result = this.recompute(scope);

    const byId = new Map(this.registry.list().map((c) => [c.id, c]));
    result.newCartridges = result.activeCartridgeIds
      .filter((id) => !before.has(id))
      .map((id) => {
        const c = byId.get(id);
        return {
          id,
          name: c?.provider.name ?? id,
          objectives: (c?.objectives.length ?? 0) + (c?.bestPractices.length ?? 0),
        };
      });

    if (signal.kind === "mcp.added") {
      const seenBefore = beforeSignals.some(
        (s) => s.kind === "mcp.added" && s.server === signal.server,
      );
      const hasCartridge = this.registry
        .list()
        .some((c) => c.detect.some((m) => matcherReferencesMcpServer(m, signal.server)));
      if (!seenBefore && !hasCartridge) result.newMcpServerWithoutCartridge = signal.server;
    }

    return result;
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
      newCartridges: [], // only record() has a before-state to diff against
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
   * The next thing to try. With no `cartridgeId`, one recommendation across everything —
   * active cartridges first, to avoid nagging about tools you haven't touched.
   *
   * With a `cartridgeId`, answers "what's next for X" / "I just added X, what should I do
   * first" for that cartridge specifically — regardless of whether it's active yet. That
   * matters because activation needs a recorded signal, and someone asking this question
   * in chat often hasn't triggered one: they installed the tool and are asking before
   * they've used it.
   */
  learnNext(scope: string, cartridgeId?: string): Recommendation | null {
    const signals = this.store.getSignals(scope);
    const judgements = this.store.getJudgements(scope);
    const cartridges = this.registry.list();
    const state = evaluateProject(cartridges, signals, judgements);

    const order = cartridgeId
      ? [cartridgeId]
      : state.activeCartridgeIds.length
        ? state.activeCartridgeIds
        : cartridges.map((c) => c.id);

    for (const id of order) {
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
      // An explicit ask for one cartridge stops here — falling through to "any other
      // cartridge" would silently answer a different question than the one asked.
      if (cartridgeId) return null;
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
