import type { Elements, EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import { href, linked, mentions } from './mentions'
import { DEFAULTS, readPalette } from './palette'
import { tracer } from './trace'
import { traceIo } from './trace-io'

let LIT = DEFAULTS.shared.lit

// margin's noun, mirrored: listing margin as a dependency would stop this plugin loading without it.
declare module 'claude-code' {
  interface EngineInterface {
    margin: { show: (at: { path: string; line: number }) => Promise<void> }
  }
}

// md-display.pl's frame lines, as a share of the width: heavy whole, separator half, group break a quarter.
const SHARE: Record<string, number> = { '━': 1, '─': 2, '┈': 4 }
const RULE = /^([━─┈])\1*$/

const t = tracer('folio')
// Messages whose decision is traced: a render repeats on resize and scroll.
const traced = new Set<string>()
const note = (id: string, decision: string, data: object) => {
  const key = `${id}:${decision}`
  if (traced.has(key)) return
  if (traced.size > 500) traced.clear()
  traced.add(key)
  t.event('folio.split', { decision, ...data })
}

const NAME_SHARE = 0.5
const CODE_MAX = 100_000
// eslint-disable-next-line no-control-regex
const CODE_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g
const NAME_FLOOR = 20

const EDIT: Record<string, string> = { Edit: 'Updated', Write: 'Wrote' }

const newFileLines = (output: { content?: string }) => (output.content ? output.content.replace(/\n$/, '').split('\n') : [])

// What an Edit or Write row shows in place of its result block; undefined where the engine's own rows should draw.
function editSummary(tool: string, output: any, isErrored: boolean) {
  // An errored edit keeps the engine's row: a denial's reason shows only there.
  if (!(tool in EDIT) || isErrored) return undefined
  if (!output || typeof output !== 'object' || output.staged) return undefined
  if (output.type === 'create') return { add: newFileLines(output).length, del: 0, isNew: true }
  const lines: string[] = (output.structuredPatch ?? []).flatMap((hunk: { lines: string[] }) => hunk.lines)
  const add = lines.filter(line => line[0] === '+').length
  const del = lines.filter(line => line[0] === '-').length
  return add + del ? { add, del, isNew: false } : undefined
}

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`)
const AGENT_TAIL: Record<string, string> = { completed: 'done', async_launched: 'backgrounded', remote_launched: 'remote' }

// Other tools' one-line rows as label, argument and tail; undefined where the engine's own rows should draw.
const ROWS: Record<string, (input: any, output: any) => [string, string, string] | undefined> = {
  WebFetch: (input, output) => ['Fetched', host(String(input.url)), `${output.code} · ${size(output.bytes)}`],
  WebSearch: (input, { searchCount: n }) => ['Searched', `"${input.query}"`, n === undefined ? '' : `${n} search${n === 1 ? '' : 'es'}`],
  Agent: (input, output) => (AGENT_TAIL[output.status] ? ['Agent', String(input.description), AGENT_TAIL[output.status]!] : undefined),
  Skill: (input, output) => output.success ? ['Skill', String(input.skill), output.status === 'forked' ? (output.background ? 'backgrounded' : 'done') : 'loaded'] : undefined,
}
// The same rows while the call runs, before any output: label, argument, tail.
const RUNNING: Record<string, (input: any, name: (file: string) => string) => [string, string, string]> = {
  WebFetch: input => ['Fetching', host(String(input.url)), ''],
  WebSearch: input => ['Searching', `"${input.query}"`, ''],
  Agent: input => ['Agent', String(input.description), 'running'],
  Skill: input => ['Loading', String(input.skill), ''],
  Edit: (input, name) => ['Updating', name(String(input.file_path)), ''],
  Write: (input, name) => ['Writing', name(String(input.file_path)), ''],
}
// A background agent's finish row: its tail and dot colour, by the task's status.
const ENDED: Record<string, [string, string]> = { completed: ['done', 'success'], failed: ['failed', 'error'], killed: ['stopped', 'inactive'] }
// As the engine writes a task's duration: 12s, 2m 2s, 1h 2m.
const took = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}
// The engine's own blink rate is not documented.
const BLINK_MS = 500
const toolRow = (tool: string, input: any, output: any, isErrored: boolean) =>
  tool in ROWS && !isErrored && output && typeof output === 'object' ? ROWS[tool]!(input ?? {}, output) : undefined

// An Edit or Write result as unified-diff hunks, for the Code element: tab and newline its only control characters,
// and over its size limit it refuses the row, so such a diff stays in ctrl+o. A new file has no patch: all added.
function diffText(output: any) {
  const lines = newFileLines(output)
  type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
  const text = (output.type === 'create'
    ? [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)]
    : (output.structuredPatch as Hunk[]).flatMap(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines])
  ).join('\n').replace(CODE_CONTROLS, '')
  return text.length <= CODE_MAX ? text : undefined
}

// Cells a string takes in a Code element, per grapheme: a tab, and a wide East Asian or emoji one, take two.
const graphemes = new Intl.Segmenter()
const cells = (text: string) =>
  [...graphemes.segment(text)].reduce((sum, { segment }) =>
    sum + (segment === '\t' || /[\u1100-\u115F\u2600-\u27BF\u2B50\u2B55\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFF}]/u.test(segment) ? 2 : 1), 0)

// Rows the Code element draws for a diff `width` cells wide: a `...` row between hunks, and each line one row
// plus its wraps under the hunk's gutter (the widest line number, a space, a marker). `\ No newline` draws none.
export function diffRows(diff: string, width: number) {
  return diff.split(/^(?=@@ )/m).reduce((sum, hunk, i) => {
    const [head = '', ...lines] = hunk.replace(/\n$/, '').split('\n')
    const [a = 0, b = 1, c = 0, d = 1] = (head.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/) ?? []).slice(1).map(n => (n === '' ? 1 : +n))
    const room = Math.max(width - String(Math.max(a + b, c + d) - 1).length - 3, 1)
    return sum + (i ? 1 : 0) + lines.filter(line => line[0] !== '\\').reduce((rows, line) => rows + Math.max(1, Math.ceil(cells(line.slice(1)) / room)), 0)
  }, 0)
}

// A path cut in the middle to fit `max`: the first folder, then as many last segments as fit. The file name goes last.
// A path with `.` and `..` folded, joined under `base` unless absolute.
const resolve = (base: string, path: string) => {
  const out: string[] = []
  for (const part of (path.startsWith('/') || !base ? path : `${base}/${path}`).split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && (part || !out.length)) out.push(part)
  }
  return out.join('/')
}

// Files a Bash command writes, under a leading `cd DIR &&`.
// shortcut: regex parse of common write forms (sed -i, >, >>, tee), not a shell parser; a false hit costs a read and draws nothing.
export function writeTargets(command: string): string[] {
  const quoted: string[] = []
  // Heredoc bodies hold text, not commands; quoted text holds no redirection.
  const cmd = command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, m => m.split('\n')[0] + '\n')
    .replace(/"[^"]*"|'[^']*'/g, m => `\0${quoted.push(m.slice(1, -1)) - 1}\0`)
  const word = (w: string) => w.replace(/\0(\d+)\0/g, (_, i) => quoted[+i]!)
  const out = new Set<string>()
  for (const m of cmd.matchAll(/(?:^|[^0-9&<>])>>?\|?\s*([^\s;&|<>()]+)/g)) out.add(word(m[1]!))
  for (const seg of cmd.split(/&&|\|\||[;|\n]/)) {
    const words = seg.trim().split(/\s+/)
    if (words[0] === 'tee') words.slice(1).filter(w => !w.startsWith('-')).forEach(w => out.add(word(w)))
    if (words[0] === 'sed' && words.some(w => /^--in-place|^-[a-zA-Z]*i/.test(w))) {
      const args = words.slice(1)
      const hasScript = args.some(w => w === '-e' || w === '-f')
      const plain = args.filter((w, i) => !w.startsWith('-') && !['-e', '-f'].includes(args[i - 1] ?? ''))
      plain.slice(hasScript ? 0 : 1).forEach(w => out.add(word(w)))
    }
  }
  const dir = cmd.match(/^\s*cd\s+([^\s;&|]+)\s*&&/)?.[1]
  return [...out].filter(f => !f.startsWith('/dev/')).map(f => resolve(dir ? word(dir) : '', f))
}

// Lines added and removed between two texts: an LCS line diff, or for big files a multiset count.
function diffCount(before: string | undefined, after: string) {
  const lines = (s: string | undefined) => (s ? s.replace(/\n$/, '').split('\n') : [])
  const [a, b] = [lines(before), lines(after)]
  let same = 0
  if (a.length * b.length > 4_000_000) {
    const left = new Map<string, number>()
    a.forEach(l => left.set(l, (left.get(l) ?? 0) + 1))
    for (const l of b) if ((left.get(l) ?? 0) > 0) { left.set(l, left.get(l)! - 1); same++ }
  } else {
    let prev = new Array(b.length + 1).fill(0)
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0)
      for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
      prev = cur
    }
    same = prev[b.length]
  }
  return { add: b.length - same, del: a.length - same }
}

export function cutPath(path: string, max: number) {
  if (path.length <= max) return path
  const parts = path.split('/')
  const file = parts.pop()!
  const fits = (head: string) => {
    let tail = file
    if (`${head}/${tail}`.length > max) return undefined
    for (const part of [...parts].slice(1).reverse()) {
      if (`${head}/${part}/${tail}`.length > max) break
      tail = `${part}/${tail}`
    }
    return `${head}/${tail}`
  }
  return (parts[0] && fits(`${parts[0]}/…`)) || fits('…') || `…${file.slice(1 - max)}`
}

// Same files in the same order as loadConfig in claude/hooks/rules-guard.mjs.
async function readHideEditDiff($: EngineInterface, cwd: string) {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${(await $.env.get('HOME').catch(() => undefined)) ?? ''}/.claude`
  const top = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).then(r => (r.exitCode === 0 ? r.stdout.trim() : ''), () => '')
  let hide = true
  for (const f of [`${dir}/claudzilla.json`, ...(top ? [`${top}/.claude/claudzilla.json`, `${top}/.claude/claudzilla.local.json`] : [])]) {
    const value = await $.fs.read(f).then(text => JSON.parse(text)?.folio?.hideEditDiff).catch(() => undefined)
    if (typeof value === 'boolean') hide = value
  }
  return hide
}

