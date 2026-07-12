import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CartridgeRegistry } from "../src/registry.js";
import { SqliteStore } from "../src/store.js";
import { ProgressService } from "../src/service.js";
import { SyncService } from "../src/sync.js";
import { SupabaseBackend } from "../src/remote.js";
import type {
  RemoteBackend,
  RemoteProfile,
  RemoteBadge,
  RemoteCartridge,
  CartridgeScore,
} from "../src/remote.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = path.resolve(here, "../../../cartridges");

class FakeRemote implements RemoteBackend {
  profiles: RemoteProfile[] = [];
  badges: RemoteBadge[] = [];
  scores: CartridgeScore[] = [];
  installs: string[] = [];
  published: string[] = [];
  approved: RemoteCartridge[] = [];
  async upsertProfile(p: RemoteProfile) { this.profiles.push(p); }
  async upsertBadges(b: RemoteBadge[]) { this.badges.push(...b); }
  async upsertCartridgeScores(s: CartridgeScore[]) { this.scores.push(...s); }
  async incrementInstall(id: string) { this.installs.push(id); }
  async listApprovedCartridges() { return this.approved; }
  async submitCartridge(c: { id: string }) { this.published.push(c.id); }
  async leaderboard() { return []; }
  async cartridgeLeaderboard() { return []; }
}

describe("SyncService", () => {
  let registry: CartridgeRegistry;
  let store: SqliteStore;
  let service: ProgressService;

  beforeEach(async () => {
    registry = new CartridgeRegistry({ sources: [bundled] });
    await registry.load();
    store = new SqliteStore({ path: ":memory:" });
    service = new ProgressService(registry, store);
  });
  afterEach(() => store.close());

  it("pushes earned badges + points/rank to the remote profile", async () => {
    service.record("/proj", { kind: "mcp_tool", server: "postman", tool: "generate-spec" });
    const remote = new FakeRemote();
    const sync = new SyncService(service, remote, { userId: "u1", handle: "quinton" });

    const res = await sync.pushProgress("/proj");
    expect(res.points).toBe(10);
    expect(res.rank).toBe("Initiate");
    expect(remote.profiles[0]).toMatchObject({ userId: "u1", handle: "quinton", points: 10, rank: "Initiate" });
    expect(remote.badges.map((b) => b.badgeId)).toContain("spec-author");
    // Per-cartridge score rolls the badge points up under the postman cartridge.
    expect(remote.scores).toContainEqual({ userId: "u1", cartridgeId: "postman", handle: "quinton", points: 10 });
  });

  it("pulls approved cartridges into a cache dir the registry can hot-load", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "learnmcp-cache-"));
    try {
      const remote = new FakeRemote();
      remote.approved = [
        {
          id: "acme",
          version: "1.0.0",
          document: {
            id: "acme",
            version: "1.0.0",
            provider: { name: "Acme" },
            trust: "community",
            detect: [],
            objectives: [],
            bestPractices: [],
            badges: [],
          },
        },
      ];
      const sync = new SyncService(service, remote, { userId: "u1" });
      const written = await sync.pullCartridges(dir);
      expect(written).toEqual(["acme"]);
      const doc = JSON.parse(await readFile(path.join(dir, "acme.json"), "utf8"));
      expect(doc.id).toBe("acme");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SupabaseBackend (PostgREST request building)", () => {
  it("builds an authorized RPC call for install increments", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    };
    const be = new SupabaseBackend({ url: "https://x.supabase.co/", key: "svc-key", fetchImpl });
    await be.incrementInstall("postman");

    expect(calls[0].url).toBe("https://x.supabase.co/rest/v1/rpc/increment_install");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer svc-key");
    expect(headers.apikey).toBe("svc-key");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ p_cartridge_id: "postman" });
  });

  it("throws with context on a non-2xx response", async () => {
    const fetchImpl = async () => new Response("nope", { status: 403 });
    const be = new SupabaseBackend({ url: "https://x.supabase.co", key: "k", fetchImpl });
    await expect(be.incrementInstall("x")).rejects.toThrow(/403/);
  });
});
