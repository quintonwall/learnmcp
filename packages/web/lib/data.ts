import "server-only";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { rankForPoints } from "@learnmcp/schema";
import { getSupabase } from "./supabase";

/**
 * Data layer with graceful fallback: if Supabase is configured (env vars set) the
 * gallery/leaderboard read from it; otherwise the gallery falls back to the bundled
 * first-party cartridges so the app runs with zero backend during development.
 */

export interface CartridgeCard {
  id: string;
  name: string;
  icon?: string;
  trust: string;
  objectives: number;
  badges: number;
  installs: number;
}

export interface LeaderboardRow {
  position: number;
  handle: string;
  points: number;
  rank: string;
}

export interface CartridgeBoard {
  cartridgeId: string;
  name: string;
  icon?: string;
  rows: { position: number; handle: string; points: number }[];
}

export const usingSupabase = (): boolean => getSupabase() !== null;

export interface PlatformStats {
  lessonsCompleted: number;
  badgesEarned: number;
  activeLearners: number;
}

/** The headline numbers for the homepage: how much learning has actually happened here. */
export async function getPlatformStats(): Promise<PlatformStats | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("platform_stats")
    .select("lessons_completed,badges_earned,active_learners")
    .single();
  if (error || !data) return null;
  return {
    lessonsCompleted: data.lessons_completed ?? 0,
    badgesEarned: data.badges_earned ?? 0,
    activeLearners: data.active_learners ?? 0,
  };
}

/**
 * The registry is the repo's own `cartridges/` directory — the same thing contributors
 * PR into and the MCP server reads from GitHub. This app deploys from that repo, so
 * reading it off disk *is* reading the registry; there's no separate table to keep in sync.
 *
 * Supabase only supplies popularity: how many distinct learners have earned from each one.
 */
export async function getCartridges(): Promise<CartridgeCard[]> {
  const cards = bundledCartridges();
  const sb = getSupabase();
  if (!sb) return cards;

  const { data } = await sb
    .from("cartridge_popularity")
    .select("cartridge_id,learners");
  if (!data?.length) return cards;

  const learners = new Map(data.map((r) => [r.cartridge_id, r.learners as number]));
  return cards
    .map((c) => ({ ...c, installs: learners.get(c.id) ?? 0 }))
    .sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0) || a.name.localeCompare(b.name));
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  // `learner_leaderboard` is what the remote MCP writes into — it includes anonymous
  // learners under a stable pseudonym, which is most of them by design.
  const { data } = await sb
    .from("learner_leaderboard")
    .select("position,display_name,points,rank")
    .order("position", { ascending: true })
    .limit(100);
  return (data ?? []).map((r) => ({
    position: r.position,
    handle: r.display_name ?? "anonymous",
    points: r.points,
    rank: r.rank ?? rankForPoints(r.points).rank.name,
  }));
}

/** Per-cartridge leaderboards: the top players for each cartridge. */
export async function getCartridgeLeaders(perCartridge = 5): Promise<CartridgeBoard[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("learner_cartridge_leaderboard")
    .select("cartridge_id,display_name,points,position")
    .lte("position", perCartridge)
    .order("cartridge_id", { ascending: true })
    .order("position", { ascending: true });
  if (error || !data || data.length === 0) return [];

  // Map cartridge ids to display name/icon (falls back to bundled metadata).
  const cartridges = await getCartridges();
  const meta = new Map(cartridges.map((c) => [c.id, c]));

  const boards = new Map<string, CartridgeBoard>();
  for (const r of data) {
    let board = boards.get(r.cartridge_id);
    if (!board) {
      const m = meta.get(r.cartridge_id);
      board = { cartridgeId: r.cartridge_id, name: m?.name ?? r.cartridge_id, icon: m?.icon, rows: [] };
      boards.set(r.cartridge_id, board);
    }
    board.rows.push({ position: r.position, handle: r.display_name ?? "anonymous", points: r.points });
  }
  return [...boards.values()];
}

/** Read the repo's bundled cartridges from disk (dev fallback, no backend needed). */
function bundledCartridges(): CartridgeCard[] {
  const dir = path.resolve(process.cwd(), "..", "..", "cartridges");
  const cards: CartridgeCard[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const file = path.join(dir, name, `${name}.json`);
    try {
      if (!statSync(file).isFile()) continue;
      const c = JSON.parse(readFileSync(file, "utf8"));
      cards.push({
        id: c.id,
        name: c.provider?.name ?? c.id,
        icon: c.provider?.icon,
        trust: c.trust ?? "official",
        objectives: (c.objectives?.length ?? 0) + (c.bestPractices?.length ?? 0),
        badges: c.badges?.length ?? 0,
        installs: 0,
      });
    } catch {
      /* skip unreadable cartridge */
    }
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name));
}