type Part = { text: string } | { rule: string } | { code: { lang: string; body: string } }

// Splits a reply at frame lines and fenced blocks, outside ``` / ~~~ fences.
export function split(text: string): Part[] {
  const parts: Part[] = []
  let chunk: string[] = []
  let fence = ''
  let open = { lang: '', body: [] as string[] }
  let pad = 0
  // The open fence's own lines, given back as text if it never closes.
  let held: string[] = []
  const flush = () => {
    const t = chunk.join('\n').replace(/^\n+|\n+$/g, '')
    if (t) parts.push({ text: t })
    chunk = []
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    const mark = m?.[2]
    // CommonMark's close: the opener's character, at least as long, nothing after it.
    if (mark && fence && mark[0] === fence[0] && mark.length >= fence.length && !m[3]!.trim()) {
      parts.push({ code: { lang: open.lang, body: open.body.join('\n') } })
      fence = ''
      continue
    }
    if (mark && !fence) {
      flush()
      held = []
      fence = mark
      pad = m[1]!.length
      open = { lang: m[3]!.trim().split(/\s+/)[0]!.toLowerCase(), body: [] }
    } else if (fence) open.body.push(line.slice(Math.min(pad, line.search(/\S|$/))))
    if (fence) {
      held.push(line)
      continue
    }
    const rule = line.match(RULE)?.[1]
    if (rule) {
      flush()
      parts.push({ rule })
    } else chunk.push(line)
  }
  if (fence) chunk.push(...held)
  flush()

  return parts
}

const SHELL = new Set(['bash', 'sh', 'zsh', 'shell', 'console'])

