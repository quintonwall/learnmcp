import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CloudStore } from "../src/cloudStore.js";
import { IdentityStore, hashToken, mintToken, TOKEN_PREFIX } from "../src/identity.js";
import { CartridgeRegistry } from "../src/registry.js";
import { ProgressService } from "../src/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = path.resolve(here, "../../../cartridges");

/**
 * Minimal in-memory PostgREST. Enough to exercise hydrate → evaluate → flush without a
 * live Supabase: records what was written so the assertions can check the shape.
 */
function fakeSupabase(seed: Record<string, unknown[]> = {}) {
  const tables: Record<string, unknown[]> = {
    learners: [],
    learner_signals: [],
    learner_badges: [],
    learner_objectives: [],
    learner_judgements: [],
    ...seed,
  };
  const writes: Array<{ method: string; table: string; body: unknown }> = [];

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const afterRest = url.split("/rest/v1/")[1] ?? "";
    const table = afterRest.split("?")[0];
    const body = init.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET") {
      return new Response(JSON.stringify(tables[table] ?? []), { status: 200 });
    }
    writes.push({ method, table, body });
    if (table === "learners" && method === "POST") {
      const row = { id: "learner-1", handle: null, points: 0, rank: "Novice", user_id: null };
      tables.learners.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (Array.isArray(body)) (tables[table] ??= []).push(...body);
    return new Response("[]", { status: 200 });
  };

  return { fetchImpl, tables, writes };
}

describe("identity — anonymous first", () => {
  it("mints a learner when there is no token, and only stores the hash", async () => {
    const { fetchImpl, writes } = fakeSupabase();
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });

    const { learner, issued } = await store.resolve(undefined);
    expect(learner.id).toBe("learner-1");
    expect(learner.claimed).toBe(false);
    expect(issued).toMatch(new RegExp(`^${TOKEN_PREFIX}`));

    // The raw token must never be persisted — only its digest.
    const written = writes.find((w) => w.table === "learners")!.body as { token_hash: string };
    expect(written.token_hash).toBe(hashToken(issued!));
    expect(JSON.stringify(written)).not.toContain(issued!);
  });

  it("reuses the learner behind a known token", async () => {
    const token = mintToken();
    const { fetchImpl } = fakeSupabase({
      learners: [{ id: "learner-9", handle: "quinton", points: 40, rank: "Initiate", user_id: "u1" }],
    });
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });

    const { learner, issued } = await store.resolve(token);
    expect(learner.id).toBe("learner-9");
    expect(learner.claimed).toBe(true);
    expect(issued, "an existing learner must not be re-issued a token").toBeUndefined();
  });

  it("mints a fresh learner rather than erroring on an unknown token", async () => {
    const { fetchImpl } = fakeSupabase(); // no learners → lookup returns []
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });

    const { learner, issued } = await store.resolve("lmcp_stale-token");
    expect(learner.id).toBe("learner-1");
    expect(issued).toBeTruthy();
  });
});

describe("CloudStore — hydrate, evaluate, flush", () => {
  async function service(fetchImpl: typeof fetch) {
    const registry = new CartridgeRegistry({ sources: [bundled] });
    await registry.load();
    const store = new CloudStore({ url: "https://x.supabase.co", key: "svc", fetchImpl: fetchImpl as never });
    await store.hydrate("learner-1");
    return { store, service: new ProgressService(registry, store) };
  }

  it("earns a badge in memory and writes it back on flush", async () => {
    const fake = fakeSupabase();
    const { store, service: svc } = await service(fake.fetchImpl as never);

    const res = svc.record("learner-1", { kind: "command", name: "postman:generate-spec" });
    expect(res.newBadges.map((b) => b.badgeId)).toContain("spec-author");

    const { points } = await store.flush();
    expect(points).toBe(10);

    const badgeWrite = fake.writes.find((w) => w.table.startsWith("learner_badges"))!;
    expect(badgeWrite.body).toMatchObject([{ learner_id: "learner-1", badge_id: "spec-author" }]);
    // The denormalised total is what the leaderboard orders by.
    expect(fake.writes.find((w) => w.method === "PATCH")!.body).toMatchObject({ points: 10 });
  });

  it("credits pre-existing badges from the database without re-granting them", async () => {
    const fake = fakeSupabase({
      learner_badges: [
        {
          cartridge_id: "postman",
          badge_id: "spec-author",
          name: "Spec Author",
          points: 10,
          earned_at: new Date().toISOString(),
        },
      ],
    });
    const { store, service: svc } = await service(fake.fetchImpl as never);

    const res = svc.record("learner-1", { kind: "command", name: "postman:generate-spec" });
    expect(res.newBadges, "already held — must not be re-awarded").toHaveLength(0);

    await store.flush();
    expect(fake.writes.some((w) => w.table.startsWith("learner_badges"))).toBe(false);
  });

  it("does not inflate counts when a project is re-scanned", async () => {
    const fake = fakeSupabase();
    const { store, service: svc } = await service(fake.fetchImpl as never);

    for (let i = 0; i < 3; i++) {
      svc.record("learner-1", { kind: "file", path: "openapi.yaml" });
    }
    await store.flush();

    const signalWrites = fake.writes.filter((w) => w.table.startsWith("learner_signals"));
    expect((signalWrites[0].body as unknown[]).length, "state signals are idempotent").toBe(1);
  });

  it("keeps counting repeated activity, so gte thresholds still work", async () => {
    const fake = fakeSupabase();
    const { store, service: svc } = await service(fake.fetchImpl as never);

    let last;
    for (let i = 0; i < 10; i++) {
      last = svc.record("learner-1", { kind: "command", name: "postman:run-collection" });
    }
    expect(last!.newBadges.map((b) => b.badgeId)).toContain("collection-runner-gold");

    await store.flush();
    const signalWrites = fake.writes.filter((w) => w.table.startsWith("learner_signals"));
    expect((signalWrites[0].body as unknown[]).length).toBe(10);
  });

  it("flush is a no-op when nothing changed", async () => {
    const fake = fakeSupabase();
    const { store } = await service(fake.fetchImpl as never);
    await store.flush();
    expect(fake.writes).toHaveLength(0);
  });
});
