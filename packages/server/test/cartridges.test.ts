import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCartridge, type Cartridge } from "@learnmcp/schema";
import { evaluateProject } from "../src/detection.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cartridgesDir = path.resolve(here, "../../../cartridges");

function findCartridgeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findCartridgeFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

const files = findCartridgeFiles(cartridgesDir);

describe("shipped cartridges", () => {
  it("ships the expected first-party cartridges", () => {
    const ids = files.map((f) => path.basename(f, ".json")).sort();
    expect(ids).toEqual([
      "context7",
      "exa",
      "general",
      "github",
      "playwright",
      "postman",
      "slack",
      "supabase",
    ]);
  });

  it.each(files)("%s is a valid cartridge with consistent badge refs", (file) => {
    const res = validateCartridge(JSON.parse(readFileSync(file, "utf8")));
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;
    const c: Cartridge = res.cartridge;

    // Every objective's `badge` reference must resolve to a defined badge.
    const badgeIds = new Set(c.badges.map((b) => b.id));
    for (const o of [...c.objectives, ...c.bestPractices]) {
      if (o.badge) expect(badgeIds, `${c.id}:${o.id}`).toContain(o.badge);
    }

    // Badge ids are unique.
    expect(badgeIds.size).toBe(c.badges.length);
  });

  it.each(files)("%s grants nothing on an empty project", (file) => {
    // A `not` matcher over a glob that matches no files is vacuously true, so a best
    // practice phrased as "doesn't do the bad thing" hands out a badge to someone who has
    // written nothing at all. Guard every cartridge against that whole class of bug.
    const res = validateCartridge(JSON.parse(readFileSync(file, "utf8")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const state = evaluateProject([res.cartridge], []);
    expect(
      state.grantedBadges.map((b) => b.badgeId),
      `${res.cartridge.id} awards badges for doing nothing`,
    ).toEqual([]);
    expect(state.completedObjectives).toEqual([]);
  });

  it.each(files)("%s covers its product broadly", (file) => {
    const res = validateCartridge(JSON.parse(readFileSync(file, "utf8")));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c: Cartridge = res.cartridge;

    // Thin cartridges are why learnmcp can feel inert — you use a tool all day and earn
    // nothing. Context7 exposes only two tools, so it gets a lower floor.
    const floor = c.id === "context7" || c.id === "exa" ? 6 : 7;
    expect(c.objectives.length, `${c.id} has too few objectives`).toBeGreaterThanOrEqual(floor);

    // Badge tiers should span more than one level.
    const tiers = new Set(c.badges.map((b) => b.tier));
    expect(tiers.size, `${c.id} badges are all one tier`).toBeGreaterThan(1);
  });

  it("badge display names are unique across all cartridges", () => {
    // Two distinct badges sharing a name renders as "🏅 Plugged In · 🏅 Plugged In",
    // which reads as a double-award bug even though both are legitimate.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of files) {
      const res = validateCartridge(JSON.parse(readFileSync(file, "utf8")));
      if (!res.ok) continue;
      for (const b of res.cartridge.badges) {
        const prev = seen.get(b.name);
        if (prev && prev !== res.cartridge.id) clashes.push(`"${b.name}" in ${prev} and ${res.cartridge.id}`);
        seen.set(b.name, res.cartridge.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});