const PROMPT = /^\s*\$ /

// What Run runs: the block as one script; a transcript's commands are its `$ ` lines.
export function runText(lang: string, body: string): string | undefined {
  if (!SHELL.has(lang)) return undefined
  const lines = body.split('\n')
  const cmds = lines.some(l => PROMPT.test(l)) ? lines.filter(l => PROMPT.test(l)).map(l => l.replace(PROMPT, '')) : lines
  return cmds.some(l => l.trim() && !l.trim().startsWith('#')) ? cmds.join('\n').trim() : undefined
}

// Copy buttons pressed in the last 2 s: key to the press that set it, so an older press's timer leaves a newer one lit.
const copied = new Map<string, number>()
let presses = 0

async function copy($: EngineInterface, key: string, text: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const done = await $.ui.copy({ text, surface })
  if (!done.isCopied) return $.ui.toast(`folio: copy failed (${done.reason})`)
  const press = ++presses
  copied.set(key, press)
  $.ui.invalidate('ui.render')
  void $.clock.after(2000, () => {
    if (copied.get(key) !== press) return
    copied.delete(key)
    $.ui.invalidate('ui.render')
  })
}

// Run pressed once in the last 3 s, by block, to the press that armed it: the second press runs, as nothing else stands between a click and the shell.
const armed = new Map<string, number>()
// Each running block's command: leaving its stream kills it.
const live = new Map<string, ReturnType<EngineInterface['process']['spawn']>>()
const stopped = new Set<string>()
// Until when a block ignores Run, by block: a double-click is not a second look, and a Stop landing just after the end is not Run again.
const deaf = new Map<string, number>()
// Each block's last run, by block. shortcut: in memory, so a restart drops it (Claude keeps its row); persist via $.store if missed.
const outputs = new Map<string, { end: string; text: string; tail: Span[][]; more: number }>()
const SHOWN = 20
// shortcut: output past 4 MB is dropped from the card and the copy, like $.process.run's cap; page it if a run needs more.
const CAP = 4_000_000
// Blocks whose output Hide took off the card; the block still counts as run.
const hidden = new Set<string>()

async function press($: EngineInterface, cmd: string, block: string) {
  const now = await $.clock.now()
  if (now < (deaf.get(block) ?? 0)) return
  const run = live.get(block)
  if (run) {
    stopped.add(block)
    void run.return(undefined as never)
    return
  }
  // A block run once already had its look, so Run again goes at once.
  if (!armed.has(block) && !outputs.has(block)) {
    const at = ++presses
    armed.set(block, at)
    deaf.set(block, now + 300)
    $.ui.invalidate('ui.render')
    void $.clock.after(3000, () => {
      if (armed.get(block) !== at) return
      armed.delete(block)
      $.ui.invalidate('ui.render')
    })
    return
  }
  armed.delete(block)
  // The click after a run starts is a double-click, not a Stop.
  deaf.set(block, now + 300)
  await shell($, cmd, block)
}

type Paint = { color?: string; backgroundColor?: string; bold?: boolean; dimColor?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; strikethrough?: boolean }
type Span = { text: string; paint: Paint }
// CSI, OSC (links, titles) and the two-byte escapes (charset, cursor save).
const ESC = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]/g
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const hex = (...rgb: number[]) => `#${rgb.map(v => (v & 255).toString(16).padStart(2, '0')).join('')}`
// The 16 base colours by name, so they follow the terminal's palette; the rest as xterm's hex.
function c256(n: number) {
  if (n < 16) return n < 8 ? NAMES[n] : `${NAMES[n - 8]}Bright`
  if (n >= 232) return hex(...Array(3).fill(8 + 10 * (n - 232)))
  const level = [0, 95, 135, 175, 215, 255]
  return hex(level[Math.floor((n - 16) / 36)]!, level[Math.floor((n - 16) / 6) % 6]!, level[(n - 16) % 6]!)
}
const OFF: Record<number, (keyof Paint)[]> = { 22: ['bold', 'dimColor'], 23: ['italic'], 24: ['underline'], 27: ['inverse'], 29: ['strikethrough'], 39: ['color'], 49: ['backgroundColor'] }
const ON: Record<number, keyof Paint> = { 1: 'bold', 2: 'dimColor', 3: 'italic', 4: 'underline', 7: 'inverse', 9: 'strikethrough' }
// One SGR sequence's codes over the running style; codes it does not know are skipped.
function sgr(was: Paint, params: string): Paint {
  const c = (params || '0').split(';').map(Number)
  let p: Paint = { ...was }
  for (let i = 0; i < c.length; i++) {
    const n = c[i]!
    const key = n === 38 ? 'color' : n === 48 ? 'backgroundColor' : undefined
    if (n === 0) p = {}
    else if (ON[n]) (p as any)[ON[n]] = true
    else if (OFF[n]) for (const k of OFF[n]) delete p[k]
    else if (n >= 30 && n <= 37) p.color = c256(n - 30)
    else if (n >= 90 && n <= 97) p.color = c256(n - 82)
    else if (n >= 40 && n <= 47) p.backgroundColor = c256(n - 40)
    else if (n >= 100 && n <= 107) p.backgroundColor = c256(n - 92)
    else if (key && c[i + 1] === 5) {
      p[key] = c256(c[i + 2]! & 255)
      i += 2
    } else if (key && c[i + 1] === 2) {
      p[key] = hex(c[i + 2]!, c[i + 3]!, c[i + 4]!)
      i += 4
    }
  }
  return p
}

