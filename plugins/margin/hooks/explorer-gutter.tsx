import type { ClientModule } from 'claude-code'

import { codeLineAt, redLit } from './explorer-diff'

type Props = {
  rows: { row: number; line: number; before?: number; cell: string; lit: boolean; hit?: boolean; tone?: 'add' | 'del' }[]
  colors: { lit: string; faint: string; claude: string; warning: string; add: string; del: string; addBg: string; delBg: string }
}

// The code view's line numbers: a drag from one to another posts the lines it covered once let go. The gutter
// stays put while dragging and draws the range, so rows are never counted from a spot that has moved.
const Gutter: ClientModule<Props, { anchor?: number; to?: number }> = ({ rows, colors }, surface) => {
  const { Box, Text } = surface.elements
  const lineAt = (y: number, last?: number) => codeLineAt(rows, y, last)
  surface.onPointer(e => {
    const { anchor, to } = surface.state ?? {}
    if (e.type === 'down' && e.button === 'left') {
      const at = lineAt(e.y)
      if (at !== undefined) surface.setState({ anchor: at, to: at })
    } else if (e.type === 'move' && e.button && anchor !== undefined) surface.setState({ anchor, to: lineAt(e.y, to) })
    // A move with no button held while anchored is an up the surface missed.
    else if ((e.type === 'up' || (e.type === 'move' && !e.button)) && anchor !== undefined) {
      const end = lineAt(e.y, to) ?? to ?? anchor
      surface.setState({})
      surface.post({ first: Math.min(anchor, end), last: Math.max(anchor, end) })
    }
  })
  const { anchor, to } = surface.state ?? {}
  const dragging = anchor !== undefined && to !== undefined
  return (
    <Box flexDirection="column">
      {rows.map(r => {
        const lo = dragging ? Math.min(anchor, to) : 0
        const hi = dragging ? Math.max(anchor, to) : 0
        const inRange = dragging ? (r.tone === 'del' ? redLit(r.before ?? 0, lo, hi) : r.line >= lo && r.line <= hi) : r.lit
        const diff = r.tone === 'add' ? colors.add : r.tone === 'del' ? colors.del : colors.faint
        const diffBg = r.tone === 'add' ? colors.addBg : r.tone === 'del' ? colors.delBg : undefined
        return (
          <Text key={r.row} color={r.hit ? colors.warning : diff} backgroundColor={inRange ? colors.lit : diffBg}>
            {r.cell}
          </Text>
        )
      })}
    </Box>
  )
}

export default Gutter
