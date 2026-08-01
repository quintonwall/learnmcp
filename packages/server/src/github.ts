import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateCartridge, type Cartridge } from "@learnmcp/schema";
import type { FetchLike } from "./remote.js";

/**
 * The cartridge registry is a GitHub directory, not a database. Contributing a cartridge
 * is opening a PR against `cartridges/` in the repo below; once it merges, every learnmcp
 * instance picks it up on its next refresh with no redeploy.
 *
 * Layout is one directory per cartridge — `cartridges/<id>/<id>.json` — but any `.json`
 * one or two levels under the root is accepted, so a flat file works too.
 */

export const DEFAULT_REPO = "quintonwall/learnmcp";
export const DEFAULT_REF = "main";
export const DEFAULT_PATH = "cartridges";

/** Human-facing URL of the registry directory — shown in tool output so people can find it. */
export function cartridgeRepoUrl(): string {
  const repo = process.env.LEARNMCP_CARTRIDGE_REPO ?? DEFAULT_REPO;
  const ref = process.env.LEARNMCP_CARTRIDGE_REF ?? DEFAULT_REF;
  const root = process.env.LEARNMCP_CARTRIDGE_PATH ?? DEFAULT_PATH;
  return `https://github.com/${repo}/tree/${ref}/${root}`;
}

export interface GithubSourceOptions {
  repo?: string;
  ref?: string;
  path?: string;
  /**
   * Optional token. Unauthenticated GitHub allows 60 requests/hour *per IP* — fine for one
   * developer, not for a shared server where every user's refresh comes from the same
   * address. Set GITHUB_TOKEN when hosting.
   */
  token?: string;
  fetchImpl?: FetchLike;
}

interface ContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
}

export interface FetchedCartridges {
  cartridges: Cartridge[];
  /** Cartridge files that were found but rejected, with why. */
  skipped: Array<{ path: string; reason: string }>;
  /** The commit-ish the listing was read at, for cache validation. */
  ref: string;
}

function resolve(opts: GithubSourceOptions) {
  return {
    repo: opts.repo ?? process.env.LEARNMCP_CARTRIDGE_REPO ?? DEFAULT_REPO,
    ref: opts.ref ?? process.env.LEARNMCP_CARTRIDGE_REF ?? DEFAULT_REF,
    root: opts.path ?? process.env.LEARNMCP_CARTRIDGE_PATH ?? DEFAULT_PATH,
    token: opts.token ?? process.env.GITHUB_TOKEN,
    fetchImpl: opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike),
  };
}

/**
 * Read every cartridge from the GitHub repo. Individual bad cartridges are reported in
 * `skipped` rather than thrown — one malformed contribution must not take down the
 * registry for everyone.
 */
export async function fetchGithubCartridges(
  opts: GithubSourceOptions = {},
): Promise<FetchedCartridges> {
  const { repo, ref, root, token, fetchImpl } = resolve(opts);
  if (!fetchImpl) throw new Error("no fetch implementation available");

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "learnmcp/0.1",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const listing = async (dir: string): Promise<ContentEntry[]> => {
    const url = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      const hint =
        res.status === 403 && !token
          ? " (rate-limited — set GITHUB_TOKEN)"
          : res.status === 404
            ? ` (no ${dir} in ${repo}@${ref})`
            : "";
      throw new Error(`GitHub ${res.status} listing ${dir}${hint}`);
    }
    const body = (await res.json()) as ContentEntry[] | ContentEntry;
    return Array.isArray(body) ? body : [body];
  };

  // Root, then one level of per-cartridge subdirectories.
  const entries = await listing(root);
  const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".json"));
  const dirs = entries.filter((e) => e.type === "dir");
  for (const dir of dirs) {
    const nested = await listing(dir.path);
    files.push(...nested.filter((e) => e.type === "file" && e.name.endsWith(".json")));
  }

  const cartridges: Cartridge[] = [];
  const skipped: FetchedCartridges["skipped"] = [];

  for (const file of files) {
    if (!file.download_url) {
      skipped.push({ path: file.path, reason: "no download url" });
      continue;
    }
    try {
      const res = await fetchImpl(file.download_url, { headers: { "user-agent": headers["user-agent"] } });
      if (!res.ok) {
        skipped.push({ path: file.path, reason: `HTTP ${res.status}` });
        continue;
      }
      const parsed = validateCartridge(JSON.parse(await res.text()));
      if (!parsed.ok) {
        skipped.push({ path: file.path, reason: parsed.error });
        continue;
      }
      cartridges.push(parsed.cartridge);
    } catch (err) {
      skipped.push({ path: file.path, reason: (err as Error).message });
    }
  }

  return { cartridges, skipped, ref };
}

/**
 * Refresh a local cache directory from the GitHub registry. The registry watches this
 * directory, so writing here is what makes new cartridges live — no restart, no redeploy.
 *
 * Only overwrites on a successful fetch: if GitHub is unreachable the previous cache
 * stays intact and learnmcp keeps working offline.
 */
export async function syncGithubCartridges(
  cacheDir: string,
  opts: GithubSourceOptions = {},
): Promise<FetchedCartridges> {
  const result = await fetchGithubCartridges(opts);
  mkdirSync(cacheDir, { recursive: true });
  for (const c of result.cartridges) {
    writeFileSync(path.join(cacheDir, `${c.id}.json`), JSON.stringify(c, null, 2));
  }
  return result;
}
