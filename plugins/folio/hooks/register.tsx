import type { EngineInterface, Register } from 'claude-code'

import { href, linked, mentions } from './mentions'
import { tracer } from './trace'
import { traceIo } from './trace-io'

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
const TREE_LINE_ROWS = 500
const NAME_FLOOR = 20

// `done` once it landed, `tried` when it failed and changed nothing.
const EDIT: Record<string, { done: string; tried: string; error: string }> = {
  Edit: { done: 'Updated', tried: 'Update', error: 'Error editing file' },
  Write: { done: 'Wrote', tried: 'Write', error: 'Error writing file' },
}

const newFileLines = (output: { content?: string }) => (output.content ? output.content.replace(/\n$/, '').split('\n') : [])

// What an Edit or Write row shows in place of its result block; undefined where the engine's own rows should draw.
function editSummary(tool: string, output: any, isErrored: boolean) {
  const names = EDIT[tool]
  if (!names) return undefined
  // A refusal is errored too, with its own rows: only a tool's own error starts this way.
  if (isErrored) return typeof output === 'string' && output.startsWith('Error') ? { error: names.error } : undefined
  if (!output || typeof output !== 'object' || output.staged) return undefined
  if (output.type === 'create') return { add: newFileLines(output).length, del: 0, isNew: true }
  const lines: string[] = (output.structuredPatch ?? []).flatMap((hunk: { lines: string[] }) => hunk.lines)
  const add = lines.filter(line => line[0] === '+').length
  const del = lines.filter(line => line[0] === '-').length
  return add + del ? { add, del, isNew: false } : undefined
}

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

