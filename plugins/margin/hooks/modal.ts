// The Git tab's modals, in cells of the tab body: where each layer sits, how many rows its lists show and
// which rows its scroll window holds.

// A modal list's rows before "show all"; one row more shows whole, as "show all" would take its place.
export const CAP = 3
// Each layer's inset from the one under it: a pane is mostly taller than wide, so height gets the smaller share.
export const INSET_X = 0.05
export const INSET_Y = 0.03

export type Frame = { top: number; left: number; width: number; height: number }

export const insets = (cols: number, rows: number) => ({
  x: Math.max(1, Math.round(cols * INSET_X)),
  y: Math.max(1, Math.round(rows * INSET_Y)),
})

// `want`: the rows the modal needs, border included. It grows to that, up to its limit, centred.
export const modalFrame = (cols: number, rows: number, want: number): Frame => {
  const { x, y } = insets(cols, rows)
  const height = Math.min(want, rows - 2 * y)
  return { top: Math.floor((rows - height) / 2), left: x, width: cols - 2 * x, height }
}

// Over a modal at its limit, the gaps that modal really left; over a shorter one, the modal's limit one step in,
// so the stacked modal may cover it.
export const stackFrame = (cols: number, rows: number, modal: Frame, want: number): Frame => {
  const { x, y } = insets(cols, rows)
  const limit = rows - 2 * y
  const full = modal.height >= limit - 1
  const under = full ? modal : { top: y, height: limit, left: modal.left, width: modal.width }
  const [gx, gy] = full ? [modal.left, modal.top] : [x, y]
  const height = Math.min(want, under.height - 2 * gy)
  return { top: under.top + Math.floor((under.height - height) / 2), left: under.left + gx, width: under.width - 2 * gx, height }
}

// The rows a capped list shows, from `from` where it fits, and whether "show all" follows them.
export const capped = <T>(rows: T[], from = 0): { rows: T[]; more: boolean } => {
  if (rows.length <= CAP + 1) return { rows, more: false }
  const at = Math.max(0, Math.min(from, rows.length - CAP))
  return { rows: rows.slice(at, at + CAP), more: true }
}

// `room`: rows for the list and its cues. Each cue shown takes a row, except a top cue merged into the divider.
// Cues need 3 rows: one row each and one to list.
export const scrollWindow = (total: number, top: number, room: number, mergedTop: boolean) => {
  if (total <= room || room < 3) return { top: 0, shown: Math.min(total, room), above: 0, below: Math.max(0, total - room) }
  const upRow = mergedTop ? 0 : 1
  const at = Math.max(0, Math.min(top, total - (room - upRow)))
  let shown = room - (at > 0 ? upRow : 0)
  if (at + shown < total) shown -= 1
  return { top: at, shown, above: at, below: total - at - shown }
}
