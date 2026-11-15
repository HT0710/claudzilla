import type { ClientModule } from 'claude-code'

type Piece = { text: string; color?: string; dimColor?: boolean }
export type FooterState = 'working' | 'planning' | 'waiting' | 'done' | 'stopped'
export type FooterProps = { state: FooterState; color: string; since: number; now: number; at?: number; end?: string; right: Piece[]; faint: string; clockColor: string }

export const TICK = 120
const STATES = {
  working: { frames: ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'], every: 1, word: 'working', lead: 'for' },
  planning: { frames: ['◐', '◓', '◑', '◒'], every: 1, word: 'planning', lead: 'for' },
  waiting: { frames: ['•∙∙', '∙•∙', '∙∙•', '∙•∙'], every: 3, word: 'waiting', lead: 'for' },
  done: { frames: ['✓'], every: 1, word: 'done', lead: 'in' },
  stopped: { frames: ['■'], every: 1, word: 'stopped', lead: 'after' },
}

// Compact units: 4s, 1m 4s, 1h 2m 5s; seconds stay, as the counter ticks each second.
export const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const [h, m] = [Math.floor(s / 3600), Math.floor(s / 60) % 60]
  return `${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${s % 60}s`
}

// The row's texts and the spaces between them; `now` is the time a live counter reads. The middle group sits on the
// row's centre, and goes when it would touch the left or right text.
export const footerParts = (p: FooterProps, tick: number, now: number, columns: number) => {
  const s = STATES[p.state]
  const left = `${s.frames[Math.floor(tick / s.every) % s.frames.length]} ${s.word}`
  const rightLen = p.right.reduce((n, x) => n + x.text.length, 0)
  const end = p.at ?? now
  const counter = p.since > 0 && p.since <= end ? duration(end - p.since) : undefined
  const clock = p.at !== undefined && p.end ? p.end : undefined
  const midLen = counter ? s.lead.length + 1 + counter.length + (clock ? 4 + clock.length : 0) : 0
  const start = Math.floor((columns - midLen) / 2)
  const leftMax = Math.max(...s.frames.map(f => f.length)) + 1 + s.word.length
  const mid = counter && start > leftMax && start + midLen < columns - rightLen ? { lead: s.lead, counter, clock } : undefined
  return {
    left,
    mid,
    gap: mid ? [start - left.length, columns - rightLen - start - midLen] : [Math.max(1, columns - left.length - rightLen)],
  }
}

export const footerRow = (el: { Box: any; Text: any }, p: FooterProps, tick: number, now: number, columns: number) => {
  const { Box, Text } = el
  const { left, mid, gap } = footerParts(p, tick, now, columns)
  return (
    <Box height={1} flexGrow={1} overflow="hidden">
      <Text key="state" color={p.color}>{left}</Text>
      <Text>{' '.repeat(gap[0])}</Text>
      {mid && (
        <Text>
          <Text color={p.faint}>{`${mid.lead} `}</Text>
          <Text>{mid.counter}</Text>
          {mid.clock && <Text color={p.faint}>{' at '}</Text>}
          {mid.clock && <Text color={p.clockColor}>{mid.clock}</Text>}
        </Text>
      )}
      {mid && <Text>{' '.repeat(gap[1])}</Text>}
      {p.right.length > 0 && <Text key="count">{p.right.map(({ text, ...style }) => <Text {...style}>{text}</Text>)}</Text>}
    </Box>
  )
}

// The Overview footer: a frame clock animates the glyph, and a live counter reads the time since the turn began.
// `now` is the plugin's clock at the draw; ticks since then add on, as Date is not the plugin's clock here.
const Footer: ClientModule<FooterProps, { tick: number; live: boolean; seen: number; base: number }> = (p, surface) => {
  const live = p.at === undefined
  const old = surface.state
  const state = !old ? { tick: 0, live, seen: p.now, base: 0 } : old.seen !== p.now || old.live !== live ? { ...old, live, seen: p.now, base: old.tick } : old
  if (!old)
    surface.every(TICK, () => {
      const at = surface.state
      if (at?.live) surface.setState({ ...at, tick: at.tick + 1 })
    })
  if (state !== old) surface.setState(state)
  return footerRow(surface.elements, p, state.tick, p.now + (state.tick - state.base) * TICK, surface.columns)
}

export default Footer