// A path cut in the middle to fit `max`: the first folder, then as many last segments as fit. The file name goes last.
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
    for (const rows of [runs, done, placed, shownDiffs]) rows.clear()
    current = undefined
    await t.flush(traceIo($))
    return next(e)
  })

  // A run of edits folds into its first row, as a big diff fills the chat. Off the fullscreen layout a printed row
  // cannot change, so each edit keeps its own.
  type Run = { ids: string[]; isOpen: boolean }
  const runs = new Map<string, Run>()
  const done = new Map<string, { file: string; diff?: string; summary: NonNullable<ReturnType<typeof editSummary>> }>()
  const placed = new Set<string>()
  // Edits whose diff a click on their tree row opened.
  const shownDiffs = new Set<string>()
  let current: Run | undefined
  let shownView: string | undefined

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
      const run: Run = (e.viewport?.isFullscreen && current) || { ids: [], isOpen: false }
      run.ids.push(e.requestId)
      runs.set(e.requestId, run)
      current = run
    } else current = undefined
    return next(e)
  })

  // Each hook runs next even when dropping it: margin tracks the row in view on this chain.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const native = await next(e)
    if (!hideEditDiff || e.surface !== 'terminal' || e.props.isExpanded || !runs.has(e.requestId) || !editSummary(e.props.tool, e.props.output, e.props.isErrored)) return native
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const native = await next(e)
    const { tool, input, output, isRunning, isErrored, isInterrupted, isExpanded } = e.props
    const run = runs.get(e.requestId)
    // A Client draws nothing on mobile.
    if (!hideEditDiff || e.surface !== 'terminal' || isExpanded || !run) return native
    const summary = !isRunning && !isInterrupted ? editSummary(tool, output, isErrored) : undefined
    if (summary && !done.has(e.requestId)) {
      done.set(e.requestId, { file: String((input as { file_path?: string }).file_path), summary, diff: isErrored ? undefined : diffText(output) })
      // The run's first row draws this one's counts; a lone edit has none to update.
      if (run.ids.length > 1) $.ui.invalidate('ui.render')
    }
    if (!summary) return native
    const elements = $.ui.resolve(e)
    const { Box, Code, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    if (!Client) return native
    type Piece = { text: string; color?: string; bold?: boolean }
    const row = (key: string, pieces: Piece[]) => <Client key={key} module="./fold.tsx" width="100%" height={1} props={{ pieces }} />
    const cwd = await $.session.cwd().catch(() => '')
    // A share of the chat, so a wide terminal shows more of a path; the floor still fits most file names.
    const nameRoom = Math.max(NAME_FLOOR, Math.floor((e.viewport?.columns ?? 80) * NAME_SHARE))
    const name = (file: string) => cutPath(cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file, nameRoom)
    const namePieces = (path: string): Piece[] =>
      path.split(/(\/)/).filter(Boolean).map(text => (text === '/' ? { text, color: 'promptBorder' } : { text }))
    const countPieces = (add: number, del: number, isNew = false, gap = '  '): Piece[] => [
      { text: gap },
      ...(add > 0 || isNew ? [{ text: `+${add}`, color: 'success' }] : []),
      ...(add > 0 && del > 0 ? [{ text: ' ' }] : []),
      ...(del > 0 ? [{ text: `−${del}`, color: 'error' }] : []),
      ...(isNew ? [{ text: ' new' }] : []),
    ]
    const result = (entry: NonNullable<ReturnType<typeof done.get>>, gap = '  ') =>
      'error' in entry.summary
        ? [{ text: gap }, { text: entry.summary.error, color: 'error' }]
        : countPieces(entry.summary.add, entry.summary.del, entry.summary.isNew, gap)
    const self = done.get(e.requestId)!
    const diff = (entry: typeof self, hasNext = false) => entry.diff && (
      <Box position="relative" paddingLeft={4} paddingBottom={hasNext ? 1 : undefined}>
        {/* Sized by the diff beside it, which may wrap: clipped, not counted. */}
        <Box position="absolute" left={2} height="100%" overflow="hidden">
          <Text color="promptBorder">{Array(TREE_LINE_ROWS).fill('│').join('\n')}</Text>
        </Box>
        <Code source={entry.diff} path={entry.file} format="diff" />
      </Box>
    )
    const head = (mark: string, color: string, label: string): Piece[] => [{ text: mark, color }, { text: ' ' }, { text: label, bold: true }]
    const entries = run.ids.flatMap(id => done.get(id) ?? [])
    if (entries.length < 2) {
      return (
        <Box flexDirection="column" marginTop={1}>
          {row(`fold:${e.requestId}`, [...head('●', isErrored ? 'error' : 'success', isErrored ? EDIT[tool]!.tried : EDIT[tool]!.done), { text: ' (', color: 'promptBorder' }, ...namePieces(name(self.file)), { text: ')', color: 'promptBorder' }, ...result(self)])}
          {run.isOpen && diff(self)}
        </Box>
      )
    }
    const edits = entries.flatMap(entry => ('error' in entry.summary ? [] : entry.summary))
    const add = edits.reduce((sum, edit) => sum + edit.add, 0)
    const del = edits.reduce((sum, edit) => sum + edit.del, 0)
    const files = new Set(entries.filter(entry => !('error' in entry.summary)).map(entry => entry.file)).size
    // A failed edit stays named while the fold is closed.
    const listed = run.isOpen ? entries : entries.filter(entry => 'error' in entry.summary)
    const at = listed.indexOf(self)
    const isFirst = entries[0] === self
    if (!isFirst && at < 0) return <Box />
    const mark = run.isOpen ? '○' : '●'
    // Every row's counts start in one column: past the header or the widest listed name, whichever ends later.
    const TREE_INDENT = 4
    const [verb, count, noun] = edits.length ? ['Edited', files, files === 1 ? 'file' : 'files'] : ['Failed', entries.length, 'edits']
    const label = `${verb} (${count} ${noun})`
    const end = Math.max(label.length + 2, ...listed.map(entry => TREE_INDENT + name(entry.file).length))
    const gapAfter = (width: number) => ' '.repeat(end - width + 2)

    return (
      <Box flexDirection="column" marginTop={isFirst ? 1 : 0}>
        {isFirst && row(`fold:${e.requestId}`, [
          ...head(mark, edits.length ? 'success' : 'error', verb),
          { text: ' (', color: 'promptBorder' },
          { text: String(count), color: 'claude' },
          { text: ` ${noun}` },
          { text: ')', color: 'promptBorder' },
          ...(edits.length ? countPieces(add, del, false, gapAfter(label.length + 2)) : []),
        ])}
        {at >= 0 && row(`file:${e.requestId}`, [
          { text: at === listed.length - 1 && !shownDiffs.has(e.requestId) ? '  └ ' : '  ├ ', color: 'promptBorder' },
          ...namePieces(name(self.file)),
          ...result(self, gapAfter(TREE_INDENT + name(self.file).length)),
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
