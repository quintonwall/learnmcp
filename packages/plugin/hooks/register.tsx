import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HudCartridge, HudNext, HudSnapshot } from '../types'

const snapshot = atom({ plugin: 'learnmcp', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'learnmcp', key: 'isHidden' } as const, false)

const DEFAULT_URL = 'https://learnmcp.ai/mcp'
const STORE_KEY = 'snapshot'
const BAR = 8

type Progress = {
  points: number
  rank: {
    rank: { name: string }
    next?: { name: string }
    pointsToNext?: number
    progress: number
  }
  cartridges: HudCartridge[]
  earnedBadges: number
}

export function bar(fraction: number, width = BAR): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Red when you've barely started, through orange and yellow, to green when complete. */
export function heat(fraction: number): string {
  if (fraction >= 1) return '#2ea043'
  if (fraction >= 0.75) return '#8ccf3f'
  if (fraction >= 0.5) return '#e3b341'
  if (fraction >= 0.25) return '#f0883e'
  return '#e5534b'
}

/** One emoji and colour per rank, climbing from a seedling to a crown. */
const RANK_STYLE: Record<string, { emoji: string; color: string }> = {
  Novice: { emoji: '🌱', color: '#8b949e' },
  Initiate: { emoji: '🔰', color: '#3fb950' },
  Apprentice: { emoji: '🔨', color: '#58a6ff' },
  Journeyman: { emoji: '🧭', color: '#39c5cf' },
  Adept: { emoji: '🔮', color: '#bc8cff' },
  Expert: { emoji: '🎯', color: '#ff7b72' },
  Master: { emoji: '🥋', color: '#f778ba' },
  Grandmaster: { emoji: '🧙', color: '#d2a8ff' },
  Legend: { emoji: '👑', color: '#ffd700' },
}

export function rankStyle(name: string): { emoji: string; color: string } {
  return RANK_STYLE[name] ?? { emoji: '🎓', color: '#58a6ff' }
}

/** `first-contact` → `First Contact`: the recommendation carries the badge id, not its name. */
export function titleCase(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * The cartridge row, fitted to `columns`: as many tracks as fit, then `+N more`. Tracks
 * with progress come first, so the ones you're actually working on are the ones shown.
 */
export function fitCartridges(
  cartridges: HudCartridge[],
  columns: number,
): { shown: HudCartridge[]; more: number } {
  const sorted = [...cartridges].sort(
    (a, b) => b.completed / (b.total || 1) - a.completed / (a.total || 1),
  )
  let width = 0
  for (const [i, c] of sorted.entries()) {
    const part = `${c.id} ${bar(0, 5)} ${c.completed}/${c.total}`.length + (i > 0 ? 3 : 0)
    const rest = sorted.length - i - 1
    const suffix = rest > 0 ? ` +${rest} more`.length : 0
    if (i > 0 && width + part + suffix > columns) return { shown: sorted.slice(0, i), more: sorted.length - i }
    width += part
  }
  return { shown: sorted, more: 0 }
}

/** The server answers either a plain JSON body or one SSE frame, as the plugin's hook handles. */
export function parseToolResult(text: string, contentType: string): unknown {
  let body: { result?: { content?: Array<{ type: string; text?: string }> } } | null = null
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('data:') && line.slice(5).trim()) body = JSON.parse(line.slice(5).trim())
    }
  } else if (text) {
    body = JSON.parse(text)
  }
  const payload = body?.result?.content?.find(c => c.type === 'text')?.text
  return payload ? JSON.parse(payload) : null
}

async function callTool($: EngineInterface, url: string, token: string, name: string) {
  const res = await $.http.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
  })
  if (!res.ok) return null
  return parseToolResult(res.text, res.headers['content-type'] ?? '')
}

/**
 * Reads progress with the learner's own token. With no token yet, nothing is fetched: a
 * tokenless call would mint a fresh anonymous learner, which only the plugin's hooks
 * should do (they're the ones that save it).
 */
