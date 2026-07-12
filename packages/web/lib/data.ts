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

export async function getCartridges(): Promise<CartridgeCard[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from("cartridges")
      .select("id,name,provider,icon,trust,install_count")
      .eq("approved", true)
      .order("install_count", { ascending: false });
    // If the registry isn't migrated/seeded yet (error or empty), fall back to the
    // bundled first-party cartridges so the gallery is never blank.
    if (!error && data && data.length > 0) {
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon ?? undefined,
        trust: c.trust,
        objectives: 0, // objectives/badges counts live in cartridge_versions
        badges: 0,
        installs: c.install_count ?? 0,
      }));
    }
  }
  return bundledCartridges();
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb
    .from("leaderboard")
    .select("position,handle,points,rank")
    .order("points", { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => ({
    position: r.position,
    handle: r.handle ?? "anonymous",
    points: r.points,
    rank: r.rank ?? rankForPoints(r.points).rank.name,
  }));
}

/** Per-cartridge leaderboards: the top players for each cartridge. */
export async function getCartridgeLeaders(perCartridge = 5): Promise<CartridgeBoard[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("cartridge_leaderboard")
    .select("cartridge_id,handle,points,position")
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
    board.rows.push({ position: r.position, handle: r.handle ?? "anonymous", points: r.points });
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
