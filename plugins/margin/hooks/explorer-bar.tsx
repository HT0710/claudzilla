import type { ClientModule } from 'claude-code'

import { thumbOf } from './explorer-layout'

type Props = { axis: 'v' | 'h'; cells: number; from: number; to: number; total: number; shown: number; top: number; glyph: string; color: string; marks?: (string | null)[] }
type State = { grab?: number; top0?: number; to?: number; by?: number }

// A scroll bar: `cells` cells along `axis`, the thumb the cells in [from, to). Dragged, the bar stays put and
// draws the thumb where it would land, posting `{ top }` on each move and once let go. Every spot counts from the
// press, never from a redrawn bar: moved under the pointer, a drag got cells counted from where the terminal had
// not yet moved it, and jumped. A press off the thumb draws the jump at once and posts it on release.
const Bar: ClientModule<Props, State> = ({ axis, cells, from, to, total, shown, top, glyph, color, marks }, surface) => {
  const { Box, Text } = surface.elements
  const clamp = (t: number) => Math.max(0, Math.min(t, Math.max(0, total - shown)))
  surface.onPointer(e => {
    const pos = axis === 'v' ? e.y : e.x
    const { grab, top0, to: jump, by } = surface.state ?? {}
    if (e.type === 'down' && e.button === 'left') {
      if (pos >= from && pos < to) surface.setState({ grab: pos, top0: top })
      else surface.setState({ grab: pos, to: clamp(Math.round((pos * total) / cells - shown / 2)) })
    } else if (e.type === 'move' && e.button && grab !== undefined && jump === undefined) {
      const next = ((pos - grab) * total) / cells
      surface.setState({ grab, top0, by: next })
      surface.post({ top: clamp((top0 ?? top) + Math.round(next)) })
    }
    // A move with no button held while grabbed is an up the surface missed.
    else if ((e.type === 'up' || (e.type === 'move' && !e.button)) && grab !== undefined) {
      surface.setState({})
      surface.post({ top: jump ?? clamp((top0 ?? top) + Math.round(by ?? 0)) })
    }
  })
  const { top0, to: jump, by } = surface.state ?? {}
  const at = jump ?? (by === undefined ? top : clamp((top0 ?? top) + Math.round(by)))
  const thumb = at === top ? { from, to } : thumbOf(total, shown, at, cells)
  const inThumb = (i: number) => i >= thumb.from && i < thumb.to
  const cell = (i: number) => (inThumb(i) ? glyph : marks?.[i] ? '\u2501' : ' ')
  const all = Array.from({ length: cells }, (_, i) => cell(i))
  return axis === 'v' ? (
    <Box flexDirection="column">
      {all.map((c, i) => (
        <Text key={i} color={marks?.[i] ?? color}>
          {c}
        </Text>
      ))}
    </Box>
  ) : (
    <Text color={color}>{all.join('')}</Text>
  )
}

export default Bar
