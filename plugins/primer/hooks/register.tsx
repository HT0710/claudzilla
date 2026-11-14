import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEFAULTS, readPalette } from './palette'
import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('primer')

const PAD = 2
// Rows the stacked topics and section keep however far the divider is dragged.
const MIN_TOC = 3
const MIN_BODY = 3
// The panel plugin's palette: section labels.
const HUD = { label: DEFAULTS.shared.label }

export type Section = { slug: string; heading: string; part: string; body: string }

const TOPIC = /^<!--\s*topic:\s*(\S+?)\s*-->$/

// Any ## or ### outside a fence ends the open section; a ### without a topic line starts none.
export function parse(md: string): Section[] {
  const out: Section[] = []
  const lines = md.replace(/\r/g, '').split('\n')
  let part = ''
  let fence = ''
  let cur: (Section & { lines: string[] }) | undefined
  const close = () => {
    if (cur) out.push({ slug: cur.slug, heading: cur.heading, part: cur.part, body: cur.lines.join('\n').trim() })
    cur = undefined
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const mark = /^\s*(```|~~~)/.exec(line)?.[1]
    if (mark) fence = fence ? (mark === fence ? '' : fence) : mark
    const h = fence || mark ? undefined : /^(##|###) (.*)$/.exec(line)
    if (!h) {
      cur?.lines.push(line)
      continue
    }
    close()
    if (h[1] === '##') part = h[2]!.trim()
    else {
      const slug = TOPIC.exec(lines[i + 1]?.trim() ?? '')?.[1]
      if (slug) {
        cur = { slug, heading: h[2]!.trim(), part, body: '', lines: [] }
        i++
      }
    }
  }
  close()
  return out
}

export function find(sections: Section[], arg: string): { section?: Section; note?: string } {
  const slug = arg.trim().toLowerCase() || 'start'
  const section = sections.find(s => s.slug === slug)
  return section ? { section } : { note: `No topic "${arg.trim()}". Pick one from the list.` }
}

const PANE = 'primer'
const MISSING = 'Guide not found. Read it at https://github.com/HT0710/claudzilla/blob/main/GUIDE.md'
const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

// Markdown in a pane sizes tables to the terminal, not the pane: a table wider than `columns` becomes one line per row.
export function fit(md: string, columns: number): string {
  const lines = md.split('\n')
  const out: string[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) fence = !fence
    if (fence || !lines[i]!.startsWith('|') || !/^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() ?? '')) {
      out.push(lines[i]!)
      continue
    }
    let end = i + 2
    while (lines[end]?.startsWith('|')) end++
    const rows = [lines[i]!, ...lines.slice(i + 2, end)].map(cells)
    const widths = rows[0]!.map((_, c) => Math.max(...rows.map(r => (r[c] ?? '').replace(/`|\*\*/g, '').length)))
    if (widths.reduce((a, w) => a + w + 3, 1) <= columns) out.push(...lines.slice(i, end))
    else out.push(rows.slice(1).map(([first, ...rest]) => `**${first}** — ${rest.join(' · ')}`).join('  \n'))
    i = end - 1
  }
  return out.join('\n')
}

