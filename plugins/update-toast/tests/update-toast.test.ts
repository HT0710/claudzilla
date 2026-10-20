import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import { crossed, due, parse } from '../hooks/register'

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
  const rows = sink(on, 'update-toast')
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
