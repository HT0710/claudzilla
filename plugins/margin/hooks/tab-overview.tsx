import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AgentRow, Modal, Spawn, Step, Take } from '../types'
import { BAR_ROWS, EMPTY_INTENT, EMPTY_OVERVIEW, EMPTY_USED, HUD, PAD, SCOPE, TYPES, USE_KINDS, clock, cues, drawLayer, emptyNote, fit, heading, modalFrame, modalZone, zoneWindow } from './kit'
import type { Layer, LayerCtx, TabCtx, TabDraw, UseKind, Zone } from './kit'

const intent = atom({ plugin: 'margin', key: 'intent' } as const, EMPTY_INTENT)
const overview = atom({ plugin: 'margin', key: 'overview' } as const, EMPTY_OVERVIEW)
const spawns = atom({ plugin: 'margin', key: 'spawns' } as const, [] as Spawn[])
const expanded = atom({ plugin: 'margin', key: 'expanded' } as const, -1)
const used = atom({ plugin: 'margin', key: 'used' } as const, EMPTY_USED)
const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)
const stepsTop = atom({ plugin: 'margin', key: 'stepsTop' } as const, 0)
const stepsFollow = atom({ plugin: 'margin', key: 'stepsFollow' } as const, true)

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
}

export async function draw($: EngineInterface, ctx: OverviewCtx): Promise<TabDraw> {
  const { Box, Button, Text } = ctx.el
  const { props } = ctx
  const drawn: Zone[] = []
  const shown = await read($, intent)
  const about = await read($, overview)
  const agentRows = hang(shown.steps, await read($, spawns), shown.turn ?? -1)
  const open = await read($, expanded)
  const modalNow = await read($, modal)
  const width = props.bodyColumns - 2 * PAD
  // Only the first read builds the list; every later one updates the topics shown.
  const readSlot = about.running ? (about.topics.length ? 'updating…' : 'reading…') : about.failed ? 'update failed' : ''
  const done = shown.steps.filter(step => step.status === 'completed').length
  const stepCount = shown.steps.length ? `${done}/${shown.steps.length} steps` : ''
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
  const hasAbout = about.topics.length > 0 || about.running || !!about.failed
  const hasReport = !!(shown.wants || shown.waiting || shown.ended)
  // The tab body the modal sits in, under the tabs and their rule.
  const tabRows = props.scroll.bodyRows - 2 - BAR_ROWS
  const LABEL = 7
  // Purple inline label, the text wrapping under itself.
  const labelled = (label: string, text: string, color?: string) => (
    <Box key={label}>
      {/* A fixed column: beside wrapping text, a padded label shrank and lost its gap. */}
      <Box width={LABEL} flexShrink={0}>
        <Text bold color={HUD.label}>{label}</Text>
      </Box>
      <Text wrap="wrap" color={color}>{text}</Text>
    </Box>
  )
  // A part after ASK opens under a rule from the text column to the edge.
  const partRule = (label: string) => (
    <Box key={`rule:${label}`} paddingLeft={LABEL}>
      <Text color="promptBorder">{'─'.repeat(Math.max(0, width - LABEL))}</Text>
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
  const topicsOpen = modalNow?.key === 'topics' && about.topics.length > 0
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
  const modalBox = topicsOpen ? topicsModal() : null
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
  const usedNow = await read($, used)
  const usedShown = shown.waiting ? (usedNow.last ?? {}) : usedNow.kinds
  const usedKinds = USE_KINDS.filter(kind => usedShown[kind])
  const usedRows = shown.wants && usedKinds.length && roomLeft - (1 + usedKinds.length) >= 3 ? 1 + usedKinds.length : 0
  const stepRoom = roomLeft - usedRows
  const following = await read($, stepsFollow)
  const storedSteps = await read($, stepsTop)
  const setSteps = async (to: number) => {
    await update($, stepsFollow, () => false)
    await update($, stepsTop, () => to)
  }
  const topicRows = latest
    ? [
        <Box key="topic" paddingLeft={2} flexShrink={0}>
          <Text wrap="wrap" color={about.running ? HUD.faint : undefined}>{latest}</Text>
        </Box>,
      ]
    : []
  // The footer, pinned over the bottom bar: one place whether a report, TOPIC or both show.
  const statusRow = (
    <Box key="footer" flexDirection="column" flexShrink={0}>
      <Text color="promptBorder">{'─'.repeat(width)}</Text>
      <Box justifyContent="space-between">
        <Text color={stateColor}>{state}</Text>
        <Text color={HUD.faint}>{shown.waiting ? (shown.agents ? '' : '… steps') : stepCount}</Text>
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
                      <Text bold color={HUD.label}>SESSION</Text>
                      <Text color={HUD.faint}>{readSlot}</Text>
                    </Box>,
                    <Box key="summary" paddingLeft={2} height={summaryRows} overflow="hidden" flexShrink={0}>
                      <Text wrap="wrap" color={about.running ? HUD.faint : SCOPE}>{about.summary}</Text>
                    </Box>,
                    <Box key="sessionRule"><Text color="promptBorder">{'─'.repeat(width)}</Text></Box>,
                  ]
                : []),
              <Box key="topicHead" justifyContent="space-between">
                <Text bold color={HUD.label}>TOPIC</Text>
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
              ...(shown.wants ? [<Box key="topicRule"><Text color="promptBorder">{'─'.repeat(width)}</Text></Box>] : []),
            ]}
            {shown.wants && [
              labelled('ASK', shown.wants, shade()),
              take && partRule('TAKE'),
              take && (
                <Box key="TAKE">
                  <Box width={LABEL} flexShrink={0}>
                    <Text bold color={HUD.label}>TAKE</Text>
                  </Box>
                  <Text wrap="wrap">
                    <Text color={shade(TAKE_MARK[take.stance][1])}>{`${TAKE_MARK[take.stance][0]} `}</Text>
                    <Text bold color={shade(TAKE_MARK[take.stance][1])}>{fit(take.label, 16)}</Text>
                    {take.why && <Text color={shade()}>{`: ${take.why}`}</Text>}
                  </Text>
                </Box>
              ),
              shown.steps.length > 0 && partRule('STEPS'),
              shown.steps.length > 0 && (
                <Box key="steps">
                  <Box width={LABEL} flexShrink={0}>
                    <Text bold color={HUD.label}>STEPS</Text>
                  </Box>
                  <Box flexDirection="column" width={width - LABEL}>
                    {((perStep: unknown[][]) => {
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
                      // Over USED and the footer's 2 rows.
                      const from = props.scroll.bodyRows - BAR_ROWS - 2 - usedRows - stepRoom
                      const stepsEnd = zoneWindow(rows.length, Infinity, stepRoom).top
                      drawn.push({
                        tab: 'Overview', kind: 'list', from, to: from + Math.min(rows.length, stepRoom), offset: props.scroll.offset,
                        // From the row drawn: following may have scrolled past the offset stored.
                        wheel: async by => {
                          await update($, stepsFollow, () => false)
                          await update($, stepsTop, () => Math.max(0, Math.min(w.top + by, stepsEnd)))
                        },
                      })
                      const stepCues = cues(ctx.el, 'steps', width - LABEL, w, setSteps)
                      return [w.above > 0 && stepCues.up, ...rows.slice(w.top, w.top + w.shown), w.below > 0 && stepCues.down]
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
                        <Text key="mark" color={shade(MARK_SHADE[step.status])}>{MARK[step.status]} </Text>,
                        <Text key="text" color={shade(TEXT_SHADE[step.status])}>{fit(step.text, width - LABEL - 2)}</Text>,
                      ]
                      // A spawned agent's row opens its transcript; the one in view is lit across the row, as the shown tab is.
                      const agentLine = (row: AgentRow, tree: string) => {
                        const [glyph, color] = AGENT_MARK[row.status]
                        const text = fit(row.description, width - LABEL - 4)
                        const line =
                          row.id && row.id === ctx.viewing()
                            ? <Text bold inverse color={shade('claude')}>{`${tree}${glyph} ${text}`.padEnd(width - LABEL)}</Text>
                            : [
                                <Text key="tree" color={shade(HUD.faint)}>{tree}</Text>,
                                <Text key="mark" color={shade(color)}>{glyph} </Text>,
                                <Text key="text" color={shade(agentText(row.status))}>{text}</Text>,
                              ]
                        return row.id ? (
                          <Button key={`view:${row.id}`} plain onPress={() => $.ui.view(ctx.viewing() === row.id ? {} : { agentId: row.id })}>
                            {line}
                          </Button>
                        ) : (
                          line
                        )
                      }
                      const toggle = (key: string, label: string, to: number) => (
                        <Button key={key} plain onPress={() => update($, expanded, () => to)}>
                          <Text color={shade(HUD.faint)}>└ </Text>
                          <Text color={shade(HUD.faint)}>{label}</Text>
                        </Button>
                      )
                      return [
                        <Box key={`step:${i}`}>
                          {all.some(row => row.id && row.id === ctx.viewing()) ? (
                            <Button key="main" plain onPress={() => $.ui.view({})}>
                              {stepLine}
                            </Button>
                          ) : (
                            stepLine
                          )}
                        </Box>,
                        ...rows.map((row, j) => (
                          <Box key={`agent:${i}:${j}`}>{agentLine(row, j === rows.length - 1 && !folds ? '└ ' : '├ ')}</Box>
                        )),
                        folds && (hidden.length ? toggle(`more:${i}`, `… ${hidden.length} more  ${counts}`, i) : toggle('less', '… less', -1)),
                      ].filter(Boolean)
                    }))}
                  </Box>
                </Box>
              ),
              usedRows > 0 && partRule('USED'),
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
                const shorts = names.map(n => shortName(kind, n, sourceOf[n]))
                const line = fit(shorts.join(', '), room)
                return (
                  <Box key={`used:${kind}`}>
                    <Box width={LABEL} flexShrink={0}>
                      <Text bold color={HUD.label}>{i === 0 ? 'USED' : ''}</Text>
                    </Box>
                    <Text color={HUD.faint}>{kind.padEnd(kindW)}</Text>
                    <Text color={shown.waiting ? HUD.faint : 'claude'}>{String(main).padStart(mainW)}</Text>
                    <Text color={HUD.faint}>{extra.padEnd(extraW)}</Text>
                    <Text>{'  '}</Text>
                    {/* Cut as one line, then split back per name: an agent's name dims as its +N does. */}
                    {names.map((name, n) => {
                      const at = shorts.slice(0, n).join(', ').length + (n > 0 ? 2 : 0)
                      const piece = line.slice(at - (n > 0 ? 2 : 0), at + shorts[n].length)
                      return piece ? <Text key={name} color={shown.waiting || fromAgents.includes(name) ? HUD.faint : undefined}>{piece}</Text> : null
                    })}
                  </Box>
                )
              }),
            ]}
          </Box>
        </Box>
        {hasReport && statusRow}
        {modalBox}
      </Box>
    )
  return { body, zones: drawn, trace, ...(topicsOpen && { fade: { keep: new Set(['modal']), open: 'o:topics:all' } }) }
}
