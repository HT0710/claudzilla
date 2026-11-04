import type { ClientModule } from 'claude-code'

// A Git tab top row that tells the plugin when the pointer enters or leaves it, so its hover card closes once the
// pointer leaves the row: a card revealed by hover stays lit under the pointer, as it joins the row's group.
// A press is a down and up on the row.
// Behind a modal: `faded`, its colours already faded, it neither lights nor posts; `open`, the row that opened the
// modal, it stays lit in that colour and posts its presses alone.
// `line`: the hover group the row heats, so the next line's pieces, which carry its `hover`, fade at once.
// `under`: a second fade group, on a nested Text that takes the piece's colour, as a Text takes one hover.
type Piece = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; hover?: object; under?: object }
const Row: ClientModule<
  { left: Piece[]; right: Piece[]; faded?: boolean; open?: string; line?: string },
  { down?: boolean }
> = ({ left, right, faded, open, line }, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (faded) return
    if (e.type === 'enter' || e.type === 'leave') {
      if (!open) surface.post({ hover: e.type === 'enter' })
    } else if (e.type === 'down' && e.button === 'left') surface.setState({ down: true })
    else if (e.type === 'up' && surface.state?.down) {
      surface.setState({ down: false })
      if (e.y === 0 && e.x >= 0 && e.x < surface.columns) surface.post({ press: true })
    }
  })
  const texts = (pieces: Piece[]) =>
    pieces.map(({ text, under, ...style }) => (
      <Text {...style} backgroundColor={style.backgroundColor ?? open}>
        {under ? <Text hover={under}>{text}</Text> : text}
      </Text>
    ))
  return (
    <Box flexGrow={1} justifyContent="space-between" backgroundColor={open} hover={line ? { scope: line } : undefined}>
      <Text wrap="truncate-end">{texts(left)}</Text>
      {/* Pieces nest in a Text on both sides: a nested Text follows the line above's dim group but cannot heat it. */}
      <Box flexShrink={0}>
        <Text>{texts(right)}</Text>
      </Box>
    </Box>
  )
}

export default Row
