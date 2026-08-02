import type { Badge, BadgeTier } from "./cartridge.js";

/**
 * Points & ranks — the meta-progression layer above badges. Every earned badge is worth
 * points (by tier, or an explicit `points` override on the badge). Accumulated points
 * unlock ranks at fixed thresholds.
 */

export const TIER_POINTS: Record<BadgeTier, number> = {
  bronze: 10,
  silver: 25,
  gold: 100,
  platinum: 250,
};

/** Fallback for a badge with neither `points` nor `tier`. */
export const UNTIERED_POINTS = 5;

export function badgePoints(badge: Pick<Badge, "points" | "tier">): number {
  if (typeof badge.points === "number") return badge.points;
  return badge.tier ? TIER_POINTS[badge.tier] : UNTIERED_POINTS;
}

export interface Rank {
  /** Minimum cumulative points to hold this rank. */
  threshold: number;
  name: string;
}

/**
 * The rank ladder. Badges are one-time grants, so total points are capped by the
 * cartridge catalog's size, not by how long anyone uses a tool — mastering every badge
 * in every cartridge shipped today (16 of them) tops out at ~6,400 points. Thresholds
 * are calibrated against an estimated ~50-cartridge catalog (~450 avg pts/cartridge
 * fully mastered, a ~22k-point ceiling), with Legend set near that ceiling so it still
 * requires broad, sustained use across most of the catalog rather than one tool
 * mastered deeply. Revisit the top of the ladder as the catalog grows past that
 * estimate.
 */
export const RANKS: Rank[] = [
  { threshold: 0, name: "Novice" },
  { threshold: 10, name: "Initiate" },
  { threshold: 100, name: "Apprentice" },
  { threshold: 300, name: "Journeyman" },
  { threshold: 750, name: "Adept" },
  { threshold: 1_500, name: "Expert" },
  { threshold: 3_500, name: "Master" },
  { threshold: 10_000, name: "Grandmaster" },
  { threshold: 20_000, name: "Legend" },
];

export interface RankProgress {
  rank: Rank;
  /** Index into RANKS (0 = Novice). */
  index: number;
  points: number;
  /** The next rank, or undefined once maxed out. */
  next?: Rank;
  /** Points still needed to reach `next`; undefined at max rank. */
  pointsToNext?: number;
  /** Progress through the current band toward `next`, in [0, 1]. */
  progress: number;
}

export function rankForPoints(points: number): RankProgress {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (points >= RANKS[i].threshold) index = i;
  }
  const rank = RANKS[index];
  const next = RANKS[index + 1];
  if (!next) return { rank, index, points, progress: 1 };
  const span = next.threshold - rank.threshold;
  const into = points - rank.threshold;
  return {
    rank,
    index,
    points,
    next,
    pointsToNext: next.threshold - points,
    progress: span > 0 ? Math.min(1, into / span) : 0,
  };
}
