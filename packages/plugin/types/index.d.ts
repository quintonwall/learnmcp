export type HudCartridge = { id: string; completed: number; total: number }

export type HudNext = { title: string; cartridgeId: string; badge?: string; docs?: string }

export type HudSnapshot = {
  rank: string
  points: number
  /** Points earned since the band first loaded this session. */
  gained: number
  nextRank?: string
  pointsToNext?: number
  /** Progress through the current rank band, 0..1. */
  rankProgress: number
  badges: number
  cartridges: HudCartridge[]
  next?: HudNext
}

declare module 'claude-code' {
  interface PluginState {
    learnmcp: { snapshot: HudSnapshot | null; isHidden: boolean }
  }
}