// shortcut: counts rows as the terminal's Markdown wraps them: greedy words a cell narrower than the column, as
// its wrap breaks before some lines a greedy fill keeps; list and quote markers as indent; a table its rows
// plus its borders. Measured on GUIDE.md: never short, up to 3 blank rows past a section's end.
// Upgrade: an engine-reported height for the Markdown element.
export function rows(md: string, columns: number): number {
  const wrap = (text: string, room: number) => {
    let lines = 1
    let used = 0
    for (const word of text.split(' ')) {
      if (used && used + 1 + word.length > room) {
        lines++
        used = 0
      }
      used += (used ? 1 : 0) + word.length
      for (; used > room; used -= room) lines++
    }
    return lines
  }
  let n = 0
  let fence = false
  let table = false
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    const isRow = !fence && line.startsWith('|')
    if (isRow && !table) n += 2
    table = isRow
    if (isRow && /^\|[\s:|-]+\|$/.test(line.trim())) continue
    const marker = fence ? '' : (/^\s*(?:[-*] |\d+\. |> )?/.exec(line)?.[0] ?? '')
    // A code span draws its text as written, ** included; outside one, bold marks and link targets don't draw.
    const plain = (part: string, i: number) => (i % 2 ? part : part.replace(/\*\*|^#+ /g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    const text = (fence ? line : line.slice(marker.length).split('`').map(plain).join('')).trim()
    n += isRow ? 1 : wrap(text, Math.max(1, columns - marker.length - 1))
  }
  return n
}

// The guide lives in the claudzilla clone, found through the update hook it links into ~/.claude (as herald does).
// Prints the toplevel, then the version as the HUD shows it: the last v* tag, or the tag CI cuts next when ahead; empty with no tag.
export const FIND =`f=$(readlink -f "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/claudzilla-update.sh") && [ -f "$f" ] && r=$(git -C "\${f%/*}" rev-parse --show-toplevel) || exit 1
last=$(git -C "$r" describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null)
next=$([ -n "$last" ] && git -C "$r" log --format='%s%n%b' "$last..HEAD" | sh "$r/.github/next-version.sh" "$last")
printf '%s\\n%s\\n' "$r" "\${next:-$last}"`

// `report` alone gives '', `report <text>` the text; any other first word, undefined.
export function reportArgs(args: string): string | undefined {
  const m = /^report(?:\s+([\s\S]*))?$/i.exec(args.trim())
  return m ? (m[1] ?? '').trim() : undefined
}

const EXPERIMENTAL_USAGE = 'Use: /claudzilla experimental [<id> on|off]'

// First word not `experimental`: undefined; bare: {}; `<id> on|off`: that pair; anything else: the usage line.
export function experimentalArgs(args: string): { id?: string; state?: 'on' | 'off'; error?: string } | undefined {
  const [first, ...rest] = args.trim().split(/\s+/)
  if (first?.toLowerCase() !== 'experimental') return undefined
  if (!rest.length) return {}
  const [id, state] = rest
  const s = state?.toLowerCase()
  return rest.length === 2 && (s === 'on' || s === 'off') ? { id, state: s } : { error: EXPERIMENTAL_USAGE }
}

// `cost` is this session, `cost <id>` one session, `cost all ...` the flags for the all-sessions list; the argv after `report`, or the usage line.
const COST_USAGE = 'Use: /claudzilla cost [session-id | all [--since d] [--until d] [--project p]]'
export function costArgs(args: string, sessionId: string): string[] | { error: string } | undefined {
  const [first, ...rest] = args.trim().split(/\s+/)
  if (first?.toLowerCase() !== 'cost') return undefined
  if (!rest.length) return ['--session', sessionId]
  return rest[0]!.toLowerCase() === 'all' ? ['all', ...rest.slice(1)] : rest.length === 1 ? ['--session', rest[0]!] : { error: COST_USAGE }
}

export function featureLines(list: { id: string; description: string; on: boolean }[]): string {
  return list.length ? list.map(f => `${f.id}: ${f.on ? 'on' : 'off'} — ${f.description}`).join('\n') : 'No experimental features.'
}

// The /compact (or /clear) line compact_draft puts in the prompt box: one plain line, no markdown.
export function draft(input: { keep?: unknown; drop?: unknown; clear?: unknown }): string | undefined {
  if (input.clear === true) return '/clear'
  const part = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().replace(/\.+$/, '') : '')
  const keep = part(input.keep)
  const drop = part(input.drop)
  return keep ? `/compact Keep: ${keep}.` + (drop ? ` Drop: ${drop}.` : '') : undefined
}

export type HandoffInput = { sessionId: string; path: string; now: number; numbered: string; draft?: string; summary?: string; intents?: string; git?: string }

type Row = { type?: string; subtype?: string; content?: unknown; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; isCompactSummary?: boolean; message?: { content?: unknown } }
type Block = { type?: string; text?: string; name?: string; input?: Record<string, unknown> }

const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '…' : t)

// A "N:<json>" line; undefined when the JSON is cut off (the first line of a tail) or not a row.
function numberedRow(line: string): { n: number; row: Row } | undefined {
  const i = line.indexOf(':')
  try {
    const row = JSON.parse(line.slice(i + 1)) as Row
    return row && typeof row === 'object' ? { n: Number(line.slice(0, i)), row } : undefined
  } catch {
    return undefined
  }
}

const blocks = (row: Row): Block[] => (Array.isArray(row.message?.content) ? (row.message!.content as Block[]) : [])
const textOf = (row: Row): string => {
  const c = row.message?.content
  return typeof c === 'string' ? c : blocks(row).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
}

