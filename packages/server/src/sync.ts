import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProgressService } from "./service.js";
import type { RemoteBackend } from "./remote.js";
import type { Cartridge } from "@learnmcp/schema";

/**
 * Syncs local progress and cartridges with a RemoteBackend (Supabase). Local-first:
 * everything works offline; sync pushes earned badges/points up and pulls approved
 * community cartridges down into the registry cache dir (which the registry hot-loads).
 */
export interface SyncIdentity {
  userId: string;
  handle?: string;
}

export class SyncService {
  constructor(
    private readonly service: ProgressService,
    private readonly remote: RemoteBackend,
    private readonly identity: SyncIdentity,
  ) {}

  /**
   * Push this project's progress: the global profile (points/rank), every earned badge,
   * and per-cartridge point totals that back the per-cartridge leaderboards.
   */
  async pushProgress(scope: string): Promise<{ points: number; rank: string; badges: number }> {
    const { badges, points, rank } = this.service.listBadges(scope);
    await this.remote.upsertProfile({
      userId: this.identity.userId,
      handle: this.identity.handle,
      points,
      rank: rank.rank.name,
    });
    await this.remote.upsertBadges(
      badges.map((b) => ({
        userId: this.identity.userId,
        cartridgeId: b.cartridgeId,
        badgeId: b.badgeId,
        name: b.name,
        points: b.points,
      })),
    );

    // Roll badges up into per-cartridge point totals for the per-cartridge boards.
    const byCartridge = new Map<string, number>();
    for (const b of badges) {
      byCartridge.set(b.cartridgeId, (byCartridge.get(b.cartridgeId) ?? 0) + b.points);
    }
    await this.remote.upsertCartridgeScores(
      [...byCartridge].map(([cartridgeId, pts]) => ({
        userId: this.identity.userId,
        cartridgeId,
        handle: this.identity.handle,
        points: pts,
      })),
    );

    return { points, rank: rank.rank.name, badges: badges.length };
  }

  /** Pull approved community cartridges into the local registry cache dir. */
  async pullCartridges(cacheDir: string): Promise<string[]> {
    const remotes = await this.remote.listApprovedCartridges();
    mkdirSync(cacheDir, { recursive: true });
    const written: string[] = [];
    for (const r of remotes) {
      writeFileSync(path.join(cacheDir, `${r.id}.json`), JSON.stringify(r.document, null, 2));
      written.push(r.id);
    }
    return written;
  }

  /** Submit a cartridge to the registry for moderation. */
  async publish(cartridge: Cartridge): Promise<void> {
    await this.remote.submitCartridge(cartridge, this.identity.userId);
  }
}
