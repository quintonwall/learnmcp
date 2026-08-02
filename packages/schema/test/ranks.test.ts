import { describe, it, expect } from "vitest";
import { badgePoints, rankForPoints, RANKS, TIER_POINTS } from "../src/index.js";

describe("badgePoints", () => {
  it("uses tier defaults, and honors an explicit override", () => {
    expect(badgePoints({ tier: "bronze" })).toBe(TIER_POINTS.bronze);
    expect(badgePoints({ tier: "gold" })).toBe(TIER_POINTS.gold);
    expect(badgePoints({})).toBe(5); // untiered fallback
    expect(badgePoints({ tier: "bronze", points: 999 })).toBe(999);
  });
});

describe("rankForPoints", () => {
  it("maps points onto the ladder at the spec thresholds", () => {
    expect(rankForPoints(0).rank.name).toBe("Novice");
    expect(rankForPoints(9).rank.name).toBe("Novice");
    expect(rankForPoints(10).rank.name).toBe("Initiate");
    expect(rankForPoints(100).rank.name).toBe("Apprentice");
    expect(rankForPoints(300).rank.name).toBe("Journeyman");
    expect(rankForPoints(750).rank.name).toBe("Adept");
    expect(rankForPoints(1_500).rank.name).toBe("Expert");
    expect(rankForPoints(3_500).rank.name).toBe("Master");
    expect(rankForPoints(10_000).rank.name).toBe("Grandmaster");
    expect(rankForPoints(20_000).rank.name).toBe("Legend");
    expect(rankForPoints(5_000_000).rank.name).toBe("Legend");
  });

  it("reports progress toward the next rank", () => {
    const p = rankForPoints(55); // between Initiate(10) and Apprentice(100)
    expect(p.rank.name).toBe("Initiate");
    expect(p.next?.name).toBe("Apprentice");
    expect(p.pointsToNext).toBe(45);
    expect(p.progress).toBeCloseTo((55 - 10) / (100 - 10));
  });

  it("caps progress at the top rank", () => {
    const p = rankForPoints(2_000_000);
    expect(p.next).toBeUndefined();
    expect(p.pointsToNext).toBeUndefined();
    expect(p.progress).toBe(1);
  });

  it("ladder is monotonic", () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].threshold).toBeGreaterThan(RANKS[i - 1].threshold);
    }
  });
});
