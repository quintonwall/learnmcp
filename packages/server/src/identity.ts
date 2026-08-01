import { createHash, randomBytes } from "node:crypto";
import type { FetchLike } from "./remote.js";

/**
 * Anonymous-first identity for the remote MCP.
 *
 * Nobody creates an account to earn a badge. The first call with no token mints a learner
 * row and hands back a bearer token; the client stores it and sends it from then on.
 * Claiming links that same learner to a signed-in account so a real handle shows on the
 * leaderboard — the progress is already there, claiming just names it.
 *
 * Only a SHA-256 of the token is stored. A leaked database therefore can't be used to
 * impersonate learners, and a lost token is unrecoverable by design.
 */

export interface Learner {
  id: string;
  handle: string | null;
  points: number;
  rank: string;
  claimed: boolean;
}

export interface IssuedLearner extends Learner {
  /** Returned exactly once, at mint time. Never retrievable again. */
  token: string;
}

export const TOKEN_PREFIX = "lmcp_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

export interface IdentityStoreOptions {
  url: string;
  /** service_role key: learner rows are deny-all under RLS. */
  key: string;
  fetchImpl?: FetchLike;
}

export class IdentityStore {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: IdentityStoreOptions) {
    this.base = opts.url.replace(/\/$/, "") + "/rest/v1";
    this.key = opts.key;
    this.fetchImpl = opts.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
    if (!this.fetchImpl) throw new Error("no fetch implementation available");
  }

  private async req(method: string, path: string, body?: unknown, prefer?: string): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new Error(`supabase ${method} ${path} → ${res.status} ${await res.text().catch(() => "")}`.trim());
    }
    return res;
  }

  private static toLearner(row: Record<string, unknown>): Learner {
    return {
      id: row.id as string,
      handle: (row.handle as string | null) ?? null,
      points: (row.points as number) ?? 0,
      rank: (row.rank as string) ?? "Novice",
      claimed: row.user_id != null,
    };
  }

  /** Mint a brand-new anonymous learner. */
  async create(): Promise<IssuedLearner> {
    const token = mintToken();
    const res = await this.req(
      "POST",
      "/learners",
      { token_hash: hashToken(token) },
      "return=representation",
    );
    const [row] = (await res.json()) as Array<Record<string, unknown>>;
    return { ...IdentityStore.toLearner(row), token };
  }

  /** Look up a learner by bearer token, or null if it doesn't match anything. */
  async byToken(token: string): Promise<Learner | null> {
    const res = await this.req(
      "GET",
      `/learners?token_hash=eq.${hashToken(token)}&select=id,handle,points,rank,user_id&limit=1`,
    );
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    return rows[0] ? IdentityStore.toLearner(rows[0]) : null;
  }

  /**
   * Resolve the learner for a request: use the token if it's valid, otherwise mint one.
   * An unrecognised token mints a fresh learner rather than erroring — a stale token
   * should never be a dead end that stops someone learning.
   */
  async resolve(token?: string): Promise<{ learner: Learner; issued?: string }> {
    if (token) {
      const found = await this.byToken(token);
      if (found) return { learner: found };
    }
    const created = await this.create();
    return { learner: created, issued: created.token };
  }

  /**
   * Attach a learner to a signed-in account. Delegates to the `claim_learner` SQL
   * function, which merges into an existing row if that account already has one (a second
   * machine) rather than stranding progress on a duplicate identity.
   */
  async claim(learnerId: string, userId: string, handle: string): Promise<string> {
    const res = await this.req("POST", "/rpc/claim_learner", {
      p_learner_id: learnerId,
      p_user_id: userId,
      p_handle: handle,
    });
    return ((await res.json()) as string) ?? learnerId;
  }

  async leaderboard(limit = 20): Promise<
    Array<{ position: number; display_name: string; points: number; rank: string; claimed: boolean }>
  > {
    const res = await this.req(
      "GET",
      `/learner_leaderboard?select=position,display_name,points,rank,claimed&order=position.asc&limit=${limit}`,
    );
    return (await res.json()) as Array<{
      position: number;
      display_name: string;
      points: number;
      rank: string;
      claimed: boolean;
    }>;
  }

  async cartridgeLeaderboard(cartridgeId: string, limit = 10): Promise<
    Array<{ position: number; display_name: string; points: number }>
  > {
    const res = await this.req(
      "GET",
      `/learner_cartridge_leaderboard?cartridge_id=eq.${encodeURIComponent(cartridgeId)}` +
        `&select=position,display_name,points&order=position.asc&limit=${limit}`,
    );
    return (await res.json()) as Array<{ position: number; display_name: string; points: number }>;
  }

  async popularity(): Promise<Array<{ cartridge_id: string; learners: number; points_awarded: number }>> {
    const res = await this.req(
      "GET",
      "/cartridge_popularity?select=cartridge_id,learners,points_awarded&order=learners.desc",
    );
    return (await res.json()) as Array<{
      cartridge_id: string;
      learners: number;
      points_awarded: number;
    }>;
  }
}
