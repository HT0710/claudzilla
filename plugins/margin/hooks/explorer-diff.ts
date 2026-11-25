import { cleanLine } from './explorer-load'

export type DiffMarks = { added: Set<number>; removed: Map<number, string[]> }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseDiff(diff: string): DiffMarks {
  const added = new Set<number>()
  const removed = new Map<number, string[]>()
  const lines = diff.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const h = HUNK.exec(lines[i])
    if (!h) continue
    const b = h[2] === undefined ? 1 : Number(h[2])
    const c = Number(h[3])
    const d = h[4] === undefined ? 1 : Number(h[4])
    const rows = lines.slice(i + 1, i + 1 + b).map((l) => cleanLine(l.slice(1).replace(/\r$/, '')))
    if (rows.length) removed.set(d > 0 ? c : c + 1, [...(removed.get(d > 0 ? c : c + 1) ?? []), ...rows])
    for (let n = c; n < c + d; n++) added.add(n)
    i += b + d
  }
  return { added, removed }
}

export function firstChangeLine(diff: string): number | undefined {
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(diff)
  return h ? Math.max(1, Number(h[1])) : undefined
}
