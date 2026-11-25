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

export const MAX_DIFF_LINES = 20000

// shortcut: one changed block per file, so edits far apart mark everything between them; upgrade to a full diff (Myers) when multi-region writes matter
export function lineDiff(before: readonly string[], after: readonly string[]): DiffMarks | undefined {
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) return undefined
  const max = Math.min(before.length, after.length)
  let head = 0
  while (head < max && before[head] === after[head]) head++
  let tail = 0
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const added = new Set<number>()
  const removed = new Map<number, string[]>()
  if (before.length - tail > head) removed.set(head + 1, before.slice(head, before.length - tail).map((l) => cleanLine(l.replace(/\r$/, ''))))
  for (let n = head + 1; n <= after.length - tail; n++) added.add(n)
  return { added, removed }
}

export function editDiff(after: string, oldText: string, newText: string, replaceAll: boolean): DiffMarks | undefined {
  if (replaceAll || newText === '') return undefined
  const at = after.indexOf(newText)
  if (at < 0 || after.indexOf(newText, at + 1) >= 0) return undefined
  const end = at + newText.length
  const from = at > 0 ? after.lastIndexOf('\n', at - 1) + 1 : 0
  const nl = after.indexOf('\n', oldText && !oldText.endsWith('\n') ? end : end - 1)
  const to = nl < 0 ? after.length : nl
  const row = (t: string) => cleanLine(t.replace(/\r$/, ''))
  const first = after.slice(0, from).split('\n').length
  const newRows = after.slice(from, to).split('\n')
  const oldFull = (after.slice(from, at) + oldText + (end < to ? after.slice(end, to) : ''))
  const oldRows = (newText.endsWith('\n') ? oldFull.replace(/\n$/, '') : oldFull).split('\n')
  const added = new Set<number>()
  newRows.forEach((_, i) => added.add(first + i))
  return { added, removed: new Map([[first, oldRows.map(row)]]) }
}

export function reloadDiff(
  before: readonly string[] | undefined,
  after: readonly string[],
  edit?: { oldText: string; newText: string; replaceAll: boolean },
): DiffMarks | undefined {
  if (!before) return undefined
  return (edit && editDiff(after.join('\n'), edit.oldText, edit.newText, edit.replaceAll)) || lineDiff(before, after)
}
