import type { Elements, EngineInterface, Register, RenderNode, Timer, ToolGroupCall } from 'claude-code'

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
// Margin's agent colours (`plugins/margin/hooks/tab-overview.tsx`), so an agent reads the same in chat and in PLAN.
const AGENT_FIXED: Record<string, string> = { 'general-purpose': '#e8927c', 'cavecrew-reviewer': '#d17fcf', 'cavecrew-investigator': '#b3c46a', 'cavecrew-builder': '#c8b08a' }
const AGENT_HASHED = ['#7f9cb0', '#8a8fe0']
const agentTone = ({ name, type }: { name?: string; type?: string }) => {
  const fixed = AGENT_FIXED[(type ?? '').replace(/^[^:]+:/, '')]
  if (fixed) return fixed
  const shown = (name ?? (type ?? '').replace(/^[^:]+:/, '')) || 'agent'
  return AGENT_HASHED[[...shown].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % AGENT_HASHED.length]
}
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
// Text cut to `room` cells with an ellipsis; a room under 1 still keeps the ellipsis alone.
const clip = (text: string, room: number) => (text.length > room ? `${text.slice(0, Math.max(room - 1, 0))}…` : text)
const toolRow = (tool: string, input: any, output: any, isErrored: boolean) =>
  tool in ROWS && !isErrored && output && typeof output === 'object' ? ROWS[tool]!(input ?? {}, output) : undefined

// Diff lines as the Code element's source: tab and newline its only control characters, and over its size limit
// it refuses the row, so such a diff stays in ctrl+o.
function codeDiff(lines: string[]) {
  const text = lines.join('\n').replace(CODE_CONTROLS, '')
  return text && text.length <= CODE_MAX ? text : undefined
}

// An Edit or Write result as unified-diff hunks. A new file has no patch: all added.
function diffText(output: any) {
  const lines = newFileLines(output)
  type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
  return codeDiff(output.type === 'create'
    ? [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)]
    : (output.structuredPatch as Hunk[]).flatMap(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines]))
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

// The folder a leading `cd DIR &&` or `cd DIR;` moves to, with ~ as the home folder.
function leadDir(command: string, home?: string) {
  const dir = command.match(/^\s*cd\s+([^\s;&|]+)\s*(?:&&|;)/)?.[1]
  return dir && home ? dir.replace(/^~(?=\/|$)/, home) : dir
}

// Files a Bash command writes, under a leading `cd DIR &&` or `cd DIR;`.
// shortcut: regex parse of common write forms (sed -i, >, >>, tee), not a shell parser; a false hit costs a read, and after a reload hides the command's output.
export function writeTargets(command: string, home?: string): string[] {
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
  const dir = leadDir(cmd, home)
  return [...out].filter(f => !f.startsWith('/dev/')).map(f => resolve(dir ? word(dir) : '', f))
}

