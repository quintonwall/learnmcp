import {
  buildContext,
  evaluateMatcher,
  badgePoints,
  rankForPoints,
  type Cartridge,
  type Objective,
  type Signal,
  type JudgeRequest,
  type RankProgress,
} from "@learnmcp/schema";

export interface ObjectiveRef {
  cartridgeId: string;
  objectiveId: string;
  title: string;
  docs?: string;
  badge?: string;
}

export interface GrantedBadge {
  cartridgeId: string;
  badgeId: string;
  name: string;
  points: number;
}

export interface DetectionState {
  /** Cartridge ids whose `detect` matched the current project. */
  activeCartridgeIds: string[];
  completedObjectives: ObjectiveRef[];
  /** Badges earned — via a badge's own criteria or a completed objective's `badge`. */
  grantedBadges: GrantedBadge[];
  /** Total points from all earned badges. */
  points: number;
  /** Current rank and progress toward the next, derived from `points`. */
  rank: RankProgress;
  /** Unresolved subjective checks the caller should judge (LLM) then re-evaluate. */
  pending: JudgeRequest[];
}

/** Which of the given cartridges apply to a project, per their `detect` matchers. */
export function detectActive(
  cartridges: Cartridge[],
  signals: Signal[],
  judgements?: Map<string, { confidence: number }>,
): string[] {
  const ctx = buildContext(signals);
  if (judgements) ctx.judgements = judgements;
  return cartridges
    .filter((c) => c.detect.some((m) => evaluateMatcher(m, ctx).matched))
    .map((c) => c.id);
}

/**
 * Evaluate an installed set of cartridges against the session's signal history and
 * return everything the UI/store needs: active cartridges, completed objectives,
 * granted badges, and any pending LLM judgements.
 */
export function evaluateProject(
  cartridges: Cartridge[],
  signals: Signal[],
  judgements: Map<string, { confidence: number }> = new Map(),
): DetectionState {
  const ctx = buildContext(signals);
  ctx.judgements = judgements;

  const state: DetectionState = {
    activeCartridgeIds: [],
    completedObjectives: [],
    grantedBadges: [],
    points: 0,
    rank: rankForPoints(0),
    pending: [],
  };
  const grantedKeys = new Set<string>();
  const grant = (c: Cartridge, badgeId: string) => {
    const key = `${c.id}:${badgeId}`;
    if (grantedKeys.has(key)) return;
    grantedKeys.add(key);
    const badge = c.badges.find((b) => b.id === badgeId);
    state.grantedBadges.push({
      cartridgeId: c.id,
      badgeId,
      name: badge?.name ?? badgeId,
      points: badge ? badgePoints(badge) : 0,
    });
  };

  for (const c of cartridges) {
    if (c.detect.some((m) => evaluateMatcher(m, ctx).matched)) {
      state.activeCartridgeIds.push(c.id);
    }

    const allObjectives = [...c.objectives, ...c.bestPractices];
    for (const o of allObjectives) {
      const res = evaluateMatcher(o.criteria, ctx);
      state.pending.push(...res.pending);
      if (res.matched) {
        state.completedObjectives.push({
          cartridgeId: c.id,
          objectiveId: o.id,
          title: o.title,
          docs: o.docs,
          badge: o.badge,
        });
        if (o.badge) grant(c, o.badge);
      }
    }

    for (const b of c.badges) {
      if (!b.criteria) continue;
      const res = evaluateMatcher(b.criteria, ctx);
      state.pending.push(...res.pending);
      if (res.matched) grant(c, b.id);
    }
  }

  state.points = state.grantedBadges.reduce((sum, b) => sum + b.points, 0);
  state.rank = rankForPoints(state.points);
  return state;
}

/**
 * v1 recommendation: the first not-yet-completed objective, core objectives before
 * best-practices. Deliberately returns ONE suggestion to avoid nagging.
 */
export function nextObjective(
  cartridge: Cartridge,
  state: DetectionState,
): Objective | undefined {
  const done = new Set(
    state.completedObjectives
      .filter((o) => o.cartridgeId === cartridge.id)
      .map((o) => o.objectiveId),
  );
  return (
    cartridge.objectives.find((o) => !done.has(o.id)) ??
    cartridge.bestPractices.find((o) => !done.has(o.id))
  );
}
