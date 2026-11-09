import type { Tab } from '../types'

export type Split = { rows: number; min: number; max: number }
export type Zone = {
  tab: Tab
  kind: 'modal' | 'divider' | 'list'
  // Rows `from` up to `to` of the tab's tree; a pointer row counts from the engine's window, so `offset` is added to it.
  from: number
  to: number
  // The engine's scroll offset when drawn; 0 where the engine does not scroll the tab.
  offset: number
  // A modal layer's columns; any column elsewhere.
  columns?: [number, number]
  // Takes a notch no zone is under, or one with no pointer: History's list, Git's COMMITS.
  fallback?: boolean
  // A divider's name for WHEEL_HOLD.
  hold?: 'git' | 'topics'
  // The store update, made in the draw (R5): `$` and the atoms stay in the drawing file.
  wheel: (by: number) => Promise<unknown>
}

export const WHEEL_HOLD = 1000
// A stored split moved by `by` rows, from the rows drawn while it is unset, kept to the drawn bounds.
export const nudge = (stored: number, { rows, min, max }: Split, by: number) =>
  Math.max(min, Math.min((stored >= 0 ? Math.max(min, Math.min(stored, max)) : rows) + by, max))

// The zones as last drawn. Draws run at the same time and Git reads before it draws, so a draw start keeps its own
// tab's zones and a finished draw replaces them.
let zones: Zone[] = []
export const drawnZones = (): readonly Zone[] => zones
export const keepZones = (tab: Tab) => {
  zones = zones.filter(z => z.tab === tab)
}
export const setZones = (tab: Tab, drawn: Zone[]) => {
  zones = [...zones.filter(z => z.tab !== tab), ...drawn]
}
export const modalOpen = () => zones.some(z => z.kind === 'modal')
