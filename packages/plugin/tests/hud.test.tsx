import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fitCartridges, heat, rankStyle } from '../hooks/register'

const PROGRESS = {
  points: 140,
  rank: { rank: { name: 'Apprentice' }, next: { name: 'Journeyman' }, pointsToNext: 60, progress: 0.4 },
  cartridges: [
    { id: 'github', completed: 1, total: 6 },
    { id: 'postman', completed: 3, total: 8 },
    { id: 'supabase', completed: 0, total: 5 },
  ],
  earnedBadges: 7,
}
const NEXT = { cartridgeId: 'postman', objectiveId: 'sync', title: 'Sync your spec to a collection', badge: 'spec-syncer' }

function learnmcp(on: On, token = 'tok') {
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  mock.clock(on)
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
  const calls: string[] = []
  on('http.fetch', async (_$, e) => {
    const name = JSON.parse(String(e.init?.body)).params.name as string
    calls.push(name)
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
