// Markdown as one-row pieces any capped or scrolled list can hold: rows of styled spans, and fence lines for the
// engine's `Code`. Draws headings, lists, bold, italic, code spans, links, fences and tables; anything else as text.
// shortcut: widths count characters, not cells; CJK and emoji take two. Upgrade: string-width.

type Style = { bold?: boolean; italic?: boolean; code?: boolean; href?: string }
export type MdSpan = Style & { text: string }
export type MdRow = { indent: number; spans: MdSpan[] } | { code: string; language?: string }

// No backtick after the opening ``` : "```foo``` bar" is inline code, not a fence.
const FENCE = /^\s*(`{3,}(?!.*`)|~{3,})\s*(\S*)/
// A fence closes on its own marker, at least as long, with no info string.
const closes = (open: string, line: string) => {
  const m = FENCE.exec(line)
  return !!m && m[1]![0] === open[0] && m[1]!.length >= open.length && !m[2]
}
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const same = (a: Style, b: Style) => a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href

// A body can link anywhere: only http(s), and within the engine's 2048 characters, as a longer link refuses the pane.
const linkable = (href: string) => {
  try {
    return /^https?:\/\//i.test(href) && encodeURI(href).length <= 2048
  } catch {
    return false
  }
}

// A code span opens and closes on backtick runs of one length.
const MARK = /(`+)(.+?)\1(?!`)|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g

// Words with their style; `glue`: no space before it, as in "(`a.ts`)".
const words = (text: string, base: Style) => {
  const out: { text: string; style: Style; glue: boolean }[] = []
  let space = true
  const push = (part: string, style: Style) => {
    for (const piece of part.split(/(\s+)/)) {
      if (/^\s+$/.test(piece)) space = true
      else if (piece) out.push({ text: piece, style: { ...base, ...style }, glue: !space }), (space = false)
    }
  }
  let at = 0
  for (const m of text.matchAll(MARK)) {
    push(text.slice(at, m.index), {})
    if (m[1] !== undefined) push(m[2]!, { code: true })
    else if (m[3] !== undefined) push(m[3], { bold: true })
    else if (m[4] !== undefined) push(m[4], linkable(m[5]!) ? { href: m[5] } : {})
    else push(m[6]!, { italic: true })
    at = m.index! + m[0].length
  }
  push(text.slice(at), {})
  return out
}

// Packs words into rows `room` wide: glued words stay together, a unit wider than a row is broken.
const wrap = (text: string, base: Style, room: number): MdSpan[][] => {
  const units: { text: string; style: Style }[][] = []
  for (const w of words(text, base)) {
    if (w.glue && units.length) units.at(-1)!.push(w)
    else units.push([w])
  }
  const rows: MdSpan[][] = []
  let row: MdSpan[] = []
  let used = 0
  const add = (text: string, style: Style) => {
    const last = row.at(-1)
    if (last && same(last, style)) last.text += text
    else row.push({ ...style, text })
    used += text.length
  }
  const flush = () => (rows.push(row), (row = []), (used = 0))
  for (const unit of units) {
    const width = unit.reduce((n, w) => n + w.text.length, 0)
    if (used && used + 1 + width > room) flush()
    // The space takes the style both sides share, so a link or code span spans its words.
    if (used) add(' ', same(row.at(-1)!, unit[0]!.style) ? unit[0]!.style : {})
    for (const w of unit)
      for (let rest = w.text; rest; ) {
        if (used >= room) flush()
        const piece = rest.slice(0, room - used)
        add(piece, w.style)
        rest = rest.slice(piece.length)
      }
  }
  if (row.length) flush()
  return rows
}

// `\|` is a pipe inside a cell, code spans included, as on GitHub.
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||(?<!\\)\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(c => c.trim().replace(/\\\|/g, '|'))
// Outer pipes are optional; a pipe-less `---` stays a paragraph line.
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const tableAt = (lines: string[], i: number) => lines[i]!.includes('|') && i + 1 < lines.length && lines[i + 1]!.includes('|') && DELIM.test(lines[i + 1]!)

const drawn = (spans: MdSpan[]) => spans.reduce((n, s) => n + s.text.length, 0)

