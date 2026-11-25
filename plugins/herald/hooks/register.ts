import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('herald')

// One line per update event, appended by claude/hooks/claudzilla-update.sh: `<epoch s>\t<kind>\t<text>`.
export type Event = { at: number; kind: 'start' | 'live' | 'fail'; text: string }

const KINDS = ['start', 'live', 'fail']
export const CHECK_MS = 15 * 60 * 1000
let checks: { cancel: () => void } | undefined
// The update hook is linked into ~/.claude from the claudzilla clone; the mod itself runs from the plugin cache.
// No link, no lookup: a git -C on an empty path would find the session's own repo.
export const FIND = 'f=$(readlink -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/claudzilla-update.sh") && [ -f "$f" ] && git -C "${f%/*}" rev-parse --show-toplevel --absolute-git-dir'

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

export async function watch($: EngineInterface, startedS: number, onFail: (note: string) => void, ms: () => Promise<number>): Promise<void> {
  const found = await $.process.run(['sh', '-c', FIND])
  const [repo, gd] = found.exitCode === 0 ? found.stdout.trim().split('\n') : []
  t.event('update.watch', { found: !!repo && !!gd, exitCode: found.exitCode }, repo && gd ? 'info' : 'debug')
  if (!repo || !gd) return
  // The hook fetches at most hourly per clone, so every session checking often only makes the toast come sooner.
  // A second session.start in this module replaces the timer instead of adding one.
  checks?.cancel()
  try {
    checks = $.clock.every(CHECK_MS, () => {
      void $.process.run(['env', 'CLAUDZILLA_UPDATE_TIMER=1', 'sh', `${repo}/claude/hooks/claudzilla-update.sh`]).catch(err => t.error('update.check.failed', err))
    })
  } catch (err) {
    t.error('update.check.failed', err)
  }
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
      const timeoutMs = await ms()
      if (timeoutMs) $.ui.toast(ev.text, { timeoutMs })
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
const contextText = (level: number) => `Compact — ${TIERS[level - 1]}: /claudzilla compact, ${HANDOFF}, or /clear for new work`

export const coldText = (level: number, tokens: number) =>
  `Cache cold · ${TIERS[level - 1]}: ${HANDOFF} starts fresh with a note, or send to re-read ${Math.round(tokens / 1000)}k`

// Toasts each level once and again 30 min after the last toast; dropping below 1x (a compact or clear) starts over.
export function contextToast(tokens: number, base: number, ctx: Ctx, nowMs: number): { text?: string; ctx: Ctx } {
  if (base <= 0) return { ctx }
  if (tokens < base) return { ctx: { level: 0, at: 0 } }
  const level = tokens >= 4 * base ? 3 : tokens >= 2 * base ? 2 : 1
  if (level <= ctx.level && nowMs - ctx.at < EVERY_MS) return { ctx }
  const top = Math.max(level, ctx.level)
  return { text: contextText(top), ctx: { level: top, at: nowMs } }
}

// One line per waiting event in the shared file: `<epoch s>\t<session id>\t<kind>\t<name>\t<branch>\t<detail>`.
export type Wait = { at: number; session: string; kind: 'done' | 'wait'; name: string; branch: string; detail: string }

const flat = (s: string) => s.replace(/[\t\n]/g, ' ')

export function formatWait(w: Wait): string {
  return [w.at, w.session, w.kind, flat(w.name), flat(w.branch), w.detail].join('\t')
}

export function parseWait(line: string): Wait | undefined {
  const [at = '', session = '', kind = '', name = '', branch = '', ...detail] = line.split('\t')
  if (!/^\d+$/.test(at) || (kind !== 'done' && kind !== 'wait') || !detail.length) return undefined
  return { at: Number(at), session, kind, name, branch, detail: detail.join('\t') }
}

export function waitToast(w: Wait): string {
  const where = w.branch ? ` · ⎇ ${w.branch}` : ''
  return w.kind === 'wait' ? `! ${w.name} waits on you · ${w.detail}${where}` : `✓ ${w.name} done${where}`
}

// A run of permission prompts toasts once: the key leaves the detail out.
export function waitRepeat(seen: Map<string, number>, w: Wait, nowMs: number): boolean {
  const key = `${w.session}\t${w.kind}`
  const last = seen.get(key)
  if (last !== undefined && nowMs - last < 30_000) return false
  seen.set(key, nowMs)
  return true
}

// tail -F reads a trimmed file again from the top, so only fresh lines count.
export function isOtherWait(w: Wait, ownId: string, nowMs: number): boolean {
  return w.session !== ownId && nowMs - w.at * 1000 <= 10_000
}

// Outside any one profile, so sessions under every config dir see each other.
// Empty without HOME, so nothing lands in the session's folder.
const waitPath = async ($: EngineInterface) => {
  const home = await $.env.get('HOME').catch(() => undefined)
  return home ? `${home}/.cache/claudzilla/waiting.events` : ''
}

// Built-in toast seconds per herald kind.
export const TOASTS = { update: 10, usage: 10, context: 10, cacheCold: 60, waiting: 10 }
type Kind = keyof typeof TOASTS
type Toasts = Record<Kind, number>

// Toast ms per kind from each file's herald object, a later file winning per key: own key, then default, then built-in. 0 = off.
export function toastTimes(heralds: unknown[]): Toasts {
  const kinds = Object.keys(TOASTS) as Kind[]
  const set: Record<string, number> = {}
  for (const h of heralds) {
    if (!h || typeof h !== 'object') continue
    for (const k of ['default', ...kinds]) {
      const v = (h as any)[k]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) set[k] = Math.min(v, 60)
      // The old on/off switch: false is off, true the kind's built-in time.
      else if (typeof v === 'boolean' && k !== 'default') set[k] = v ? TOASTS[k as Kind] : 0
    }
  }
  return Object.fromEntries(kinds.map(k => [k, (set[k] ?? set.default ?? TOASTS[k]) * 1000])) as Toasts
}