// One line in runs of one style, from the style it starts in; text a \r wrote over is gone, as on a terminal.
function paintLine(line: string, paint: Paint): [Span[], Paint] {
  let spans: Span[] = []
  const put = (text: string) => {
    const cut = text.lastIndexOf('\r')
    if (cut >= 0) spans = []
    if (text.slice(cut + 1)) spans.push({ text: text.slice(cut + 1), paint })
  }
  const l = line.replace(/\r+$/, '')
  let at = 0
  for (const m of l.matchAll(ESC)) {
    put(l.slice(at, m.index))
    if (m[0][1] === '[' && m[0].endsWith('m')) paint = sgr(paint, m[0].slice(2, -1))
    at = m.index + m[0].length
  }
  put(l.slice(at))
  return [spans, paint]
}
// A Run card shows every character it runs: a cut line could hide part of the command.
// shortcut: counts code points, so a line of wide glyphs or tabs still cuts; measure cells if one shows up.
const cut = (body: string, room: number) =>
  body.split('\n').flatMap(l => {
    const width = Math.max(room, 1)
    const cs = Array.from(l)
    return cs.length <= width ? [l] : Array.from({ length: Math.ceil(cs.length / width) }, (_, i) => cs.slice(i * width, (i + 1) * width).join(''))
  })

const text = (spans: Span[]) => spans.map(s => s.text).join('')
const plain = (s: string) => s.split('\n').map(l => text(paintLine(l, {})[0])).join('\n')

// shortcut: no terminal and stdin at EOF, so a prompt (sudo, ssh) fails; a typed `!` handles those.
async function shell($: EngineInterface, cmd: string, block: string) {
  // Tools print colour without a terminal only when told to; GNU ls, grep and git still need --color.
  // setsid, where there is one (not macOS), keeps a prompt off the terminal Claude Code draws on.
  const run = $.process.spawn({
    argv: ['bash', '-c', 'command -v setsid >/dev/null && exec setsid -w bash -c "$1"; exec bash -c "$1"', 'folio', cmd],
    env: { FORCE_COLOR: '1', CLICOLOR_FORCE: '1' },
  })
  live.set(block, run)
  stopped.delete(block)
  hidden.delete(block)
  const got = { stdout: '', stderr: '' }
  // Parsed as it arrives, each line once: a redraw every 100 ms over a 4 MB output would stall the screen.
  const out = { plain: [] as string[], tail: [] as Span[][], paint: {} as Paint, rest: '', size: 0 }
  const feed = (chunk: string) => {
    out.size += chunk.length
    const lines = (out.rest + chunk).split('\n')
    out.rest = lines.pop()!
    for (const l of lines) {
      const [spans, paint] = paintLine(l, out.paint)
      out.paint = paint
      out.plain.push(text(spans))
      out.tail.push(spans)
      if (out.tail.length > SHOWN) out.tail.shift()
    }
  }
  const show = (end: string, done = false) => {
    const lines = out.rest ? [...out.tail, paintLine(out.rest, out.paint)[0]] : [...out.tail]
    let count = out.plain.length + (out.rest ? 1 : 0)
    for (; lines.length && !text(lines.at(-1)!).trim(); count--) lines.pop()
    const tail = lines.slice(-SHOWN)
    // The whole text only at the end: only then can it be copied.
    const all = done ? [...out.plain, text(paintLine(out.rest, out.paint)[0])].join('\n').trimEnd() : ''
    outputs.set(block, { end, text: all, tail, more: count - tail.length })
    $.ui.invalidate('ui.render')
  }
  show('')
  // At most one redraw per 100 ms, so a chatty command cannot flood the screen.
  let due = false
  let end = ''
  try {
    for await (const { stream, text } of run) {
      if (got[stream].length < CAP) got[stream] += text
      if (out.size >= CAP) continue
      feed(text)
      if (due) continue
      due = true
      void $.clock.after(100, () => {
        due = false
        if (live.get(block) === run) show('')
      })
    }
    const r = await run.result
    end = stopped.has(block) ? 'stopped' : r.code ? `exit ${r.code}` : r.signal ? `killed (${r.signal})` : ''
  } catch (err) {
    if (stopped.has(block)) end = 'stopped'
    else {
      end = 'exit 1'
      feed(`${out.rest ? '\n' : ''}${err instanceof Error ? err.message : err}\n`)
    }
  } finally {
    live.delete(block)
  }
  deaf.set(block, (await $.clock.now()) + 1000)
  show(end, true)
  const stdout = plain(got.stdout).trimEnd()
  // Claude cannot tell a Stop from a quiet success by the output alone.
  const stderr = [plain(got.stderr).trimEnd(), end === 'stopped' ? '(stopped by the user)' : ''].filter(Boolean).join('\n')
  // The row a typed `!` command leaves, so Claude reads the output next turn.
  // The end, not the start: that is where a build or a test says what failed.
  const row = await $.session.append({ message: { type: 'user', content: [{ type: 'text',
    text: `<bash-input>${cmd}</bash-input>\n<bash-stdout>${stdout.slice(-30_000)}</bash-stdout><bash-stderr>${stderr.slice(-30_000)}</bash-stderr>` }] } })
  if ('deny' in row && row.deny) $.ui.toast(`folio: Claude will not see this output (${row.deny})`)
}

type Link = { href: string; path: string; line: number }
// Paths known to be files: a render repeats on scroll and resize.
const files = new Set<string>()
// Paths found missing, by when: a burst of redraws asks once, and a file made later links on a later draw.
const misses = new Map<string, number>()
const MISS_MS = 5_000
let toldNoPanel = false
// shortcut: one cols-<session> file per session stays in TMPDIR ($.fs has no delete); clean it on session.end if $.fs gains one.
let wroteColumns = 0
// The session's folio.hideEditDiff; read at session.start.
let hideEditDiff = true
// Margin's intent report: its row draws nothing, so it must not break a run of edits.
const INTENT_TOOL = 'mcp__margin__intent'

