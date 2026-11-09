import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { BAR_ROWS, DIM, HUD, PAD, clock, cues, dayName, emptyNote, fit, zoneWindow } from './kit'
import type { Prompt, TabCtx, TabDraw } from './kit'

const historyTop = atom({ plugin: 'margin', key: 'historyTop' } as const, 0)

//  : the toast wraps at spaces; ↻ keeps to its word.
const GONE = "Can't jump: rewound or compacted out of the chat. ↻ reuses it."
// A move redraws every row, each saying where it is now; rows a long jump unmounted say nothing
// again, so only the rows reported with the newest count.
const FRESH = 100

// By local calendar day: "Today", else "Sat 10 Oct".
export const dayLabel = (ms: number, now: Date) =>
  new Date(ms).toDateString() === now.toDateString() ? 'Today' : dayName(new Date(ms))
// History stamps a prompt up to ~0.3 s after the chat stamps its row.
const SLACK = 500
// The prompt (index, newest first) to light: the newest whose turn the chat rows on screen show.
// Nothing on screen known: the newest.
export const inView = (prompts: Prompt[], times: number[]) =>
  times.length ? prompts.findIndex(prompt => prompt.timestamp <= Math.max(...times) + SLACK) : 0
// A clicked prompt while its pin holds, else the one in view.
export const litPrompt = (prompts: Prompt[], times: number[], pinned?: { timestamp: number }) => {
  const at = pinned ? prompts.findIndex(prompt => prompt.timestamp === pinned.timestamp) : -1
  return at >= 0 ? at : inView(prompts, times)
}

// The shape `gone` returns (register.tsx), declared here: a tab file imports nothing from register.tsx.
export type HistoryReads = { all: Prompt[]; prompts: Prompt[]; drawnOnly: Set<string>; commands: Set<string>; rows: { isLive: boolean; marker?: 'Rewound' | 'Compacted' }[] }
export type HistoryCtx = TabCtx & {
  // The cached read, kept in register.tsx.
  reads: () => Promise<HistoryReads>
  rowTimes: (keys: string[]) => Promise<Map<string, number>>
  rowIds: Map<string, string>
  awaited: Set<string>
  shown: Map<string, { where: string; key: string; at: number }>
  // Read at the moment the draw reads it.
  pin: () => { timestamp: number; after: number } | undefined
  flat: (text: string) => string
  isCommand: (prompt: Prompt) => boolean
  jump: (prompt: Prompt) => Promise<void>
  reuse: (display: string) => Promise<void>
  rewind: () => unknown
  latest: () => Promise<void>
}

