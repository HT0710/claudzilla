import type { Token } from './explorer-tokens'

export const TAB_STOP = 4

export type Layout = { width: number; wrap: boolean; starts: Uint32Array; rows: number; widest: number }
export type Cached = { loaded: object; width: number; wrap: boolean; layout: Layout }

// Unicode 16.0.0 East Asian Width W and F ranges, generated with unicodedata.
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2630, 0x2637],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x268a, 0x268f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x303e],
  [0x3041, 0x3096],
  [0x3099, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x318e],
  [0x3190, 0x31e5],
  [0x31ef, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18cff, 0x18d08],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1d300, 0x1d356],
  [0x1d360, 0x1d376],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c],
  [0x1fa80, 0x1fa89],
  [0x1fa8f, 0x1fac6],
  [0x1face, 0x1fadc],
  [0x1fadf, 0x1fae9],
  [0x1faf0, 0x1faf8],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

function widthOf(cp: number): number {
  let lo = 0
  let hi = WIDE.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cp < WIDE[mid][0]) hi = mid - 1
    else if (cp > WIDE[mid][1]) lo = mid + 1
    else return 2
  }
  return 1
}

function tabStep(col: number): number {
  return TAB_STOP - (col % TAB_STOP)
}

/** Pads each tab to the next multiple of TAB_STOP cells. */
export function expandTabs(text: string): string {
  let out = ''
  let col = 0
  for (const ch of text) {
    if (ch === '\t') {
      const n = tabStep(col)
      out += ' '.repeat(n)
      col += n
    } else {
      out += ch
      col += widthOf(ch.codePointAt(0)!)
    }
  }
  return out
}

/** Cell count of text, a code point at a time; tabs are not expanded. */
export function cellsOf(text: string): number {
  let n = 0
  for (const ch of text) n += widthOf(ch.codePointAt(0)!)
  return n
}

export type Hit = { from: number; to: number; current: boolean }

/** Display columns of UTF-16 spans in line, counted as layoutOf does. */
export function hitsOf(line: string, spans: readonly { start: number; end: number; current: boolean }[]): Hit[] {
  // One pass: cols[i] is the column at UTF-16 offset i; an offset inside a surrogate pair maps past the glyph.
  const cols = [0]
  let col = 0
  for (const ch of line) {
    col += ch === '\t' ? tabStep(col) : widthOf(ch.codePointAt(0)!)
    if (ch.length > 1) cols.push(col)
    cols.push(col)
  }
  const colAt = (offset: number) => cols[Math.min(offset, cols.length - 1)]!
  return spans.map((s) => ({ from: colAt(s.start), to: colAt(s.end), current: s.current }))
}

/** Keeps the cells in [from, from + width), tabs expanded; a cut wide glyph becomes a space. Cells inside a hit carry its kind. */
export function sliceTokens(tokens: Token[], from: number, width: number, hits?: readonly Hit[]): Token[] {
  const end = from + width
  const out: Token[] = []
  let col = 0
  const hitAt = (c: number): Token['hit'] => {
    const h = hits?.find((x) => c >= x.from && c < x.to)
    return h && (h.current ? 'current' : 'match')
  }
  const put = (s: string, kind: Token['kind'], hit?: Token['hit']) => {
    const last = out[out.length - 1]
    if (last?.kind === kind && last.hit === hit) last.text += s
    else out.push(hit ? { text: s, kind, hit } : { text: s, kind })
  }
  for (const { text, kind } of tokens) {
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (ch === '\t') {
        const n = tabStep(col)
        for (let i = 0; i < n; i++) if (col + i >= from && col + i < end) put(' ', kind, hitAt(col + i))
        col += n
        continue
      }
      const w = widthOf(cp)
      const glyph = cp < 0x20 || cp === 0x7f ? ' ' : ch
      if (w === 1) {
        if (col >= from && col < end) put(glyph, kind, hitAt(col))
      } else if (col >= from && col + 2 <= end) put(ch, kind, hitAt(col))
      else if (col + 2 > from && col < end) put(' ', 'plain')
      col += w
    }
  }
  return out
}

/** One row per line, or with wrap the rows each line needs at width; starts holds each line's first row. */
export function layoutOf(lines: readonly string[], width: number, wrap: boolean): Layout {
  const starts = new Uint32Array(lines.length + 1)
  let widest = 0
  for (let i = 0; i < lines.length; i++) {
    const cells = cellsOf(expandTabs(lines[i]))
    if (cells > widest) widest = cells
    starts[i + 1] = starts[i] + (wrap ? Math.max(1, Math.ceil(cells / width)) : 1)
  }
  return { width, wrap, starts, rows: starts[lines.length], widest }
}

/** Index of the line holding row. */
export function lineAt(layout: Layout, row: number): number {
  let lo = 0
  let hi = layout.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (layout.starts[mid] <= row) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function fileWindow(total: number, top: number, room: number): { top: number; last: number } {
  const t = Math.min(Math.max(0, top), Math.max(0, total - room))
  return { top: t, last: Math.min(total, t + room) }
}

export function thumbOf(total: number, shown: number, top: number, cells: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 }
  const from = Math.floor((top * cells) / total)
  return { from, to: Math.min(cells, Math.max(from + 1, Math.ceil(((top + shown) * cells) / total))) }
}

export function layoutFor(prev: Cached | undefined, loaded: object, width: number, wrap: boolean, lines: readonly string[]): Cached {
  if (prev && prev.loaded === loaded && prev.width === width && prev.wrap === wrap) return prev
  return { loaded, width, wrap, layout: layoutOf(lines, width, wrap) }
}
