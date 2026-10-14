import type { ClientModule } from 'claude-code'

// The rule between CHANGES and COMMITS: dragged, it posts how many rows CHANGES should take.
// `split` is the rows CHANGES takes as drawn; the rule sits right under them, so the pointer's row
// counts from there. `isOver`: the pointer is on the rule, which lights its grip.
const Divider: ClientModule<{ split: number }, { grabbed?: number; isOver?: boolean }> = ({ split }, surface) => {
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
  const side = Math.max(0, surface.columns - 3)
  // History's day-line purple (register.tsx DIM.label).
  return (
    <Box>
      <Text color="#625a7e">{'─'.repeat(Math.floor(side / 2))} </Text>
      <Text color="#625a7e" inverse={surface.state?.isOver || undefined}>⇕</Text>
      <Text color="#625a7e"> {'─'.repeat(Math.ceil(side / 2))}</Text>
    </Box>
  )
}

export default Divider
