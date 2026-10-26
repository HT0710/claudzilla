import type { ClientModule } from 'claude-code'

// The rule between CHANGES and COMMITS, or the Overview's TOPICS and its report: dragged, it posts how
// many rows the zone above should take. `split` is the rows that zone takes as drawn, `min` and `max` the
// rows a drag can give it; the rule sits right under them, so the pointer's row counts from there.
// `isOver`: the pointer is on the rule, which lights its grip.
// Dragged, the rule stays put and shows how far (`by`), posting once let go: moved under the pointer, it
// got rows counted from where the terminal had not yet moved it, and jumped.
// Clicked, a press and release that never left its row, it jumps to the top, or from the top to the bottom.
const Divider: ClientModule<{ split: number; min: number; max: number }, { grabbed?: number; by?: number; moved?: boolean; isOver?: boolean }> = ({ split, min, max }, surface) => {
  const { Box, Text } = surface.elements
  // Rows a drag of `d` moves the rule, as far as the zone can go: a zone under `min` never shrinks, and
  // grows to it on any move down.
  const reach = (d: number) =>
    d < 0 ? Math.max(split + d, Math.min(min, split)) - split : d > 0 ? Math.min(Math.max(split + d, min), max) - split : 0
  surface.onPointer(e => {
    const { grabbed, moved } = surface.state ?? {}
    if (e.type === 'enter') surface.setState({ ...surface.state, isOver: true })
    else if (e.type === 'leave') surface.setState({ ...surface.state, isOver: false })
    else if (e.type === 'down' && e.button === 'left') surface.setState({ grabbed: e.y, isOver: true })
    // A drag holds the pointer past the edges with no leave: an up off the rule ends the light. A move
    // with no button held while grabbed is an up the surface missed.
    else if (e.type === 'up' || (e.type === 'move' && !e.button && grabbed !== undefined)) {
      surface.setState({ isOver: e.y === 0 && e.x >= 0 && e.x < surface.columns })
      if (grabbed === undefined) return
      const to = split > min ? min : max
      if (!moved && e.y === grabbed) {
        if (to !== split) surface.post({ split: to })
      } else if (reach(e.y - grabbed)) surface.post({ split: split + reach(e.y - grabbed) })
    } else if (e.type === 'move' && e.button && grabbed !== undefined && e.y - grabbed !== surface.state?.by)
      surface.setState({ ...surface.state, by: e.y - grabbed, moved: surface.state?.moved || e.y !== grabbed })
  })
  const by = surface.state?.grabbed === undefined ? 0 : reach(surface.state.by ?? 0)
  const word = by ? `${by > 0 ? '↓' : '↑'}${Math.abs(by)}` : '⇕'
  const isLit = surface.state?.isOver
  const side = Math.max(0, surface.columns - word.length - 2)
  // The guide's divider colors (plugins/primer/hooks/divider.tsx), as every panel rule but History's day
  // lines.
  return (
    <Box>
      <Text color="promptBorder">{'─'.repeat(Math.floor(side / 2))} </Text>
      <Text color={isLit ? 'claude' : 'promptBorder'} inverse={(isLit && !by) || undefined} bold>
        {word}
      </Text>
      <Text color="promptBorder"> {'─'.repeat(Math.ceil(side / 2))}</Text>
    </Box>
  )
}

export default Divider
