import type { ClientModule } from 'claude-code'

type Props = { rows: { row: number; line: number; cell: string; lit: boolean; hit?: boolean }[]; colors: { lit: string; faint: string; claude: string; warning: string } }

// The code view's line numbers: a drag from one to another posts the lines it covered once let go. The gutter
// stays put while dragging and draws the range, so rows are never counted from a spot that has moved.
const Gutter: ClientModule<Props, { anchor?: number; to?: number }> = ({ rows, colors }, surface) => {
  const { Box, Text } = surface.elements
  const lineAt = (y: number) => rows[Math.max(0, Math.min(y, rows.length - 1))]?.line
  surface.onPointer(e => {
    const { anchor, to } = surface.state ?? {}
    if (e.type === 'down' && e.button === 'left') surface.setState({ anchor: lineAt(e.y), to: lineAt(e.y) })
    else if (e.type === 'move' && e.button && anchor !== undefined) surface.setState({ anchor, to: lineAt(e.y) })
    // A move with no button held while anchored is an up the surface missed.
    else if ((e.type === 'up' || (e.type === 'move' && !e.button)) && anchor !== undefined) {
      const end = lineAt(e.y) ?? to ?? anchor
      surface.setState({})
      surface.post({ first: Math.min(anchor, end), last: Math.max(anchor, end) })
    }
  })
  const { anchor, to } = surface.state ?? {}
  const dragging = anchor !== undefined && to !== undefined
  return (
    <Box flexDirection="column">
      {rows.map(r => {
        const inRange = dragging ? r.line >= Math.min(anchor, to) && r.line <= Math.max(anchor, to) : r.lit
        return (
          <Text key={r.row} color={r.hit ? colors.warning : colors.faint} backgroundColor={inRange ? colors.lit : undefined}>
            {r.cell}
          </Text>
        )
      })}
    </Box>
  )
}

export default Gutter
