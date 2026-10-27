import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { AUTO_MS, contextToast, crossed, due, EVERY_MS, FILL_MS, parse, ttlOf } from '../hooks/register'

const S = 1_000_000
const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const FOUND = ran(0, '/repo\n/repo/.git\n')
const line = (at: number, kind: string, text: string) => `${at}\t${kind}\t${text}\n`
const FAIL = 'claudzilla: auto-update to v1.3.0 failed - ask Claude to debug it (log: /repo/.git/claudzilla-update.log)'

type Piece = { stream: 'stdout' | 'stderr'; text: string }
// The module types carry no timers; the test runner has them.
const tick = () => new Promise(resolve => (globalThis as any).setTimeout(resolve, 5))
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await tick()
}

// The test's `$` has no `process`, so the watch is driven the way a session drives it: through session.start.
function session(on: On, pieces: Piece[], found = FOUND) {
  const seen = { toasts: [] as string[], argv: [] as readonly string[], ran: false, spawned: false }
  on('clock.now', () => ({ value: S * 1000 }))
  on('process.run', () => {
    seen.ran = true
    return found
  })
  on('process.spawn', async function* (_, e) {
    seen.spawned = true
    seen.argv = e.argv
    for (const piece of pieces) yield piece
    return { value: { code: 0, signal: null } }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  return seen
}
const start = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const END = line(S, 'live', 'end')

test('parse reads epoch, kind and text', () => {
  expect(parse(`${S}\tlive\tclaudzilla: updating to v1.2.0`)).toEqual({ at: S, kind: 'live', text: 'claudzilla: updating to v1.2.0' })
})

test('parse refuses a malformed line', () => {
  expect(parse('x\tlive\ttext')).toBeUndefined()
  expect(parse(`${S}\tother\ttext`)).toBeUndefined()
  expect(parse('')).toBeUndefined()
})

test('due: start lines within 30 s of the session start', () => {
  expect(due({ at: S - 30, kind: 'start', text: '' }, S)).toBe(true)
  expect(due({ at: S + 30, kind: 'start', text: '' }, S)).toBe(true)
  expect(due({ at: S - 31, kind: 'start', text: '' }, S)).toBe(false)
  expect(due({ at: S + 31, kind: 'start', text: '' }, S)).toBe(false)
})

test('due: live and fail lines from the session start on', () => {
  expect(due({ at: S, kind: 'live', text: '' }, S)).toBe(true)
  expect(due({ at: S + 600, kind: 'fail', text: '' }, S)).toBe(true)
  expect(due({ at: S - 6, kind: 'live', text: '' }, S)).toBe(false)
})

// The SessionStart hook's job may write before the mod reads its clock.
test('due: live lines up to 5 s before the session start', () => {
  expect(due({ at: S - 5, kind: 'live', text: '' }, S)).toBe(true)
})

test('toasts due lines and skips the rest', async ($, on) => {
  const seen = session(on, [
    { stream: 'stdout', text: line(S - 100, 'live', 'old') + line(S, 'start', 'claudzilla: update available') },
    { stream: 'stdout', text: line(S + 5, 'live', 'claudzilla: updating to v1.2.0') + END },
  ])
  await $.session.start(start)
  await until(() => seen.toasts.includes('end'))
  expect(seen.argv).toEqual(['tail', '-n', '20', '-F', '/repo/.git/claudzilla-update.events'])
  expect(seen.toasts).toEqual(['claudzilla: update available', 'claudzilla: updating to v1.2.0', 'end'])
})

test('joins a line split across pieces', async ($, on) => {
  const seen = session(on, [
    { stream: 'stdout', text: `${S}\tlive\tclaudzilla: upd` },
    { stream: 'stdout', text: 'ated to v1.2.0 - restart Claude to apply\n' + END },
  ])
  await $.session.start(start)
  await until(() => seen.toasts.includes('end'))
  expect(seen.toasts).toEqual(['claudzilla: updated to v1.2.0 - restart Claude to apply', 'end'])
})

test('a line tail re-reads after a trim toasts once', async ($, on) => {
  const again = line(S + 5, 'live', 'claudzilla: updated to v1.2.0 - restart Claude to apply')
  const seen = session(on, [{ stream: 'stdout', text: again }, { stream: 'stdout', text: again + END }])
  await $.session.start(start)
  await until(() => seen.toasts.includes('end'))
  expect(seen.toasts).toEqual(['claudzilla: updated to v1.2.0 - restart Claude to apply', 'end'])
})

test('ignores stderr, such as tail waiting for a missing file', async ($, on) => {
  const seen = session(on, [
    { stream: 'stderr', text: line(S, 'live', 'not a toast') },
    { stream: 'stdout', text: END },
  ])
  await $.session.start(start)
  await until(() => seen.toasts.includes('end'))
  expect(seen.toasts).toEqual(['end'])
})

test('does nothing when the repo is not found', async ($, on) => {
  const seen = session(on, [{ stream: 'stdout', text: END }], ran(1, ''))
  await $.session.start(start)
  await until(() => seen.ran)
  for (let i = 0; i < 10; i++) await tick()
  expect(seen.spawned).toBe(false)
  expect(seen.toasts).toEqual([])
})

test('a fail line reaches the next prompt once, with the log and retry command', async ($, on) => {
  const seen = session(on, [{ stream: 'stdout', text: line(S, 'fail', FAIL) }])
  await $.session.start(start)
  await until(() => seen.toasts.length > 0)
  const first = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const second = await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  const note = 'context' in first ? first.context?.find(c => c.includes('claudzilla-update.log')) : undefined
  expect(note).toContain('/repo/.git/claudzilla-update.log')
  expect(note).toContain('git -C /repo merge --ff-only v1.3.0 && /repo/install.sh')
  expect('context' in second && second.context?.some(c => c.includes('claudzilla-update.log'))).not.toBe(true)
})

test('a fail line without a target retries to the upstream branch', async ($, on) => {
  const seen = session(on, [{ stream: 'stdout', text: line(S, 'fail', 'claudzilla: auto-update failed - ask Claude to debug it (log: /repo/.git/claudzilla-update.log)') }])
  await $.session.start(start)
  await until(() => seen.toasts.length > 0)
  const first = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect('context' in first && first.context?.some(c => c.includes('git -C /repo merge --ff-only @{u} && /repo/install.sh'))).toBe(true)
})

test('a non-interactive session starts no watch', async ($, on) => {
  const seen = session(on, [{ stream: 'stdout', text: END }])
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  for (let i = 0; i < 10; i++) await tick()
  expect(seen.ran).toBe(false)
})

// The tracer writes through fs.write; the harness has no fs, so these answer beneath the mod and keep what it writes.
function sink(on: any, part: string) {
  const files = new Map<string, string>()
  on('env.get', (_: any, e: any) => ({ value: ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_: any, e: any) => (e.path.endsWith('.off') ? { deny: 'no marker' } : { value: '' }))
  on('fs.write', (_: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('session.end', () => ({ sessionId: 's1' }))
  return (): any[] => (files.get(`/cfg/claudzilla-trace/s1.${part}.jsonl`) ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('traces the toast shown', async ($, on) => {
  const seen = session(on, [{ stream: 'stdout', text: line(S, 'live', 'claudzilla: updating to v1.2.0') + END }])
  const rows = sink(on, 'herald')
  await $.session.start(start)
  await until(() => seen.toasts.includes('end'))
  await $.session.end({ reason: 'other' })
  expect(rows().find(r => r.event === 'update.line' && r.data.kind === 'live')?.data).toMatchObject({ toast: true })
})

const NOW = Date.parse('2026-10-21T10:00:00Z')
const IN_2H = '2026-10-21T12:10:00Z'
const lim = (kind: string, percentUsed: number, resetsAt = IN_2H) => ({ kind, percentUsed, resetsAt })

test('crossed: toasts the highest new point once per window', () => {
  const first = crossed([lim('five_hour', 77)], {}, NOW)
  expect(first.toasts).toEqual(['5-hour usage 77% · resets in 2h10m'])
  expect(first.marks).toEqual({ five_hour: { resetsAt: IN_2H, at: 75 } })
  expect(crossed([lim('five_hour', 80)], first.marks!, NOW)).toEqual({ toasts: [] })
  expect(crossed([lim('five_hour', 91)], first.marks!, NOW).toasts).toEqual(['5-hour usage 91% · resets in 2h10m'])
})

test('crossed: below 50 or an unknown window toasts nothing', () => {
  expect(crossed([lim('five_hour', 49.9), lim('spend_limit', 99)], {}, NOW)).toEqual({ toasts: [] })
})

test('crossed: the weekly window counts in days', () => {
  expect(crossed([lim('seven_day', 50, '2026-10-24T13:00:00Z')], {}, NOW).toasts).toEqual(['weekly usage 50% · resets in 3d3h'])
})

test('crossed: a past reset starts a new window', () => {
  const old = { five_hour: { resetsAt: '2026-10-21T09:00:00Z', at: 90 } }
  expect(crossed([lim('five_hour', 55)], old, NOW).toasts).toEqual(['5-hour usage 55% · resets in 2h10m'])
})

// A window keeps its reset time, give or take the API's rounding.
test('crossed: a moved reset time inside the same window is no new window', () => {
  const marks = { five_hour: { resetsAt: '2026-10-21T12:09:59Z', at: 75 } }
  expect(crossed([lim('five_hour', 80)], marks, NOW)).toEqual({ toasts: [] })
})

test('crossed: with no reset time, usage falling below the mark is a new window', () => {
  const marks = { five_hour: { at: 90 } }
  expect(crossed([{ kind: 'five_hour', percentUsed: 95 }], marks, NOW)).toEqual({ toasts: [] })
  const reset = crossed([{ kind: 'five_hour', percentUsed: 20 }], marks, NOW)
  expect(reset).toEqual({ toasts: [], marks: { five_hour: { at: 0 } } })
  expect(crossed([{ kind: 'five_hour', percentUsed: 52 }], reset.marks!, NOW).toasts).toEqual(['5-hour usage 52%'])
})

// A stale or malformed reading must not open a new window.
test('crossed: skips a reading whose reset time is past or unreadable', () => {
  expect(crossed([lim('five_hour', 95, '2026-10-21T09:00:00Z'), lim('seven_day', 95, 'soon')], {}, NOW)).toEqual({ toasts: [] })
})

function measured(on: On) {
  const store = new Map<string, unknown>()
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('clock.now', () => ({ value: NOW }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { store, toasts }
}
const measure = ($: any, rateLimits: object[], changed = ['rateLimits']) => $.session.measure({ context: { window: 200000 }, rateLimits, changed })

test('a measure toasts once across measures, through the store', async ($, on) => {
  const { toasts } = measured(on)
  await $.session.start({ ...start, isInteractive: true })
  await measure($, [lim('five_hour', 60)])
  await measure($, [lim('five_hour', 61)])
  await measure($, [lim('five_hour', 95), lim('seven_day', 50)], ['context'])
  await measure($, [lim('five_hour', 95), lim('seven_day', 50)])
  expect(toasts).toEqual(['5-hour usage 60% · resets in 2h10m', '5-hour usage 95% · resets in 2h10m', 'weekly usage 50% · resets in 2h10m'])
})

// A headless run would spend the point where nobody sees it.
test('a non-interactive session neither toasts nor marks usage', async ($, on) => {
  const { store, toasts } = measured(on)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  await measure($, [lim('five_hour', 80)])
  expect(toasts).toEqual([])
  expect(store.size).toBe(0)
})

const CT = 'Compact — suggest: /claudzilla compact, or /clear for new work'

test('contextToast: once per level crossed', () => {
  expect(contextToast(149_000, 150_000, { level: 0, at: 0 }, NOW)).toEqual({ ctx: { level: 0, at: 0 } })
  expect(contextToast(320_000, 150_000, { level: 0, at: 0 }, NOW)).toEqual({ text: CT, ctx: { level: 2, at: NOW } })
  expect(contextToast(330_000, 150_000, { level: 2, at: NOW }, NOW + 60_000).text).toBeUndefined()
  expect(contextToast(610_000, 150_000, { level: 2, at: NOW }, NOW + 60_000)).toEqual({ text: CT.replace('suggest', 'recommend'), ctx: { level: 3, at: NOW + 60_000 } })
})

test('contextToast: repeats 30 min after the last toast', () => {
  expect(EVERY_MS).toBe(30 * 60 * 1000)
  expect(contextToast(330_000, 150_000, { level: 2, at: NOW }, NOW + EVERY_MS - 1).text).toBeUndefined()
  expect(contextToast(330_000, 150_000, { level: 2, at: NOW }, NOW + EVERY_MS)).toEqual({ text: CT, ctx: { level: 2, at: NOW + EVERY_MS } })
})

test('contextToast: below 1x resets; base 0 is off', () => {
  expect(contextToast(20_000, 150_000, { level: 3, at: NOW }, NOW)).toEqual({ ctx: { level: 0, at: 0 } })
  expect(contextToast(900_000, 0, { level: 1, at: 5 }, NOW)).toEqual({ ctx: { level: 1, at: 5 } })
})

const ctxMeasure = ($: any, tokens: number) => $.session.measure({ context: { tokens, window: 1_000_000 }, rateLimits: [], changed: ['context'] })

test('a context measure toasts once per level and arms the 30-min idle timer while past 1x', async ($, on) => {
  const { toasts } = measured(on)
  const timers: number[] = []
  on('clock.after', (_, e: any) => { if (e.ms === EVERY_MS) timers.push(e.ms); return { value: undefined } as any })
  await $.session.start(start)
  await ctxMeasure($, 160_000)
  await ctxMeasure($, 170_000)
  expect(toasts).toEqual(['Compact — optional: /claudzilla compact, or /clear for new work'])
  expect(timers).toEqual([EVERY_MS, EVERY_MS])
  await ctxMeasure($, 10_000)
  expect(timers).toHaveLength(2)
})

test('compactNudge 0 in the repo config: no context toast', async ($, on) => {
  const { toasts } = measured(on)
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  on('process.run', (_, e: any) => (e.argv[0] === 'git' ? ran(0, '/proj\n') : ran(1, '')) as any)
  on('fs.read', (_, e: any) => (e.path === '/proj/.claude/claudzilla.local.json' ? { value: '{"rulesGuard":{"compactNudge":0}}' } : { deny: 'ENOENT' }) as any)
  await $.session.start(start)
  await ctxMeasure($, 900_000)
  expect(toasts).toEqual([])
})

test('a non-interactive session shows no context toast', async ($, on) => {
  const { toasts } = measured(on)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  await ctxMeasure($, 900_000)
  expect(toasts).toEqual([])
})

function clocked(on: On) {
  const toasts: [string, number | undefined][] = []
  const status: (string | undefined)[] = []
  const compacts: (string | undefined)[] = []
  const clock = mock.clock(on, { now: NOW })
  on('ui.toast', (_, e) => { toasts.push([e.text, e.timeoutMs]); return { value: undefined } })
  on('ui.status', (_, e) => { status.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e: any) => ({ text: e.text }) as any)
  const during = { compact: () => {} }
  on('session.compact', (_, e: any) => { compacts.push(e.instructions); during.compact(); return { messages: e.messages ?? [{ role: 'user', text: 'summary', toolUses: [] }] } as any })
  on('session.end', () => ({ sessionId: 's1' }) as any)
  return { clock, toasts, status, compacts, during }
}
const T160 = 'Compact — optional: /claudzilla compact, or /clear for new work'

test('30 idle minutes past 1x pin the reminder under the prompt until the next turn', async ($, on) => {
  const { clock, toasts, status } = clocked(on)
  await $.session.start(start)
  await ctxMeasure($, 160_000)
  await clock.advance(EVERY_MS)
  expect(toasts.filter(([text]) => text === T160)).toEqual([[T160, 10000]])
  expect(status).toEqual([T160])
  await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } } as any)
  expect(status).toEqual([T160, undefined])
})

test('a turn cancels the idle toast', async ($, on) => {
  const { clock, status } = clocked(on)
  await $.session.start(start)
  await ctxMeasure($, 160_000)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } } as any)
  await clock.advance(EVERY_MS)
  expect(status).toEqual([])
})

for (const [name, drop] of [
  ['/clear', ($: any) => $.session.end({ reason: 'clear' })],
  ['a compact', ($: any) => $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] })],
] as const) {
  test(`${name} cancels the idle toast and starts the levels over`, async ($, on) => {
    const { clock, toasts, status } = clocked(on)
    await $.session.start(start)
    await ctxMeasure($, 160_000)
    await drop($)
    await clock.advance(EVERY_MS)
    expect(status).toEqual([])
    await ctxMeasure($, 160_000)
    expect(toasts.filter(([text]) => text === T160)).toHaveLength(2)
  })
}