// A table that fits `width` draws as a grid: bold header, a rule under it, the first column split off by a bar.
const tableRows = (lines: string[], at: number[], width: number): [MdRow, number][] => {
  const head = cells(lines[0]!)
  const body = lines.slice(2).map(cells)
  const draw = (row: string[], base: Style) => head.map((_, i) => wrap(row[i] ?? '', base, Infinity)[0] ?? [])
  const grid = [draw(head, { bold: true }), ...body.map(r => draw(r, {}))]
  const widths = head.map((_, c) => grid.reduce((m, r) => Math.max(m, drawn(r[c]!)), 0))
  const full = head.length > 1 ? widths.reduce((n, w) => n + w, 0) + 2 * (head.length - 1) + 1 : widths[0]!
  if (full > width)
    // A table that does not fit reads as one row per data row: the first cell bold, the rest after it.
    return body.flatMap((row, k) => {
      const [first, ...rest] = row
      // Marks don't nest: a cell with its own keeps them, unbolded.
      const text = `${first && first.search(MARK) < 0 ? `**${first}**` : first} — ${rest.join(' · ')}`
      return wrap(text, {}, Math.max(1, width)).map((spans): [MdRow, number] => [{ indent: 0, spans }, at[k + 2]!])
    })
  const line = (spans: MdSpan[], n: number): [MdRow, number] => [{ indent: 0, spans }, n]
  const row = (cols: MdSpan[][], n: number) =>
    line(
      cols.flatMap((spans, c) => [
        ...(c ? [{ text: c === 1 ? ' │ ' : '  ' }] : []),
        ...spans,
        ...(widths[c]! > drawn(spans) ? [{ text: ' '.repeat(widths[c]! - drawn(spans)) }] : []),
      ]),
      n,
    )
  const rule = head.length > 1 ? '─'.repeat(widths[0]! + 1) + '┼' + '─'.repeat(full - widths[0]! - 2) : '─'.repeat(full)
  return [row(grid[0]!, at[0]!), line([{ text: rule }], at[1]!), ...grid.slice(1).map((r, k) => row(r, at[k + 2]!))]
}

// One block's rows, each with the source line it starts at: a fence's lines as code; else headings, list items and paragraphs, each wrapped.
const blockRows = (lines: string[], at: number[], width: number): [MdRow, number][] => {
  const fence = FENCE.exec(lines[0]!)
  if (fence) {
    const body = lines.slice(1)
    if (body.length && closes(fence[1]!, body.at(-1)!)) body.pop()
    return body.map((code, i) => [{ code, ...(fence[2] ? { language: fence[2] } : {}) }, at[i + 1]!])
  }
  if (tableAt(lines, 0)) return tableRows(lines, at, width)
  // A table may start mid-block, right under a paragraph.
  const start = lines.findIndex((_, i) => i > 0 && tableAt(lines, i))
  if (start > 0) return [...blockRows(lines.slice(0, start), at.slice(0, start), width), ...blockRows(lines.slice(start), at.slice(start), width)]
  const items: { lead: number; marker: string; text: string; style: Style; line: number }[] = []
  lines.forEach((raw, k) => {
    const line = raw.replace(/^\s*>\s?/, '')
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = ITEM.exec(line)
    const last = items.at(-1)
    if (heading) items.push({ lead: 0, marker: '', text: heading[1]!, style: { bold: true }, line: at[k]! })
    else if (item) items.push({ lead: item[1]!.length, marker: `${item[2]} `, text: item[3]!, style: {}, line: at[k]! })
    else if (last && !last.style.bold) last.text += ` ${line.trim()}`
    else items.push({ lead: 0, marker: '', text: line.trim(), style: {}, line: at[k]! })
  })
  return items.flatMap(it =>
    wrap(it.text, it.style, Math.max(1, width - it.lead - it.marker.length)).map((spans, i): [MdRow, number] => [
      i ? { indent: it.lead + it.marker.length, spans } : { indent: it.lead, spans: it.marker ? [{ text: it.marker }, ...spans] : spans },
      it.line,
    ]),
  )
}

// Rows of `md` at `width`: blocks split at blank lines, never inside a fence, a blank row between those that draw.
// An HTML comment reads as blank, as GitHub hides it. Only one that opens a line: mid-line it stays text.
// `lines[i]` is row i's source line index; a blank row between blocks takes the row above's.
export function mdLayout(md: string, width: number): { rows: MdRow[]; lines: number[] } {
  const blocks: { lines: string[]; at: number[] }[] = []
  let cur: string[] = []
  let at: number[] = []
  let fence = ''
  let comment = false
  const end = () => {
    if (cur.length) blocks.push({ lines: cur, at })
    cur = []
    at = []
  }
  // Tab and newline are the only control characters the engine draws.
  md.replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').split('\n').forEach((line, n) => {
    const open = FENCE.exec(line)
    if (fence) {
      cur.push(line), at.push(n)
      if (closes(fence, line)) end(), (fence = '')
    } else if (comment) comment = !line.includes('-->')
    // A fence is its own block, even with no blank line around it.
    else if (open) {
      end()
      cur.push(line), at.push(n)
      fence = open[1]!
    } else if (/^\s*<!--/.test(line) && !/-->/.test(line)) {
      comment = true
      end()
    } else if (line.trim() && !/^\s*<!--.*-->\s*$/.test(line)) cur.push(line), at.push(n)
    else end()
  })
  end()
  const rows: MdRow[] = []
  const lines: number[] = []
  for (const block of blocks) {
    const got = blockRows(block.lines, block.at, width)
    if (!got.length) continue
    if (rows.length) rows.push({ indent: 0, spans: [] }), lines.push(lines.at(-1)!)
    for (const [row, line] of got) rows.push(row), lines.push(line)
  }
  return { rows, lines }
}

export const mdRows = (md: string, width: number): MdRow[] => mdLayout(md, width).rows

// The first row of the last item or block starting at or above source line `line`.
export function mdTopFor(lines: readonly number[], line: number): number {
  let top = 0
  for (let i = 0; i < lines.length && lines[i]! <= line; i++) if (lines[i] !== lines[top]) top = i
  return top
}
