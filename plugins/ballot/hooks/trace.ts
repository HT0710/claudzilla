// Mod tracer: ring buffer rewritten to <config>/claudzilla-trace/<session>.<part>.jsonl, masked, never throws.
import type { EngineInterface } from 'claude-code'

type Level = 'debug' | 'info' | 'warn' | 'error'
export type Tracer = {
  event(event: string, data?: object, level?: Level): string
  span(event: string, data?: object): { id: string; end(data?: object, status?: 'ok' | 'error'): void }
  error(event: string, err: unknown, data?: object): void
  turn(): void
  start($: EngineInterface): Promise<void>
  flush($: EngineInterface): Promise<void>
}

const RING = 2000
// $.fs refuses text over 4 MiB.
const BUDGET = 3.5 * 1024 * 1024
const CUT = 2000
const DEBOUNCE = 3000
// A steady stream of entries still flushes this often.
const MAXWAIT = 10000
const SECRETS = [
  /sk-[A-Za-z0-9_-]{20,}/g, /gh[pousr]_[A-Za-z0-9]{36,}/g, /github_pat_[A-Za-z0-9_]{22,}/g, /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/g, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[A-Fa-f0-9]{48,}/g, /[A-Za-z0-9+/]{48,}={0,2}/g,
]

// Home first: a long home path would otherwise trip the base64 pattern.
export function mask(s: string, home = ''): string {
  let r = home ? s.split(home).join('~') : s
  for (const re of SECRETS) r = r.replace(re, '[masked]')
  return r
}

const clean = (v: unknown, home: string): unknown => {
  if (typeof v === 'string') { const m = mask(v, home); return m.length > CUT ? m.slice(0, CUT) + '…[cut]' : m }
  if (Array.isArray(v)) return v.map(x => clean(x, home))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, home)]))
  return v
}

const newId = () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0')
const safe = (s: unknown, d: string) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '') || d

export function tracer(part: string, now: () => number = Date.now): Tracer {
  const ring: { s: string; n: number }[] = []
  let bytes = 0
  let home = '', session = '', dir = '', off = false, turns = 0, dirty = false, timer = false, last = 0, due = 0
  let loaded = false, dirMade = false, modeSet = ''
  let handle: EngineInterface | undefined
  let chain: Promise<void> = Promise.resolve()

  const drop = () => { const x = ring.shift(); if (x) bytes -= x.n }
  const push = (e: Record<string, unknown>) => {
    if (off) return
    if (turns > 0) e.turn = turns
    const s = JSON.stringify(e)
    // +64: the session tag added at flush.
    const n = new TextEncoder().encode(s).length + 64
    ring.push({ s, n })
    bytes += n
    while (ring.length > RING || (bytes > BUDGET && ring.length > 1)) drop()
    dirty = true
    last = now()
    arm()
  }
  const arm = () => {
    if (timer || !handle) return
    const $ = handle
    const fire = () => {
      const wait = Math.min(DEBOUNCE - (now() - last), due - now())
      if (wait > 50) return again(wait)
      timer = false
      void flush($)
    }
    const again = (ms: number) => {
      try { void Promise.resolve($.clock.after(ms, fire)).catch(() => { timer = false }) } catch { timer = false }
    }
    timer = true
    due = now() + MAXWAIT
    again(DEBOUNCE)
  }

  const load = async ($: EngineInterface) => {
    handle = $
    const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
    home = (await $.env.get('HOME')) || ''
    dir = `${cfg || `${home}/.claude`}/claudzilla-trace`
    const id = safe(await $.session.id(), 'nosession')
    if (loaded && id !== session) {
      await write($)
      ring.length = 0; bytes = 0; dirty = false; dirMade = false; modeSet = ''
    }
    const fresh = !loaded || id !== session
    session = id
    loaded = true
    off = false
    try { await $.fs.read(`${dir}/.off`); off = true; ring.length = 0; bytes = 0 } catch { /* no marker: tracing on */ }
    // A resumed session keeps its id: seed the ring so the first flush keeps the earlier process's lines.
    if (fresh && !off) {
      try {
        const tag = `{"session":${JSON.stringify(id)},`
        const old = String(await $.fs.read(`${dir}/${id}.${safe(part, 'part')}.jsonl`)).split('\n').filter(l => l.startsWith(tag))
          .map(l => { const s = '{' + l.slice(tag.length); return { s, n: new TextEncoder().encode(s).length + 64 } })
        ring.unshift(...old)
        for (const x of old) bytes += x.n
        while (ring.length > RING || (bytes > BUDGET && ring.length > 1)) drop()
      } catch { /* no earlier file */ }
    }
  }
  const start = ($: EngineInterface): Promise<void> => chain = chain.then(() => load($).catch(() => {}))

  const write = async ($: EngineInterface) => {
    if (!dir) return
    // The switch can flip mid-session; flushes are seconds apart, so one read each is cheap.
    try { await $.fs.read(`${dir}/.off`); return } catch { off = false }
    if (!dirty) return
    dirty = false
    try {
      const file = `${dir}/${session}.${safe(part, 'part')}.jsonl`
      if (!dirMade) {
        const r: any = await $.process.run(['sh', '-c', 'mkdir -p "$1" && chmod 700 "$1"', 'sh', dir])
        if (r?.exitCode !== 0) throw new Error('mkdir')
        dirMade = true
      }
      // Lines made before start() skipped the home mask.
      const tag = `{"session":${JSON.stringify(session)},`
      const text = ring.map(x => tag + (home && x.s.includes(home) ? x.s.split(home).join('~') : x.s).slice(1)).join('\n') + '\n'
      await $.fs.write(file, text)
      // fs.write keeps an existing file's mode, so once per file.
      if (modeSet !== file) {
        const r: any = await $.process.run(['chmod', '600', file])
        if (r?.exitCode === 0) modeSet = file
      }
    } catch { dirty = true }
  }
  const flush = ($: EngineInterface): Promise<void> => chain = chain.then(async () => {
    try {
      if (!loaded) await load($)
      await write($)
    } catch { /* never throws */ }
  })

  const add = (e: Record<string, unknown>): string => {
    const id = newId()
    try {
      const data = e.data === undefined ? undefined : clean(e.data, home)
      push({ ts: new Date().toISOString(), ...e, id, part, ...(data !== undefined && { data }) })
    } catch { /* tracing never breaks the caller */ }
    return id
  }

  return {
    event: (event, data, level = 'info') => add({ event, level, data }),
    span(event, data) {
      const ts = new Date().toISOString(), id = newId()
      return {
        id,
        end(more, status) {
          try { push({ ts, end: new Date().toISOString(), part, event, id, level: 'info', data: clean({ ...data, ...more }, home), ...(status && { status }) }) } catch { /* swallow */ }
        },
      }
    },
    error(event, err, data) {
      try {
        const e = err instanceof Error ? err : new Error(String(err))
        const stack = (e.stack ?? '').split('\n').slice(0, 5).join('\n')
        add({ event, level: 'error', status: 'error', data: { ...data, message: e.message, stack } })
      } catch { /* swallow */ }
    },
    turn() { turns++ },
    start,
    flush,
  }
}
