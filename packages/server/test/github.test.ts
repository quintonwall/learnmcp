import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchGithubCartridges, syncGithubCartridges } from "../src/github.js";

const CART = {
  id: "vercel",
  version: "1.0.0",
  trust: "community",
  provider: { name: "Vercel" },
  detect: [{ type: "file", path: "**/vercel.json", exists: true }],
  objectives: [],
  bestPractices: [],
  badges: [],
};

/** Fakes the two GitHub endpoints we use: contents listing and raw download. */
function fakeGithub(tree: Record<string, unknown>, raw: Record<string, string>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    for (const [dir, body] of Object.entries(tree)) {
      if (url.includes(`/contents/${dir}?`)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    if (raw[url]) return new Response(raw[url], { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, calls };
}

describe("fetchGithubCartridges", () => {
  it("walks per-cartridge subdirectories and returns validated cartridges", async () => {
    const { fetchImpl, calls } = fakeGithub(
      {
        cartridges: [{ name: "vercel", path: "cartridges/vercel", type: "dir", download_url: null }],
        "cartridges/vercel": [
          {
            name: "vercel.json",
            path: "cartridges/vercel/vercel.json",
            type: "file",
            download_url: "https://raw/vercel.json",
          },
        ],
      },
      { "https://raw/vercel.json": JSON.stringify(CART) },
    );

    const res = await fetchGithubCartridges({ fetchImpl });
    expect(res.cartridges.map((c) => c.id)).toEqual(["vercel"]);
    expect(res.skipped).toEqual([]);
    // Defaults to the public registry repo.
    expect(calls[0]).toContain("/repos/quintonwall/learnmcp/contents/cartridges?ref=main");
  });

  it("accepts a flat .json at the root too", async () => {
    const { fetchImpl } = fakeGithub(
      {
        cartridges: [
          {
            name: "vercel.json",
            path: "cartridges/vercel.json",
            type: "file",
            download_url: "https://raw/flat.json",
          },
        ],
      },
      { "https://raw/flat.json": JSON.stringify(CART) },
    );
    const res = await fetchGithubCartridges({ fetchImpl });
    expect(res.cartridges.map((c) => c.id)).toEqual(["vercel"]);
  });

  it("skips a bad contribution instead of failing the whole registry", async () => {
    const { fetchImpl } = fakeGithub(
      {
        cartridges: [
          { name: "good.json", path: "cartridges/good.json", type: "file", download_url: "https://raw/good" },
          { name: "bad.json", path: "cartridges/bad.json", type: "file", download_url: "https://raw/bad" },
          { name: "ugly.json", path: "cartridges/ugly.json", type: "file", download_url: "https://raw/ugly" },
        ],
      },
      {
        "https://raw/good": JSON.stringify(CART),
        "https://raw/bad": JSON.stringify({ id: "bad" }), // fails schema
        "https://raw/ugly": "{ not json",
      },
    );

    const res = await fetchGithubCartridges({ fetchImpl });
    expect(res.cartridges.map((c) => c.id)).toEqual(["vercel"]);
    expect(res.skipped.map((s) => s.path).sort()).toEqual(["cartridges/bad.json", "cartridges/ugly.json"]);
  });

  it("explains a rate-limit when no token is set", async () => {
    const fetchImpl = async () => new Response("rate limited", { status: 403 });
    await expect(fetchGithubCartridges({ fetchImpl })).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("sends the token when one is provided", async () => {
    let auth: string | undefined;
    const fetchImpl = async (_url: string, init: RequestInit = {}) => {
      auth = (init.headers as Record<string, string>)?.authorization;
      return new Response("[]", { status: 200 });
    };
    await fetchGithubCartridges({ fetchImpl, token: "ghp_x" });
    expect(auth).toBe("Bearer ghp_x");
  });
});

describe("syncGithubCartridges", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "learnmcp-gh-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("writes cartridges into a cache dir the registry hot-loads", async () => {
    const { fetchImpl } = fakeGithub(
      {
        cartridges: [
          { name: "vercel.json", path: "cartridges/vercel.json", type: "file", download_url: "https://raw/v" },
        ],
      },
      { "https://raw/v": JSON.stringify(CART) },
    );

    const res = await syncGithubCartridges(dir, { fetchImpl });
    expect(res.cartridges).toHaveLength(1);
    const written = JSON.parse(await readFile(path.join(dir, "vercel.json"), "utf8"));
    expect(written.id).toBe("vercel");
  });

  it("leaves the existing cache intact when GitHub is unreachable", async () => {
    const stale = path.join(dir, "vercel.json");
    await writeFile(stale, JSON.stringify({ ...CART, version: "0.9.0" }));

    const fetchImpl = async () => {
      throw new Error("ENOTFOUND api.github.com");
    };
    await expect(syncGithubCartridges(dir, { fetchImpl })).rejects.toThrow(/ENOTFOUND/);

    // Offline must not wipe what the user already had.
    expect(JSON.parse(await readFile(stale, "utf8")).version).toBe("0.9.0");
  });
});