// The chunk's spans that name an existing file, by span; none when the engine cannot say.
async function links($: EngineInterface, text: string): Promise<Map<string, Link>> {
  const found = new Map<string, Link>()
  const all = mentions(text)
  if (!all.length) return found
  try {
    const cwd = await $.session.cwd()
    const home = all.some(m => m.path.startsWith('~/')) ? await $.env.get('HOME') : undefined
    const pathOf = (p: string) => (p.startsWith('/') ? p : p.startsWith('~/') ? `${home}${p.slice(1)}` : `${cwd}/${p}`)
    const unknown = [...new Set(all.map(m => pathOf(m.path)).filter(p => !files.has(p)))]
    if (unknown.length) {
      const now = await $.clock.now()
      const asked = unknown.filter(p => now - (misses.get(p) ?? -Infinity) >= MISS_MS)
      const kinds = await Promise.all(asked.map(p => $.fs.stat(p).then(s => s.kind, () => undefined)))
      asked.forEach((p, i) => {
        if (kinds[i] === 'file') {
          if (files.size > 500) files.clear()
          files.add(p)
          misses.delete(p)
        } else {
          if (misses.size > 500) misses.clear()
          misses.set(p, now)
        }
      })
    }
    for (const m of all) {
      const path = pathOf(m.path)
      if (files.has(path)) found.set(m.span, { href: href(path, m.line), path, line: m.line })
    }
  } catch {
    return new Map()
  }
  return found
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    LIT = (await readPalette($)).palette.shared.lit
    hideEditDiff = await readHideEditDiff($, e.cwd)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A /clear or resume goes on under a new session id, which needs its own cols file.
    wroteColumns = 0
    for (const rows of [runs, done, placed, shownDiffs, agents, bashEdits, unfolded]) rows.clear()
    current = undefined
    await t.flush(traceIo($))
    return next(e)
  })

  // A run of edits folds into its first row, as a big diff fills the chat. Off the fullscreen layout a printed row
  // cannot change, so each edit keeps its own.
  type Run = { ids: string[]; isOpen: boolean; isLive: boolean }
  const runs = new Map<string, Run>()
  const done = new Map<string, { file: string; diff?: string; summary: NonNullable<ReturnType<typeof editSummary>> }>()
  const placed = new Set<string>()
  // Edits whose diff a click on their tree row opened.
  const shownDiffs = new Set<string>()
  let current: Run | undefined
  let shownView: string | undefined
  // Running rows drawn since the last blink: one timer for all, which stops once a blink finds none.
  const blinking = new Set<string>()
  let blink: Timer | undefined
  let isLit = true
  // Agent calls' descriptions by tool_use_id: a finish notification names only the call.
  const agents = new Map<string, string>()
  // Files each Bash call changed, by tool_use_id; and the calls of groups unfolded to show them.
  const bashEdits = new Map<string, { file: string; add: number; del: number; isNew: boolean }[]>()
  const unfolded = new Set<string>()
  // Plain text, not the fold's Client: nothing opens on a press, so nothing lights under the pointer.
  const textLine = ({ Text }: Elements['terminal'], dot: RenderNode, [label, arg, tail]: [string, string, RenderNode]) => (
    <Text wrap="truncate-end">
      {dot} <Text bold>{label}</Text>
      <Text color="promptBorder"> (</Text>{arg}<Text color="promptBorder">)</Text>
      {tail && '  '}{tail}
    </Text>
  )
  const textRow = (elements: Elements['terminal'], dot: RenderNode, row: [string, string, RenderNode]) => (
    <elements.Box marginTop={1}>{textLine(elements, dot, row)}</elements.Box>
  )

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const targets = hideEditDiff ? writeTargets(e.command) : []
    if (!targets.length) return next(e)
    const cwd = await $.session.cwd().catch(() => '')
    const files = targets.map(f => resolve(cwd, f))
    const read = (f: string) => $.fs.read(f).then(text => text as string, () => undefined)
    const before = await Promise.all(files.map(read))
    const ran = await next(e)
    if (ran.deny || ran.isError) return ran
    const after = await Promise.all(files.map(read))
    const found = files.flatMap((file, i) =>
      after[i] === undefined || after[i] === before[i] ? [] : [{ file, isNew: before[i] === undefined, ...diffCount(before[i], after[i]!) }])
    if (found.length) {
      if (bashEdits.size > 500) bashEdits.clear()
      bashEdits.set(e.tool_use_id, found)
      $.ui.invalidate('ui.render')
    }
    return ran
  })

  // A group holding a Bash edit unfolds, so the edit gets its own row.
  on('ui.render', { component: 'ToolGroup' }, async (_$, e, next) => {
    const ids = e.props.calls.flatMap(c => c.tool_use_id ?? [])
    // Already unfolded: the non-fullscreen ctrl+o transcript or --verbose, whose rows stay native.
    if (e.props.isExpanded) ids.forEach(id => unfolded.delete(id))
    if (!hideEditDiff || e.surface !== 'terminal' || e.props.isExpanded || !ids.some(id => bashEdits.has(id))) return next(e)
    if (unfolded.size > 500) unfolded.clear()
    ids.forEach(id => unfolded.add(id))
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // A run lies in one transcript: an agent's rows must not take in the main chat's.
  on('ui.render', { component: 'AbovePrompt' }, async (_$, e, next) => {
    const view = e.props.view.agentId
    if (view !== shownView) current = undefined
    shownView = view

    return next(e)
  })

  on('ui.render', { component: ['UserMessage', 'AssistantMessage', 'ToolGroup', 'ToolUse'] }, async (_$, e, next) => {
    const isHidden = e.component === 'ToolUse' && e.props.tool === INTENT_TOOL
    if (isHidden || e.surface !== 'terminal' || placed.has(e.requestId)) return next(e)
    placed.add(e.requestId)
    if (e.component === 'ToolUse' && e.props.tool in EDIT) {
      // A row first drawn with its output is an old one, scrolled to: a live edit must not land in its run, off screen.
      const isLive = e.props.output === undefined
      const run: Run = (e.viewport?.isFullscreen && current?.isLive === isLive && current) || { ids: [], isOpen: false, isLive }
      run.ids.push(e.requestId)
      runs.set(e.requestId, run)
      current = run
    } else current = undefined
    return next(e)
  })

  // Each hook runs next even when dropping it: margin tracks the row in view on this chain.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const native = await next(e)
    const isEdit = (runs.has(e.requestId) && editSummary(e.props.tool, e.props.output, e.props.isErrored)) || (bashEdits.has(e.requestId) && !e.props.isErrored)
    if (!hideEditDiff || e.surface !== 'terminal' || e.props.isExpanded || !(isEdit || toolRow(e.props.tool, {}, e.props.output, e.props.isErrored))) return native
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const native = await next(e)
    const { tool, input, output, isRunning, isErrored, isInterrupted, isExpanded } = e.props
    const run = runs.get(e.requestId)
    if (tool === 'Agent') {
      if (agents.size > 500) agents.clear()
      agents.set(e.requestId, String((input as { description?: string } | undefined)?.description))
    }
    // shortcut: fullscreen ctrl+o draws a call of an unfolded group as a ToolUse with isExpanded true and no ToolGroup,
    // just like the unfolded group's own rows, so there it keeps the one-line row; upgrade once the props tell the views apart.
    const isGroupRow = unfolded.has(e.requestId)
    const bashEdit = bashEdits.get(e.requestId)
    // A Client draws nothing on mobile.
    if (!hideEditDiff || e.surface !== 'terminal' || (isExpanded && !isGroupRow)) return native
    // The root, not cwd(): a shell `cd` moves cwd(), and every row would shift with it.
    const cwd = tool in EDIT || isGroupRow || bashEdit ? await $.session.root().catch(() => '') : ''
    // A share of the chat, so a wide terminal shows more of a path; the floor still fits most file names.
    const nameRoom = Math.max(NAME_FLOOR, Math.floor((e.viewport?.columns ?? 80) * NAME_SHARE))
    const name = (file: string) => cutPath(cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file, nameRoom)
    if (isGroupRow || bashEdit) {
      if (isRunning || isErrored || isInterrupted) return native
      const elements = $.ui.resolve(e)
      const { Box, Text } = elements
      const dot = <Text color="success">●</Text>
      if (bashEdit) {
        return (
          <Box flexDirection="column" marginTop={1}>
            {bashEdit.map(c => textLine(elements, dot, [c.isNew ? 'Created' : EDIT.Edit!, name(c.file), <Text>
              {(c.add > 0 || c.isNew) && <Text color="success">+{c.add}</Text>}
              {(c.add > 0 || c.isNew) && c.del > 0 && ' '}
              {c.del > 0 && <Text color="error">−{c.del}</Text>}
            </Text>]))}
          </Box>
        )
      }
      // The call's main argument: its path, pattern, command or address.
      const args = (input ?? {}) as Record<string, unknown>
      const key = ['file_path', 'pattern', 'path', 'command', 'url', 'query'].find(k => typeof args[k] === 'string')
      if (!key) return native
      const label = tool === 'Bash' ? 'Ran' : tool
      const arg = key === 'file_path' || key === 'path' ? name(String(args[key])) : String(args[key]).split('\n')[0]!
      const room = Math.max((e.viewport?.columns ?? 80) - label.length - 8, NAME_FLOOR)
      return textRow(elements, dot, [label, arg.length > room ? `${arg.slice(0, room - 1)}…` : arg, ''])
    }
    const isLive = isRunning && !isInterrupted && !isErrored && tool in RUNNING
    const other = isLive ? RUNNING[tool]!(input ?? {}, name) : !isRunning && !isInterrupted ? toolRow(tool, input, output, isErrored) : undefined
    if (isLive) {
      blinking.add(e.requestId)
      blink ??= $.clock.every(BLINK_MS, () => {
        if (!blinking.size) {
          blink?.cancel()
          blink = undefined
          isLit = true
          return
        }
        blinking.clear()
        isLit = !isLit
        $.ui.invalidate('ui.render')
      })
    }
    if (other) {
      const elements = $.ui.resolve(e)
      const { Text } = elements
      return textRow(elements, isLive ? <Text color="inactive">{isLit ? '●' : ' '}</Text> : <Text color="success">●</Text>, other)
    }
    if (!run) return native
    const summary = !isRunning && !isInterrupted ? editSummary(tool, output, isErrored) : undefined
    if (summary && !done.has(e.requestId)) {
      done.set(e.requestId, { file: String((input as { file_path?: string }).file_path), summary, diff: diffText(output) })
      // The run's first row draws this one's counts; a lone edit has none to update.
      if (run.ids.length > 1) $.ui.invalidate('ui.render')
    }
    if (!summary) return native
    const elements = $.ui.resolve(e)
    const { Box, Code, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    if (!Client) return native
    type Piece = { text: string; color?: string; bold?: boolean }
    const row = (key: string, pieces: Piece[]) => <Client key={key} module="./fold.tsx" width="100%" height={1} props={{ pieces, lit: LIT }} />
    const namePieces = (path: string): Piece[] =>
      path.split(/(\/)/).filter(Boolean).map(text => (text === '/' ? { text, color: 'promptBorder' } : { text }))
    const plus = (add: number, isNew = false) => (add > 0 || isNew ? `+${add}` : '')
    // addWidth lines up a tree's − counts; a row with none keeps no trailing pad.
    const countPieces = (add: number, del: number, isNew = false, gap = '  ', addWidth = 0): Piece[] => [
      { text: gap },
      ...(plus(add, isNew) ? [{ text: plus(add, isNew), color: 'success' }] : []),
      ...(del > 0 && (plus(add, isNew) || addWidth) ? [{ text: ' '.repeat(Math.max(addWidth - plus(add, isNew).length, 0) + 1) }] : []),
      ...(del > 0 ? [{ text: `−${del}`, color: 'error' }] : []),
    ]
    const result = (entry: NonNullable<ReturnType<typeof done.get>>, gap = '  ', addWidth = 0) =>
      countPieces(entry.summary.add, entry.summary.del, entry.summary.isNew, gap, addWidth)
    const self = done.get(e.requestId)!
    const diff = (entry: typeof self, hasNext = false) => entry.diff && (
      <Box paddingLeft={2}>
        {/* Counted, not clipped: a clipped box scrolled past its top draws from the screen's top row and overruns. */}
        <Text color="promptBorder">{Array(diffRows(entry.diff, (e.viewport?.columns ?? 80) - 4) + (hasNext ? 1 : 0)).fill('│').join('\n')}</Text>
        <Box paddingLeft={1} flexGrow={1}>
          <Code source={entry.diff} path={entry.file} format="diff" />
        </Box>
      </Box>
    )
    const head = (mark: string, color: string, label: string): Piece[] => [{ text: mark, color }, { text: ' ' }, { text: label, bold: true }]
    const entries = run.ids.flatMap(id => done.get(id) ?? [])
    if (entries.length < 2) {
      return (
        <Box flexDirection="column" marginTop={1}>
          {row(`fold:${e.requestId}`, [...head('●', 'success', self.summary.isNew ? 'Created' : EDIT[tool]!), { text: ' (', color: 'promptBorder' }, ...namePieces(name(self.file)), { text: ')', color: 'promptBorder' }, ...result(self)])}
          {run.isOpen && diff(self)}
        </Box>
      )
    }
    const add = entries.reduce((sum, entry) => sum + entry.summary.add, 0)
    const del = entries.reduce((sum, entry) => sum + entry.summary.del, 0)
    const files = new Set(entries.map(entry => entry.file)).size
    const listed = run.isOpen ? entries : []
    const at = listed.indexOf(self)
    const isFirst = entries[0] === self
    if (!isFirst && at < 0) return <Box />
    const mark = run.isOpen ? '○' : '●'
    // Every row's counts start in one column: past the header or the widest listed name, whichever ends later.
    const TREE_INDENT = 4
    const noun = files === 1 ? 'file' : 'files'
    const label = `Edited (${files} ${noun})`
    const nameEnd = Math.max(0, ...listed.map(entry => TREE_INDENT + name(entry.file).length))
    // A new file's "new" sits in its own column between the names and the counts.
    const NEW = 'new'
    const hasNew = listed.some(entry => entry.summary.isNew)
    const end = Math.max(label.length + 2, nameEnd + (hasNew ? NEW.length + 2 : 0))
    const gapAfter = (width: number) => ' '.repeat(end - width + 2)
    const addWidth = Math.max(plus(add).length, ...listed.map(entry => plus(entry.summary.add, entry.summary.isNew).length))
    const selfName = name(self.file)
    const newPieces: Piece[] = at >= 0 && self.summary.isNew ? [{ text: ' '.repeat(nameEnd - TREE_INDENT - selfName.length + 2) }, { text: NEW, color: 'success' }] : []
    const nameWidth = self.summary.isNew ? nameEnd + 2 + NEW.length : TREE_INDENT + selfName.length

    return (
      <Box flexDirection="column" marginTop={isFirst ? 1 : 0}>
        {isFirst && row(`fold:${e.requestId}`, [
          ...head(mark, 'success', 'Edited'),
          { text: ' (', color: 'promptBorder' },
          { text: String(files), color: 'claude' },
          { text: ` ${noun}` },
          { text: ')', color: 'promptBorder' },
          ...countPieces(add, del, false, gapAfter(label.length + 2), listed.length ? addWidth : 0),
        ])}
        {at >= 0 && row(`file:${e.requestId}`, [
          { text: at === listed.length - 1 && !shownDiffs.has(e.requestId) ? '  └ ' : '  ├ ', color: 'promptBorder' },
          ...namePieces(selfName),
          ...newPieces,
          ...result(self, gapAfter(nameWidth), addWidth),
        ])}
        {shownDiffs.has(e.requestId) && diff(self, at < listed.length - 1)}
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    const run = runs.get(e.requestId)
    const element = typeof e.element === 'string' ? e.element : ''
    if (run && (e.data as { press?: boolean } | undefined)?.press) {
      if (element.startsWith('fold:')) {
        run.isOpen = !run.isOpen
        for (const id of run.ids) shownDiffs.delete(id)
      } else if (element.startsWith('file:') && done.get(e.requestId)?.diff && !shownDiffs.delete(e.requestId)) shownDiffs.add(e.requestId)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const native = await next(e)
    const { origin, isExpanded, task } = e.props
    const arg = task?.toolUseId && agents.get(task.toolUseId)
    const ended = task?.status && ENDED[task.status]
    if (!hideEditDiff || e.surface !== 'terminal' || isExpanded || origin.kind !== 'task-notification' || !arg || !ended) return native
    const elements = $.ui.resolve(e)
    const { Text } = elements
    const [tail, color] = ended
    return textRow(elements, <Text color={color}>●</Text>, ['Agent', arg, task.durationMs === undefined ? tail : `${tail} · ${took(task.durationMs)}`])
  })

  // A reply still streaming skips the hook below, so md-display.pl draws its lines from this width.
  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, async ($, e, next) => {
    const columns = e.surface === 'terminal' ? e.viewport?.columns : undefined
    if (columns && columns !== wroteColumns) {
      wroteColumns = columns
      try {
        await $.fs.write(`${(await $.env.get('TMPDIR')) || '/tmp'}/claudzilla-rules/cols-${await $.session.id()}`, String(columns))
      } catch {}
    }
    return next(e)
  })

  // A hook's text is fixed when printed; drawn here, the lines follow a resize or a docked pane.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary block split up would repeat the engine's ` · summary` mark per chunk.
    if (e.props.isSummary) {
      note(e.requestId, 'summary', { split: false, reason: 'summary block' })
      return next(e)
    }
    const parts = split(e.props.text)
    const rules = parts.filter(p => 'rule' in p).length
    const codes = parts.filter(p => 'code' in p).length
    // Only the fullscreen terminal hands a plain click on a link to the plugin.
    const found = e.surface === 'terminal' ? await Promise.all(parts.map(p => ('text' in p ? links($, p.text) : undefined))) : []
    if (!rules && !codes && !found.some(f => f?.size)) {
      note(e.requestId, 'plain', { split: false, reason: 'no frame lines' })
      return next(e)
    }
    if (rules) note(e.requestId, 'split', { split: true, rules, chunks: parts.length - rules, columns: e.viewport?.columns ?? 80, first: !!e.props.isFirstOfReply })
    else note(e.requestId, codes ? 'fenced' : 'linked', { split: false, reason: codes ? 'code blocks' : 'file links', codes, links: found.filter(f => f?.size).length })
    const { Box, Text, Markdown, Button, Code } = $.ui.resolve(e)
    // The engine indents only the block that draws the bullet, so later chunks take its two columns here.
    const indent = e.props.isFirstOfReply ? 2 : 0
    const room = Math.max((e.viewport?.columns ?? 80) - indent - 2, 4)
    const rows = []
    let isFirst = e.props.isFirstOfReply
    for (const [i, p] of parts.entries()) {
      if ('rule' in p) {
        rows.push(
          <Box paddingLeft={indent} marginTop={1}>
            <Text wrap="truncate">{p.rule.repeat(Math.floor(room / SHARE[p.rule]!))}</Text>
          </Box>,
        )
      } else if ('code' in p) {
        const { lang, body } = p.code
        const cmd = runText(lang, body)
        const block = `${e.requestId}:${i}`
        const ran = outputs.get(block)
        const shown = ran && !hidden.has(block)
        const output: Span[][] = shown ? [...(ran.more ? [[{ text: `… ${ran.more} earlier lines`, paint: {} }]] : []), ...ran.tail] : []
        const edge = cmd ? 'bashBorder' : 'promptBorder'
        // Every edge drawn here at a fixed width: a mod's Box cannot drop one border side or overlap it.
        const line = (left: string, right: string, label: any, end: any) => (
          <Box>
            <Text color={edge}>{left}</Text>
            {label}
            <Box width={1} flexGrow={1} height={1} overflow="hidden">
              <Text color={edge}>{'─'.repeat(400)}</Text>
            </Box>
            {end}
            <Text color={edge}>{right}</Text>
          </Box>
        )
        const side = (content: any, k: string) => (
          <Box key={k} width={room}>
            <Text color={edge}>{'│ '}</Text>
            <Box width={room - 4}>{content}</Box>
            <Text color={edge}>{' │'}</Text>
          </Box>
        )
        const copyButton = (k: string, text: string) => (
          <Button key={k} plain onPress={p => void copy($, k, text, p.surface).catch(() => undefined)}>
            <Text color={copied.has(k) ? 'success' : 'text'}>{copied.has(k) ? '✓ Copied' : '⧉ Copy'}</Text>
          </Button>
        )
        const runLabel = live.has(block) ? '■ Stop' : armed.has(block) ? '▶ Run? click again' : ran ? '▶ Run again' : '▶ Run'
        const runColor = live.has(block) ? 'error' : armed.has(block) ? 'warning' : 'success'
        const card = (
          <Box flexDirection="column" width={room}>
            {line(
              lang ? '╭─ ' : '╭─',
              ' ─╮',
              lang ? <Box><Text color="subtle">{lang}</Text><Text>{' '}</Text></Box> : null,
              <Box>
                <Text>{' '}</Text>
                {cmd ? (
                  <Box>
                    <Button key={`run:${block}`} plain onPress={() => void press($, cmd, block).catch(() => undefined)}>
                      <Text color={runColor}>{runLabel}</Text>
                    </Button>
                    <Text color={edge}>{' │ '}</Text>
                  </Box>
                ) : null}
                {copyButton(`copy:${block}`, body)}
              </Box>,
            )}
            {(cmd ? cut(body, room - 4) : body.split('\n')).map((l, n) => side(<Code source={l || ' '} language={lang || undefined} wrap="truncate-end" />, `c${n}`))}
            {shown
              ? line(
                  '├─ ',
                  live.has(block) ? '─┤' : ' ─┤',
                  <Box><Text color="subtle">{ran.end ? `output · ${ran.end}` : 'output'}</Text><Text>{' '}</Text></Box>,
                  live.has(block) ? null : (
                    <Box>
                      <Text>{' '}</Text>
                      <Button key={`hide:${block}`} plain onPress={() => { hidden.add(block); $.ui.invalidate('ui.render') }}>
                        <Text color="error">{'✕ Hide'}</Text>
                      </Button>
                      <Text color={edge}>{' │ '}</Text>
                      {copyButton(`copyout:${block}`, ran.text)}
                    </Box>
                  ),
                )
              : null}
            {output.map((l, n) =>
              side(<Text wrap="truncate-end">{l.length ? l.map(s => (Object.keys(s.paint).length ? <Text {...s.paint}>{s.text}</Text> : s.text)) : ' '}</Text>, `o${n}`),
            )}
            {line('╰', '╯', null, null)}
          </Box>
        )
        // A reply that opens with a block carries its bullet on the card, not on the next text.
        rows.push(isFirst ? <Box marginTop={1}><Text color="text">● </Text>{card}</Box> : <Box marginLeft={indent} marginTop={1}>{card}</Box>)
        isFirst = false
      } else {
        // Awaited on a linked chunk too: hooks beneath (panel's in-view tracking) still see it.
        let drawn = await next({ ...e, props: { ...e.props, text: p.text, isFirstOfReply: isFirst } })
        const chunk = found[i]
        if (chunk?.size) {
          const at = new Map([...chunk.values()].map(l => [l.href, { path: l.path, line: l.line }]))
          // Drawn by the plugin, the block lacks the engine's blank row above and its bullet.
          drawn = (
            <Box marginTop={1}>
              {isFirst ? <Text color="text">● </Text> : null}
              <Markdown
                key={`m:${e.requestId}:${i}`}
                text={linked(p.text, new Map([...chunk].map(([span, l]) => [span, l.href])))}
                pressableLinks={[...at.keys()].slice(0, 256)}
                onLinkPress={async link => {
                  const target = at.get(link.href)
                  if (!target) return
                  try {
                    await $.margin.show(target)
                  } catch (err) {
                    // A missing noun throws TypeError; any other failure is margin's to report.
                    if (!(err instanceof TypeError) || toldNoPanel) return
                    toldNoPanel = true
                    $.ui.toast('folio: install the margin part to preview files; ctrl+click opens them')
                  }
                }}
              />
            </Box>
          )
        }
        rows.push(isFirst ? drawn : <Box paddingLeft={indent}>{drawn}</Box>)
        isFirst = false
      }
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
