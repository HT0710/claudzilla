// Markdown as one-row pieces any capped or scrolled list can hold: rows of styled spans, and fence lines for the
// engine's `Code`. Draws headings, lists, bold, italic, code spans, links, fences and tables; anything else as text.
// shortcut: widths count characters, not cells; CJK and emoji take two. Upgrade: string-width.

type Style = { bold?: boolean; italic?: boolean; code?: boolean; href?: string }
export type MdSpan = Style & { text: string }
export type MdRow = { indent: number; spans: MdSpan[] } | { code: string; language?: string }

// No backtick after the opening ``` : "```foo``` bar" is inline code, not a fence.
const FENCE = /^\s*(```(?!.*`)|~~~)\s*(\S*)/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const same = (a: Style, b: Style) => a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.href === b.href

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
  // A code span opens and closes on backtick runs of one length.
  const mark = /(`+)(.+?)\1(?!`)|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g
  let at = 0
  for (const m of text.matchAll(mark)) {
    push(text.slice(at, m.index), {})
    if (m[1] !== undefined) push(m[2]!, { code: true })
    else if (m[3] !== undefined) push(m[3], { bold: true })
    else if (m[4] !== undefined) push(m[4], { href: m[5] })
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

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

// One block's rows: a fence's lines as code; else headings, list items and paragraphs, each wrapped.
const blockRows = (lines: string[], width: number): MdRow[] => {
  const fence = FENCE.exec(lines[0]!)
  if (fence) {
    const body = lines.slice(1)
    if (FENCE.test(body.at(-1) ?? '')) body.pop()
    return body.map(code => ({ code, ...(fence[2] ? { language: fence[2] } : {}) }))
  }
  // A table reads as one row per data row: the first cell bold, the rest after it.
  const table = lines.length > 1 && lines[0]!.startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[1]!.trim())
  if (table)
    lines = lines.slice(2).map(line => {
      const [first, ...rest] = cells(line)
      return `**${first}** — ${rest.join(' · ')}`
    })
  const items: { lead: number; marker: string; text: string; style: Style }[] = []
  for (const raw of lines) {
    const line = raw.replace(/^\s*>\s?/, '')
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = ITEM.exec(line)
    const last = items.at(-1)
    if (heading) items.push({ lead: 0, marker: '', text: heading[1]!, style: { bold: true } })
    else if (item) items.push({ lead: item[1]!.length, marker: `${item[2]} `, text: item[3]!, style: {} })
    else if (last && !last.style.bold && !table) last.text += ` ${line.trim()}`
    else items.push({ lead: 0, marker: '', text: line.trim(), style: {} })
  }
  return items.flatMap(it =>
    wrap(it.text, it.style, Math.max(1, width - it.lead - it.marker.length)).map((spans, i) =>
      i ? { indent: it.lead + it.marker.length, spans } : { indent: it.lead, spans: it.marker ? [{ text: it.marker }, ...spans] : spans },
    ),
  )
}

// Rows of `md` at `width`: blocks split at blank lines, never inside a fence, a blank row between those that draw.
// An HTML comment line reads as blank, as GitHub hides it.
export function mdRows(md: string, width: number): MdRow[] {
  const blocks: string[][] = []
  let cur: string[] = []
  let fence = false
  for (const line of md.replace(/\r/g, '').split('\n')) {
    // A fence is its own block, even with no blank line around it.
    if (FENCE.test(line)) {
      if (!fence && cur.length) blocks.push(cur), (cur = [])
      cur.push(line)
      if (fence) blocks.push(cur), (cur = [])
      fence = !fence
    } else if (fence || (line.trim() && !/^\s*<!--.*-->\s*$/.test(line))) cur.push(line)
    else if (cur.length) blocks.push(cur), (cur = [])
  }
  if (cur.length) blocks.push(cur)
  return blocks
    .map(block => blockRows(block, width))
    .filter(rows => rows.length)
    .flatMap((rows, i) => [...(i ? [{ indent: 0, spans: [] }] : []), ...rows])
}
