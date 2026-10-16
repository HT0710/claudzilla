import type { ClientModule } from 'claude-code'

// The rule between CHANGES and COMMITS, or the Overview's TOPICS and its report: dragged, it posts how
// many rows the zone above should take. `split` is the rows that zone takes as drawn; the rule sits right
// under them, so the pointer's row counts from there. `isOver`: the pointer is on the rule, which lights
// its grip. With a `label`, the rule shows it, the grip only under the pointer, lit only while dragged.
const Divider: ClientModule<{ split: number; label?: string }, { grabbed?: number; isOver?: boolean }> = ({ split, label }, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'enter') surface.setState({ ...surface.state, isOver: true })
    else if (e.type === 'leave') surface.setState({ ...surface.state, isOver: false })
    else if (e.type === 'down' && e.button === 'left') surface.setState({ grabbed: e.y, isOver: true })
    // A drag holds the pointer past the edges with no leave: an up off the rule ends the light.
    else if (e.type === 'up') surface.setState({ isOver: e.y === 0 && e.x >= 0 && e.x < surface.columns })
    else if (e.type === 'move' && e.button && surface.state?.grabbed !== undefined && e.y !== surface.state.grabbed)
      surface.post({ split: split + e.y - surface.state.grabbed })
  })
  const word = label && !surface.state?.isOver ? label : '⇕'
  const isLit = label ? surface.state?.grabbed !== undefined : surface.state?.isOver
  const side = Math.max(0, surface.columns - word.length - 2)
  // History's day-line purple (register.tsx DIM.label); a label, and the lit grip as History's ↑ to the
  // top under the pointer, in its word's (HUD.label).
  return (
    <Box>
      <Text color="#625a7e">{'─'.repeat(Math.floor(side / 2))} </Text>
      <Text color={word === label || isLit ? '#a396d2' : '#625a7e'} inverse={isLit || undefined}>
        {word}
      </Text>
      <Text color="#625a7e"> {'─'.repeat(Math.ceil(side / 2))}</Text>
    </Box>
  )
}

export default Divider