const reply = (cache: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number }, extra = {}) =>
  JSON.stringify({ type: 'assistant', ...extra, message: { usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 9, cache_creation: cache } } })
const H1 = { ephemeral_1h_input_tokens: 9, ephemeral_5m_input_tokens: 0 }
const M5 = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9 }
const READ = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }

test('ttlOf: the TTL of the newest main-chat cache write', () => {
  expect(ttlOf([reply(M5), reply(H1), reply(READ)].join('\n'))).toBe(3_600_000)
  expect(ttlOf([reply(H1), reply(M5)].join('\n'))).toBe(300_000)
  expect(ttlOf([reply(M5), reply(H1, { isSidechain: true })].join('\n'))).toBe(300_000)
  expect(ttlOf('{"type":"user"}\nnot json')).toBeUndefined()
})

// A session idle after a reply: its transcript, prompt box, and what the mod filled.
function idle(on: On, { transcript = reply(H1), box = '', cfg = '' } = {}) {
  const seen = clocked(on)
  const fills: string[] = []
  const prompt = { text: box }
  on('session.id', () => ({ value: 's1' }) as any)
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  on('fs.read', (_, e: any) => (cfg && e.path === '/cfg/claudzilla.json' ? { value: cfg } : { deny: 'ENOENT' }) as any)
  on('process.run', (_, e: any) =>
    (e.argv[0] === 'find' && e.argv[1] === '/cfg/projects' ? ran(0, '/cfg/projects/p/s1.jsonl\n') : e.argv[0] === 'tail' && e.argv.at(-1) === '/cfg/projects/p/s1.jsonl' ? ran(0, transcript + '\n') : ran(1, '')) as any)
  on('prompt.read', () => ({ value: { text: prompt.text, cursor: 0 } }) as any)
  on('prompt.fill', (_, e: any) => { fills.push(e.text); return { isFilled: true } as any })
  return { ...seen, fills, box: prompt }
}
const COLD = 'Cache goes cold in 15 min: press Enter to draft a compact'

