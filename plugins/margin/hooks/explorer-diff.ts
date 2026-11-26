import type { Layout } from './explorer-layout'
import { toneRows } from './explorer-layout'
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
    let oldLeft = b
    let newLeft = d
    let n = d > 0 ? c : c + 1
    while ((oldLeft > 0 || newLeft > 0) && i + 1 < lines.length) {
      const l = lines[++i]
      if (l[0] === '\\') continue
      if (l[0] === '+') {
        added.add(n++)
        newLeft--
      } else if (l[0] === '-') {
        const rows = removed.get(n) ?? []
        rows.push(cleanLine(l.slice(1).replace(/\r$/, '')))
        removed.set(n, rows)
        oldLeft--
      } else {
        n++
        oldLeft--
        newLeft--
      }
    }
  }
  return { added, removed }
}

// The control set folio strips from its diffs (plugins/folio/hooks/register.tsx:44).
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

// Each hunk's marks at its place in `lines`, and the first marked line. undefined when a hunk matches nowhere, or in more than one place and not at its own header line.
export function relocateEdit(diff: string, lines: readonly string[]): { marks: DiffMarks; first: number } | undefined {
  const file = lines.map((l) => l.replace(CONTROL, ''))
  const added = new Set<number>()
  const removed = new Map<number, string[]>()
  for (const hunk of diff.split(/^(?=@@ )/m)) {
    const h = HUNK.exec(hunk)
    if (!h) continue
    const start = Number(h[3])
    const anchor = hunk.split('\n').filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1).replace(CONTROL, ''))
    let offset = 0
    if (!anchor.length) {
      if (file.join('\n') !== '') return undefined
    } else {
      const at = (s: number) => s >= 0 && s + anchor.length <= file.length && anchor.every((t, i) => file[s + i] === t)
      if (!at(start - 1)) {
        let found = -1
        for (let s = 0; s + anchor.length <= file.length; s++) {
          if (!at(s)) continue
          if (found >= 0) return undefined
          found = s
        }
        if (found < 0) return undefined
        offset = found + 1 - start
      }
    }
    const m = parseDiff(hunk)
    for (const n of m.added) added.add(n + offset)
    for (const [n, rows] of m.removed) removed.set(n + offset, [...(removed.get(n + offset) ?? []), ...rows])
  }
  const keys = [...added, ...removed.keys()]
  if (!keys.length) return undefined
  return { marks: { added, removed }, first: Math.min(...keys) }
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

// Union. git's red rows win at one key.
export function mergeMarks(git: DiffMarks | undefined, reload: DiffMarks | undefined): DiffMarks | undefined {
  if (!git || !reload) return git ?? reload
  return { added: new Set([...git.added, ...reload.added]), removed: new Map([...reload.removed, ...git.removed]) }
}

// A red row gives `last`, so a drag keeps its last current line.
export function codeLineAt(rows: readonly { line: number; tone?: 'add' | 'del' }[], y: number, last?: number): number | undefined {
  const r = rows[Math.max(0, Math.min(y, rows.length - 1))]
  return r?.tone === 'del' ? last : r?.line
}

// A red row above line `before` is lit when lines before - 1 and before are both in [lo, hi]. The trailing block is never lit.
export function redLit(before: number, lo: number, hi: number): boolean {
  return before - 1 >= lo && before <= hi
}

export function sameMarks(a: DiffMarks | undefined, b: DiffMarks | undefined): boolean {
  const x = a ?? { added: new Set<number>(), removed: new Map<number, string[]>() }
  const y = b ?? { added: new Set<number>(), removed: new Map<number, string[]>() }
  if (x.added.size !== y.added.size || x.removed.size !== y.removed.size) return false
  for (const n of x.added) if (!y.added.has(n)) return false
  for (const [k, v] of x.removed) {
    const w = y.removed.get(k)
    if (!w || w.length !== v.length || v.some((t, i) => t !== w[i])) return false
  }
  return true
}

export function pressLine(row: { line: number; tone?: 'add' | 'del' }): number | undefined {
  return row.tone === 'del' ? undefined : row.line
}

export function barCells(total: number, cells: number, rows: readonly { row: number; tone: 'add' | 'del' }[], colours: { add: string; del: string; mixed: string }): (string | null)[] {
  if (cells <= 0) return []
  const seen = Array.from({ length: cells }, () => ({ add: false, del: false }))
  for (const { row, tone } of rows) if (row >= 0 && row < total) seen[total <= cells ? row : Math.floor((row * cells) / total)]![tone] = true
  return seen.map(c => (c.add && c.del ? colours.mixed : c.add ? colours.add : c.del ? colours.del : null))
}

export type BarKey = { layout: Layout; reload?: DiffMarks; diff?: DiffMarks; showDiff: boolean; cells: number }
export type BarCache = BarKey & { marks: (string | null)[] }

// Reload marks win a cell over git marks. The same key returns prev itself.
export function cachedBar(prev: BarCache | undefined, key: BarKey, colours: { add: string; del: string; mixed: string }): BarCache {
  if (prev && prev.layout === key.layout && prev.reload === key.reload && prev.diff === key.diff && prev.showDiff === key.showDiff && prev.cells === key.cells) return prev
  const { layout, cells } = key
  const reloadCells = barCells(layout.rows, cells, toneRows(layout, key.reload), colours)
  const gitCells = barCells(layout.rows, cells, key.showDiff ? toneRows(layout, key.diff) : [], colours)
  return { ...key, marks: reloadCells.map((r, i) => r ?? gitCells[i]!) }
}