async function refresh($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('LEARNMCP_LOCAL')) === '1') return
    const home = await $.env.get('HOME')
    if (!home) return
    const token = (await $.fs.read(`${home}/.learnmcp/token`).catch(() => '')).trim()
    if (!token) return
    const url = (await $.env.get('LEARNMCP_URL')) || DEFAULT_URL

    const [progress, next] = await Promise.all([
      callTool($, url, token, 'progress') as Promise<Progress | null>,
      callTool($, url, token, 'learn_next') as Promise<(HudNext & { message?: string }) | null>,
    ])
    if (!progress) return

    await update($, snapshot, prev => {
      const shot: HudSnapshot = {
        rank: progress.rank.rank.name,
        points: progress.points,
        gained: prev ? prev.gained + Math.max(0, progress.points - prev.points) : 0,
        nextRank: progress.rank.next?.name,
        pointsToNext: progress.rank.pointsToNext,
        rankProgress: progress.rank.progress,
        badges: progress.earnedBadges,
        cartridges: progress.cartridges,
        next: next?.title
          ? { title: next.title, cartridgeId: next.cartridgeId, badge: next.badge, docs: next.docs }
          : undefined,
      }
      void $.store.set(STORE_KEY, shot)
      return shot
    })
  } catch {
    // Offline or the server is down: keep showing the last snapshot.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'learnmcp-hud',
      description: 'Show or hide the learnmcp progress band above the prompt',
    })
    // Draw last session's numbers at once, with this session's gains starting from zero.
    const cached = (await $.store.get(STORE_KEY)) as HudSnapshot | undefined
    if (cached && (await read($, snapshot)) === null) {
      await update($, snapshot, () => ({ ...cached, gained: 0 }))
    }
    void refresh($)
    // The plugin's own SessionStart hook records the project scan; read again once it has.
    $.clock.after(10_000, () => void refresh($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)

    return result
  })

  on('command.run', { command: 'learnmcp-hud' }, async $ => {
    const hidden = await update($, isHidden, h => !h)

    return { text: hidden ? 'learnmcp band hidden.' : 'learnmcp band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shot = await read($, snapshot)
    if (e.props.hasSurvey || shot === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const rank = rankStyle(shot.rank)
    const { shown, more } = fitCartridges(shot.cartridges, e.props.bodyColumns)

    /** A bar whose filled part shades toward green as it nears complete. */
    const coloredBar = (fraction: number, width: number) => {
      const full = bar(fraction, width).replace(/░/g, '')
      return (
        <Text>
          <Text color={heat(fraction)}>{full}</Text>
          <Text dimColor>{'░'.repeat(width - full.length)}</Text>
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="magenta" bold>🎓 learnmcp</Text>
          <Text>  </Text>
          <Text color={rank.color} bold>{rank.emoji} {shot.rank}</Text>
          <Text> </Text>
          {coloredBar(shot.rankProgress, BAR)}
          <Text color="#ffd700" bold> {shot.points} pts</Text>
          {shot.gained > 0 && <Text color="green" bold> +{shot.gained}</Text>}
          {shot.nextRank && (
            <Text dimColor>
              {' '}· {shot.pointsToNext} to {rankStyle(shot.nextRank).emoji} {shot.nextRank}
            </Text>
          )}
          <Text dimColor> · 🏅 {shot.badges}</Text>
        </Text>
        <Text wrap="truncate-end">
          {shown.length === 0 && <Text dimColor>No cartridges active yet — use a tool learnmcp knows</Text>}
          {shown.map((c, i) => {
            const fraction = c.completed / (c.total || 1)
            return (
              <Text>
                {i > 0 && <Text dimColor> · </Text>}
                <Text>{c.id} </Text>
                {coloredBar(fraction, 5)}
                <Text color={heat(fraction)}> {c.completed}/{c.total}</Text>
              </Text>
            )
          })}
          {more > 0 && <Text dimColor> +{more} more</Text>}
        </Text>
        {shot.next && (
          <Text wrap="truncate-end">
            <Text color="#ff8700">Next: {shot.next.title}</Text>
            <Text dimColor>
              {' '}({shot.next.cartridgeId}){shot.next.badge ? ` → ${titleCase(shot.next.badge)}` : ''}
            </Text>
          </Text>
        )}
      </Box>
    )
  })
}