// The note a cold session leaves for its successor: built from the transcript tail, no model call.
export function handoffNote(input: HandoffInput): string {
  const rows = input.numbered.split('\n').map(numberedRow).filter((r): r is { n: number; row: Row } => !!r && !r.row.isSidechain)
  let wants: { wants: string; steps: { text?: string; status?: string }[] } | undefined
  let now: unknown
  let away: { n: number; row: Row } | undefined
  const turns: { p: string; reply?: Row }[] = []
  let promptLine = 0
  let housekeeping = false
  const houseLines = new Set<number>()
  for (const { n, row } of rows) {
    if (row.type === 'assistant') {
      if (housekeeping) { houseLines.add(n); continue }
      const cur = turns[turns.length - 1]
      if (textOf(row) && cur && textOf(row).length >= (cur.reply ? textOf(cur.reply).length : 0)) cur.reply = row
      for (const b of blocks(row)) {
        const i = b.input
        if (b.type !== 'tool_use' || !i) continue
        if (b.name === 'mcp__margin__intent') {
          if (typeof i.wants === 'string') { wants = { wants: i.wants, steps: Array.isArray(i.steps) ? i.steps : [] }; now = undefined }
          if (i.now !== undefined) now = i.now
        }
      }
    } else if (row.type === 'user' && !row.isMeta && !row.isCompactSummary) {
      const t = textOf(row).trim()
      if (/<command-message>claudzilla-compact|<command-name>\/compact|^\/compact/.test(t)) housekeeping = true
      else if (t && !t.startsWith('<') && !t.startsWith('[Request interrupted')) { turns.push({ p: t }); promptLine = n; housekeeping = false }
    } else if (row.type === 'user' && row.isCompactSummary) away = undefined
    else if (row.type === 'system' && row.subtype === 'away_summary') away = { n, row }
  }
  // Intent calls from the whole file: the last 5 distinct asks, newest last.
  // shortcut: houseLines covers the 1 MB tail only, so older compact asks still show; grep housekeeping prompts file-wide if they do.
  const asks = new Map<string, number>()
  for (const line of (input.intents ?? '').split('\n')) {
    const r = numberedRow(line)
    for (const b of r?.row.type === 'assistant' ? blocks(r.row) : []) {
      const w = b.name === 'mcp__margin__intent' && b.input?.wants
      if (typeof w === 'string' && w !== wants?.wants && !houseLines.has(r!.n)) { asks.delete(w); asks.set(w, r!.n) }
    }
  }
  const out = [`# Handoff from ${input.sessionId}`, '', `Written ${new Date(input.now).toISOString()}. Resume the old session with \`claude --resume ${input.sessionId}\`. Its transcript: ${input.path}`]
  const add = (heading: string, body: string) => out.push('', `## ${heading}`, '', body)
  if (wants) add('Where we were', [cut(wants.wants, 500), ...wants.steps.slice(0, 20).map(s => `- ${cut(String(s.text ?? ''), 500)}`), ...(now !== undefined ? [`Last step started: ${now}`] : [])].join('\n'))
  if (input.git?.trim()) add('Git', '```text\n' + input.git.trim() + '\n```')
  if (asks.size) add('Earlier asks', [...asks].slice(-5).map(([w, n]) => `- Line ${n}: ${cut(w, 500)}`).join('\n'))
  if (turns.length) {
    const quote = (row: Row) => {
      const t = textOf(row)
      return (t.length > 2000 ? t.slice(0, 800) + '…' + t.slice(-1200) : t).split('\n').map(l => `> ${l}`).join('\n')
    }
    add('Recent turns', turns.slice(-3).map(({ p, reply }) => `- You: ${cut(p, 500)}` + (reply ? `\n\n${quote(reply)}` : '')).join('\n\n'))
  }
  const sum = input.summary && numberedRow(input.summary)
  const since = sum ? sum.n : 0
  if (sum) {
    const t = textOf(sum.row)
    add('Last compact summary', `At line ${sum.n}.\n${t.length > 8000 ? `${t.slice(0, 3000)}…${t.slice(-5000)}\nCut; full text at line ${sum.n}.` : t}`)
  }
  if (away && typeof away.row.content === 'string' && away.n > since) add('Away recap', `At line ${away.n}${away.row.timestamp ? `, ${away.row.timestamp}` : ''}.\n${cut(away.row.content, 2000)}${promptLine > away.n ? '\nOlder than the last prompt; its Next may be done.' : ''}`)
  const d = input.draft && numberedRow(input.draft)
  const call = d && blocks(d.row).find(b => b.type === 'tool_use' && b.name === 'mcp__primer__compact_draft')
  if (d && call?.input && d.n > since) add('Compact draft', `At line ${d.n}${d.row.timestamp ? `, ${d.row.timestamp}` : ''}.\nKeep: ${cut(String(call.input.keep ?? ''), 500)}\nDrop: ${cut(String(call.input.drop ?? ''), 500)}`)
  add('How to dig', [
    'If this note is your whole prompt, say in one line what you loaded, then wait for the user\'s ask.',
    'Check git before saying what is pending. Don\'t restate the last reply.',
    'The Git block was checked when this note was written. Everything else is the old session\'s claim: re-check it before acting on it.',
    'Use this note as is when your ask needs nothing more.',
    'For more detail, `grep -n` or `jq` the old transcript yourself, by line number. Engine compact summaries are rows with `"isCompactSummary":true`. Never Read it whole: it can be over 60 MB. Where Bash is denied, Read with `offset` and `limit` around a line number.',
  ].join('\n'))
  return out.join('\n') + '\n'
}

