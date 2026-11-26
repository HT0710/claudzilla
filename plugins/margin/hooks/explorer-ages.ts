export const SCAN_CAP = 5000

export type Scan = { capped: boolean; at: ReadonlyMap<string, number> }

/** Reads `<seconds> <name>` lines (names relative to `page`) into ms ages for each file and each folder above it. */
export function parseScan(out: string, page: string): Scan {
  const rows = out.split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  if (rows.length > SCAN_CAP) return { capped: true, at: new Map() }
  const at = new Map<string, number>()
  const base = page.replace(/\/$/, '')
  for (const row of rows) {
    const m = /^(\d+) (.+)$/.exec(row)
    if (!m) continue
    const ms = Number(m[1]) * 1000
    const name = m[2]!.replace(/^\.\//, '').replace(/\/$/, '')
    for (let i = name.length; i > 0; i = name.lastIndexOf('/', i - 1)) {
      const key = `${base}/${name.slice(0, i)}`
      if ((at.get(key) ?? -1) < ms) at.set(key, ms)
    }
  }
  return { capped: false, at }
}

export const ageOf = (scan: Scan | undefined, path: string): number | undefined => (scan?.capped ? undefined : scan?.at.get(path))
