import type { ClientModule } from 'claude-code'

// The rule between CHANGES and COMMITS: dragged, it posts how many rows CHANGES should take.
// `split` is the rows CHANGES takes as drawn; the rule sits right under them, so the pointer's row
// counts from there.
const Divider: ClientModule<{ split: number }, { grabbed?: number }> = ({ split }, surface) => {
  const { Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'down' && e.button === 'left') surface.setState({ grabbed: e.y })
    else if (e.type === 'up') surface.setState({})
    else if (e.type === 'move' && e.button && surface.state?.grabbed !== undefined && e.y !== surface.state.grabbed)
      surface.post({ split: split + e.y - surface.state.grabbed })
  })
  const side = Math.max(0, surface.columns - 3)
  // History's day-line purple (register.tsx DIM.label).
  return (
    <Text color="#625a7e">
      {'─'.repeat(Math.floor(side / 2))} ⇕ {'─'.repeat(Math.ceil(side / 2))}
    </Text>
  )
}

export default Divider
