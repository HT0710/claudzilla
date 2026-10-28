import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('herald')

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

const DEFAULT_BASE = 150000
export const EVERY_MS = 30 * 60 * 1000
// The highest compactNudge level toasted (1x, 2x, 4x as 1 to 3) and when the last context toast showed.
export type Ctx = { level: number; at: number }

// The HUD shows the size; the toast says how strongly to act, as the reply line's label does (rules-guard compactMsg).
const TIERS = ['optional', 'suggest', 'recommend']
const contextText = (level: number) => `Compact — ${TIERS[level - 1]}: /claudzilla compact, or /clear for new work`

// Toasts each level once and again 30 min after the last toast; dropping below 1x (a compact or clear) starts over.
export function contextToast(tokens: number, base: number, ctx: Ctx, nowMs: number): { text?: string; ctx: Ctx } {
  if (base <= 0) return { ctx }
  if (tokens < base) return { ctx: { level: 0, at: 0 } }
  const level = tokens >= 4 * base ? 3 : tokens >= 2 * base ? 2 : 1
  if (level <= ctx.level && nowMs - ctx.at < EVERY_MS) return { ctx }
  const top = Math.max(level, ctx.level)
  return { text: contextText(top), ctx: { level: top, at: nowMs } }
}

// rules-guard's compactNudge and coldCompact, from the same files in the same order (loadConfig in claude/hooks/rules-guard.mjs).
async function config($: EngineInterface, cwd: string): Promise<Config> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
  const cfg: Config = { dir, base: DEFAULT_BASE, cold: DEFAULT_COLD }
  for (const f of [`${dir}/claudzilla.json`, ...(top ? [`${top}/.claude/claudzilla.json`, `${top}/.claude/claudzilla.local.json`] : [])]) {
    const rg: any = await $.fs.read(f).then(text => JSON.parse(text)?.rulesGuard).catch(() => undefined)
    if (Number.isInteger(rg?.compactNudge) && rg.compactNudge >= 0) cfg.base = rg.compactNudge
    if (typeof rg?.coldCompact === 'number' && rg.coldCompact >= 0) cfg.cold = rg.coldCompact
  }
  return cfg
}

// The prompt cache's 1h TTL. A 5m one is cold long before a stage could run.
const HOUR = 3_600_000
export const FILL_MS = HOUR - 15 * 60_000
export const AUTO_MS = HOUR - 5 * 60_000
// The auto compact comes at this many times compactNudge (0 = never); the fill at 1x.
const DEFAULT_COLD = 2
const FILL = '/claudzilla compact'
type Config = { dir: string; base: number; cold: number }