// rules-guard's compactNudge and coldCompact, and the herald toast times, from the same files in the same order (loadConfig in claude/hooks/rules-guard.mjs).
async function config($: EngineInterface, cwd: string): Promise<Config> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
  const cfg: Config = { dir, base: DEFAULT_BASE, cold: DEFAULT_COLD, toasts: toastTimes([]) }
  const heralds: unknown[] = []
  for (const f of [`${dir}/claudzilla.json`, ...(top ? [`${top}/.claude/claudzilla.json`, `${top}/.claude/claudzilla.local.json`] : [])]) {
    const json: any = await $.fs.read(f).then(text => JSON.parse(text)).catch(() => undefined)
    const rg = json?.rulesGuard
    heralds.push(json?.herald)
    if (Number.isInteger(rg?.compactNudge) && rg.compactNudge >= 0) cfg.base = rg.compactNudge
    if (typeof rg?.coldCompact === 'number' && rg.coldCompact >= 0) cfg.cold = rg.coldCompact
  }
  cfg.toasts = toastTimes(heralds)
  return cfg
}

// The prompt cache's 1h TTL. A 5m one is cold long before a stage could run.
export const HOUR = 3_600_000
export const FILL_MS = HOUR - 15 * 60_000
export const AUTO_MS = HOUR - 5 * 60_000
// The auto compact comes at this many times compactNudge (0 = never); the fill at 1x.
const DEFAULT_COLD = 2
const FILL = '/claudzilla compact'
export const HANDOFF = '/claudzilla handoff'
type Config = { dir: string; base: number; cold: number; toasts: Toasts }

// The TTL the newest main-chat cache write chose, as hud.pl reads it; a pure cache read keeps it.
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

// The newest main-chat reply: when it landed (any reply, a cache read too, restarts the cache's hour) and the context it read.
// None past a compact, whose summary replaced that context.
export function lastReply(tail: string): { at: number; tokens: number } | undefined {
  for (const line of tail.split('\n').reverse()) {
    if (!line.includes('"assistant"') && !line.includes('compact_boundary')) continue
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.subtype === 'compact_boundary') return undefined
    const u = e?.message?.usage
    if (e?.type !== 'assistant' || e.isSidechain || !u) continue
    const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    // A synthetic line (an API error, a usage limit) carries all-zero usage: it never reached the cache.
    if (!tokens) continue
    const at = Date.parse(e.timestamp)
    return Number.isNaN(at) ? undefined : { at, tokens }
  }
  return undefined
}

