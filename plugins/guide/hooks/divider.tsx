import type { ClientModule } from 'claude-code'

// The panel plugin's divider (plugins/panel/hooks/divider.tsx), in the guide's colors: the rule between
// the topics and the section when stacked. Dragged, it posts how many rows the topics should take. `split`
// is the rows they take as drawn, `most` the most they may; the rule sits right under them, so the pointer's
// row counts from there.
// Dragged, the rule stays put and shows how far (`by`), posting once let go: moved under the pointer, it
// got rows counted from where the terminal had not yet moved it, and jumped.
const Divider: ClientModule<{ split: number; most: number }, { grabbed?: number; by?: number; isOver?: boolean }> = ({ split, most }, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    const { grabbed } = surface.state ?? {}
    if (e.type === 'enter') surface.setState({ ...surface.state, isOver: true })
    else if (e.type === 'leave') surface.setState({ ...surface.state, isOver: false })
    else if (e.type === 'down' && e.button === 'left') surface.setState({ grabbed: e.y, isOver: true })
    // A drag holds the pointer past the edges with no leave: an up off the rule ends the light. A move
    // with no button held while grabbed is an up the surface missed.
    else if (e.type === 'up' || (e.type === 'move' && !e.button && grabbed !== undefined)) {
      surface.setState({ isOver: e.y === 0 && e.x >= 0 && e.x < surface.columns })
      if (grabbed !== undefined && e.y !== grabbed) surface.post({ split: split + e.y - grabbed })
    } else if (e.type === 'move' && e.button && grabbed !== undefined && e.y - grabbed !== surface.state?.by)
      surface.setState({ ...surface.state, by: e.y - grabbed })
  })
  // No higher than the 3 rows the topics keep (register.tsx MIN_TOC), no lower than the section's 3 allow.
  const by = surface.state?.grabbed === undefined ? 0 : Math.min(Math.max(0, most - split), Math.max(Math.min(0, 3 - split), surface.state.by ?? 0))
  const word = by ? `${by > 0 ? '↓' : '↑'}${Math.abs(by)}` : '⇕'
  const isLit = surface.state?.isOver
  const side = Math.max(0, surface.columns - word.length - 2)
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
