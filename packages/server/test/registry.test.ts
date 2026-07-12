import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CartridgeRegistry } from "../src/registry.js";

const minimal = (id: string, extra: object = {}) =>
  JSON.stringify({ id, version: "1.0.0", provider: { name: id }, ...extra });

/** Poll until `fn()` is truthy or we time out — chokidar fires asynchronously. */
async function until(fn: () => boolean, ms = 10000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("CartridgeRegistry", () => {
  let root: string;
  let projectDir: string;
  let userDir: string;
  let reg: CartridgeRegistry;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "learnmcp-"));
    projectDir = path.join(root, "project");
    userDir = path.join(root, "user");
    await mkdir(projectDir, { recursive: true });
    await mkdir(userDir, { recursive: true });
    // Polling makes the watcher deterministic under parallel test load (fsevents lags).
    reg = new CartridgeRegistry({ sources: [projectDir, userDir], usePolling: true });
  });

  afterEach(async () => {
    await reg.close();
    await rm(root, { recursive: true, force: true });
  });

  it("loads cartridges from source dirs", async () => {
    await writeFile(path.join(userDir, "postman.json"), minimal("postman"));
    await reg.load();
    expect(reg.get("postman")?.provider.name).toBe("postman");
    expect(reg.size()).toBe(1);
  });

  it("skips invalid cartridges with a warning instead of crashing", async () => {
    const warnings: string[] = [];
    reg = new CartridgeRegistry({ sources: [userDir], onWarn: (m) => warnings.push(m) });
    await writeFile(path.join(userDir, "good.json"), minimal("good"));
    await writeFile(path.join(userDir, "bad.json"), "{ not json ");
    await writeFile(path.join(userDir, "invalid.json"), JSON.stringify({ id: "Bad Id!" }));
    await reg.load();
    expect(reg.get("good")).toBeDefined();
    expect(reg.size()).toBe(1);
    expect(warnings.some((w) => w.includes("bad.json"))).toBe(true);
    expect(warnings.some((w) => w.includes("invalid.json"))).toBe(true);
  });

  it("resolves duplicate ids by source precedence (project over user)", async () => {
    await writeFile(path.join(userDir, "postman.json"), minimal("postman", { version: "1.0.0" }));
    await writeFile(path.join(projectDir, "postman.json"), minimal("postman", { version: "9.9.9" }));
    await reg.load();
    expect(reg.get("postman")?.version).toBe("9.9.9");
  });

  it("hot-reloads when a cartridge is dropped in (no restart)", async () => {
    await reg.load();
    expect(reg.size()).toBe(0);
    let changes = 0;
    reg.on("change", () => changes++);
    await reg.watch();

    await writeFile(path.join(userDir, "vercel.json"), minimal("vercel"));
    await until(() => reg.get("vercel") !== undefined);
    expect(reg.get("vercel")).toBeDefined();
    expect(changes).toBeGreaterThan(0);
  }, 15000);

  it("hot-reloads on removal too", async () => {
    await writeFile(path.join(userDir, "temp.json"), minimal("temp"));
    await reg.load();
    expect(reg.get("temp")).toBeDefined();
    await reg.watch();
    await rm(path.join(userDir, "temp.json"));
    await until(() => reg.get("temp") === undefined);
    expect(reg.get("temp")).toBeUndefined();
  }, 15000);
});
