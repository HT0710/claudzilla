import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FileView } from '../types'
import { HUD, PAD, emptyNote, fit } from './kit'
import type { TabCtx, TabDraw } from './kit'

const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as FileView)

// `rows` lines of the view with the clicked one in the middle, clamped to the slice's ends.
export const fileWindow = (view: { line: number; first: number; text: string }, rows: number) => {
  const all = view.text.split('\n')
  const at = Math.max(0, Math.min(view.line - view.first - Math.floor(rows / 2), all.length - rows))
  return { first: view.first + at, lines: all.slice(at, at + rows), mark: view.line - view.first - at }
}

export async function draw($: EngineInterface, ctx: TabCtx): Promise<TabDraw> {
  const { Box, Code, Text } = ctx.el
  const { props } = ctx
  const view = await read($, file)
  const rows = Math.max(0, props.scroll.bodyRows)
  if (!view) {
    return { body: emptyNote(ctx.el, rows, 'No file open', <Text color={HUD.faint}>Click a file path in</Text>, <Text color={HUD.faint}>a reply to show it here.</Text>), zones: [], trace: {} }
  }
  if (!view.text) {
    // The box's border and padding take 6 columns of the body.
    return {
      body: emptyNote(
        ctx.el,
        rows,
        "Can't show this file",
        <Text color={HUD.faint}>{fit(view.path, props.bodyColumns - 2 * PAD - 6)}</Text>,
        <Text color={HUD.faint}>It is binary or unreadable.</Text>,
      ),
      zones: [],
      trace: {},
    }
  }
  // The header row and its rule, as Overview's and Git's first rows.
  const room = Math.max(1, rows - 2)
  const { first, lines, mark } = fileWindow(view, room)
  const cwd = await $.session.cwd().catch(() => '')
  const home = await $.env.get('HOME').catch(() => undefined)
  // As the reply wrote it: from the working directory, else from ~.
  const shown = cwd && view.path.startsWith(`${cwd}/`) ? view.path.slice(cwd.length + 1) : home && view.path.startsWith(`${home}/`) ? `~/${view.path.slice(home.length + 1)}` : view.path
  const width = props.bodyColumns - 2 * PAD
  const at = `line ${view.line}`
  // A cut takes the path's start, never the line beside it.
  const fits = Math.max(1, width - at.length - 1)
  const head = shown.length > fits ? `…${shown.slice(1 - fits)}` : shown
  return {
    body: (
      <Box flexDirection="column" height={rows} flexShrink={0}>
        {/* As Git's branch row: the path in the action color, the line faint on the right. */}
        <Box justifyContent="space-between">
          <Text color={HUD.action}>{head}</Text>
          <Text color={HUD.faint}>{at}</Text>
        </Box>
        <Box marginX={-PAD}>
          <Text color="promptBorder">{'─'.repeat(width + 2 * PAD)}</Text>
        </Box>
        <Box height={room} flexShrink={0}>
          <Text color="claude">{lines.map((_, i) => (i === mark ? '▶' : ' ')).join('\n')}</Text>
          <Code source={lines.join('\n')} path={view.path} startLine={first} wrap="truncate-end" />
        </Box>
      </Box>
    ),
    zones: [],
    trace: {},
    rules: [1],
  }
}