async function tailOf($: EngineInterface, dir: string): Promise<string> {
  // -H: projects/ may be a link (a second config dir sharing one), and find skips a linked start point without it.
  const found = await $.process.run(['find', '-H', `${dir}/projects`, '-maxdepth', '2', '-name', `${await $.session.id()}.jsonl`])
  const path = found.stdout.split('\n')[0]
  // shortcut: the last 1 MB only; a newer main-chat line past that (one huge tool result) reads as no TTL, so no stage runs.
  return path ? (await $.process.run(['tail', '-c', '1000000', path])).stdout : ''
}

// Why a stage skips: not a 1h cache, or already cold (a timer that slept with the machine fires late).
async function skip($: EngineInterface, dir: string, late = true, tail?: string): Promise<string | undefined> {
  tail ??= await tailOf($, dir)
  if (ttlOf(tail) !== HOUR) return 'ttl'
  const at = lastReply(tail)?.at
  if (late && at !== undefined && (await $.clock.now()) - at >= HOUR) return 'cold'
  return undefined
}

// Stage 1, 15 min before the cache goes cold: the person can still compact on the warm cache.
async function coldFill($: EngineInterface, dir: string, auto: boolean, timeoutMs: number) {
  const why = await skip($, dir)
  if (why) return t.event('cold.fill', { skip: why }, 'debug')
  const box = await $.prompt.read()
  const filled = !box.text.trim() && (await $.prompt.fill({ text: FILL }).catch(() => ({ isFilled: false }))).isFilled
  t.event('cold.fill', { filled })
  if (timeoutMs) $.ui.toast(`Cache goes cold in 15 min: ${filled ? 'press Enter to draft a compact' : FILL}${auto && filled ? ', or it compacts itself in 10 min' : ''}`, { timeoutMs })
}

// Stage 2, past coldCompact times compactNudge: still away 5 min before cold, compact on the warm cache with the generic summary.
async function coldCompact($: EngineInterface, dir: string, live: Live) {
  const why = await skip($, dir)
  if (why) return t.event('cold.compact', { skip: why }, 'debug')
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

// Stage 3, at the hour: the cache is cold (late is fine), so offer a handoff over an empty box or the unsent compact fill.
async function coldHandoff($: EngineInterface, dir: string) {
  const why = await skip($, dir, false)
  if (why) return t.event('cold.handoff', { skip: why }, 'debug')
  const box = (await $.prompt.read()).text.trim()
  if (box && box !== FILL) return t.event('cold.handoff', { skip: 'typed' })
  t.event('cold.handoff', { filled: (await $.prompt.fill({ text: HANDOFF }).catch(() => ({ isFilled: false }))).isFilled })
}

// The first key back after an hour away: the cache is cold, so say what a send costs and the way around it.
async function coldStatus($: EngineInterface, live: Live, cfg: Promise<Config>) {
  const { dir, base } = await cfg
  let tail: string | undefined
  // A resumed session has had no measure yet: its transcript tells the context and when the cache was last read.
  if (!live.seeded) {
    live.seeded = true
    const turns = live.turns
    tail = await tailOf($, dir)
    const last = lastReply(tail)
    if (last && live.turns === turns && !live.tokens) Object.assign(live, { tokens: last.tokens, endAt: last.at })
  }
  const now = await $.clock.now()
  const tokens = live.tokens
  // Re-checked after the awaits: a second key may have run the same check meanwhile.
  if (live.coldShown || base <= 0 || tokens < base || now - live.endAt < HOUR) return
  live.coldShown = true
  const why = await skip($, dir, false, tail)
  if (why) return t.event('cold.status', { skip: why }, 'debug')
  // A prompt sent meanwhile has cleared the line already.
  if (live.tokens !== tokens) return
  const level = tokens >= 4 * base ? 3 : tokens >= 2 * base ? 2 : 1
  t.event('cold.status', { level })
  $.ui.status(coldText(level, tokens))
  live.pinned = live.coldLine = true
  // The key that brought the line may have emptied the box before the line was up.
  const box = await $.prompt.read()
  // A send during the read has taken the line down.
  if (live.coldLine && !box.text.trim()) t.event('cold.suggest', { shown: (await $.prompt.suggest({ text: HANDOFF })).isShown })
}

// A compact takes a while: whoever came back meanwhile keeps what they typed.
async function clearFill($: EngineInterface) {
  const text = (await $.prompt.read()).text.trim()
  if (text === FILL || text === HANDOFF) await $.prompt.fill({ text: '' }).catch(() => undefined)
}

type Timer = { cancel: () => void }
// seeded: the transcript was read, or a turn or reset made it stale; turns: prompts sent, so a read that a send overtook is dropped.
type Live = { ctx: Ctx; idle?: Timer; cold: Timer[]; pinned: boolean; coldLine?: boolean; endAt: number; tokens: number; coldShown: boolean; seeded: boolean; turns: number }

// A turn is no idle time; a compact or /clear drops the context the levels were counted on.
function stopIdle($: EngineInterface, live: Live, reset: boolean) {
  live.idle?.cancel()
  live.idle = undefined
  for (const timer of live.cold) timer.cancel()
  live.cold = []
  if (live.pinned) $.ui.status(undefined)
  live.pinned = live.coldLine = false
  if (reset) {
    live.ctx = { level: 0, at: 0 }
    live.tokens = 0
    live.seeded = true
  }
}

// Module state, not per register: one tail per process.
const waitSeen = new Map<string, number>()
let tailing = false

// Toasts other sessions' fresh waiting lines; the own id is read per line, as /clear changes it.
async function watchWaiting($: EngineInterface): Promise<void> {
  if (tailing) return
  tailing = true
  try {
    const timeoutMs = (await config($, await $.session.cwd())).toasts.waiting
    if (!timeoutMs) return
    const path = await waitPath($)
    if (!path) return
    // shortcut: a line appended during the trim is lost, a few lines at most, only at session start; upgrade to a lock if it shows up
    await $.process.run(['sh', '-c', '[ "$(wc -l < "$1")" -gt "$2" ] && tail -n "$3" "$1" > "$1.$$" && mv "$1.$$" "$1"', 'sh', path, '400', '200']).catch(() => undefined)
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['tail', '-n', '0', '-F', path] })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const raw of lines) {
        const w = parseWait(raw)
        const now = await $.clock.now()
        const skip = !w ? 'unparsed' : !isOtherWait(w, await $.session.id(), now) ? 'own or old' : !waitRepeat(waitSeen, w, now) ? 'repeat' : ''
        t.event('waiting.line', { kind: w?.kind, toast: !skip, skip }, skip ? 'debug' : 'info')
        if (w && !skip) $.ui.toast(waitToast(w), { timeoutMs })
      }
    }
  } finally {
    tailing = false
  }
}

