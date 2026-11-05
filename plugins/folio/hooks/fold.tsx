import type { ClientModule } from 'claude-code'

// An edit fold's row. A Client, as a Button always inverts under the pointer. A press is a down and up on the row.
// Margin's lit row, mirrored: listing margin as a dependency would stop this plugin loading without it.
const LIT = '#0f1c28'
type Piece = { text: string; color?: string; bold?: boolean }
const Fold: ClientModule<{ pieces: Piece[] }, { hot?: boolean; down?: boolean }> = ({ pieces }, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'enter') surface.setState({ hot: true })
    else if (e.type === 'leave') surface.setState({ hot: false, down: false })
    else if (e.type === 'down' && e.button === 'left') surface.setState({ hot: true, down: true })
    else if (e.type === 'up' && surface.state?.down) {
      surface.setState({ hot: true, down: false })
      surface.post({ press: true })
    }
  })
  return (
    <Box flexGrow={1} backgroundColor={surface.state?.hot ? LIT : undefined}>
      <Text wrap="truncate-end">
        {pieces.map(({ text, color, bold }) => (
          <Text color={color} bold={bold}>{text}</Text>
        ))}
      </Text>
    </Box>
  )
}

export default Fold