const COMPACT_SPEC = {
  name: 'compact_draft',
  description: 'Only from the claudzilla-compact skill: puts the drafted /compact (or /clear) line in the prompt box.',
  isDeferred: true,
  inputSchema: {
    type: 'object',
    properties: {
      keep: { type: 'string', description: 'what the compact must keep' },
      drop: { type: 'string', description: 'finished detail to drop' },
      clear: { type: 'boolean', description: 'true: nothing carries over, /clear instead' },
    },
  },
} as const

// command.run rejects inside its own hook, so the skill starts once the hook has returned; a draft in the box if it won't.
async function handOff($: EngineInterface, command: string, args: string) {
  const fill = () => $.prompt.fill({ text: `/${command} ${args}`.trim() }).catch(() => undefined)
  const go = async () => {
    try {
      await $.command.run({ command, args })
    } catch {
      await fill()
    }
  }
  try {
    await Promise.resolve($.clock.after(500, go))
  } catch {
    await fill()
  }
}

// A main-chat turn is running: set by the main chat's turn.start, cleared by the main chat's turn.complete.
let busy = false
// A handoff is written or waiting to run; a second one would clear while the first note's turn runs.
let handing = false

const NUMBERED = `grep -n '' "$1" | tail -c 1000000`
const DRAFT = `grep -n '"type":"tool_use","id":"[^"]*","name":"mcp__primer__compact_draft"' "$1" | tail -1`
const SUMMARY = `grep -n '"isCompactSummary":true' "$1" | tail -1`
const INTENTS = `grep -n '"type":"tool_use","id":"[^"]*","name":"mcp__margin__intent"' "$1" | tail -40`
// $1 is the session cwd; prints nothing outside a git repo.
const GIT = `export GIT_OPTIONAL_LOCKS=0
git -C "$1" rev-parse --git-dir >/dev/null 2>&1 || exit 0
echo "Branch: $(git -C "$1" status -sb | head -1 | cut -c4-)"
echo "HEAD: $(git -C "$1" rev-parse --short HEAD)"
u=$(git -C "$1" log --oneline HEAD --not --remotes)
echo "Commits on no remote: $(printf '%s' "$u" | grep -c .)"
[ -n "$u" ] && printf '%s\n' "$u" | head -10
d=$(git -C "$1" status --porcelain | head -20)
[ -n "$d" ] && printf 'Dirty files:\n%s\n' "$d"
git -C "$1" diff --stat HEAD | tail -1`

// Writes the note for this session, then clears and sends it once the hook has returned (command.run rejects inside its own hook).
async function coldHandoff($: EngineInterface): Promise<{ text: string } | Record<string, never>> {
  if (busy) return { text: 'A turn is running. Run /claudzilla handoff when it ends.' }
  if (handing) return { text: 'A handoff is already running.' }
  handing = true
  try {
    return await writeHandoff($)
  } catch (err) {
    handing = false
    throw err
  }
}

