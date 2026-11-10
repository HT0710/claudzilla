import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AgentRow, Modal, Spawn, Step, Take } from '../types'
import { printable } from './git-data'
import { BAR_ROWS, DIMMED, EMPTY_INTENT, EMPTY_OVERVIEW, EMPTY_USED, HUD, LIT, PAD, PILL_CAPS, SCOPE, TYPES, USE_KINDS, card as kitCard, clock, counted, cues, drawLayer, emptyNote, fade, fadeBg, fit, heading, kv as kitKv, modalFrame, modalZone, row as kitRow, rowHovers, toPieces, zoneWindow } from './kit'
import type { Layer, LayerCtx, Piece, RowCtx, TabCtx, TabDraw, UseKind, Zone } from './kit'

const intent = atom({ plugin: 'margin', key: 'intent' } as const, EMPTY_INTENT)
const overview = atom({ plugin: 'margin', key: 'overview' } as const, EMPTY_OVERVIEW)
const spawns = atom({ plugin: 'margin', key: 'spawns' } as const, [] as Spawn[])
const expanded = atom({ plugin: 'margin', key: 'expanded' } as const, -1)
const used = atom({ plugin: 'margin', key: 'used' } as const, EMPTY_USED)
const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)
const stepsTop = atom({ plugin: 'margin', key: 'stepsTop' } as const, 0)
const stepsFollow = atom({ plugin: 'margin', key: 'stepsFollow' } as const, true)
const rowPointer = atom({ plugin: 'margin', key: 'rowPointer' } as const, { left: null, at: null } as { left: string | null; at: string | null })

// The name a USED row shows for a full value.
export const shortName = (kind: UseKind, name: string, source?: string): string => {
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (kind === 'files') return base
  if (kind === 'memory') return base.replace(/\.md$/, '')
  if (kind === 'web' && source !== 'search') {
    try {
      return new URL(name).host
    } catch {
      return name
    }
  }
  return name
}

// The top STEPS last drew, kept once the run ends and no step is in progress; a new prompt clears it.
let stepsHeld: number | undefined
export function resetStepsHeld() {
  stepsHeld = undefined
}

const STEP_WORD: Record<Step['status'], string> = { completed: 'done', in_progress: 'working', pending: 'not started' }
const AGENT_WORD: Record<AgentRow['status'], string> = { completed: 'done', pending: 'not started', planned: 'not started', running: 'running', waiting: 'waiting', idle: 'idle', failed: 'failed', killed: 'stopped' }
// A STEPS row: a step or agent with its card, or a fold toggle.
type StepLine = { key?: string; left?: JSX.Element[]; word?: string; mark?: string; node?: JSX.Element }

const WORKING = ['running', 'waiting', 'idle']
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
// Agents under each step: by the description Claude listed, never by position, as a redraft reorders steps.
// An earlier turn's agent fills a listed entry only while it works: a finished one would show old work as new.
export const hang = (steps: Step[], spawns: Spawn[], turn: number): AgentRow[][] => {
  const left = spawns.filter(one => one.turn === turn || (one.turn < turn && WORKING.includes(one.status)))
  const rows = steps.map(step =>
    (step.agents ?? []).map(description => {
      const i = left.findIndex(one => same(one.description, description))
      if (i < 0) return { description, status: 'planned' as const }
      const [one] = left.splice(i, 1)
      return { id: one.id, description: one.description, status: one.status }
    }),
  )
  const current = steps.findIndex(step => step.status === 'in_progress')
  for (const one of left.filter(one => one.turn === turn)) {
    const at = steps.findIndex(step => step.text === one.step)
    rows[at >= 0 ? at : current >= 0 ? current : steps.length - 1]?.push({ id: one.id, description: one.description, status: one.status })
  }
  return rows
}

const LABEL_CARD = {
  SESSION: 'What this chat is about, summed up from your prompts',
  TOPIC: 'What your latest prompts are about; show all lists every topic',
  ASK: "What you asked this turn, in Claude's words",
  TAKE: "Claude's view of the ask before working",
  PLAN: 'The steps Claude set for this turn, and their progress',
  USED: 'What Claude read this turn; press a row to list it',
}
type Label = keyof typeof LABEL_CARD

// The lines a text takes wrapped at w: words packed greedily, one past the width broken, as Text wraps.
// shortcut: counts characters, not cells; CJK and emoji take two, so the count runs short. Upgrade: string-width.
export const wrapLines = (text: string, w: number): string[] =>
  text.split('\n').flatMap(para => {
    const lines: string[] = []
    let cur = ''
    for (const word of para.split(' ')) {
      if (cur.length + (cur ? 1 : 0) + word.length <= w) cur = cur ? `${cur} ${word}` : word
      else {
        if (cur) lines.push(cur)
        let rest = word
        for (; rest.length > w; rest = rest.slice(w)) lines.push(rest.slice(0, w))
        cur = rest
      }
    }
    return [...lines, cur]
  })