test('15 min before a 1h cache goes cold: toast and fill /claudzilla compact', async ($, on) => {
  const { clock, toasts, fills } = idle(on)
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS - 1)
  expect(fills).toEqual([])
  await clock.advance(1)
  expect(fills).toEqual(['/claudzilla compact'])
  expect(toasts).toEqual([[COLD, 60000]])
})

for (const [name, opts, tokens] of [
  ['a 5m TTL', { transcript: reply(M5) }, 60_000],
  ['context under 50k', {}, 49_999],
  ['coldCompact off', { cfg: '{"rulesGuard":{"coldCompact":"off"}}' }, 60_000],
] as const) {
  test(`${name}: no cold-cache fill`, async ($, on) => {
    const { clock, toasts, fills } = idle(on, opts)
    await $.session.start(start)
    await ctxMeasure($, tokens)
    await clock.advance(FILL_MS)
    expect(fills).toEqual([])
    expect(toasts).toEqual([])
  })
}

test('text in the prompt box stays: toast only', async ($, on) => {
  const { clock, toasts, fills } = idle(on, { box: 'half typed' })
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS)
  expect(fills).toEqual([])
  expect(toasts).toEqual([['Cache goes cold in 15 min: /claudzilla compact', 60000]])
})

test('a turn or a new reply restarts the cold-cache clock', async ($, on) => {
  const { clock, fills } = idle(on)
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS - 10)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } } as any)
  await clock.advance(FILL_MS - 10)
  expect(fills).toEqual([])
  await ctxMeasure($, 61_000)
  await clock.advance(FILL_MS)
  expect(fills).toEqual(['/claudzilla compact'])
})

