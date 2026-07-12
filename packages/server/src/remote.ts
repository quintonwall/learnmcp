import type { Cartridge } from "@learnmcp/schema";

/**
 * Remote backend for syncing progress and cartridges to Supabase. Implemented against
 * PostgREST with an injectable `fetch`, so it needs no SDK and is easy to fake in tests.
 */

export interface RemoteProfile {
  userId: string;
  handle?: string;
  points: number;
  rank: string;
}

export interface RemoteBadge {
  userId: string;
  cartridgeId: string;
  badgeId: string;
  name: string;
  points: number;
}

export interface RemoteCartridge {
  id: string;
  version: string;
  document: Cartridge;
}

export interface LeaderboardEntry {
  position: number;
  user_id: string;
  handle: string | null;
  points: number;
  rank: string;
}

export interface CartridgeScore {
  userId: string;
  cartridgeId: string;
  handle?: string;
  points: number;
}

export interface CartridgeLeaderEntry {
  cartridge_id: string;
  user_id: string;
  handle: string | null;
  points: number;
  position: number;
}

export interface RemoteBackend {
  upsertProfile(profile: RemoteProfile): Promise<void>;
  upsertBadges(badges: RemoteBadge[]): Promise<void>;
  upsertCartridgeScores(scores: CartridgeScore[]): Promise<void>;
  incrementInstall(cartridgeId: string): Promise<void>;
  listApprovedCartridges(): Promise<RemoteCartridge[]>;
  submitCartridge(cartridge: Cartridge, userId: string): Promise<void>;
  /** Global leaderboard (points-ranked across all cartridges). */
  leaderboard(limit?: number): Promise<LeaderboardEntry[]>;
  /** Per-cartridge leaderboards — top `perCartridge` for each cartridge. */
  cartridgeLeaderboard(perCartridge?: number): Promise<CartridgeLeaderEntry[]>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SupabaseBackendOptions {
  url: string;
  key: string;
  fetchImpl?: FetchLike;
}

export class SupabaseBackend implements RemoteBackend {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: SupabaseBackendOptions) {
    this.base = opts.url.replace(/\/$/, "") + "/rest/v1";
    this.key = opts.key;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    if (!this.fetchImpl) throw new Error("no fetch implementation available");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async req(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${path}`, { method, ...init });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`supabase ${method} ${path} → ${res.status} ${body}`.trim());
    }
    return res;
  }

  async upsertProfile(p: RemoteProfile): Promise<void> {
    await this.req("POST", "/user_profiles?on_conflict=user_id", {
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({
        user_id: p.userId,
        handle: p.handle ?? null,
        points: p.points,
        rank: p.rank,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  async upsertBadges(badges: RemoteBadge[]): Promise<void> {
    if (badges.length === 0) return;
    await this.req("POST", "/user_badges?on_conflict=user_id,cartridge_id,badge_id", {
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(
        badges.map((b) => ({
          user_id: b.userId,
          cartridge_id: b.cartridgeId,
          badge_id: b.badgeId,
          name: b.name,
          points: b.points,
        })),
      ),
    });
  }

  async upsertCartridgeScores(scores: CartridgeScore[]): Promise<void> {
    if (scores.length === 0) return;
    await this.req("POST", "/cartridge_scores?on_conflict=user_id,cartridge_id", {
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify(
        scores.map((s) => ({
          user_id: s.userId,
          cartridge_id: s.cartridgeId,
          handle: s.handle ?? null,
          points: s.points,
          updated_at: new Date().toISOString(),
        })),
      ),
    });
  }

  async incrementInstall(cartridgeId: string): Promise<void> {
    await this.req("POST", "/rpc/increment_install", {
      headers: this.headers(),
      body: JSON.stringify({ p_cartridge_id: cartridgeId }),
    });
  }

  async listApprovedCartridges(): Promise<RemoteCartridge[]> {
    const res = await this.req(
      "GET",
      "/cartridges?approved=eq.true&select=id,latest_version,cartridge_versions(version,document)",
      { headers: this.headers() },
    );
    const rows = (await res.json()) as Array<{
      id: string;
      latest_version: string;
      cartridge_versions: Array<{ version: string; document: Cartridge }>;
    }>;
    return rows.flatMap((r) => {
      const v = r.cartridge_versions.find((x) => x.version === r.latest_version) ?? r.cartridge_versions[0];
      return v ? [{ id: r.id, version: v.version, document: v.document }] : [];
    });
  }

  async submitCartridge(c: Cartridge, userId: string): Promise<void> {
    await this.req("POST", "/cartridges?on_conflict=id", {
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({
        id: c.id,
        name: c.provider.name,
        provider: c.provider.name,
        homepage: c.provider.homepage ?? null,
        icon: c.provider.icon ?? null,
        trust: c.trust,
        latest_version: c.version,
        submitted_by: userId,
        approved: false,
        updated_at: new Date().toISOString(),
      }),
    });
    await this.req("POST", "/cartridge_versions?on_conflict=cartridge_id,version", {
      headers: this.headers({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ cartridge_id: c.id, version: c.version, document: c }),
    });
  }

  async leaderboard(limit = 100): Promise<LeaderboardEntry[]> {
    const res = await this.req(
      "GET",
      `/leaderboard?select=position,user_id,handle,points,rank&order=points.desc&limit=${limit}`,
      { headers: this.headers() },
    );
    return (await res.json()) as LeaderboardEntry[];
  }

  async cartridgeLeaderboard(perCartridge = 5): Promise<CartridgeLeaderEntry[]> {
    const res = await this.req(
      "GET",
      `/cartridge_leaderboard?select=cartridge_id,user_id,handle,points,position&position=lte.${perCartridge}&order=cartridge_id.asc,position.asc`,
      { headers: this.headers() },
    );
    return (await res.json()) as CartridgeLeaderEntry[];
  }
}
