export const RECENT_MAX = 8

export type Recent = { path: string; at: number }

const viewed = new Map<string, number>()
const edited = new Map<string, number>()

export function markViewed(path: string, at: number): void {
  viewed.set(path, Math.max(at, viewed.get(path) ?? at))
}

export function viewedList(): Recent[] {
  return [...viewed].map(([path, at]) => ({ path, at }))
}

export function markEdited(path: string, at: number): void {
  edited.set(path, at)
}

export function editedAt(path: string): number | undefined {
  return edited.get(path)
}

export function resetRecent(): void {
  viewed.clear()
  edited.clear()
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Age in exactly 3 cells: `now`, ` 5m`, `40m`, ` 3h`, `99d`, `14w`, ` 1y`. */
export function ageText(ms: number, now: number): string {
  const d = Math.max(0, now - ms)
  const [n, unit] =
    d < MIN ? [0, '']
    : d < HOUR ? [Math.floor(d / MIN), 'm']
    : d < DAY ? [Math.floor(d / HOUR), 'h']
    : d < 100 * DAY ? [Math.floor(d / DAY), 'd']
    : d < 365 * DAY ? [Math.floor(d / (7 * DAY)), 'w']
    : [Math.floor(d / (365 * DAY)), 'y']
  // shortcut: past 99 years the text is 4 cells, upgrade if a clock ever reads older
  return unit ? `${n}${unit}`.padStart(3) : 'now'
}

export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function recentSplit(entries: readonly Recent[], now: number, text: string): { today: Recent[]; earlier: Recent[] } {
  const q = text.toLowerCase()
  const kept = entries
    .filter((e) => !q || (e.path.slice(e.path.lastIndexOf('/') + 1).toLowerCase().includes(q)))
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_MAX)
  const mid = startOfDay(now)
  return { today: kept.filter((e) => e.at >= mid), earlier: kept.filter((e) => e.at < mid) }
}