test('a non-interactive session arms no cold-cache fill', async ($, on) => {
  const { clock, fills } = idle(on)
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS)
  expect(fills).toEqual([])
})

const AUTO = '{"rulesGuard":{"coldCompact":"auto"}}'

test('coldCompact auto: 5 min before cold, still away, compacts and clears the filled box', async ($, on) => {
  const { clock, toasts, fills, compacts, box } = idle(on, { cfg: AUTO })
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS)
  expect(toasts).toEqual([['Cache goes cold in 15 min: press Enter to draft a compact, or it compacts itself in 10 min', 60000]])
  box.text = '/claudzilla compact'
  await clock.advance(AUTO_MS - FILL_MS)
  expect(compacts).toEqual([undefined])
  expect(fills).toEqual(['/claudzilla compact', ''])
})

test('coldCompact auto: text typed in the box means someone is there, no compact', async ($, on) => {
  const { clock, compacts } = idle(on, { cfg: AUTO, box: 'half typed' })
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(AUTO_MS)
  expect(compacts).toEqual([])
})

test('coldCompact fill (the default): no compact', async ($, on) => {
  const { clock, compacts } = idle(on)
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(AUTO_MS)
  expect(compacts).toEqual([])
})

test('coldCompact auto: its own compact starts the context levels over', async ($, on) => {
  const { clock, toasts } = idle(on, { cfg: AUTO })
  await $.session.start(start)
  await ctxMeasure($, 160_000)
  await clock.advance(AUTO_MS)
  await ctxMeasure($, 160_000)
  expect(toasts.filter(([text]) => text === T160)).toHaveLength(2)
})