export type OverviewCtx = TabCtx & {
  // The agent whose transcript the main view shows; read when drawn and when pressed.
  viewing: () => string | undefined
  // A skill's SKILL.md as its prompt reported it.
  skillPath: (name: string) => string | undefined
}

export async function draw($: EngineInterface, ctx: OverviewCtx): Promise<TabDraw> {
  const { Box, Button, Link, Text } = ctx.el
  const { props } = ctx
  const drawn: Zone[] = []
  const shown = await read($, intent)
  const about = await read($, overview)
  const sparks = await read($, spawns)
  const agentRows = hang(shown.steps, sparks, shown.turn ?? -1)
  const open = await read($, expanded)
  const modalNow = await read($, modal)
  const usedNow = await read($, used)
  const usedShown = shown.waiting ? (usedNow.last ?? {}) : usedNow.kinds
  const width = props.bodyColumns - 2 * PAD
  // Only the first read builds the list; every later one updates the topics shown.
  const readSlot = about.running ? (about.topics.length ? 'updating…' : 'reading…') : about.failed ? 'update failed' : ''
  const done = shown.steps.filter(step => step.status === 'completed').length
  // Ended with every step closed: an answer; else interrupted or failed, as Claude left it.
  // Working is lit as History lights the prompt in view; done is the branch row's green; stopped Git's dirty amber.
  // Waiting on agents takes plan mode's teal: the theme's other blues are working and the tabs.
  const [state, stateColor] = !shown.ended
    ? shown.agents
      ? [`◌ waiting on ${shown.agents} agent${shown.agents === 1 ? '' : 's'}`, 'planMode']
      : shown.waiting
        ? ['◐ planning…', 'claude']
        : ['● working', 'claude']
    : done === shown.steps.length
      ? [`✓ done ${clock(shown.at)}`, HUD.action]
      : [`■ stopped ${clock(shown.at)}`, HUD.dirty]
  const MARK = { completed: '✓', in_progress: '●', pending: '○' }
  // The marks scan as progress on their own; done text stays readable, a step back; the current step is lit.
  // Last turn's report, waiting on this turn's, is dimmed whole.
  const MARK_SHADE = { completed: HUD.action, in_progress: 'claude', pending: HUD.faint }
  const TEXT_SHADE = { completed: SCOPE, in_progress: 'claude', pending: undefined }
  // An agent marks as its step would: working lit, not started faint, ended its outcome; ended text a step back.
  const AGENT_MARK: Record<AgentRow['status'], [string, string]> = {
    planned: ['○', HUD.faint], pending: ['◌', HUD.faint], running: ['◌', 'claude'], waiting: ['◌', 'claude'], idle: ['◌', 'claude'],
    completed: ['✓', HUD.action], failed: ['✗', TYPES.fix], killed: ['■', HUD.dirty],
  }
  // fine is done's green, concern the warning amber, against failed's red, unsure the faint of pending.
  const TAKE_MARK: Record<Take['stance'], [string, string]> = {
    fine: ['✓', HUD.action], concern: ['!', 'warning'], against: ['✗', TYPES.fix!], unsure: ['?', HUD.faint],
  }
  const agentText = (status: AgentRow['status']) => (WORKING.includes(status) ? undefined : status === 'planned' || status === 'pending' ? HUD.faint : SCOPE)
  const shade = (color?: string) => (shown.waiting ? HUD.faint : color)
  const count = (text: string) => (shown.waiting ? text : counted(ctx.el, text))
  const hasAbout = about.topics.length > 0 || about.running || !!about.failed
  const hasReport = !!(shown.wants || shown.waiting || shown.ended)
  // The tab body the modal sits in, under the tabs and their rule.
  const tabRows = props.scroll.bodyRows - 2 - BAR_ROWS
  const LABEL = 7
  const USED_LINE = 100000
  // A step or agent row is a row Client; its card shows on hover, as the Git tab's rows do.
  const hv = rowHovers.Overview
  const topicsOpen = modalNow?.key === 'topics' && about.topics.length > 0
  const usedKind = modalNow?.key === 'used' ? modalNow.kind : undefined
  const usedEntry = usedKind && usedShown[usedKind]
  // Dim behind what is drawn: a stored modal with nothing to show is not open.
  const dimmed = topicsOpen || !!(usedKind && usedEntry)
  // Every read before the hover state clears: a press or a second draw in an await would find it empty.
  const pointer = await read($, rowPointer)
  const following = await read($, stepsFollow)
  const storedSteps = await read($, stepsTop)
  const cwd = usedEntry ? await $.session.cwd().catch(() => '') : ''
  const home = usedEntry ? await $.env.get('HOME').catch(() => undefined) : undefined
  const spans = hv.spans
  hv.spans = {}
  hv.acts = {}
  hv.lines = {}
  const gone = pointer.left && spans[pointer.left]
  const cards: JSX.Element[] = []
  const upOf = (at: number, n: number) => at + 4 + n > tabRows
  const rc: RowCtx = { el: ctx.el, hover: hv, dimmed, pointer, gone: gone || undefined, cards, columns: props.bodyColumns, cardWidth: Math.floor(props.bodyColumns * 0.75), up: upOf }
  const acts: Record<string, () => unknown> = {}
  // Behind a modal only the open row acts: its press closes it.
  hv.acts = dimmed ? (usedKind ? { [`o:used:${usedKind}`]: () => ctx.setModal(() => null) } : {}) : acts
  const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
  const view = async (id?: string) => {
    const shown = await $.ui.view(id && ctx.viewing() !== id ? { agentId: id } : {})
    if (shown.deny) $.ui.toast(shown.deny)
  }
  // A line a label card dims: nested, it follows the card's group but cannot heat it, so only the word does.
  const dimText = (hover: object | undefined, color: string | undefined, children: JSX.Children, wrap?: 'wrap') => (
    <Text wrap={wrap} color={color}>
      <Text color={color} hover={hover}>{children}</Text>
    </Text>
  )
  // Purple inline label, the text wrapping under itself.
  const labelled = (label: string, text: string, color?: string, hover?: object) => (
    <Box key={label}>
      {/* A fixed column: beside wrapping text, a padded label shrank and lost its gap. */}
      <Box width={LABEL} flexShrink={0}>
        {labelWord(label as Label)}
      </Box>
      {dimText(hover, color, count(text), 'wrap')}
    </Box>
  )
  // A part after ASK opens under a rule from the text column to the edge.
  const partRule = (label: string, start: number) => (
    <Box key={`rule:${label}`} paddingLeft={LABEL}>
      {dimText(dimFor(start), 'promptBorder', '─'.repeat(Math.max(0, width - LABEL)))}
    </Box>
  )
  const wrapRows = (text: string, w: number) => wrapLines(text, w).length
  const take = shown.take
  const takeText = take ? `${TAKE_MARK[take.stance][0]} ${fit(take.label, 16)}${take.why ? `: ${take.why}` : ''}` : ''
  // ASK and TAKE as wrapped: the divider goes no lower than TAKE's last row over the footer.
  const reportRows = wrapRows(shown.wants, Math.max(1, width - LABEL)) + (take ? 1 + wrapRows(takeText, Math.max(1, width - LABEL)) : 0)
  // TOPIC shows the latest topic; "show all" opens the rest in a modal, newest first.
  const latest = about.topics.at(-1)
  const latestRows = latest ? wrapRows(latest, Math.max(1, width - 2)) : 0
  // SESSION over TOPIC: its header, the summary cut at 4 rows (15 words ask for 2), a rule.
  const summaryRows = about.summary && hasAbout ? Math.min(4, wrapRows(about.summary, Math.max(1, width - 2))) : 0
  const sessionRows = summaryRows && 2 + summaryRows
  const zoned = !!shown.wants && hasAbout
  const layers: { m?: Layer; s?: Layer } = {}
  const lc: LayerCtx = { el: ctx.el, layers, setModal: change => ctx.setModal(change) }
  const topicsModal = () => {
    const w = Math.max(1, modalFrame(props.bodyColumns, tabRows, 0).width - 4 - 3)
    const items = [...about.topics].reverse().map(topic => wrapLines(topic, w))
    const rows = items.flatMap((lines, i) =>
      lines.map((line, j) => {
        const last = i === items.length - 1
        const glyph = j ? (last ? '  ' : '│ ') : last ? '└ ' : '├ '
        return (
          <Text>
            <Text color="promptBorder">{` ${glyph}`}</Text>
            <Text color={i === 0 ? 'claude' : undefined}>{line}</Text>
          </Text>
        )
      }),
    )
    const f = modalFrame(props.bodyColumns, tabRows, 5 + rows.length)
    return drawLayer($, lc, 'm', f, { top: f.top, left: f.left - PAD }, [], [heading(ctx.el, 'TOPICS', <Text color={HUD.faint}>{`${about.topics.length} total`}</Text>)], rows, modalNow!.top)
  }
  const usedModal = (kind: UseKind, entry: NonNullable<typeof usedEntry>) => {
    const { names: recent, fromAgents = [], agentOf = {}, sourceOf = {} } = entry
    // Claude's own names first, agents' after, each newest first.
    const names = [...recent.filter(n => !fromAgents.includes(n)), ...recent.filter(n => fromAgents.includes(n))]
    const hintOf = (name: string) => {
      const one = agentOf[name] && sparks.find(s => s.id === agentOf[name])
      return [one && fit(printable(one.name ?? (one.type ?? '').replace(/^[^:]+:/, '')), 14), sourceOf[name]].filter(Boolean).join('  ')
    }
    const inner = modalFrame(props.bodyColumns, tabRows, 0).width - 4
    const rows = names.map((name, i) => {
      const glyph = i === names.length - 1 ? '└ ' : '├ '
      const hint = hintOf(name)
      const room = Math.max(1, inner - 3 - (hint ? hint.length + 2 : 0))
      const text = printable(name)
      // Path or URL pieces: a folder or path part SCOPE, every slash the border colour.
      const parts = (segs: string[], tone: (i: number) => string | undefined) =>
        segs.flatMap((seg, k) => [
          ...(k ? [<Text key={`/${k}`} color="promptBorder">/</Text>] : []),
          ...(seg ? [<Text key={`s${k}`} color={tone(k)}>{seg}</Text>] : []),
        ])
      let pieces: JSX.Element[] = [<Text>{text}</Text>]
      if (kind === 'files') {
        const rel = cwd && text.startsWith(`${cwd}/`) ? text.slice(cwd.length + 1) : home && text.startsWith(`${home}/`) ? `~/${text.slice(home.length + 1)}` : text
        const cut = rel.length > room ? `…${rel.slice(1 - room)}` : rel
        const segs = cut.split('/')
        pieces = parts(segs, k => (k < segs.length - 1 ? SCOPE : undefined))
      } else if (kind === 'memory') {
        pieces = [<Text>{shortName('memory', text)}</Text>]
      } else if (kind === 'web' && sourceOf[name] !== 'search') {
        const rest = text.replace(/^https?:\/\//, '')
        const q = rest.search(/[?#]/)
        const segs = (q < 0 ? rest : rest.slice(0, q)).split('/')
        pieces = [...parts(segs, k => (k ? SCOPE : undefined)), ...(q < 0 ? [] : [<Text color={HUD.faint}>{rest.slice(q)}</Text>])]
      }
      const main = <Text wrap="truncate-end">{pieces}</Text>
      const path = kind === 'skills' ? ctx.skillPath(name) : kind === 'files' || kind === 'memory' ? name : undefined
      const web = kind === 'web' && sourceOf[name] !== 'search'
      if (path && !web && Client) {
        const key = `o:m:use:${i}`
        hv.acts[key] = () => $.margin.show({ path, line: 1 })
        const left = toPieces([<Text color="promptBorder">{` ${glyph}`}</Text>, ...pieces])
        return (
          // Keyed, its own hover scope: unkeyed, it would light whenever the pointer is anywhere in the modal.
          <Box key={`${key}:box`} flexDirection="column" height={1} hover={{ backgroundColor: LIT }}>
            <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left, right: hint ? toPieces(<Text color={HUD.faint}>{hint}</Text>) : [] }} />
          </Box>
        )
      }
      const target = web ? (
        <Link href={name}>{main}</Link>
      ) : path ? (
        <Button key={`m:use:${i}`} plain onPress={() => $.margin.show({ path, line: 1 })}>
          {main}
        </Button>
      ) : (
        main
      )
      return (
        <Box justifyContent="space-between" gap={2}>
          <Box flexShrink={1} overflow="hidden">
            <Text color="promptBorder">{` ${glyph}`}</Text>
            {target}
          </Box>
          {hint ? (
            <Box flexShrink={0}>
              <Text color={HUD.faint}>{hint}</Text>
            </Box>
          ) : null}
        </Box>
      )
    })
    const f = modalFrame(props.bodyColumns, tabRows, 5 + rows.length)
    return drawLayer($, lc, 'm', f, { top: f.top, left: f.left - PAD }, [], [heading(ctx.el, kind.toUpperCase(), <Text color={HUD.faint}>{`${names.length} total`}</Text>)], rows, modalNow!.top)
  }
  const modalBox = topicsOpen ? topicsModal() : usedKind && usedEntry ? usedModal(usedKind, usedEntry) : null
  // Its list gone (a new prompt or /clear emptied it), the modal closes: left open, it would come back with the next list.
  if (usedKind && !usedEntry && !ctx.signal.aborted) $.clock.after(0, () => ctx.setModal(m => (m?.key === 'used' && m.kind === usedKind ? null : m)))
  if (modalNow?.key === 'topics' && !about.topics.length && !ctx.signal.aborted) $.clock.after(0, () => ctx.setModal(m => (m?.key === 'topics' ? null : m)))
  const layerZone = modalZone($, 'Overview', layers)
  if (layerZone) drawn.push(layerZone)
  const trace = {
    zones: !hasReport && !hasAbout ? 'empty' : zoned ? 'report+topic' : hasReport ? 'report' : 'topic',
    steps: shown.steps.length, topics: about.topics.length, topicRows: latestRows, reading: about.running, failed: about.failed,
  }
  // The body never scrolls (its bars stay pinned): STEPS gets the rows left under TAKE, its cues included.
  // TOPICS' header, zone and divider, ASK, TAKE and their rules, the footer.
  const roomLeft =
    props.scroll.bodyRows - 2 - BAR_ROWS - (hasReport ? 2 : 0) - (zoned ? 2 + latestRows : 0) - sessionRows - reportRows - 1
  // USED under STEPS: its rule and a row per kind, only while STEPS keep 3 rows.
  const usedKinds = USE_KINDS.filter(kind => usedShown[kind])
  const usedRows = shown.wants && usedKinds.length && roomLeft - (1 + usedKinds.length) >= 3 ? 1 + usedKinds.length : 0
  const stepRoom = roomLeft - usedRows
  // Over USED and the footer's 2 rows.
  const from = props.scroll.bodyRows - BAR_ROWS - 2 - usedRows - stepRoom
  // The tab-body row each drawn label sits on, counted down the column; PLAN's and USED's come from STEPS.
  const askAt = sessionRows + (hasAbout ? 2 + latestRows : 0)
  const askRows = wrapRows(shown.wants, Math.max(1, width - LABEL))
  const takeAt = askAt + askRows + 1
  const takeRows = take ? wrapRows(takeText, Math.max(1, width - LABEL)) : 0
  // The rule row under ASK, or under TAKE when there is one.
  const ruleAt = take ? takeAt + takeRows : askAt + askRows
  const labelAt: Partial<Record<Label, number>> = {
    ...(summaryRows > 0 && { SESSION: 0 }),
    ...(hasAbout && { TOPIC: sessionRows }),
    ...(shown.wants && { ASK: askAt }),
    ...(shown.wants && take && { TAKE: takeAt }),
    ...(shown.wants && shown.steps.length > 0 && { PLAN: from - 2 }),
    ...(usedRows > 0 && { USED: ruleAt + 1 }),
  }
  const cardOf = (label: Label) => wrapLines(LABEL_CARD[label], rc.cardWidth - 4)
  // The line a label's card dims: the first row of the element starting at `start`, or inside the label's own text.
  const dimFor = (start: number, rows = 1, own?: Label) => {
    if (dimmed) return undefined
    for (const [label, at] of Object.entries(labelAt) as [Label, number][]) {
      const t = rc.up(at, cardOf(label).length) ? at - 1 : at + 1
      if (t === start || (label === own && t > start && t < start + rows)) return { scope: `card:o:label:${label}`, color: DIMMED }
    }
  }
  const labelWord = (label: Label) => {
    // Not a row card: the row last left, kept until another row is entered, must not hide it.
    kitCard({ ...rc, gone: undefined }, `card:o:label:${label}`, labelAt[label]!, 'left', ...cardOf(label).map(l => <Text>{l}</Text>))
    return (
      <Box key={`o:label:${label}`} width={label.length} hover={dimmed ? undefined : { scope: `card:o:label:${label}` }}>
        <Text bold color={HUD.label}>{label}</Text>
      </Box>
    )
  }
  const setSteps = async (to: number) => {
    await update($, stepsFollow, () => false)
    await update($, stepsTop, () => to)
  }
  const topicRows = latest
    ? [
        <Box key="topic" paddingLeft={2} flexShrink={0}>
          {dimText(dimFor(sessionRows + 1), about.running ? HUD.faint : undefined, latest, 'wrap')}
        </Box>,
      ]
    : []
  // The footer, pinned over the bottom bar: one place whether a report, TOPIC or both show.
  const statusRow = (
    <Box key="footer" flexDirection="column" flexShrink={0}>
      <Text color="promptBorder">{'─'.repeat(width)}</Text>
      <Box justifyContent="space-between">
        <Text color={stateColor}>{state}</Text>
        {shown.waiting ? (
          <Text color={HUD.faint}>{shown.agents ? '' : '… steps'}</Text>
        ) : shown.steps.length ? (
          <Box key="count">
            <Text color="claude">{`${done}`}</Text>
            <Text color={HUD.faint}>/</Text>
            <Text color="claude">{`${shown.steps.length}`}</Text>
            <Text color={HUD.faint}>{' steps'}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
  const body =
    !hasReport && !hasAbout ? (
      // The rows under the tabs and their rule.
      emptyNote(
        ctx.el,
        props.scroll.bodyRows - BAR_ROWS - 2,
        'Nothing here yet',
        <Text color={HUD.faint}>What Claude is doing and</Text>,
        <Text color={HUD.faint}>what this chat is about.</Text>,
      )
    ) : (
      <Box flexDirection="column" height={Math.max(0, props.scroll.bodyRows - 2 - BAR_ROWS)}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {/* Unshrinkable: past the footer it is cut at the bottom, not squeezed row by row. */}
          <Box key="report" flexDirection="column" flexShrink={0}>
            {hasAbout && [
              ...(summaryRows
                ? [
                    <Box key="sessionHead" justifyContent="space-between">
                      {labelWord('SESSION')}
                      <Text color={HUD.faint}>{readSlot}</Text>
                    </Box>,
                    <Box key="summary" paddingLeft={2} height={summaryRows} overflow="hidden" flexShrink={0}>
                      {dimText(dimFor(1), about.running ? HUD.faint : undefined, about.summary, 'wrap')}
                    </Box>,
                    <Box key="sessionRule">{dimText(dimFor(1 + summaryRows), 'promptBorder', '─'.repeat(width))}</Box>,
                  ]
                : []),
              <Box key="topicHead" justifyContent="space-between">
                {labelWord('TOPIC')}
                <Box gap={2}>
                  {!summaryRows && <Text color={HUD.faint}>{readSlot}</Text>}
                  {about.topics.length > 1 && (
                    <Button key="o:topics:all" plain onPress={() => ctx.setModal(() => ({ key: 'topics', top: 0 }))}>
                      <Text color="claude" hover={{ scope: 'o:topics:all', inverse: true }}>show all</Text>
                    </Button>
                  )}
                </Box>
              </Box>,
              ...topicRows,
              ...(shown.wants ? [<Box key="topicRule">{dimText(dimFor(sessionRows + 1 + latestRows), 'promptBorder', '─'.repeat(width))}</Box>] : []),
            ]}
            {shown.wants && [
              labelled('ASK', shown.wants, shade(), dimFor(askAt, askRows, 'ASK')),
              take && partRule('TAKE', askAt + askRows),
              take && (
                <Box key="TAKE">
                  <Box width={LABEL} flexShrink={0}>
                    {labelWord('TAKE')}
                  </Box>
                  {dimText(
                    dimFor(takeAt, takeRows, 'TAKE'),
                    undefined,
                    [
                      <Text color={shade(TAKE_MARK[take.stance][1])}>{`${TAKE_MARK[take.stance][0]} `}</Text>,
                      <Text bold color={shade(TAKE_MARK[take.stance][1])}>{fit(take.label, 16)}</Text>,
                      take.why && <Text color={shade()}>{count(`: ${take.why}`)}</Text>,
                    ],
                    'wrap',
                  )}
                </Box>
              ),
              shown.steps.length > 0 && partRule('STEPS', ruleAt),
              shown.steps.length > 0 && (
                <Box key="steps">
                  <Box width={LABEL} flexShrink={0}>
                    {labelWord('PLAN')}
                  </Box>
                  <Box flexDirection="column" width={width - LABEL}>
                    {((perStep: StepLine[][]) => {
                      const rows = perStep.flat()
                      // Following, the step in progress kept in view, scrolled as little as that takes.
                      const doing = following ? shown.steps.findIndex(step => step.status === 'in_progress') : -1
                      const first = doing < 0 ? -1 : perStep.slice(0, doing).reduce((n, one) => n + one.length, 0)
                      // Its last row too, its agents with it; a step taller than the zone keeps its first row.
                      const at = first < 0 ? -1 : Math.min(first + perStep[doing]!.length - 1, first + Math.max(0, stepRoom - 3))
                      let w = zoneWindow(rows.length, at < 0 ? (following ? (stepsHeld ?? storedSteps) : storedSteps) : Math.min(storedSteps, at), stepRoom)
                      while (at >= w.top + w.shown) {
                        const down = zoneWindow(rows.length, w.top + 1, stepRoom)
                        if (down.top === w.top) break
                        w = down
                      }
                      if (!ctx.signal.aborted) stepsHeld = w.top
                      if (usedRows > 0) labelAt.USED = from - 2 + (w.above > 0 ? 1 : 0) + w.shown + (w.below > 0 ? 1 : 0) + 1
                      const stepsEnd = zoneWindow(rows.length, Infinity, stepRoom).top
                      drawn.push({
                        tab: 'Overview', kind: 'list', from, to: from + Math.min(rows.length, stepRoom), offset: props.scroll.offset,
                        // From the row drawn: following may have scrolled past the offset stored.
                        wheel: async by => {
                          await update($, stepsFollow, () => false)
                          await update($, stepsTop, () => Math.max(0, Math.min(w.top + by, stepsEnd)))
                        },
                      })
                      const stepCues = cues(ctx.el, 'steps', width - LABEL, w, setSteps, true, false)
                      // Tab-body rows: the zone's start counts the tabs bar too.
                      const atOf = (k: number) => from - 2 + (w.above > 0 ? 1 : 0) + (k - w.top)
                      hv.lines = Object.fromEntries(rows.flatMap((r, k) => (r.key && k >= w.top && k < w.top + w.shown ? [[r.key, atOf(k)]] : [])))
                      const inWindow = (k: number) => k >= w.top && k < w.top + w.shown && !!rows[k]?.key
                      // The line between a row and its card dims, as the Git tab's: the next row when the card opens down, the one above when up.
                      const faded = (scope: string, x: Piece) => ({ scope, color: PILL_CAPS.has(x.text) ? fadeBg(x.color) : fade(x.color), ...(x.backgroundColor && { backgroundColor: fadeBg(x.backgroundColor) }) })
                      const dimOn = (k: number, pieces: Piece[]) => {
                        if (dimmed) return pieces
                        const fromAbove = inWindow(k - 1) && !upOf(atOf(k - 1), 1)
                        const fromBelow = inWindow(k + 1) && upOf(atOf(k + 1), 1)
                        // PLAN's card dims the row under it too; a second group goes on `under` when the row above holds `hover`.
                        const plan = dimFor(atOf(k))
                        return pieces.map(x => ({
                          ...x,
                          ...(fromAbove ? { hover: faded(`line:${k - 1}`, x) } : plan && { hover: plan }),
                          ...(fromBelow ? { under: faded(`line:${k + 1}`, x) } : fromAbove && plan && { under: plan }),
                        }))
                      }
                      const shownRows = rows.slice(w.top, w.top + w.shown).map((r, n) => {
                        if (!r.key) return r.node
                        const k = w.top + n
                        kitCard(rc, `card:${r.key}`, atOf(k), 'center', kitKv(rc, 'status', <Text color={r.mark}>{r.word}</Text>))
                        return kitRow(rc, r.key, r.left!, [], { pieces: (key, node) => dimOn(k, toPieces(node)), line: k, act: false, lit: true })
                      })
                      return [w.above > 0 && stepCues.up, ...shownRows, w.below > 0 && stepCues.down]
                    })(shown.steps.map((step, i) => {
                      const all = agentRows[i] ?? []
                      // Past 3, the rest fold into a count, so a fan-out does not push later steps out of view.
                      const folds = all.length > 3
                      const rows = folds && open !== i ? all.slice(0, 3) : all
                      const hidden = all.slice(rows.length)
                      const counts = ['◌', '✗', '■', '○', '✓']
                        .map(glyph => [glyph, hidden.filter(row => AGENT_MARK[row.status][0] === glyph).length] as const)
                        .flatMap(([glyph, n]) => (n ? `${n} ${glyph}` : []))
                        .join(' ')
                      // In an agent's transcript, that agent's step leads back to the main conversation.
                      const stepLine = [
                        <Text key="mark" color={shade(MARK_SHADE[step.status])}>{`${MARK[step.status]} `}</Text>,
                        <Text key="text" color={shade(TEXT_SHADE[step.status])}>{count(fit(step.text, width - LABEL - 2))}</Text>,
                      ]
                      // A spawned agent's row opens its transcript; the one in view is lit across the row, as the shown tab is.
                      const agentLine = (row: AgentRow, tree: string, j: number): StepLine => {
                        const [glyph, color] = AGENT_MARK[row.status]
                        const text = fit(row.description, width - LABEL - 4)
                        const key = `o:agent:${i}:${j}`
                        if (row.id) acts[key] = () => view(row.id)
                        const left =
                          row.id && row.id === ctx.viewing()
                            ? [<Text bold inverse color={shade('claude')}>{`${tree}${glyph} ${text}`.padEnd(width - LABEL)}</Text>]
                            : [
                                <Text key="tree" color={shade('promptBorder')}>{tree}</Text>,
                                <Text key="mark" color={shade(color)}>{`${glyph} `}</Text>,
                                <Text key="text" color={shade(agentText(row.status))}>{text}</Text>,
                              ]
                        return { key, left, word: AGENT_WORD[row.status], mark: shade(color) }
                      }
                      const toggle = (key: string, label: string, to: number): StepLine => ({
                        node: (
                          <Button key={key} plain onPress={() => update($, expanded, () => to)}>
                            <Text color={shade('promptBorder')}>└ </Text>
                            <Text color={shade(HUD.faint)}>{label}</Text>
                          </Button>
                        ),
                      })
                      const stepKey = `o:step:${i}`
                      if (all.some(row => row.id && row.id === ctx.viewing())) acts[stepKey] = () => view()
                      return [
                        { key: stepKey, left: stepLine, word: STEP_WORD[step.status], mark: shade(MARK_SHADE[step.status]) },
                        ...rows.map((row, j) => agentLine(row, j === rows.length - 1 && !folds ? '└ ' : '├ ', j)),
                        folds && (hidden.length ? toggle(`more:${i}`, `… ${hidden.length} more  ${counts}`, i) : toggle('less', '… less', -1)),
                      ].filter(Boolean) as StepLine[]
                    }))}
                  </Box>
                </Box>
              ),
              usedRows > 0 && partRule('USED', labelAt.USED! - 1),
              ...(usedRows > 0 ? usedKinds : []).map((kind, i) => {
                const { main, agents, names: recent, fromAgents = [], sourceOf = {} } = usedShown[kind]!
                // Claude's own names first, agents' after, each newest first.
                const names = [...recent.filter(n => !fromAgents.includes(n)), ...recent.filter(n => fromAgents.includes(n))]
                const extra = agents > 0 ? ` +${agents}` : ''
                // Counts right-aligned, as the Git tab's churn columns; +N in its own column after them.
                const mainW = Math.max(...usedKinds.map(k => String(usedShown[k]!.main).length))
                const extraW = Math.max(...usedKinds.map(k => (usedShown[k]!.agents > 0 ? ` +${usedShown[k]!.agents}`.length : 0)))
                const kindW = Math.max(...usedKinds.map(k => k.length)) + 2
                const room = Math.max(1, width - LABEL - kindW - mainW - extraW - 2)
                const shorts = names.map(n => printable(shortName(kind, n, sourceOf[n])))
                const line = fit(shorts.join(', '), room)
                const dh = dimFor(labelAt.USED! + i)
                acts[`o:used:${kind}`] = () => ctx.setModal(() => ({ key: 'used', top: 0, kind }))
                const left = [
                  <Text color={HUD.faint}>{kind.padEnd(kindW)}</Text>,
                  <Text color={shown.waiting ? HUD.faint : 'claude'}>{String(main).padStart(mainW)}</Text>,
                  <Text color={HUD.faint}>{extra.padEnd(extraW)}</Text>,
                  <Text>{'  '}</Text>,
                  // Cut as one line, then split back per name: an agent's name dims as its +N does.
                  ...names.map((name, n) => {
                    const at = shorts.slice(0, n).join(', ').length + (n > 0 ? 2 : 0)
                    const piece = line.slice(at - (n > 0 ? 2 : 0), at + shorts[n].length)
                    return piece ? <Text key={name} color={shown.waiting || fromAgents.includes(name) ? HUD.faint : undefined}>{piece}</Text> : null
                  }),
                ]
                return (
                  <Box key={`used:${kind}`}>
                    <Box width={LABEL} flexShrink={0}>
                      {i === 0 ? labelWord('USED') : <Text>{''}</Text>}
                    </Box>
                    {/* Past the step rows' line ids, so the two never share a hover group. */}
                    {kitRow(rc, `o:used:${kind}`, left, [], { pieces: (_key, node) => toPieces(node).map(x => ({ ...x, ...(dh && { hover: dh }) })), line: USED_LINE + i, act: false, width: width - LABEL })}
                  </Box>
                )
              }),
            ]}
          </Box>
        </Box>
        {hasReport && statusRow}
        {cards}
        {modalBox}
      </Box>
    )
  return { body, zones: drawn, trace, ...(topicsOpen && { fade: { keep: new Set(['modal']), open: 'o:topics:all' } }), ...(modalBox && usedKind && { fade: { keep: new Set(['modal']), open: `${'Client' in ctx.el ? 'row' : 'hov'}:o:used:${usedKind}` } }) }
}