// What announce needs from the module: the session's mode and config, and the found names.
type WaitCtx = { interactive: boolean; cfg: Promise<Config>; names: Map<string, string> }

async function nameOf($: EngineInterface, names: Map<string, string>, dir: string, id: string): Promise<string | undefined> {
  if (names.has(id)) return names.get(id)
  for (const f of await $.fs.list(`${dir}/sessions`).catch(() => [])) {
    if (!f.name.endsWith('.json')) continue
    const s: any = await $.fs.read(`${dir}/sessions/${f.name}`).then(text => JSON.parse(text)).catch(() => undefined)
    if (s?.sessionId === id && typeof s.name === 'string') {
      names.set(id, s.name)
      return s.name
    }
  }
  return undefined
}

// Appends one line to the shared file every session tails; $.fs.write would replace the whole file.
async function announce($: EngineInterface, c: WaitCtx, kind: Wait['kind'], detail: string): Promise<void> {
  if (!c.interactive) return
  const { dir, toasts } = await c.cfg
  if (!toasts.waiting) return
  const path = await waitPath($)
  if (!path) return
  const id = await $.session.id()
  // The sessions file, not classic.SessionStart's session_title: cc-plugin-sec-default runs first and skips other plugins' classic.SessionStart.
  const name = (await nameOf($, c.names, dir, id)) || id.slice(0, 8)
  const git = await $.process.run(['git', '-C', await $.session.cwd(), 'branch', '--show-current']).catch(() => undefined)
  const branch = git?.exitCode === 0 ? git.stdout.trim() : ''
  const at = Math.floor((await $.clock.now()) / 1000)
  // Path and line ride as arguments, never in the script text.
  const r = await $.process.run(['sh', '-c', 'mkdir -p "${1%/*}" && printf \'%s\\n\' "$2" >> "$1"', 'sh', path, formatWait({ at, session: id, kind, name, branch, detail })])
  if (r.exitCode !== 0) throw new Error(`append exited ${r.exitCode}: ${r.stderr.trim()}`)
}

