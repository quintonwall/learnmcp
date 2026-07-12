import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCartridge, type Cartridge } from "@learnmcp/schema";

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
});
