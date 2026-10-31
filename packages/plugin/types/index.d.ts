export type HudStep = { id: string; title: string; why?: string; docs?: string; badge?: string; done: boolean }

export type HudCartridge = { id: string; completed: number; total: number; steps?: HudStep[] }

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
  /** Cartridges active in the folder this session is in, as the server sees it. */
  projectCartridges: string[]
  next?: HudNext
  /** The next objective of every active track; the band's "Next" rotates through them. */
  upNext: HudNext[]
}

declare module 'claude-code' {
  interface PluginState {
    learnmcp: { snapshot: HudSnapshot | null; isHidden: boolean; focus: string | null; project: string | null; tick: number; expanded: string[] }
  }
}
