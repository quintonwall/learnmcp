import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cartridgeColor, fitCartridges, heat, nextItems, projectId, rankStyle } from '../hooks/register'

const PROGRESS = {
  points: 140,
  rank: { rank: { name: 'Apprentice' }, next: { name: 'Journeyman' }, pointsToNext: 60, progress: 0.4 },
  cartridges: [
    { id: 'github', completed: 1, total: 6 },
    {
      id: 'postman',
      completed: 3,
      total: 8,
      steps: [
        { id: 'a', title: 'Generate a spec', badge: 'spec-author', done: true },
        { id: 'b', title: 'Sync your spec to a collection', why: 'Keeps tests honest', docs: 'https://example.com/sync', done: false },
        { id: 'c', title: 'Run the collection in CI', done: false },
      ],
    },
    { id: 'supabase', completed: 0, total: 5 },
  ],
  earnedBadges: 7,
  upNext: [
    { cartridgeId: 'postman', title: 'Sync your spec to a collection', badge: 'spec-syncer' },
    { cartridgeId: 'github', title: 'Open your first pull request', badge: 'first-pr' },
    { cartridgeId: 'supabase', title: 'Turn on row level security', badge: 'locked-down' },
  ],
}
const NEXT = { cartridgeId: 'postman', objectiveId: 'sync', title: 'Sync your spec to a collection', badge: 'spec-syncer' }

function learnmcp(on: On, token = 'tok') {
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('fs.read', async (_$, e) => {
    if (e.path === '/home/me/.learnmcp/token' && token) return { value: `${token}\n` }
    return { deny: 'ENOENT' }
  })
  const calls: string[] & { args?: Array<Record<string, unknown>>; clock?: typeof clock } = []
  calls.args = []
  calls.clock = clock
  on('http.fetch', async (_$, e) => {
    const params = JSON.parse(String(e.init?.body)).params
    const name = params.name as string
    calls.push(name)
    calls.args!.push({ name, ...params.arguments })
    const payload = name === 'progress' ? PROGRESS : NEXT
    const body = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }
    return { value: { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: JSON.stringify(body) } }
  })
  return calls
}

const BAND = (bodyColumns: number) =>
  ({
    plugin: 'learnmcp',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
  }) as const

const TURN = { reason: 'answer', answer: '', durationMs: 1, isAborted: false, turnId: 't1' } as const

const start = { cwd: '/proj', surface: 'terminal', isInteractive: true } as const

test('the band shows rank, points, cartridges and next in at most 4 lines', async ($, on) => {
  learnmcp(on)
  await $.session.start(start)
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND(120), surface } as never)
    const drawn = await ui.drawn()
    expect(('children' in drawn ? drawn.children?.length : 0) ?? 0).toBeLessThanOrEqual(4)
    expect(await ui.find({ type: 'Text', text: /🔨 Apprentice/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /140 pts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3\/8/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Next: Sync your spec/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Spec Syncer/ })).toBeDefined()
    expect(JSON.stringify(drawn)).toContain('"color":"#e5534b"')
    await ui.unmount()
  }
})

test('no token means no request and no band', async ($, on) => {
  const calls = learnmcp(on, '')
  await $.session.start(start)
  await $.turn.complete(TURN)

  expect(calls).toEqual([])
  const ui = await $.ui.mount({ ...BAND(120), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /learnmcp/ })).toBeUndefined()
})

test('the command hides the band', async ($, on) => {
  learnmcp(on)
  await $.session.start(start)
  await $.turn.complete(TURN)
  const before = await $.ui.mount({ ...BAND(120), surface: 'terminal' } as never)
  expect(await before.find({ type: 'Text', text: /learnmcp/ })).toBeDefined()
  await before.unmount()
  await $.command.run({ command: 'learnmcp-hud', args: '' } as never)

  const ui = await $.ui.mount({ ...BAND(120), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /learnmcp/ })).toBeUndefined()
})

test('the cartridge row fits its width, most-progressed first', async () => {
  const { shown, more } = fitCartridges(PROGRESS.cartridges, 40)
  expect(shown[0]?.id).toBe('postman')
  expect(shown.length + more).toBe(3)
  expect(more).toBeGreaterThan(0)
})

test('bars shade toward green and ranks have their own emoji', async () => {
  expect(heat(0.1)).toBe('#e5534b')
  expect(heat(1)).toBe('#2ea043')
  expect(rankStyle('Legend').emoji).toBe('👑')
  expect(rankStyle('Unknown').emoji).toBe('🎓')
})