// Lines added and removed between two texts, and their unified-diff hunks with 3 lines of context: an LCS line
// diff, or for big files a multiset count and no hunks.
function diffCount(before: string | undefined, after: string): { add: number; del: number; diff?: string } {
  const lines = (s: string | undefined) => (s ? s.replace(/\n$/, '').split('\n') : [])
  const [a, b] = [lines(before), lines(after)]
  // An empty side makes the product 0, so a long side alone also takes the cheap count.
  if (a.length * b.length > 4_000_000 || Math.max(a.length, b.length) > 20_000) {
    let same = 0
    const left = new Map<string, number>()
    a.forEach(l => left.set(l, (left.get(l) ?? 0) + 1))
    for (const l of b) if ((left.get(l) ?? 0) > 0) { left.set(l, left.get(l)! - 1); same++ }
    return { add: b.length - same, del: a.length - same }
  }
  // The shorter side stays under 2001 lines here, so an LCS length fits 16 bits.
  const table = [new Uint16Array(b.length + 1)]
  for (let i = 1; i <= a.length; i++) {
    const [prev, cur] = [table[i - 1]!, new Uint16Array(b.length + 1)]
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!)
    table.push(cur)
  }
  // Walked from the end, an add before a remove, so each change reads removes first.
  const ops: string[] = []
  for (let i = a.length, j = b.length; i || j;) {
    if (i && j && a[i - 1] === b[j - 1]) { ops.push(` ${a[--i]}`); j-- }
    else if (j && (!i || table[i]![j - 1]! >= table[i - 1]![j]!)) ops.push(`+${b[--j]}`)
    else ops.push(`-${a[--i]}`)
  }
  ops.reverse()
  const CONTEXT = 3
  const isChange = (op = ' ') => op[0] !== ' '
  const out: string[] = []
  let [oldNo, newNo, k] = [0, 0, 0]
  while (k < ops.length) {
    const first = ops.findIndex((op, i) => i >= k && isChange(op))
    if (first < 0) break
    let last = first
    for (let i = first + 1; i < ops.length && i - last <= 2 * CONTEXT; i++) if (isChange(ops[i])) last = i
    const from = Math.max(first - CONTEXT, k)
    oldNo += from - k
    newNo += from - k
    const body = ops.slice(from, Math.min(last + CONTEXT + 1, ops.length))
    const olds = body.filter(op => op[0] !== '+').length
    const news = body.filter(op => op[0] !== '-').length
    out.push(`@@ -${oldNo + (olds ? 1 : 0)},${olds} +${newNo + (news ? 1 : 0)},${news} @@`, ...body)
    oldNo += olds
    newNo += news
    k = from + body.length
  }
  return { add: ops.filter(op => op[0] === '+').length, del: ops.filter(op => op[0] === '-').length, diff: codeDiff(out) }
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
// Blocks whose long lines wrap instead of cutting; kept across Run again and resizes.
const wrapped = new Set<string>()

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
type Span = { text: string; paint: Paint; href?: string }
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
// [start, end) code-point offsets of each URL in `s`, with the URL itself.
const urlRanges = (s: string) => {
  let [unit, point] = [0, 0]
  // Low surrogates are not code points of their own.
  const at = (i: number) => {
    for (; unit < i; unit++) if ((s.charCodeAt(unit) & 0xfc00) !== 0xdc00) point++
    return point
  }
  return [...s.matchAll(/https?:\/\/\S+/g)].map(m => {
    // Closing quotes and brackets and sentence punctuation after a URL are not part of it.
    const url = m[0].replace(/["'),\].;>]+$/, '')
    return [at(m.index), at(m.index + url.length), url] as const
  })
}

// End offset of each row, at most `max`: after the last space that fits `width`, else a hard cut; the space stays on its row.
// A URL that fits `width` is never split: a break inside it moves to its start unless that empties the row.
const rowEnds = (cs: string[], width: number, urls: ReturnType<typeof urlRanges>, max = Infinity) => {
  const w = Math.max(width, 1)
  const ends: number[] = []
  let at = 0
  while (cs.length - at > w && ends.length < max) {
    let sp = cs.lastIndexOf(' ', at + w - 1)
    // Break after the first space of a run, never right after the row's leading spaces.
    while (sp > at && cs[sp - 1] === ' ') sp = cs.lastIndexOf(' ', sp - 1)
    let end = sp > at ? sp + 1 : at + w
    const u = urls.find(([s, e]) => s > at && s < end && end < e && e - s <= w)
    ends.push((at = u ? u[0] : end))
  }
  return ends.length < max ? [...ends, cs.length] : ends
}

// shortcut: counts code points, so a line of wide glyphs or tabs still cuts; measure cells if one shows up.
// One output row as rows of `width` code points; each piece keeps its span's paint, and a split URL's pieces keep its full href.
// With `max`, only the first `max` rows are cut, then one row counting the rest; shortcut: a URL running past them is read in full, and the count is UTF-16 units over `width`.
const cutSpans = (spans: Span[], width: number, max = Infinity): Span[][] => {
  const w = Math.max(width, 1)
  function* points() { for (const s of spans) for (const c of s.text) yield { c, paint: s.paint } }
  const it = points()
  const cs: { c: string; paint: Paint }[] = []
  const limit = max * w + 1
  for (let n = it.next(); !n.done; n = it.next()) {
    cs.push(n.value)
    if (cs.length >= limit) break
  }
  // A URL cut by the limit is read to its end so its pieces keep the full href.
  if (/https?:\/\/\S*$/.test(cs.map(x => x.c).join(''))) for (let n = it.next(); !n.done && /\S/.test(n.value.c); n = it.next()) cs.push(n.value)
  const chars = cs.map(x => x.c)
  const urls = urlRanges(chars.join(''))
  const ends = rowEnds(chars, w, urls, max)
  const last = ends.at(-1)!
  const total = spans.reduce((sum, s) => sum + s.text.length, 0)
  const left = total - chars.slice(0, last).join('').length
  let ui = 0
  const rows = ends.map((e, i) => {
    const from = ends[i - 1] ?? 0
    const row: Span[] = []
    for (let k = from; k < e; k++) {
      const { c, paint } = cs[k]!
      while (urls[ui] && k >= urls[ui]![1]) ui++
      const u = urls[ui]
      const h = u && k >= u[0] && (u[0] < from || u[1] > e) ? u[2] : undefined
      const prev = row[row.length - 1]
      if (prev?.paint === paint && prev.href === h) prev.text += c
      else row.push({ text: c, paint, href: h })
    }
    return row
  })
  return left > 0 && max < Infinity ? [...rows, [{ text: `… +${Math.ceil(left / w)} rows`, paint: {} }]] : rows
}

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
    for (const rows of [runs, done, placed, shownDiffs, agents, spawned, bashEdits, lostWrites, openGroups]) rows.clear()
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
  const toggleBlink = (redraw: () => void) => {
    if (!blinking.size) {
      blink?.cancel()
      blink = undefined
      isLit = true
      return
    }
    blinking.clear()
    isLit = !isLit
    redraw()
  }
  // Agent calls by tool_use_id: a finish notification names only the call. Model and effort as the spawn and the
  // agent's own requests report them, which an agent definition or a fork may set apart from the call's input.
  type AgentRow = { description?: string; model?: string; effort?: string; name?: string; type?: string }
  const agents = new Map<string, AgentRow>()
  // Agent calls' tool_use_id by agentId, which their requests carry.
  const spawned = new Map<string, string>()
  // Bash commands' first line by tool_use_id, for a background command's finish notification.
  const shells = new Map<string, string>()
  const agentTag = ({ model, effort }: AgentRow) => [/opus|sonnet|haiku|fable/.exec(model ?? '')?.[0], effort].filter(Boolean).join(' · ')
  // Files each Bash call changed, by tool_use_id; and the Bash groups a click opened, by requestId, to the file rows
  // whose diff a click opened.
  type BashEdit = { file: string; add: number; del: number; isNew: boolean; diff?: string }
  const bashEdits = new Map<string, BashEdit[]>()
  // Bash writes drawn as a Ran row because folio holds no record of them, as after a reload.
  const lostWrites = new Set<string>()
  const openGroups = new Map<string, Set<string>>()
  // A file's name from the session root, cut to a share of the chat, so a wide terminal shows more of a path.
  const namer = (cwd: string, columns = 80) => {
    const room = Math.max(NAME_FLOOR, Math.floor(columns * NAME_SHARE))
    return (file: string) => cutPath(cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file, room)
  }
  type Piece = { text: string; color?: string; bold?: boolean }
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
  const head = (mark: string, color: string, label: string): Piece[] => [{ text: mark, color }, { text: ' ' }, { text: label, bold: true }]
  // Plain text, not the fold's Client: nothing opens on a press, so nothing lights under the pointer.
  const textLine = ({ Text }: Elements['terminal'], dot: RenderNode, [label, arg, tail]: [string, string, RenderNode], tag = '', tone?: string) => (
    <Text wrap="truncate-end">
      {dot} <Text bold>{label}</Text>
      <Text color="promptBorder"> (</Text>{tone ? <Text color={tone}>{arg}</Text> : arg}<Text color="promptBorder">)</Text>
      {tag && <Text><Text color="promptBorder"> [</Text>{tag.split(' · ').flatMap((part, i) => [...(i ? [<Text color="promptBorder"> · </Text>] : []), <Text color="inactive">{part}</Text>])}<Text color="promptBorder">]</Text></Text>}
      {tail && '  '}{tail}
    </Text>
  )
  const textRow = (elements: Elements['terminal'], dot: RenderNode, row: [string, string, RenderNode], tag?: string, tone?: string) => (
    <elements.Box marginTop={1}>{textLine(elements, dot, row, tag, tone)}</elements.Box>
  )
  // An opened file's diff under its tree row, the tree line beside it; `hasNext` runs the line on to the next row.
  const diffBox = ({ Box, Code, Text }: Elements['terminal'], columns: number, entry: { file: string; diff?: string }, hasNext = false) => entry.diff && (
    <Box paddingLeft={2}>
      {/* Counted, not clipped: a clipped box scrolled past its top draws from the screen's top row and overruns. */}
      <Text color="promptBorder">{Array(diffRows(entry.diff, columns - 4) + (hasNext ? 1 : 0)).fill('│').join('\n')}</Text>
      <Box paddingLeft={1} flexGrow={1}>
        <Code source={entry.diff} path={entry.file} format="diff" />
      </Box>
    </Box>
  )

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (!result.deny && result.agentId && e.tool_use_id) {
      if (spawned.size > 500) spawned.clear()
      spawned.set(result.agentId, e.tool_use_id)
      agents.set(e.tool_use_id, { ...agents.get(e.tool_use_id), description: e.description, model: result.model, name: e.name, type: e.subagentType })
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId && spawned.get(e.agentId)
    if (id && typeof e.effort === 'string') agents.set(id, { ...agents.get(id), effort: e.effort })
    return yield* next(e)
  })

  const tops = new Map<string, string>()
  // Bash calls whose writes git status found, as a script's: they keep their command, and show its output while their row is open.
  const scripts = new Set<string>()
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // Here, not on the row: calls drawn in a group never draw a ToolUse row. Every call, because one past its timeout moves to the background.
    if (e.tool_use_id) {
      // Oldest out, so a long-running background command keeps its line.
      if (shells.size > 5000) shells.delete(shells.keys().next().value!)
      shells.set(e.tool_use_id, e.command.split('\n')[0]!)
    }
    if (!hideEditDiff) return next(e)
    const home = /^\s*cd\s+~/.test(e.command) ? await $.env.get('HOME').catch(() => undefined) : undefined
    const targets = writeTargets(e.command, home)
    const cwd = await $.session.cwd().catch(() => '')
    const read = (f: string) => $.fs.read(f).then(text => text as string, () => undefined)
    const git = (dir: string, ...args: string[]) => $.process.run(['git', '--no-optional-locks', '-C', dir, ...args], { timeoutMs: 5000 })
      .then(r => (r.exitCode === 0 ? r.stdout : undefined), () => undefined)
    // Dirty files by path, from git status, for commands whose writes the parse can't see.
    const dirty = async (top: string) => {
      const out = await git(top, 'status', '--porcelain', '-z', '--no-renames', '--untracked-files=all')
      return out === undefined ? undefined : new Map(out.split('\0').filter(Boolean).map(r => [`${top}/${r.slice(3)}`, r.slice(0, 2)]))
    }
    const cd = leadDir(e.command, home)
    const dir = cd ? resolve(cwd, cd) : cwd
    // Only under the session root: git status runs a repo's config (core.fsmonitor, filters), and this runs before approval.
    const root = targets.length ? '' : await $.session.root().catch(() => '')
    const isTrusted = !!root && (dir === root || dir.startsWith(`${root}/`))
    if (isTrusted && !tops.has(dir)) {
      const found = (await git(dir, 'rev-parse', '--show-toplevel'))?.trim()
      // Not cached when missing, so a later `git init` counts.
      if (found) tops.set(dir, found)
    }
    const top = isTrusted ? tops.get(dir) ?? '' : ''
    const was = top ? await dirty(top) : undefined
    // shortcut: a tree with over 100 dirty files skips script writes, as reading each on every call costs too much; upgrade by hashing with git hash-object.
    if (!targets.length && (!was || was.size > 100)) return next(e)
    let files = targets.map(f => resolve(cwd, f))
    if (was) files = [...was.keys()]
    const before = await Promise.all(files.map(read))
    const ran = await next(e)
    if (ran.deny || ran.isError) return ran
    if (was) {
      // shortcut: another session or a parallel Bash call writing at the same time counts as this call's write.
      const fresh = [...((await dirty(top)) ?? new Map<string, string>())].filter(([f]) => !was.has(f))
      if (fresh.length > 100) return ran
      files.push(...fresh.map(([f]) => f))
      before.push(...await Promise.all(fresh.map(([f, code]) => (code === '??' ? undefined : git(top, 'show', `HEAD:${f.slice(top.length + 1)}`)))))
    }
    const after = await Promise.all(files.map(read))
    // A NUL byte marks a binary file, which has no line diff to show.
    const found = files.flatMap((file, i) => after[i] === undefined || after[i] === before[i] || `${before[i] ?? ''}${after[i]}`.includes('\0')
      ? [] : [{ file, isNew: before[i] === undefined, ...diffCount(before[i], after[i]!) }])
    // An unparsed command that changed nothing is a plain command, not a write.
    if (was && !found.length) return ran
    // No parsed target exists, as with `sed -i ... $f`: the parse misread it, so the engine's bashEditDiff stays adoptable.
    if (!was && files.every((_, i) => before[i] === undefined && after[i] === undefined)) return ran
    if (scripts.size > 500) scripts.clear()
    if (was) scripts.add(e.tool_use_id)
    // A write that changed nothing still unfolds its group, so a rerun looks like the first run.
    if (bashEdits.size > 500) bashEdits.clear()
    bashEdits.set(e.tool_use_id, found)
    $.ui.invalidate('ui.render')
    return ran
  })

  // With no record of a Bash call's writes, as after a reload, takes them from the engine's bashEditDiff; a command the parse sees no write in is a script.
  const adopt = (id: string, output: unknown, command: string) => {
    type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
    const files = (output as { bashEditDiff?: { files?: { filePath: string; hunks: Hunk[] }[] } } | undefined)?.bashEditDiff?.files
    if (bashEdits.has(id) || !files?.length) return false
    const count = (hunks: Hunk[], sign: string) => hunks.flatMap(h => h.lines).filter(line => line[0] === sign).length
    if (scripts.size > 500) scripts.clear()
    if (bashEdits.size > 500) bashEdits.clear()
    if (!writeTargets(command).length) scripts.add(id)
    // The engine writes a new file as one hunk with no old lines (@@ -1,0 +1,N @@); an existing file's hunk has context.
    bashEdits.set(id, files.map(({ filePath, hunks }) => ({ file: filePath, add: count(hunks, '+'), del: count(hunks, '-'),
      isNew: hunks.length === 1 && !hunks[0]!.oldLines, diff: diffText({ structuredPatch: hunks }) })))
    return true
  }

  // A group's header part per tool kind: done label, running label, noun counted.
  const GROUP_KINDS: Record<string, [string, string, string]> = {
    Read: ['Read', 'Reading', 'file'], Grep: ['Searched', 'Searching', 'pattern'], Glob: ['Searched', 'Searching', 'pattern'], Bash: ['Ran', 'Running', 'command'],
    Edit: ['Edited', 'Editing', 'file'], Write: ['Wrote', 'Writing', 'file'],
  }
  // A group folds into a row of its own, like a run of edits; a click opens a tree of its calls.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const native = await next(e)
    const { calls, isActive, isExpanded } = e.props
    // Off the fullscreen layout a printed row cannot change: a live header would stay Running.
    if (!hideEditDiff || e.surface !== 'terminal' || isExpanded || !e.viewport?.isFullscreen || !calls.length) return native
    const elements = $.ui.resolve(e)
    if (!('Client' in elements)) return native
    const isLive = isActive || calls.some(c => c.isRunning)
    if (isLive) {
      blinking.add(e.requestId)
      blink ??= $.clock.every(BLINK_MS, () => toggleBlink(() => $.ui.invalidate('ui.render')))
    }
    return foldCalls(elements, e.requestId, e.viewport.columns ?? 80, await $.session.root().catch(() => ''), calls, isLive) ?? native
  })

  // Calls as one row whose press opens a tree of them. `title` stands in for the per-kind counts; `lone`, a call's
  // only written file, draws as that file's row and a press opens its diff with no tree.
  const foldCalls = (elements: Elements['terminal'], requestId: string, columns: number, root: string,
    calls: readonly ToolGroupCall[], isLive: boolean, title?: Piece[], lone?: BashEdit) => {
    const { Box, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    if (!Client) return undefined
    const name = namer(root, columns)
    const changed = calls.flatMap(c => (c.tool_use_id && !c.isErrored && bashEdits.get(c.tool_use_id)) || [])
    const add = changed.reduce((sum, c) => sum + c.add, 0)
    const del = changed.reduce((sum, c) => sum + c.del, 0)
    const isOpen = openGroups.has(requestId)
    const kinds = new Map<string, { live: string; noun: string; n: number }>()
    for (const c of calls) {
      const [done, live, noun] = GROUP_KINDS[c.tool] ?? [c.tool, c.tool, '']
      const kind = kinds.get(done) ?? kinds.set(done, { live, noun, n: 0 }).get(done)!
      kind.n++
    }
    const parts = [...kinds].flatMap(([done, { live, noun, n }], i): Piece[] => [...(i ? [{ text: ' · ' }] : []),
      { text: isLive ? live : done, bold: true }, { text: ' (', color: 'promptBorder' }, { text: String(n), color: 'claude' },
      ...(noun ? [{ text: ` ${noun}${n === 1 ? '' : 's'}` }] : []), { text: ')', color: 'promptBorder' }])
    const [mark, color] = isLive ? [isLit ? '●' : ' ', 'inactive'] : [isOpen ? '○' : '●', 'success']
    const header: Piece[] = [{ text: mark, color }, { text: ' ' }, ...(lone ? [{ text: lone.isNew ? 'Created' : EDIT.Edit!, bold: true },
      { text: ' (', color: 'promptBorder' }, ...namePieces(name(lone.file)), { text: ')', color: 'promptBorder' }, ...countPieces(lone.add, lone.del, lone.isNew)]
      : [...(title ?? parts), ...(add + del ? countPieces(add, del) : [])])]
    const TREE_INDENT = 4
    // A file row with a diff is the fold's Client, keyed by call and file, so a press opens the diff under it.
    type Row = { pieces: Piece[]; key?: string; edit?: { file: string; diff?: string }; out?: 'first' | 'more' }
    const rows = isOpen && !lone ? calls.flatMap((c): Row[] => {
      const edits = (c.tool_use_id && !c.isErrored && bashEdits.get(c.tool_use_id)) || []
      if (edits.length) return edits.map((f, i) => ({ key: f.diff && `file:${c.tool_use_id}:${i}`, edit: f, pieces: [{ text: f.isNew ? 'Created' : EDIT.Edit!, bold: true },
        { text: ' (', color: 'promptBorder' }, ...namePieces(name(f.file)), { text: ')', color: 'promptBorder' }, ...countPieces(f.add, f.del, f.isNew)] }))
      const tail: Piece[] = c.isErrored ? [{ text: '  ' }, { text: 'failed', color: 'error' }] : c.isInterrupted ? [{ text: '  ' }, { text: 'interrupted', color: 'inactive' }] : []
      const room = columns - TREE_INDENT - tail.reduce((sum, p) => sum + p.text.length, 0)
      // The call's main argument: its path, pattern, command or address.
      const args = (c.input ?? {}) as Record<string, unknown>
      if (c.tool === 'Bash') return [{ pieces: [{ text: clip(String(args.command ?? '').split('\n')[0]!, room) }, ...tail] }]
      const key = ['file_path', 'pattern', 'path', 'command', 'url', 'query'].find(k => typeof args[k] === 'string')
      const arg = !key ? '' : key === 'file_path' || key === 'path' ? name(String(args[key])) : String(args[key]).split('\n')[0]!
      return [{ pieces: [{ text: c.tool, bold: true }, ...(arg ? [{ text: ' (', color: 'promptBorder' }, { text: clip(arg, room - c.tool.length - 3) }, { text: ')', color: 'promptBorder' }] : []), ...tail] }]
    }) : []
    // A script's output ends its tree: three lines, then a count of the rest.
    if (isOpen && scripts.has(requestId)) {
      const { stdout, stderr } = (calls[0]?.output ?? {}) as { stdout?: unknown; stderr?: unknown }
      const lines = ([[stdout, undefined], [stderr, 'error']] as const).flatMap(([s, color]) => typeof s === 'string' ? plain(s).split('\n').map(l => ({ text: l, color })) : [])
      while (lines.length && !lines.at(-1)!.text) lines.pop()
      const shown: Piece[][] = lines.slice(0, 3).map(l => [l])
      if (lines.length > 3) shown.push([{ text: `… +${lines.length - 3} lines` }])
      rows.push(...shown.map((pieces, i): Row => ({ pieces, out: i ? 'more' : 'first' })))
    }
    const last = rows.findLastIndex(r => r.out !== 'more')

    return (
      <Box flexDirection="column" marginTop={1}>
        <Client key={`fold:${requestId}`} module="./fold.tsx" width="100%" height={1} props={{ pieces: header, lit: LIT }} />
        {lone && isOpen && diffBox(elements, columns, lone, false)}
        {rows.flatMap(({ pieces, key, edit, out }, i) => {
          const isShown = !!key && !!openGroups.get(requestId)?.has(key)
          const line = [{ text: out === 'more' ? '    ' : i === last && !isShown ? '  └ ' : '  ├ ', color: 'promptBorder' }, ...pieces]
          return key ? [<Client key={key} module="./fold.tsx" width="100%" height={1} props={{ pieces: line, lit: LIT }} />, isShown && diffBox(elements, columns, edit!, i < rows.length - 1)]
            : [<Text wrap="truncate-end">{line.map(({ text, color, bold }) => <Text color={color} bold={bold}>{text}</Text>)}</Text>]
        })}
      </Box>
    )
  }

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
    const isFolded = hideEditDiff && e.surface === 'terminal' && !e.props.isExpanded
    const edits = bashEdits.get(e.requestId)
    // The engine draws bashEditDiff under the row; folio's own row already shows the edit, where it draws one.
    const { bashEditDiff, ...rest } = (e.props.output ?? {}) as { bashEditDiff?: unknown }
    const isStripped = isFolded && (scripts.has(e.requestId) ? !!e.viewport?.isFullscreen : true)
    const native = await next(isStripped && edits?.length && bashEditDiff && typeof e.props.output === 'object' ? { ...e, props: { ...e.props, output: rest } } : e)
    const isEdit = (runs.has(e.requestId) && editSummary(e.props.tool, e.props.output, e.props.isErrored)) || (!!bashEdits.get(e.requestId)?.length && !e.props.isErrored && !scripts.has(e.requestId)) || lostWrites.has(e.requestId)
    const isScriptRow = scripts.has(e.requestId) && !e.props.isErrored && !!e.viewport?.isFullscreen
    if (!hideEditDiff || e.surface !== 'terminal' || e.props.isExpanded || !(isEdit || isScriptRow || toolRow(e.props.tool, {}, e.props.output, e.props.isErrored))) return native
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const native = await next(e)
    const { tool, input, output, isRunning, isErrored, isInterrupted, isExpanded } = e.props
    const run = runs.get(e.requestId)
    if (tool === 'Agent') {
      if (agents.size > 500) agents.clear()
      const args = (input ?? {}) as AgentRow & { subagent_type?: string }
      const known = agents.get(e.requestId)
      const resolved = (output as { resolvedModel?: string } | undefined)?.resolvedModel
      agents.set(e.requestId, { description: args.description ?? known?.description, model: resolved ?? known?.model ?? args.model, effort: known?.effort ?? args.effort, name: known?.name ?? args.name, type: known?.type ?? args.subagent_type })
    }
    // A Client draws nothing on mobile.
    if (!hideEditDiff || e.surface !== 'terminal' || isExpanded) return native
    // A result drawn first shows the engine diff until this row records the edit.
    if (!isRunning && !isErrored && !isInterrupted && adopt(e.requestId, output, String((input as { command?: unknown } | undefined)?.command ?? ''))) $.ui.invalidate('ui.render')
    const bashEdit = bashEdits.get(e.requestId)?.length ? bashEdits.get(e.requestId) : undefined
    // The root, not cwd(): a shell `cd` moves cwd(), and every row would shift with it.
    const name = namer(tool in EDIT || bashEdit ? await $.session.root().catch(() => '') : '', e.viewport?.columns)
    if (bashEdit) {
      if (isRunning || isErrored || isInterrupted) return native
      // A script's title names its command even for one file; off the fullscreen layout it keeps the engine row.
      const isScript = scripts.has(e.requestId)
      if (isScript && !e.viewport?.isFullscreen) return native
      // Off the fullscreen layout a printed row cannot open, so each file keeps a plain row; so does a lone file with no diff to open.
      if (e.viewport?.isFullscreen && (isScript || bashEdit.length > 1 || bashEdit[0]!.diff)) {
        const command = String((input as { command?: unknown } | undefined)?.command ?? '').split('\n')[0]!
        const add = bashEdit.reduce((sum, c) => sum + c.add, 0)
        const del = bashEdit.reduce((sum, c) => sum + c.del, 0)
        const room = (e.viewport.columns ?? 80) - 8 - countPieces(add, del).reduce((sum, p) => sum + p.text.length, 0)
        const title: Piece[] = [{ text: 'Ran', bold: true }, { text: ' (', color: 'promptBorder' }, { text: clip(command, room) }, { text: ')', color: 'promptBorder' }]
        const call = { tool_use_id: e.requestId, tool, input, isRunning, isErrored, isInterrupted, output }
        const folded = foldCalls($.ui.resolve(e), e.requestId, e.viewport.columns ?? 80, await $.session.root().catch(() => ''), [call], false, title, !isScript && bashEdit.length === 1 ? bashEdit[0] : undefined)
        if (folded) return folded
      }
      if (isScript) return native
      const elements = $.ui.resolve(e)
      const { Box, Text } = elements
      const dot = <Text color="success">●</Text>
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
    // Without a record, as after a reload, a write keeps one row and not the engine's block.
    const command = tool === 'Bash' && !bashEdits.has(e.requestId) ? String((input as { command?: unknown } | undefined)?.command ?? '') : ''
    if (command && !isRunning && !isErrored && !isInterrupted && writeTargets(command).length) {
      if (lostWrites.size > 500) lostWrites.clear()
      // The result block may have drawn before this row marked it.
      if (!lostWrites.has(e.requestId)) {
        lostWrites.add(e.requestId)
        $.ui.invalidate('ui.render')
      }
      const elements = $.ui.resolve(e)
      return textRow(elements, <elements.Text color="success">●</elements.Text>, ['Ran', command.split('\n')[0]!, ''])
    }
    const isLive = isRunning && !isInterrupted && !isErrored && tool in RUNNING
    const other = isLive ? RUNNING[tool]!(input ?? {}, name) : !isRunning && !isInterrupted ? toolRow(tool, input, output, isErrored) : undefined
    if (isLive) {
      blinking.add(e.requestId)
      blink ??= $.clock.every(BLINK_MS, () => toggleBlink(() => $.ui.invalidate('ui.render')))
    }
    if (other) {
      const elements = $.ui.resolve(e)
      const { Text } = elements
      return textRow(elements, isLive ? <Text color="inactive">{isLit ? '●' : ' '}</Text> : <Text color="success">●</Text>, other, ...(tool === 'Agent' ? [agentTag(agents.get(e.requestId)!), agentTone(agents.get(e.requestId)!)] : []))
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
    const { Box, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    if (!Client) return native
    const row = (key: string, pieces: Piece[]) => <Client key={key} module="./fold.tsx" width="100%" height={1} props={{ pieces, lit: LIT }} />
    const result = (entry: NonNullable<ReturnType<typeof done.get>>, gap = '  ', addWidth = 0) =>
      countPieces(entry.summary.add, entry.summary.del, entry.summary.isNew, gap, addWidth)
    const self = done.get(e.requestId)!
    const diff = (entry: typeof self, hasNext = false) => diffBox(elements, e.viewport?.columns ?? 80, entry, hasNext)
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
    const newPieces: Piece[] = at >= 0 && self.summary.isNew ? [{ text: ' '.repeat(nameEnd - TREE_INDENT - selfName.length + 2) }, { text: NEW }] : []
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
    const isPress = !!(e.data as { press?: boolean } | undefined)?.press
    const shown = openGroups.get(e.requestId)
    if (!run && isPress && element === `fold:${e.requestId}`) {
      if (!openGroups.delete(e.requestId)) openGroups.set(e.requestId, new Set())
      $.ui.invalidate('ui.render')
    } else if (!run && isPress && shown && element.startsWith('file:')) {
      if (!shown.delete(element)) shown.add(element)
      $.ui.invalidate('ui.render')
    }
    if (run && isPress) {
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
    const agent = task?.toolUseId ? agents.get(task.toolUseId) : undefined
    const shell = task?.toolUseId ? shells.get(task.toolUseId) : undefined
    const arg = agent?.description ?? shell
    const ended = task?.status && ENDED[task.status]
    if (!hideEditDiff || e.surface !== 'terminal' || isExpanded || origin.kind !== 'task-notification' || !arg || !ended) return native
    const elements = $.ui.resolve(e)
    const { Text } = elements
    const [tail, color] = ended
    return textRow(elements, <Text color={color}>●</Text>, [agent ? 'Agent' : 'Bash', arg, task.durationMs === undefined ? tail : `${tail} · ${took(task.durationMs)}`], ...(agent ? [agentTag(agent), agentTone(agent)] : []))
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
    const { Box, Text, Markdown, Button, Code, Link } = $.ui.resolve(e)
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
        const wide = (l: string) => Array.from(l).length > room - 4
        const isWrapped = wrapped.has(block)
        const cutNow = cmd ? output.some(l => wide(text(l))) : body.split('\n').some(wide)
        const wrapKey = `wrap:${block}`
        const wrapHover = { scope: wrapKey, color: 'text' }
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
            {(cmd || isWrapped ? body.split('\n').flatMap(l => cutSpans([{ text: l, paint: {} }], room - 4)) : body.split('\n').map(l => [{ text: l, paint: {} }])).map((r, n) =>
              side(
                r.some(s => s.href) ? (
                  // Link takes inline children only, so a row with a split URL drops Code's syntax colour.
                  <Text color="text" wrap="truncate-end">{r.map(s => (s.href ? <Link href={s.href}>{s.text}</Link> : s.text))}</Text>
                ) : (
                  <Code source={r.map(s => s.text).join('') || ' '} language={lang || undefined} wrap="truncate-end" />
                ),
                `c${n}`,
              ),
            )}
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
            {(cmd && isWrapped ? output.flatMap(l => cutSpans(l, room - 4, SHOWN)) : output).map((l, n) =>
              side(<Text wrap="truncate-end">{l.length ? l.map(s => { const t = Object.keys(s.paint).length ? <Text {...s.paint}>{s.text}</Text> : s.text; return s.href ? <Link href={s.href}>{t}</Link> : t }) : ' '}</Text>, `o${n}`),
            )}
            {line(
              '╰',
              cutNow ? ' ─╯' : '╯',
              null,
              cutNow ? (
                <Box>
                  <Text>{' '}</Text>
                  <Button key={wrapKey} plain hover={wrapHover} onPress={() => { isWrapped ? wrapped.delete(block) : wrapped.add(block); $.ui.invalidate('ui.render') }}>
                    <Text color="inactive" hover={wrapHover}>{isWrapped ? '→ Unwrap' : '↩ Wrap'}</Text>
                  </Button>
                </Box>
              ) : null,
            )}
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