// The TTL the newest main-chat cache write chose, as hud-data.mjs reads it; a pure cache read keeps it.
export function ttlOf(tail: string): number | undefined {
  for (const line of tail.split('\n').reverse()) {
    if (!line.includes('"assistant"')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const c = e?.message?.usage?.cache_creation
    if (e?.type !== 'assistant' || e.isSidechain || !c) continue
    if (c.ephemeral_1h_input_tokens > 0) return HOUR
    if (c.ephemeral_5m_input_tokens > 0) return 300_000
  }
  return undefined
}

async function ttl($: EngineInterface, dir: string): Promise<number | undefined> {
  const found = await $.process.run(['find', `${dir}/projects`, '-maxdepth', '2', '-name', `${await $.session.id()}.jsonl`])
  const path = found.stdout.split('\n')[0]
  // shortcut: the last 1 MB only; a newer main-chat line past that (one huge tool result) reads as no TTL, so no stage runs.
  return path ? ttlOf((await $.process.run(['tail', '-c', '1000000', path])).stdout) : undefined
}

// Stage 1, 15 min before the cache goes cold: the person can still compact on the warm cache.
async function coldFill($: EngineInterface, dir: string, auto: boolean) {
  if ((await ttl($, dir)) !== HOUR) return t.event('cold.fill', { skip: 'ttl' }, 'debug')
  const box = await $.prompt.read()
  const filled = !box.text.trim() && (await $.prompt.fill({ text: FILL }).catch(() => ({ isFilled: false }))).isFilled
  t.event('cold.fill', { filled })
  $.ui.toast(`Cache goes cold in 15 min: ${filled ? 'press Enter to draft a compact' : FILL}${auto && filled ? ', or it compacts itself in 10 min' : ''}`, { timeoutMs: 60000 })
}

// Stage 2, past coldCompact times compactNudge: still away 5 min before cold, compact on the warm cache with the generic summary.
async function coldCompact($: EngineInterface, dir: string, live: Live) {
  if ((await ttl($, dir)) !== HOUR) return t.event('cold.compact', { skip: 'ttl' }, 'debug')
  const box = (await $.prompt.read()).text.trim()
  // Typed text means someone is there.
  if (box && box !== FILL) return t.event('cold.compact', { skip: 'typed' })
  // Rejects while a turn runs.
  const done = await $.session.compact().catch(() => undefined)
  t.event('cold.compact', { compacted: !!done && !done.skip })
  if (!done || done.skip) return
  // The mod's own compact passes its session.compact hook by.
  stopIdle($, live, true)
  await clearFill($)
}

// A compact takes a while: whoever came back meanwhile keeps what they typed.
async function clearFill($: EngineInterface) {
  if ((await $.prompt.read()).text.trim() === FILL) await $.prompt.fill({ text: '' }).catch(() => undefined)
}

type Timer = { cancel: () => void }
type Live = { ctx: Ctx; idle?: Timer; cold: Timer[]; pinned: boolean }

// A turn is no idle time; a compact or /clear drops the context the levels were counted on.
function stopIdle($: EngineInterface, live: Live, reset: boolean) {
  live.idle?.cancel()
  live.idle = undefined
  for (const timer of live.cold) timer.cancel()
  live.cold = []
  if (live.pinned) $.ui.status(undefined)
  live.pinned = false
  if (reset) live.ctx = { level: 0, at: 0 }
}

export const register: Register = on => {
  let note: string | undefined
  let interactive = false
  let cfg: Promise<Config> = Promise.resolve({ dir: '', base: 0, cold: 0 })
  // Module memory, not $.store: the store is shared by every open session, and context is this session's own.
  const live: Live = { ctx: { level: 0, at: 0 }, cold: [], pinned: false }

  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    const started = await next(e)
    t.event('update.start', { interactive: !!e.isInteractive })
    interactive = !!e.isInteractive
    if (!e.isInteractive) return started
    cfg = config($, e.cwd)
    const startedS = Math.floor((await $.clock.now()) / 1000)
    // session.start is awaited before the first prompt: the watch runs on detached, for the module's life.
    void watch($, startedS, text => (note = text)).catch(err => t.error('update.watch.failed', err))
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    stopIdle($, live, false)
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
    const tokens = e.context.tokens
    if (interactive && e.changed.includes('context') && tokens) {
      const { dir, base: b, cold } = await cfg
      const shown = contextToast(tokens, b, live.ctx, await $.clock.now())
      live.ctx = shown.ctx
      if (shown.text) {
        t.event('context.toast', { level: live.ctx.level, idle: false })
        $.ui.toast(shown.text, { timeoutMs: 10000 })
      }
      stopIdle($, live, false)
      // session.measure comes only after a turn: away from the keyboard, a timer pins the reminder under the prompt
      // until the next turn, as a toast lasts 60 s at most.
      if (b > 0 && tokens >= b) {
        try {
          live.idle = $.clock.after(EVERY_MS, () => {
            t.event('context.toast', { level: live.ctx.level, idle: true })
            $.ui.status(contextText(live.ctx.level))
            live.pinned = true
            void $.clock.now().then(at => (live.ctx = { ...live.ctx, at }))
          })
        } catch {
          live.idle = undefined
        }
        const auto = cold > 0 && tokens >= cold * b
        try {
          live.cold = [$.clock.after(FILL_MS, () => void coldFill($, dir, auto).catch(err => t.error('cold.fill.failed', err)))]
          if (auto) live.cold.push($.clock.after(AUTO_MS, () => void coldCompact($, dir, live).catch(err => t.error('cold.compact.failed', err))))
        } catch {
          live.cold = []
        }
      }
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    // A precompute installs nothing, and a subagent's compact leaves the main context as it was.
    if (e.trigger !== 'precompute' && !e.agentId && !result.skip) {
      stopIdle($, live, true)
      await clearFill($)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    stopIdle($, live, true)
    await t.flush(traceIo($))
    return next(e)
  })
}