export async function draw($: EngineInterface, ctx: HistoryCtx): Promise<TabDraw> {
  const { Box, Button, Text } = ctx.el
  const { props, flat, isCommand, rowIds, awaited, shown } = ctx
  const { all, prompts, drawnOnly, commands, rows } = await ctx.reads()
  // "↻ " and "HH:MM  " come before the text; padding it to the edge makes the whole row the jump button.
  const room = props.bodyColumns - 2 * PAD - 9
  const now = new Date()
  const days = prompts.map(prompt => dayLabel(prompt.timestamp, now))
  // The longest count that fits beside "⟲ rewind  ⤓ latest " (19 columns); none in the narrowest pane.
  const count = `${prompts.length}${all.length > prompts.length ? '+' : ''} ${all.length === 1 ? 'prompt' : 'prompts'}`
  const counted = [`${count} this session`, count, ''].find(text => !text || text.length + 19 <= room + 9)
  const isReachable = (prompt: Prompt) => {
    const key = flat(prompt.display)
    if ((!isCommand(prompt) && !drawnOnly.has(key)) || rowIds.has(key) || commands.has(key)) return true
    awaited.add(key)
    return false
  }
  // Rows under the Compacted line still jump while the chat shows them, dim as the model lost them.
  const compacted = rows.findIndex(row => row.marker === 'Compacted')
  // The prompt being read lights even if compacted: it is on screen.
  const times = await ctx.rowTimes([...new Set([...shown.values()].map(row => row.key))])
  const known = [...shown.values()].filter(row => times.has(row.key))
  const newest = Math.max(...known.map(row => row.at))
  const lit = litPrompt(prompts, known.filter(row => row.at >= newest - FRESH).map(row => times.get(row.key)!), ctx.pin())
  // `line` left and right of " label ", across the row (room + 9 columns).
  const flanks = (label: string, line: string) => {
    const fill = Math.max(0, room + 7 - label.length)
    return [line.repeat(Math.floor(fill / 2)), line.repeat(Math.ceil(fill / 2))]
  }
  // A day is a plain line; Rewound a broken one, Compacted a pressed-together one.
  const divider = (label: string, line: string, word: string, dim: string) => (
    <Box>
      <Text color={dim}>{flanks(label, line)[0]} </Text>
      <Text color={word}>{label}</Text>
      <Text color={dim}> {flanks(label, line)[1]}</Text>
    </Box>
  )
  // One element per row, dividers too, so the list scrolls by rows under the header.
  // A ! command's ! in the shell prompt's color, faint as its row.
  const row = (prompt: Prompt, color: string | undefined) => {
    const text = fit(flat(prompt.display), room).padEnd(room)
    if (!text.startsWith('!')) return <Text color={color}>{text}</Text>
    return [<Text color={color === HUD.faint ? color : 'bashBorder'}>!</Text>, <Text color={color}>{text.slice(1)}</Text>]
  }
  const lines = prompts.flatMap((prompt, i) => [
    ...(days[i] !== days[i - 1] ? [divider(days[i] ?? '', '─', HUD.label, DIM.label)] : []),
    // Rewound shares the rewind button's green.
    ...(rows[i]?.marker === 'Rewound' ? [divider('Rewound', '~', HUD.action, DIM.action)] : []),
    ...(rows[i]?.marker === 'Compacted' ? [divider('Compacted', '=', HUD.compacted, DIM.compacted)] : []),
    <Box>
      <Button key={`reuse:${i}`} plain onPress={() => ctx.reuse(prompt.display)}>
        <Text color={HUD.idle}>↻ </Text>
      </Button>
      <Button key={`jump:${i}`} plain onPress={() => (rows[i]?.isLive ? ctx.jump(prompt) : $.ui.toast(GONE))}>
        <Text color={HUD.faint}>{clock(prompt.timestamp)}  </Text>
        {row(prompt, !rows[i]?.isLive || !isReachable(prompt) ? HUD.faint : i === lit ? 'claude' : compacted >= 0 && i >= compacted ? HUD.faint : undefined)}
      </Button>
    </Box>,
  ])
  // The rows under the tabs, their rule and the header, cues included.
  // Clamped: the list shrinks after a rewind.
  const listRows = Math.max(0, props.scroll.bodyRows - BAR_ROWS - 3)
  const w = zoneWindow(lines.length, await read($, historyTop), listRows)
  const listCues = cues(ctx.el, 'history', props.bodyColumns - 2 * PAD, w, to => update($, historyTop, () => to))
  const historyEnd = zoneWindow(lines.length, Infinity, listRows).top
  return {
    zones: [
      {
        tab: 'History', kind: 'list', from: -Infinity, to: Infinity, offset: 0, fallback: true,
        // From the row drawn: a rewind may have shrunk the list under the offset stored.
        wheel: by => update($, historyTop, top => Math.max(0, Math.min(Math.min(top, historyEnd) + by, historyEnd))),
      },
    ],
    trace: { zones: prompts.length ? 'list' : 'empty', prompts: prompts.length, rows: lines.length, listRows },
    scroll: { from: w.top, above: w.above, below: w.below },
    body: (
      <Box flexDirection="column">
        {prompts.length > 0 && (
          <Box justifyContent="space-between">
            <Box>
              <Button key="rewind" plain onPress={ctx.rewind}>
                <Text color={HUD.action}>⟲ rewind</Text>
              </Button>
              <Text>  </Text>
              <Button key="latest" plain onPress={ctx.latest}>
                <Text color={HUD.latest}>⤓ latest</Text>
              </Button>
            </Box>
            {counted && <Text color={HUD.faint}>{counted}</Text>}
          </Box>
        )}
        {/* The rows under the tabs and their rule. */}
        {prompts.length === 0 &&
          emptyNote(
            ctx.el,
            props.scroll.bodyRows - BAR_ROWS - 2,
            'No prompts yet',
            <Text color={HUD.faint}>What you've asked Claude.</Text>,
            <Box>
              <Text color={HUD.faint}>Click to jump, </Text>
              <Text color={HUD.idle}>↻</Text>
              <Text color={HUD.faint}> to reuse.</Text>
            </Box>,
          )}
        {w.above > 0 && listCues.up}
        {lines.slice(w.top, w.top + w.shown)}
        {w.below > 0 && listCues.down}
      </Box>
    ),
  }
}