const PANE = {
  plugin: 'learnmcp',
  component: 'Pane',
  requestId: 'learnmcp',
  props: {
    title: 'learnmcp',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** The refresh after a turn is not awaited; mounting the band waits for it, as the band test does. */
async function settled($: Parameters<Parameters<typeof test>[1]>[0]) {
  const ui = await $.ui.mount({ ...BAND(120), surface: 'terminal' } as never)
  await ui.find({ type: 'Text', text: /pts/ })
  await ui.unmount()
}

test('the project id matches the one the hook and proxy send', async () => {
  // Same value `node` computes in packages/plugin/hooks for this path.
  expect(projectId('/Users/q/Code/twilio-demo')).toBe('twilio-demo-19807669')
  expect(projectId('/Users/q/Code/twilio-demo/')).toBe('twilio-demo-19807669')
})

test('reads are tagged with the project they are about', async ($, on) => {
  const calls = learnmcp(on)
  await $.session.start({ ...start, cwd: '/Users/q/Code/twilio-demo' })
  await $.turn.complete(TURN)
  await settled($)

  expect(calls.args!.find(c => c.name === 'progress')?.project).toBe('twilio-demo-19807669')
  expect(calls.args!.find(c => c.name === 'learn_next')?.project).toBe('twilio-demo-19807669')
})

test('the large view lists every track and following one changes only what is suggested', async ($, on) => {
  const calls = learnmcp(on)
  await $.session.start(start)
  await $.turn.complete(TURN)
  await settled($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    for (const id of ['github', 'postman', 'supabase']) {
      expect(await ui.find({ type: 'Button', key: `row-${id}` })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Points and badges come from every track/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await ui.press({ key: 'row-supabase' })
  await ui.press({ key: 'track-supabase' })
  const asked = calls.args!.filter(c => c.name === 'learn_next').at(-1)
  expect(asked?.cartridge).toBe('supabase')
  // Points are not a function of the pick: progress is read the same way either side.
  expect(calls.args!.filter(c => c.name === 'progress').at(-1)).not.toHaveProperty('cartridge')

  await ui.press({ key: 'track-auto' })
  expect(calls.args!.filter(c => c.name === 'learn_next').at(-1)?.cartridge).toBeUndefined()
})

test('the followed track is remembered per folder', async ($, on) => {
  const calls = learnmcp(on)
  await $.session.start({ ...start, cwd: '/proj/a' })
  await $.turn.complete(TURN)
  await settled($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  await ui.press({ key: 'row-postman' })
  await ui.press({ key: 'track-postman' })

  await $.session.start({ ...start, cwd: '/proj/a' })
  await $.turn.complete(TURN)
  await settled($)
  expect(calls.args!.filter(c => c.name === 'learn_next').at(-1)?.cartridge).toBe('postman')

  await $.session.start({ ...start, cwd: '/proj/b' })
  await $.turn.complete(TURN)
  await settled($)
  expect(calls.args!.filter(c => c.name === 'learn_next').at(-1)?.cartridge).toBeUndefined()
})

test('this folder’s tracks come first in the band', async () => {
  const { shown } = fitCartridges(PROGRESS.cartridges, 200, ['supabase'])
  expect(shown[0]?.id).toBe('supabase')
})

test('the band rotates through every track’s next item every two seconds', async ($, on) => {
  const calls = learnmcp(on)
  await $.session.start(start)
  await $.turn.complete(TURN)

  const ui = await $.ui.mount({ ...BAND(120), surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Next: Sync your spec.*1\/3/ })).toBeDefined()
  await calls.clock!.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Next: Open your first pull request.*2\/3/ })).toBeDefined()
  await calls.clock!.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Next: Turn on row level security.*3\/3/ })).toBeDefined()
  await calls.clock!.advance(2000)
  expect(await ui.find({ type: 'Text', text: /Next: Sync your spec.*1\/3/ })).toBeDefined()
  await ui.unmount()
})

test('the followed track is shown first in the rotation', async () => {
  const shot = { upNext: PROGRESS.upNext, next: PROGRESS.upNext[0] } as never
  expect(nextItems(shot, 'supabase')[0]?.cartridgeId).toBe('supabase')
  expect(nextItems(shot, null)[0]?.cartridgeId).toBe('postman')
})

test('the band has a button that opens the large view', async ($, on) => {
  const opened: string[] = []
  learnmcp(on)
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.session.start(start)
  await $.turn.complete(TURN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND(120), surface } as never)
    await ui.press({ key: 'open-large' })
    await ui.unmount()
  }
  expect(opened).toEqual(['learnmcp', 'learnmcp'])
})

test('selecting a track in the large view shows every step, and again hides them', async ($, on) => {
  learnmcp(on)
  await $.session.start(start)
  await $.turn.complete(TURN)
  await settled($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Generate a spec/ })).toBeUndefined()

    await ui.press({ key: 'row-postman' })
    expect(await ui.find({ type: 'Text', text: /✓ Generate a spec/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ Sync your spec to a collection/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ Run the collection in CI/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Keeps tests honest/ })).toBeDefined()

    await ui.press({ key: 'row-postman' })
    expect(await ui.find({ type: 'Text', text: /Generate a spec/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('every bundled track has its own colour, and unknown ones get a stable one', async () => {
  const ids = ['twilio', 'general', 'firebase', 'postman', 'supabase', 'vercel', 'github', 'stripe', 'figma', 'notion', 'slack', 'exa', 'playwright', 'context7', 'serena', 'atlassian', 'chrome-devtools']
  expect(new Set(ids.map(cartridgeColor)).size).toBe(ids.length)
  expect(cartridgeColor('brand-new')).toBe(cartridgeColor('brand-new'))
})