async function writeHandoff($: EngineInterface): Promise<{ text: string } | Record<string, never>> {
  const home = await $.env.get('HOME').catch(() => undefined)
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${home}/.claude`
  const sessionId = await $.session.id()
  const found = await $.process.run(['find', `${dir}/projects`, '-maxdepth', '2', '-name', `${sessionId}.jsonl`]).catch(() => undefined)
  const path = found?.stdout.split('\n')[0]
  if (!path) {
    handing = false

    return { text: 'No transcript for this session yet, so there is nothing to hand off.' }
  }
  const grep = async (script: string) => (await $.process.run(['sh', '-c', script, 'sh', path]).catch(() => undefined))?.stdout ?? ''
  const cwd = await $.session.cwd().catch(() => '')
  const git = async () => (cwd ? (await $.process.run(['sh', '-c', GIT, 'sh', cwd]).catch(() => undefined))?.stdout ?? '' : '')
  const [numbered, draft, summary, intents, gitOut] = await Promise.all([grep(NUMBERED), grep(DRAFT), grep(SUMMARY), grep(INTENTS), git()])
  const file = `${dir}/claudzilla-handoff/${sessionId}.md`
  let note: string
  try {
    note = handoffNote({ sessionId, path, now: await $.clock.now(), numbered, draft: draft.trim() || undefined, summary: summary.trim() || undefined, intents, git: gitOut.trim() || undefined })
    await $.process.run(['sh', '-c', 'mkdir -p "$1" && chmod 700 "$1"', 'sh', `${dir}/claudzilla-handoff`])
    await $.fs.write(file, note)
  } catch (err) {
    $.ui.toast(`Handoff note not written: ${err instanceof Error ? err.message : String(err)}`)
    handing = false

    return {}
  }
  const lost = () => $.ui.toast(`Note is at ${file}. Type @${file}.`)
  const go = async () => {
    if (busy) {
      handing = false

      return $.ui.toast('A turn is running. Run /claudzilla handoff when it ends.')
    }
    try {
      try {
        await $.command.run({ command: 'clear' })
      } catch {
        return lost()
      }
      // Inline, because a plugin's prompt does not expand @file.
      const sent = await $.prompt.submit({ text: note, asUser: true }).then(r => !r.drop, () => false)
      if (sent) return
      const { isFilled } = await $.prompt.fill({ text: `@${file} ` }).catch(() => ({ isFilled: false }))
      if (!isFilled) lost()
    } finally {
      handing = false
    }
  }
  try {
    await Promise.resolve($.clock.after(500, go))
  } catch {
    handing = false
    lost()
  }

  return {}
}

// Filled once the turn ends: the box may not take text while a turn runs.
let pending: string | undefined

type Guide = { version?: string; sections?: Section[]; repo?: string }

let guide: Promise<Guide> | undefined
let slug = 'start'
let note: string | undefined
// Set by /claudzilla: the next draw scrolls the topics to the shown one. Drawing can't write `tocTop`, so the row
// it picks waits in `pinned` until the wheel moves the topics from there.
let reveal = false
let pinned: number | undefined
// The first row the topics and the section show, as the wheel moved them; the rows the topics take when
// stacked, as the divider was dragged, -1 until it is.
const tocTop = atom({ plugin: 'primer', key: 'tocTop' } as const, 0)
const bodyTop = atom({ plugin: 'primer', key: 'bodyTop' } as const, 0)
const split = atom({ plugin: 'primer', key: 'split' } as const, -1)
// The pane as last drawn: the wheel left of `tocColumns` (beside) or on rows `tocFrom` to `tocTo` (stacked)
// scrolls the topics up to `tocEnd`; anywhere else, and the keys, the section up to `bodyEnd`.
let zones: { tocColumns: number; tocFrom: number; tocTo: number; tocEnd: number; bodyEnd: number } | undefined

async function load($: EngineInterface): Promise<Guide> {
  const found = await $.process.run(['sh', '-c', FIND]).catch(() => undefined)
  const [repo, version] = found?.exitCode === 0 ? found.stdout.split('\n') : []
  if (!repo) return {}
  const md = await $.fs.read(`${repo}/GUIDE.md`).catch(() => undefined)
  return { repo, version: version || undefined, sections: md === undefined ? undefined : parse(md) }
}

// Key names only, dotted: values may be private.
const keyNames = (v: unknown, prefix = ''): string[] =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => keyNames(x, prefix + k + '.')) : prefix ? [prefix.slice(0, -1)] : []

// Every source is optional: one that fails leaves its field out.
async function snapshot($: EngineInterface, columns: number | undefined) {
  const run = async (argv: string[]) => {
    const r = await $.process.run(argv).catch(() => undefined)
    return r?.exitCode === 0 ? r.stdout.trim() : undefined
  }
  const sh = (cmd: string) => run(['sh', '-c', cmd])
  const home = await $.env.get('HOME').catch(() => undefined)
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${home}/.claude`
  const json = async (name: string) => JSON.parse(await $.fs.read(`${dir}/${name}`)) as Record<string, unknown>
  const g = await (guide ??= load($)).catch(() => ({}) as Guide)
  const git = (...args: string[]) => (g.repo ? run(['git', '-C', g.repo, ...args]) : Promise.resolve(undefined))
  const [commit, branch, status, os, node, size, version, settings, overrides, config] = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('branch', '--show-current'),
    git('status', '--porcelain'),
    sh('uname -sr'),
    sh('node -v'),
    sh('stty size </dev/tty'),
    $.session.version().catch(() => undefined),
    json('settings.json').catch(() => undefined),
    json('settings.overrides.json').catch(() => undefined),
    json('claudzilla.json').catch(() => undefined),
  ])
  const rowCount = Number(size?.split(' ')[0])
  return {
    version: g.version,
    commit,
    branch,
    dirty: status === undefined ? undefined : status !== '',
    claudeCode: version?.version,
    os,
    node,
    columns,
    rows: rowCount > 0 ? rowCount : undefined,
    // shortcut: $.ui.panes() lists only this plugin's panes, so it is not the whole screen; upgrade when the API lists all.
    panes: (await $.ui.panes().catch(() => [])).map(p => p.id),
    mods: Object.entries((settings?.enabledPlugins as Record<string, unknown> | undefined) ?? {}).filter(([k, v]) => v && k.endsWith('@claudzilla')).map(([k]) => k),
    overrideKeys: overrides && keyNames(overrides),
    configKeys: config && keyNames(config),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    handing = false
    await t.start(traceIo($))
    HUD.label = (await readPalette($)).palette.shared.label
    await $.command.register({ name: 'claudzilla', description: 'The claudzilla guide, one section at a time', argumentHint: '[topic | report [what happened] | compact | handoff | experimental [id on|off] | cost [session-id | all [--since d] [--until d] [--project p]]]', immediate: true })
    await $.command.register({ name: 'claudzilla-handoff', description: 'Start fresh with a note from this session', immediate: true })
    await $.tool.register(COMPACT_SPEC).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))

    return next(e)
  })

  on('turn.start', async (_, e, next) => {
    if (!e.agentId) busy = true

    return next(e)
  })

  // Answered here, in place of next: core would ask permission for a tool only this skill calls.
  on('tool.call', { tool: /^mcp__primer__compact_draft$/ }, async (_, e) => {
    const input = e as unknown as { keep?: unknown; drop?: unknown; clear?: unknown; agentId?: string }
    if (input.agentId !== undefined) return { result: 'ok' }
    pending = draft(input)
    t.event('compact.draft', { drafted: !!pending, clear: input.clear === true })

    return { result: pending ? 'Filled into the prompt box when this turn ends.' : 'Nothing to draft: pass keep, or clear: true.' }
  })

  // The draft shows in the prompt box, not as a chat row.
  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, async ($, e, next) => {
    if (e.props.tool !== 'mcp__primer__compact_draft') return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) busy = false
    if (pending === undefined || e.agentId) return result
    const text = pending
    pending = undefined
    const { isFilled } = await $.prompt.fill({ text }).catch(() => ({ isFilled: false }))
    if (!isFilled) $.ui.toast('The prompt box did not take it.')

    return result
  })

  on('session.end', async ($, e, next) => {
    await t.flush(traceIo($))

    return next(e)
  })

  on('command.run', { command: ['claudzilla', 'claudzilla-handoff'] }, async ($, e) => {
    if (e.command === 'claudzilla-handoff' || /^handoff$/i.test(e.args.trim())) return coldHandoff($)
    const description = reportArgs(e.args)
    if (description !== undefined) {
      t.event('report.snapshot', await snapshot($, e.presentation?.columns).catch(() => ({})))
      await t.flush(traceIo($))
      await handOff($, 'claudzilla-report', description)

      return {}
    }
    const lab = experimentalArgs(e.args)
    if (/^compact$/i.test(e.args.trim())) {
      await handOff($, 'claudzilla-compact', '')

      return {}
    }
    // Bare, it toggles like /margin (alt+q); a topic opens that topic either way.
    if (!e.args.trim() && (await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return {}
    }
    let labNote: string | undefined
    const cost = costArgs(e.args, await $.session.id().catch(() => ''))
    if (cost && !Array.isArray(cost)) labNote = cost.error
    else if (cost) {
      const home = await $.env.get('HOME').catch(() => undefined)
      const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${home}/.claude`
      const cwd = await $.session.cwd().catch(() => '')
      const out = await $.process.run(['node', `${dir}/hooks/cost-trace.mjs`, 'report', ...cost, '--cwd', cwd]).catch(() => undefined)
      labNote = out?.exitCode === 0 ? out.stdout.trimEnd() : out?.stderr.trim() || 'Could not read the cost log.'
    }
    if (lab) {
      const home = await $.env.get('HOME').catch(() => undefined)
      const dir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) || `${home}/.claude`
      const script = (...argv: string[]) => $.process.run(['node', `${dir}/hooks/experimental.mjs`, ...argv]).catch(() => undefined)
      const lines: string[] = []
      if (lab.error) lines.push(lab.error)
      else if (lab.id && lab.state) {
        const set = await script('--set', lab.id, lab.state)
        lines.push(set?.exitCode === 0 ? `${lab.id} ${lab.state}. Applies from the next session or after /clear.` : (set?.stderr.trim() || 'Could not write the setting.'))
      }
      const listed = await script('--list')
      try {
        if (listed?.exitCode !== 0) throw new Error()
        lines.push(featureLines(JSON.parse(listed.stdout)))
      } catch {
        lines.push('Experimental features need the claudzilla core install.')
      }
      labNote = lines.join('\n')
    }
    // Read again on each run: GUIDE.md changes with the clone.
    guide = load($)
    const { sections } = await guide
    const hit = find(sections ?? [], lab ? 'labs' : cost ? 'limits' : e.args)
    if (hit.section) slug = hit.section.slug
    note = labNote ?? hit.note
    if (hit.section) await update($, bodyTop, () => 0)
    reveal = true
    const opened = await $.ui.open({ id: PANE, title: 'Guide', focus: true, closeOnEscape: true })
    if (!opened.isPlaced) $.ui.toast('Guide waits: terminal too narrow.')
    $.ui.invalidate('ui.render')

    return {}
  })

  // The wheel scrolls the zone under it, not the pane; the keys, with no pointer, the section.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const z = zones
    if (!z) return next(e)
    const p = e.pointer
    const overToc = p && (z.tocColumns ? p.column < z.tocColumns && p.row >= z.tocFrom : p.row >= z.tocFrom && p.row < z.tocTo)
    if (overToc) {
      const from = pinned
      pinned = undefined
      await update($, tocTop, top => Math.max(0, Math.min(Math.min(from ?? top, z.tocEnd) + e.by, z.tocEnd)))
    }
    else await update($, bodyTop, top => Math.max(0, Math.min(Math.min(top, z.bodyEnd) + e.by, z.bodyEnd)))

    return {}
  })

  // The stacked divider, dragged: the topics take that many rows; the render clamps it to the pane.
  on('ui.message', async ($, e, next) => {
    const rows = (e.data as { split?: unknown } | undefined)?.split
    if (e.requestId !== PANE || e.element !== 'divider' || typeof rows !== 'number') return next(e)
    await update($, split, () => Math.max(0, rows))

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    // A reload with the pane open drops the module's read.
    const { version, sections } = await (guide ??= load($))
    const header = (
      <Box width={e.props.bodyColumns - 2 * PAD} justifyContent="space-between">
        <Text bold color={HUD.label}>claudzilla</Text>
        {version ? <Text bold color={HUD.label}>{version}</Text> : null}
      </Box>
    )
    if (!sections?.length) {
      zones = undefined
      return (
        <Box flexDirection="column">
          {header}
          <Text>{MISSING}</Text>
        </Box>
      )
    }
    const current = sections.find(s => s.slug === slug) ?? sections[0]
    const pick = async (to: string) => {
      slug = to
      note = undefined
      await update($, bodyTop, () => 0)
      $.ui.invalidate('ui.render')
    }
    const tocWidth = Math.max(...sections.map(s => s.heading.length)) + 2 + PAD
    // A row is its cell wide, or the pane's width in a pane too narrow for it, cut with an ellipsis: wrapped, a
    // row takes two lines the list counts as one. Cut here, as a Button wraps its Text whatever `wrap` says.
    const cell = Math.min(tocWidth - PAD, e.props.bodyColumns - 2 * PAD)
    const row = (heading: string) => (heading.length + 2 > cell ? `  ${heading}`.slice(0, Math.max(0, cell - 1)) + '…' : `  ${heading}`.padEnd(cell))
    // Select options can't be disabled, so part names can't sit among them: a Button per topic under part labels.
    // The topic shown is no Button, lit across its cell as the panel's current tab is; the others pad to the cell,
    // as a Button lights and presses as wide as it draws. One element per row, so
    // the zone scrolls by slicing them; a blank row before each part but the first.
    const list = sections.flatMap((s, i) => [
      ...(s.part && s.part !== sections[i - 1]?.part
        ? [
            ...(i ? [<Box key={`gap:${s.part}`}><Text> </Text></Box>] : []),
            <Box key={`part:${s.part}`}>
              <Text bold color={HUD.label}>{s.part.toUpperCase()}</Text>
            </Box>,
          ]
        : []),
      s === current ? (
        <Box key={`topic:${s.slug}`}>
          <Text bold inverse color="claude">{row(s.heading)}</Text>
        </Box>
      ) : (
        <Button key={`topic:${s.slug}`} plain onPress={() => pick(s.slug)}>
          <Text>{row(s.heading)}</Text>
        </Button>
      ),
    ])
    const beside = e.props.bodyColumns - 2 * PAD - tocWidth >= 40
    const sectionColumns = beside ? e.props.bodyColumns - 2 * PAD - tocWidth - PAD - 1 : e.props.bodyColumns - 2 * PAD
    // Markdown stretches tables to its own width, not the box: beside the topics every table is a list.
    const text = current ? fit(`### ${current.heading}\n\`/claudzilla ${current.slug}\`\n\n${current.body}`, beside ? 0 : sectionColumns) : ''
    // Rows under the header, its rule and the note. Beside, both zones take them all; stacked, the topics
    // take what they need up to half, or what the divider was dragged to, 3 rows at least; the section the rest
    // under the divider, 3 rows at least, ahead of the topics' 3 in a pane too short for both.
    const noteRows = note ? rows(note, e.props.bodyColumns - 2 * PAD) : 0
    const free = Math.max(2, e.props.scroll.bodyRows - 2 - noteRows)
    const dragged = await read($, split)
    const mostToc = Math.max(0, free - 1 - MIN_BODY)
    const tocRows = beside ? free : Math.min(Math.max(MIN_TOC, dragged >= 0 ? dragged : Math.min(list.length, Math.ceil((free - 1) / 2))), mostToc)
    const bodyRows = beside ? free : free - 1 - tocRows
    const tocEnd = Math.max(0, list.length - tocRows)
    const bodyEnd = Math.max(0, rows(text, sectionColumns) - bodyRows)
    // Clamped here too: the pane shrinks, or the divider grows a zone, after the wheel moved it.
    let tocFrom = Math.min(pinned ?? (await read($, tocTop)), tocEnd)
    // The shown topic's row in `list`: a label row per part up to it, and a blank row before each but the first.
    const shown = current ? sections.indexOf(current) : -1
    const parts = sections.slice(0, shown + 1).filter((s, i) => s.part && s.part !== sections[i - 1]?.part).length
    const at = shown + 2 * parts - (parts ? 1 : 0)
    if (reveal && shown >= 0 && (at < tocFrom || at >= tocFrom + tocRows)) {
      tocFrom = pinned = Math.min(at < tocFrom ? at : at - tocRows + 1, tocEnd)
    }
    reveal = false
    const bodyFrom = Math.min(await read($, bodyTop), bodyEnd)
    const top = 2 + noteRows
    zones = { tocColumns: beside ? PAD + tocWidth : 0, tocFrom: top, tocTo: top + tocRows, tocEnd, bodyEnd }
    const topics = (
      <Box key="topics" flexDirection="column" flexShrink={0} width={beside ? tocWidth : undefined} height={tocRows} overflow="hidden">
        {list.slice(tocFrom, tocFrom + tocRows)}
      </Box>
    )
    // Box borders draw all four sides: beside, the divider is a column of │ the zones' height. Stacked, the
    // panel's draggable rule; only the terminal and desktop draw a Client, elsewhere the rule stays put.
    const divider = beside ? (
      <Box key="divider" position="absolute" left={tocWidth} top={0} width={1}>
        <Text color="promptBorder">{Array(free).fill('│').join('\n')}</Text>
      </Box>
    ) : Client ? (
      <Client key="divider" module="./divider.tsx" props={{ split: tocRows, most: mostToc }} height={1} />
    ) : (
      <Box key="divider">
        <Text color="promptBorder">{'─'.repeat(Math.max(0, sectionColumns))}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Box paddingX={PAD}>{header}</Box>
        <Box paddingX={PAD / 2}>
          <Text color="promptBorder">{'─'.repeat(Math.max(0, e.props.bodyColumns - PAD))}</Text>
        </Box>
        <Box flexDirection="column" paddingX={PAD}>
          {note ? <Text color="warning">{note}</Text> : null}
          <Box key="layout" flexDirection={beside ? 'row' : 'column'}>
            {topics}
            {beside ? null : divider}
            <Box key="section" flexDirection="column" flexGrow={1} paddingLeft={beside ? PAD + 1 : 0} height={bodyRows} overflow="hidden">
              <Box key="text" flexDirection="column" flexShrink={0} marginTop={-bodyFrom}>
                {current ? <Markdown text={text} /> : null}
              </Box>
            </Box>
            {beside ? divider : null}
          </Box>
        </Box>
      </Box>
    )
  })
}
