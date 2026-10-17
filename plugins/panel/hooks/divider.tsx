import type { ClientModule } from 'claude-code'

// The rule between CHANGES and COMMITS, or the Overview's TOPICS and its report: dragged, it posts how
// many rows the zone above should take. `split` is the rows that zone takes as drawn; the rule sits right
// under them, so the pointer's row counts from there. `isOver`: the pointer is on the rule, which lights
// its grip. With a `label`, the rule shows it, the grip only under the pointer, lit only while dragged.
// Dragged, the rule stays put and shows how far (`by`), posting once let go: moved under the pointer, it
// got rows counted from where the terminal had not yet moved it, and jumped.
const Divider: ClientModule<{ split: number; label?: string }, { grabbed?: number; by?: number; isOver?: boolean }> = ({ split, label }, surface) => {
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
  // No higher than the zone's title.
  const by = surface.state?.grabbed === undefined ? 0 : Math.max(-split, surface.state.by ?? 0)
  const word = by ? `${by > 0 ? '↓' : '↑'}${Math.abs(by)}` : label && !surface.state?.isOver ? label : '⇕'
  const isLit = label ? surface.state?.grabbed !== undefined : surface.state?.isOver
  const side = Math.max(0, surface.columns - word.length - 2)
  // History's day-line purple (register.tsx DIM.label), as the ↑ to a zone's top; a label, and the lit
  // grip, in its word's (HUD.label).
  return (
    <Box>
      <Text color="#625a7e">{'─'.repeat(Math.floor(side / 2))} </Text>
      <Text color={word === label || isLit ? '#a396d2' : '#625a7e'} inverse={(isLit && !by) || undefined} bold={word !== label || undefined}>
        {word}
      </Text>
      <Text color="#625a7e"> {'─'.repeat(Math.ceil(side / 2))}</Text>
    </Box>
  )
}

export default Divider
