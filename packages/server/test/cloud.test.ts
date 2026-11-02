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
function fakeSupabase(seed: Record<string, unknown[]> = {}, maxRows = Infinity) {
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
    const [table, query = ""] = (url.split("/rest/v1/")[1] ?? "").split("?");
    const body = init.body ? JSON.parse(init.body as string) : undefined;

    if (method === "GET") {
      // Honour limit/offset like PostgREST, and cap a response at `maxRows`.
      const offset = Number(query.match(/offset=(\d+)/)?.[1] ?? 0);
      const limit = Math.min(Number(query.match(/limit=(\d+)/)?.[1] ?? Infinity), maxRows);
      const all = tables[table] ?? [];
      const headers: Record<string, string> = {};
      const prefer = (init.headers as Record<string, string> | undefined)?.Prefer ?? "";
      if (prefer.includes("count=exact")) headers["content-range"] = `${offset}-${offset + limit - 1}/${all.length}`;
      return new Response(JSON.stringify(all.slice(offset, offset + limit)), { status: 200, headers });
    }
    if (table === "learners" && method === "PATCH") {
      // Mirrors the real unique index: reject a handle already held by a DIFFERENT row.
      const id = decodeURIComponent(query.match(/id=eq\.([^&]+)/)?.[1] ?? "");
      const clash = (tables.learners as Array<Record<string, unknown>>).some(
        (l) => l.id !== id && (l.handle as string | null)?.toLowerCase() === (body.handle as string)?.toLowerCase(),
      );
      if (clash) return new Response(JSON.stringify({ code: "23505" }), { status: 409 });
      const row = (tables.learners as Array<Record<string, unknown>>).find((l) => l.id === id);
      if (row) Object.assign(row, body);
      writes.push({ method, table, body });
      return new Response(null, { status: 204 });
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

  it("claiming is just setting a handle — no account, no separate sign-in", async () => {
    const { fetchImpl } = fakeSupabase({
      learners: [{ id: "learner-1", handle: null, points: 0, rank: "Novice" }],
    });
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });

    const result = await store.setHandle("learner-1", "quinton");
    expect(result).toEqual({ ok: true });

    const after = (await fetchImpl("https://x.supabase.co/rest/v1/learners", {})
      .then((r) => r.json())) as Array<{ id: string; handle: string }>;
    expect(after.find((l) => l.id === "learner-1")?.handle).toBe("quinton");
  });

  it("rejects a handle someone else already holds", async () => {
    const { fetchImpl } = fakeSupabase({
      learners: [
        { id: "learner-1", handle: null, points: 0, rank: "Novice" },
        { id: "learner-2", handle: "quinton", points: 10, rank: "Initiate" },
      ],
    });
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });

    const result = await store.setHandle("learner-1", "quinton");
    expect(result).toEqual({ ok: false, reason: "taken" });
  });

  it("is claimed from handle alone — no user_id, no OAuth, involved at all", async () => {
    const token = mintToken();
    const { fetchImpl } = fakeSupabase({
      // Deliberately no user_id anywhere in this fixture.
      learners: [{ id: "learner-1", handle: "quinton", points: 0, rank: "Novice" }],
    });
    const store = new IdentityStore({ url: "https://x.supabase.co", key: "svc", fetchImpl });
    const { learner } = await store.resolve(token);
    expect(learner.claimed).toBe(true);
    expect(learner.handle).toBe("quinton");
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
    // The denormalised total is what the leaderboard orders by — and it must carry the
    // rank too, or the board reports 'Novice' for someone my_progress calls 'Initiate'.
    expect(fake.writes.find((w) => w.method === "PATCH")!.body).toMatchObject({
      points: 10,
      rank: "Initiate",
    });
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

  it("still saves badges and objectives when a signal batch hits the idempotency index", async () => {
    const fake = fakeSupabase();
    // Mirror idx_signals_idempotent: Postgres rejects a multi-row insert containing a
    // signal that's already stored; single-row inserts of the new ones succeed.
    const fetchImpl = async (url: string, init: RequestInit = {}) => {
      const rows = init.body ? JSON.parse(init.body as string) : undefined;
      if (url.includes("/learner_signals") && init.method === "POST" && Array.isArray(rows) && rows.length > 1) {
        return new Response(JSON.stringify({ code: "23505" }), { status: 409 });
      }
      return fake.fetchImpl(url, init);
    };
    const { store, service: svc } = await service(fetchImpl as never);

    svc.record("learner-1", { kind: "file", path: "a.md" });
    svc.record("learner-1", { kind: "file", path: "b.md" });
    svc.record("learner-1", { kind: "command", name: "postman:generate-spec" });

    await expect(store.flush()).resolves.toMatchObject({ points: 10 });
    expect(fake.writes.some((w) => w.table.startsWith("learner_badges"))).toBe(true);
  });

  it("loads every signal row even when the server caps a response", async () => {
    // 2500 stored signals, 1000 rows per response (PostgREST's default cap): the .git
    // signal sits past the first page and must still be seen, not re-inserted.
    const stored = Array.from({ length: 2500 }, (_, i) => ({
      payload: i === 2400 ? { kind: "file", path: ".git", event: "exists" } : { kind: "file", path: `f${i}.txt`, event: "exists" },
    }));
    const fake = fakeSupabase({ learner_signals: stored }, 1000);
    const { store, service: svc } = await service(fake.fetchImpl as never);

    svc.record("learner-1", { kind: "file", path: ".git", event: "exists" });
    await store.flush();

    expect(fake.writes.some((w) => w.table.startsWith("learner_signals") && w.method === "POST")).toBe(false);
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

  it("reads every page of a long log, with a total, in parallel", async () => {
    const stored = Array.from({ length: 5200 }, (_, i) => ({
      payload: { kind: "file", path: `f${i}.md`, event: "exists" },
    }));
    const fake = fakeSupabase({ learner_signals: stored });
    let inFlight = 0;
    let peak = 0;
    const slow = async (url: string, init?: RequestInit) => {
      if (!url.includes("learner_signals")) return fake.fetchImpl(url, init);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return fake.fetchImpl(url, init);
    };
    const store = new CloudStore({ url: "https://x.supabase.co", key: "svc", fetchImpl: slow as never });
    await store.hydrate("learner-1");
    expect(store.getSignals("learner-1")).toHaveLength(5200);
    expect(peak).toBeGreaterThan(1);
  });

  it("still reads everything when the server caps pages below ours", async () => {
    const stored = Array.from({ length: 1234 }, (_, i) => ({
      payload: { kind: "file", path: `g${i}.md`, event: "exists" },
    }));
    const fake = fakeSupabase({ learner_signals: stored }, 300);
    const store = new CloudStore({ url: "https://x.supabase.co", key: "svc", fetchImpl: fake.fetchImpl as never });
    await store.hydrate("learner-1");
    expect(store.getSignals("learner-1")).toHaveLength(1234);
  });

  it("falls back to paging in order when no total comes back", async () => {
    const stored = Array.from({ length: 2100 }, (_, i) => ({
      payload: { kind: "file", path: `h${i}.md`, event: "exists" },
    }));
    const fake = fakeSupabase({ learner_signals: stored });
    const noTotal = async (url: string, init: RequestInit = {}) => {
      const { Prefer: _drop, ...rest } = (init.headers ?? {}) as Record<string, string>;
      return fake.fetchImpl(url, { ...init, headers: rest });
    };
    const store = new CloudStore({ url: "https://x.supabase.co", key: "svc", fetchImpl: noTotal as never });
    await store.hydrate("learner-1");
    const paths = store.getSignals("learner-1").map((x) => (x as { path: string }).path);
    expect(paths).toHaveLength(2100);
    expect(paths[0]).toBe("h0.md");
    expect(paths[2099]).toBe("h2099.md");
  });
});
