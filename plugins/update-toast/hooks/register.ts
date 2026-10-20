import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('update-toast')

// One line per update event, appended by claude/hooks/claudzilla-update.sh: `<epoch s>\t<kind>\t<text>`.
export type Event = { at: number; kind: 'start' | 'live' | 'fail'; text: string }

const KINDS = ['start', 'live', 'fail']
// The update hook is linked into ~/.claude from the claudzilla clone; the mod itself runs from the plugin cache.
// No link, no lookup: a git -C on an empty path would find the session's own repo.
const FIND = 'f=$(readlink -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/claudzilla-update.sh") && [ -f "$f" ] && git -C "${f%/*}" rev-parse --show-toplevel --absolute-git-dir'

export function parse(line: string): Event | undefined {
  const [at = '', kind = '', ...text] = line.split('\t')
  if (!/^\d+$/.test(at) || !KINDS.includes(kind)) return undefined
  return { at: Number(at), kind: kind as Event['kind'], text: text.join('\t') }
}

// start lines belong to the session that began within 30 s of them, so an open session never takes a newer one's;
// live lines get 5 s of grace, as the SessionStart hook's job may write before the mod reads its clock.
export function due(ev: Event, startedS: number): boolean {
  return ev.kind === 'start' ? Math.abs(ev.at - startedS) <= 30 : ev.at >= startedS - 5
}

export async function watch($: EngineInterface, startedS: number, onFail: (note: string) => void): Promise<void> {
  const found = await $.process.run(['sh', '-c', FIND])
  const [repo, gd] = found.exitCode === 0 ? found.stdout.trim().split('\n') : []
  t.event('update.watch', { found: !!repo && !!gd, exitCode: found.exitCode }, repo && gd ? 'info' : 'debug')
  if (!repo || !gd) return
  let rest = ''
  // tail -F reads a trimmed file again from the top.
  const shown = new Set<string>()
  for await (const { stream, text } of $.process.spawn({ argv: ['tail', '-n', '20', '-F', `${gd}/claudzilla-update.events`] })) {
    if (stream !== 'stdout') continue
    const lines = (rest + text).split('\n')
    rest = lines.pop() ?? ''
    for (const raw of lines) {
      const ev = parse(raw)
      const skip = !ev ? 'unparsed' : !due(ev, startedS) ? 'not due' : shown.has(raw) ? 'repeat' : ''
      if (!ev || skip) {
        t.event('update.line', { kind: ev?.kind, toast: false, skip }, 'debug')
        continue
      }
      t.event('update.line', { kind: ev.kind, toast: true, at: ev.at })
      shown.add(raw)
      $.ui.toast(ev.text, { timeoutMs: 10000 })
      if (ev.kind === 'fail') {
        // The hook names its target, the newest release tag: retry to that, not the branch tip.
        const to = /auto-update to (\S+) failed/.exec(ev.text)?.[1] ?? '@{u}'
        onFail(`${ev.text}. Only if the user asks, read the log, fix the cause, then run: git -C ${repo} merge --ff-only ${to} && ${repo}/install.sh - then report the result.`)
      }
    }
  }
}

const POINTS = [50, 75, 90]
const WINDOWS: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly' }
// The highest point toasted in a window, and the window's reset time.
export type Mark = { resetsAt?: string; at: number }

function resetIn(resetsAt: string, nowMs: number): string {
  const left = Math.max(0, Math.floor((Date.parse(resetsAt) - nowMs) / 60000))
  const h = Math.floor(left / 60)
  return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${h}h${left % 60}m`
}

// Toasts each window's highest newly crossed point; marks come back only when they changed.
export function crossed(limits: SessionRateLimit[], marks: Record<string, Mark>, nowMs: number): { toasts: string[]; marks?: Record<string, Mark> } {
  const toasts: string[] = []
  let next: Record<string, Mark> | undefined
  for (const { kind, percentUsed, resetsAt } of limits) {
    const name = WINDOWS[kind]
    // A reset time that is past or unreadable is a stale reading, not a new window.
    if (!name || (resetsAt && !(Date.parse(resetsAt) > nowMs))) continue
    const old = marks[kind]
    // The reset time may shift a little within one window, so a window is new only once the old one has reset.
    const same = !!old && (old.resetsAt ? Date.parse(old.resetsAt) > nowMs : percentUsed >= old.at)
    const point = Math.max(0, ...POINTS.filter(p => p <= percentUsed && p > (same ? old.at : 0)))
    if ((same || !old) && !point) continue
    next = { ...(next ?? marks), [kind]: { resetsAt, at: point } }
    if (point) toasts.push(`${name} usage ${percentUsed}%` + (resetsAt ? ` · resets in ${resetIn(resetsAt, nowMs)}` : ''))
  }
  return next ? { toasts, marks: next } : { toasts }
}

export const register: Register = on => {
  let note: string | undefined
  let interactive = false

  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    const started = await next(e)
    t.event('update.start', { interactive: !!e.isInteractive })
    interactive = !!e.isInteractive
    if (!e.isInteractive) return started
    const startedS = Math.floor((await $.clock.now()) / 1000)
    // session.start is awaited before the first prompt: the watch runs on detached, for the module's life.
    void watch($, startedS, text => (note = text)).catch(err => t.error('update.watch.failed', err))
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    if (note === undefined) return next(e)
    t.event('update.note', { injected: true })
    const context = [...(e.context ?? []), note]
    note = undefined
    return next({ ...e, context })
  })

  on('session.measure', async ($, e, next) => {
    // A headless run would spend the point where nobody sees the toast.
    if (interactive && e.changed.includes('rateLimits')) {
      const { toasts, marks } = crossed(e.rateLimits, ((await $.store.get('usage')) ?? {}) as Record<string, Mark>, await $.clock.now())
      if (marks) await $.store.set('usage', marks)
      for (const text of toasts) {
        t.event('usage.toast', { text })
        $.ui.toast(text, { timeoutMs: 10000 })
      }
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await t.flush(traceIo($))
    return next(e)
  })
}
