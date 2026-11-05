import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HudCartridge, HudNext, HudSnapshot } from '../types'

const snapshot = atom({ plugin: 'learnmcp', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'learnmcp', key: 'isHidden' } as const, false)
/** The track the person chose to follow; null means follow whatever is active here. */
const focus = atom({ plugin: 'learnmcp', key: 'focus' } as const, null)
/** Id of the folder this session is in, as the plugin's hook and proxy compute it. */
const project = atom({ plugin: 'learnmcp', key: 'project' } as const, null)

/** Which of the next items the band shows; steps every ROTATE_MS while there is more than one. */
const tick = atom({ plugin: 'learnmcp', key: 'tick' } as const, 0)
const ROTATE_MS = 4000

/** Tracks whose steps are open in the large view. */
const expanded = atom({ plugin: 'learnmcp', key: 'expanded' } as const, [] as string[])

const PANE = 'learnmcp'

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
  projectCartridgeIds?: string[]
  upNext?: HudNext[]
  earnedBadges: number
}

/**
 * Same id the hook and the MCP proxy send (folder name + FNV-1a of the path), so the
 * server can tell which cartridges belong to the app being built. The path itself never
 * leaves the machine.
 */
export function projectId(dir: string): string {
  const abs = dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir
  let h = 0x811c9dc5
  for (let i = 0; i < abs.length; i++) {
    h ^= abs.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${abs.split(/[\\/]/).pop() || 'root'}-${(h >>> 0).toString(16).padStart(8, '0')}`
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
 * in `priority` (this project's, the chosen one first) come first, then those with progress,
 * so the ones you're actually working on are the ones shown.
 */
export function fitCartridges(
  cartridges: HudCartridge[],
  columns: number,
  priority: string[] = [],
): { shown: HudCartridge[]; more: number } {
  const rank = (id: string) => (priority.includes(id) ? priority.indexOf(id) : priority.length)
  const sorted = [...cartridges].sort(
    (a, b) => rank(a.id) - rank(b.id) || b.completed / (b.total || 1) - a.completed / (a.total || 1),
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

/**
 * What the band's "Next" cycles through: every track's suggestion, the followed track's
 * first. Servers that predate `upNext` send only one, which is shown alone.
 */
export function nextItems(shot: HudSnapshot, chosen: string | null): HudNext[] {
  const all = shot.upNext?.length ? shot.upNext : shot.next ? [shot.next] : []
  return [...all].sort((a, b) => Number(b.cartridgeId === chosen) - Number(a.cartridgeId === chosen))
}

/** A colour per known track, so each reads as its own thing; unknown ones are picked by name. */
const CARTRIDGE_COLORS: Record<string, string> = {
  twilio: '#f22f46',
  general: '#8b949e',
  firebase: '#ffa611',
  postman: '#ff6c37',
  supabase: '#3ecf8e',
  vercel: '#e6edf3',
  github: '#a371f7',
  stripe: '#7a73ff',
  figma: '#d26bff',
  notion: '#d2b48c',
  slack: '#e8386d',
  exa: '#5b9dff',
  playwright: '#45ba4b',
  context7: '#1fc8e0',
  serena: '#d29922',
  atlassian: '#3d8bff',
  'chrome-devtools': '#6ea8fe',
}
const FALLBACK_COLORS = ['#ff7b72', '#79c0ff', '#56d364', '#e3b341', '#d2a8ff', '#ffa657', '#39c5cf', '#f778ba']

export function cartridgeColor(id: string): string {
  // Own keys only: an id like `constructor` must not resolve to an inherited function.
  if (Object.hasOwn(CARTRIDGE_COLORS, id)) return CARTRIDGE_COLORS[id]!
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]!
}

const METER_CELLS = 14

/**
 * A progress meter drawn from coloured cells rather than block characters: surfaces
 * that draw their own buttons and fonts render `█░` as odd squares, while a Box's
 * background is painted the same everywhere.
 */
function meter($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], fraction: number, color: string) {
  const { Box } = $.ui.resolve(e)
  const filled = fraction > 0 ? Math.max(1, Math.round(Math.min(1, fraction) * METER_CELLS)) : 0

  return (
    <Box flexDirection="row" width={METER_CELLS} height={1} backgroundColor="#30363d">
      {filled > 0 && <Box width={filled} height={1} backgroundColor={color} />}
    </Box>
  )
}

/** Sort key for the pane: the followed track, then this folder's, then the rest. */
function rankIn(id: string, chosen: string | null, here: string[]): number {
  if (id === chosen) return -1
  const i = here.indexOf(id)
  return i === -1 ? here.length : i
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

async function callTool(
  $: EngineInterface,
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const res = await $.http.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
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

    const here = (await read($, project)) ?? undefined
    const chosen = (await read($, focus)) ?? undefined
    const [progress, next] = await Promise.all([
      callTool($, url, token, 'progress', { project: here }) as Promise<Progress | null>,
      callTool($, url, token, 'learn_next', { project: here, cartridge: chosen }) as Promise<
        (HudNext & { message?: string }) | null
      >,
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
        projectCartridges: progress.projectCartridgeIds ?? [],
        upNext: progress.upNext ?? [],
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

/** Follow `id` (a cartridge) from now on in this folder; null goes back to following what's active here. */
async function choose($: EngineInterface, id: string | null): Promise<void> {
  await update($, focus, () => id)
  const here = await read($, project)
  if (here) void $.store.set(`focus:${here}`, id ?? '')
  void refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'learnmcp-hud',
      description: 'Show or hide the learnmcp progress band above the prompt',
    })
    await $.command.register({
      name: 'learnmcp-pane',
      description: 'Open the large learnmcp view: every track, and a picker for the one to follow',
    })
    const here = projectId(e.cwd)
    await update($, project, () => here)
    const chosen = ((await $.store.get(`focus:${here}`)) as string | undefined) || null
    await update($, focus, () => chosen)
    // Draw last session's numbers at once, with this session's gains starting from zero.
    const cached = (await $.store.get(STORE_KEY)) as HudSnapshot | undefined
    if (cached && (await read($, snapshot)) === null) {
      await update($, snapshot, () => ({ ...cached, gained: 0 }))
    }
    // Step the band's "Next" through every track's suggestion, a couple of seconds each.
    $.clock.every(ROTATE_MS, async () => {
      const shot = await read($, snapshot)
      if ((shot?.upNext?.length ?? 0) > 1) await update($, tick, n => n + 1)
    })
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

  on('command.run', { command: 'learnmcp-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: 'learnmcp' })

    return { text: 'learnmcp pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shot = await read($, snapshot)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (shot === null) return <Text dimColor>No progress yet — learnmcp fills this in after the first scan.</Text>

    const chosen = await read($, focus)
    const open = await read($, expanded)
    const here = shot.projectCartridges ?? []
    const rank = rankStyle(shot.rank)
    // The followed track, then this folder's, then the rest.
    const tracks = [...shot.cartridges].sort(
      (a, b) => rankIn(a.id, chosen, here) - rankIn(b.id, chosen, here),
    )

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={rank.color} bold>{rank.emoji} {shot.rank}</Text>
          <Text color="#ffd700" bold> {shot.points} pts</Text>
          {shot.gained > 0 && <Text color="green" bold> +{shot.gained}</Text>}
          {shot.nextRank && (
            <Text dimColor> · {shot.pointsToNext} to {rankStyle(shot.nextRank).emoji} {shot.nextRank}</Text>
          )}
          <Text dimColor> · 🏅 {shot.badges}</Text>
        </Text>
        <Text dimColor>Points and badges come from every track. Following one only changes what is suggested next.</Text>
        <Text> </Text>
        <Text dimColor>
          {chosen ? `Following ${chosen}.` : 'Auto: suggestions follow this folder.'} ● = active in this folder. Select a track for its steps.
        </Text>
        {chosen && (
          <Button key="track-auto" plain onPress={() => choose($, null)}>
            Stop following {chosen} (Auto)
          </Button>
        )}
        <Text> </Text>
        {tracks.map(c => {
          const color = cartridgeColor(c.id)
          const fraction = c.completed / (c.total || 1)
          const isOpen = open.includes(c.id)
          const nextStep = c.steps?.find(step => !step.done)
          return (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Button
                  key={`row-${c.id}`}
                  plain
                  onPress={() => update($, expanded, list => (list.includes(c.id) ? list.filter(x => x !== c.id) : [...list, c.id]))}
                >
                  {isOpen ? '▾' : '▸'}
                </Button>
                <Text color={color} bold> {c.id.padEnd(12)}</Text>
                <Text> </Text>
                {meter($, e, fraction, heat(fraction))}
                <Text color={heat(fraction)} bold> {c.completed}/{c.total}</Text>
                {here.includes(c.id) && <Text dimColor> ● here</Text>}
                {chosen === c.id && <Text color="#ff8700"> ← following</Text>}
              </Box>
              {isOpen && chosen !== c.id && (
                <Box marginLeft={4}>
                  <Button key={`track-${c.id}`} plain onPress={() => choose($, c.id)}>
                    Follow {c.id}
                  </Button>
                </Box>
              )}
              {isOpen && (c.steps ?? []).length === 0 && (
                <Text dimColor>    No step list yet — update the learnmcp server.</Text>
              )}
              {isOpen &&
                (c.steps ?? []).map(step => (
                  <Box flexDirection="column" marginLeft={4}>
                    <Text>
                      <Text color={step.done ? '#2ea043' : step === nextStep ? '#ff8700' : undefined}>
                        {step.done ? '✓' : step === nextStep ? '▶' : '○'} {step.title}
                      </Text>
                      {step.badge && <Text dimColor> → {titleCase(step.badge)}</Text>}
                    </Text>
                    {!step.done && step.why && <Text dimColor>    {step.why}</Text>}
                    {!step.done && step.docs && <Text dimColor>    {step.docs}</Text>}
                  </Box>
                ))}
            </Box>
          )
        })}
        {shot.next && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="#ff8700" bold>Next: {shot.next.title}</Text>
            <Text dimColor>
              {shot.next.cartridgeId}
              {shot.next.badge ? ` → ${titleCase(shot.next.badge)}` : ''}
              {shot.next.docs ? ` · ${shot.next.docs}` : ''}
            </Text>
          </Box>
        )}
      </Box>
    )
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

    const { Box, Text, Button } = $.ui.resolve(e)
    const rank = rankStyle(shot.rank)
    const chosenTrack = await read($, focus)
    const items = nextItems(shot, chosenTrack)
    const position = items.length ? (await read($, tick)) % items.length : 0
    const current = items[position]
    const { shown, more } = fitCartridges(shot.cartridges, e.props.bodyColumns, [
      ...(chosenTrack ? [chosenTrack] : []),
      ...(shot.projectCartridges ?? []),
    ])

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
        <Box flexDirection="row" justifyContent="space-between">
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
          <Button
            key="open-large"
            plain
            hotkey="o"
            onPress={() => $.ui.open({ id: PANE, title: 'learnmcp' })}
          >
            ⤢ more
          </Button>
        </Box>
        <Text wrap="truncate-end">
          {shown.length === 0 && <Text dimColor>No cartridges active yet — use a tool learnmcp knows</Text>}
          {shown.map((c, i) => {
            const fraction = c.completed / (c.total || 1)
            return (
              <Text>
                {i > 0 && <Text dimColor> · </Text>}
                <Text color={cartridgeColor(c.id)} bold>{c.id} </Text>
                {coloredBar(fraction, 5)}
                <Text color={heat(fraction)}> {c.completed}/{c.total}</Text>
              </Text>
            )
          })}
          {more > 0 && <Text dimColor> +{more} more</Text>}
        </Text>
        {current && (
          <Text wrap="truncate-end">
            <Text color="#ff8700">Next: {current.title}</Text>
            <Text dimColor>
              {' '}({current.cartridgeId}){current.badge ? ` → ${titleCase(current.badge)}` : ''}
              {items.length > 1 ? ` · ${position + 1}/${items.length}` : ''}
            </Text>
          </Text>
        )}
      </Box>
    )
  })
}