test('coldCompact auto: text typed while the compact runs stays', async ($, on) => {
  const { clock, fills, box, during } = idle(on, { cfg: AUTO })
  during.compact = () => (box.text = 'back already')
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS)
  box.text = '/claudzilla compact'
  await clock.advance(AUTO_MS - FILL_MS)
  expect(fills).toEqual(['/claudzilla compact'])
})

test('coldCompact auto: with text in the box, the toast promises no compact', async ($, on) => {
  const { clock, toasts } = idle(on, { cfg: AUTO, box: 'half typed' })
  await $.session.start(start)
  await ctxMeasure($, 60_000)
  await clock.advance(FILL_MS)
  expect(toasts).toEqual([['Cache goes cold in 15 min: /claudzilla compact', 60000]])
})

for (const [name, e] of [
  ['a precompute', { trigger: 'precompute', messages: [{ role: 'user', text: 'hi', toolUses: [] }] }],
  ["a subagent's compact", { trigger: 'auto', agentId: 'a1', messages: [{ role: 'user', text: 'hi', toolUses: [] }] }],
] as const) {
  test(`${name} keeps the cold-cache timers`, async ($, on) => {
    const { clock, fills } = idle(on)
    await $.session.start(start)
    await ctxMeasure($, 60_000)
    await $.session.compact(e as any)
    await clock.advance(FILL_MS)
    expect(fills).toEqual(['/claudzilla compact'])
  })
}