export const register: Register = on => {
  let note: string | undefined
  let interactive = false
  let cfg: Promise<Config> = Promise.resolve({ dir: '', base: 0, cold: 0, toasts: toastTimes([]) })
  // Session id to the name in its sessions file; found names only, so a file written later is still found.
  const names = new Map<string, string>()
  const wrote = (err: unknown) => t.error('waiting.write.failed', err)
  const ctx = (): WaitCtx => ({ interactive, cfg, names })
  // Module memory, not $.store: the store is shared by every open session, and context is this session's own.
  const live: Live = { ctx: { level: 0, at: 0 }, cold: [], pinned: false, endAt: 0, tokens: 0, coldShown: false, seeded: false, turns: 0 }

  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    const started = await next(e)
    t.event('update.start', { interactive: !!e.isInteractive })
    interactive = !!e.isInteractive
    if (!e.isInteractive) return started
    // A hot reload starts a fresh module that never pinned the old instance's reminder, so it would stay up.
    $.ui.status(undefined)
    live.pinned = live.coldLine = false
    cfg = config($, e.cwd)
    const startedS = Math.floor((await $.clock.now()) / 1000)
    // session.start is awaited before the first prompt: the watch runs on detached, for the module's life.
    void watch($, startedS, text => (note = text), async () => (await cfg).toasts.update).catch(err => t.error('update.watch.failed', err))
    void watchWaiting($).catch(err => t.error('waiting.watch.failed', err))
    return started
  })

  // A background agent's report starts another main turn, so done waits for the last one. A plugin's or a nested agent reports to no main turn.
  on('turn.complete', ($, e, next) => {
    if (e.reason === 'answer' && !e.agentId)
      void $.agent
        .list()
        .catch(() => [])
        .then(agents => agents.some(a => !a.spawnedBy && !a.parentId && ['pending', 'running', 'waiting'].includes(a.status)) || announce($, ctx(), 'done', ''))
        .catch(wrote)
    return next(e)
  })

  // A subagent's prompt blocks on the user too. AskUserQuestion is written by its tool call.
  on('classic.PermissionRequest', ($, e, next) => {
    if (e.tool_name !== 'AskUserQuestion') void announce($, ctx(), 'wait', `${e.tool_name} permission`).catch(wrote)
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    void announce($, ctx(), 'wait', 'question').catch(wrote)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    stopIdle($, live, false)
    live.tokens = 0
    live.coldShown = false
    live.seeded = true
    live.turns++
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
      const timeoutMs = (await cfg).toasts.usage
      for (const text of toasts) {
        t.event('usage.toast', { text })
        if (timeoutMs) $.ui.toast(text, { timeoutMs })
      }
    }
    const tokens = e.context.tokens
    if (interactive && e.changed.includes('context') && tokens) {
      const { dir, base: b, cold, toasts } = await cfg
      const shown = contextToast(tokens, b, live.ctx, await $.clock.now())
      live.ctx = shown.ctx
      live.endAt = await $.clock.now()
      live.tokens = tokens
      live.seeded = true
      if (shown.text) {
        t.event('context.toast', { level: live.ctx.level, idle: false })
        if (toasts.context) $.ui.toast(shown.text, { timeoutMs: toasts.context })
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
          live.cold = [$.clock.after(FILL_MS, () => void coldFill($, dir, auto, toasts.cacheCold).catch(err => t.error('cold.fill.failed', err)))]
          if (auto) live.cold.push($.clock.after(AUTO_MS, () => void coldCompact($, dir, live).catch(err => t.error('cold.compact.failed', err))))
          // A compact sent once the cache is cold reads it all back: past the hour the offer is a handoff.
          live.cold.push($.clock.after(HOUR, () => void coldHandoff($, dir).catch(err => t.error('cold.handoff.failed', err))))
        } catch {
          live.cold = []
        }
      }
    }
    return next(e)
  })

  on('prompt.edit', ($, e, next) => {
    // No await before this check: a key never waits on a read.
    if (interactive && !live.coldShown && (live.tokens > 0 || !live.seeded)) void coldStatus($, live, cfg).catch(err => t.error('cold.status.failed', err))
    const box = next(e)
    // Cold line still up and the box emptied: offer the handoff again, dim, Tab to take.
    if (live.coldLine)
      void Promise.resolve(box)
        .then(async b => b.text.trim() || t.event('cold.suggest', { shown: (await $.prompt.suggest({ text: HANDOFF })).isShown }))
        .catch(err => t.error('cold.suggest.failed', err))
    return box
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
