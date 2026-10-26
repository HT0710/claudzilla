import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('primer')

const PAD = 2
// Rows the stacked topics and section keep however far the divider is dragged.
const MIN_TOC = 3
const MIN_BODY = 3
// The panel plugin's palette: section labels.
const HUD = { label: '#a396d2' }

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

// The guide lives in the claudzilla clone, found through the update hook it links into ~/.claude (as update-toast does).
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

// The /compact (or /clear) line compact_draft puts in the prompt box: one plain line, no markdown.
export function draft(input: { keep?: unknown; drop?: unknown; clear?: unknown }): string | undefined {
  if (input.clear === true) return '/clear'
  const part = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().replace(/\.+$/, '') : '')
  const keep = part(input.keep)
  const drop = part(input.drop)
  return keep ? `/compact Keep: ${keep}.` + (drop ? ` Drop: ${drop}.` : '') : undefined
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
    await t.start(traceIo($))
    await $.command.register({ name: 'claudzilla', description: 'The claudzilla guide, one section at a time', argumentHint: '[topic | report [what happened] | compact]', immediate: true })
    await $.tool.register(COMPACT_SPEC).catch(() => undefined)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))

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

  on('command.run', { command: 'claudzilla' }, async ($, e) => {
    const description = reportArgs(e.args)
    if (description !== undefined) {
      t.event('report.snapshot', await snapshot($, e.presentation?.columns).catch(() => ({})))
      await t.flush(traceIo($))
      await handOff($, 'claudzilla-report', description)

      return {}
    }
    if (/^compact$/i.test(e.args.trim())) {
      await handOff($, 'claudzilla-compact', '')

      return {}
    }
    // Bare, it toggles like /panel (alt+g); a topic opens that topic either way.
    if (!e.args.trim() && (await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return {}
    }
    // Read again on each run: GUIDE.md changes with the clone.
    guide = load($)
    const { sections } = await guide
    const hit = find(sections ?? [], e.args)
    if (hit.section) slug = hit.section.slug
    note = hit.note
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
