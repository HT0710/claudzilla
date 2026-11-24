const graphemes = new Intl.Segmenter()
const pieces = (text: string) => [...graphemes.segment(text)].map(s => s.segment)

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export const cells = (text: string) =>
  pieces(text).reduce((sum, g) =>
    sum + (/\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFF}\uFE0F]/u.test(g) ? 2 : 1), 0)

// Display only: the sent text keeps its tabs, controls and blank lines.
export const tidy = (text: string) =>
  text.replace(/\t/g, ' ').replace(CONTROLS, '')
    .replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')

// Word wrap to `room` cells, keeping indentation and space runs; a word longer than room is cut by grapheme, taking at least one per line.
export const wrap = (text: string, room: number) => text.split('\n').flatMap(para => {
  const out: string[] = []
  let line = ''
  for (const word of para.split(/(?<= )/)) {
    const next = line + word
    if (cells(next.trimEnd()) <= room) { line = next; continue }
    if (line) out.push(line.trimEnd())
    line = ''
    let width = 0
    for (const g of pieces(word)) {
      const gw = cells(g)
      if (line && width + gw > room) { out.push(line); line = ''; width = 0 }
      line += g
      width += gw
    }
  }
  if (line || !out.length) out.push(line.trimEnd())
  return out
})

export const stamp = (ms: number, now = Date.now()) => {
  const d = new Date(ms)
  const hm = d.toTimeString().slice(0, 5)
  const [weekday, month] = d.toDateString().split(' ')
  return d.toDateString() === new Date(now).toDateString() ? hm : `${weekday} ${d.getDate()} ${month} ${hm}`
}

export type ReadText = (path: string, offset: number, length: number) => Promise<string>
export type Scan = { offset: number; times: Map<string, number>; run: Promise<unknown>; skipping: boolean }
export const newScan = (): Scan => ({ offset: 0, times: new Map(), run: Promise.resolve(), skipping: false })

const bytes = (s: string) => new TextEncoder().encode(s).length

const scanMore = async (read: ReadText, path: string, scan: Scan, id: string, chunk: number) => {
  while (!scan.times.has(id)) {
    let text = await read(path, scan.offset, chunk)
    if (!text) break
    const full = bytes(text) >= chunk
    let dropped = false
    if (scan.skipping) {
      const i = text.indexOf('\n')
      if (i < 0) { if (!full) break; scan.offset += chunk; continue }
      const head = text.slice(0, i)
      // a read that starts mid-character decodes each cut byte as one U+FFFD
      const cut = /^\uFFFD*/.exec(head)![0].length
      scan.offset += cut + bytes(head.slice(cut)) + 1
      text = text.slice(i + 1)
      scan.skipping = false
      dropped = true
    }
    const lines = text.split('\n')
    lines.pop()
    for (const line of lines) {
      scan.offset += bytes(line) + 1
      if (!line.includes('"type":"user"')) continue
      try {
        const row = JSON.parse(line)
        const ms = Date.parse(row.timestamp)
        if (row.type === 'user' && typeof row.uuid === 'string' && Number.isFinite(ms)) scan.times.set(row.uuid, ms)
      } catch {}
    }
    if (!lines.length) {
      if (dropped) continue
      if (!full) break
      // shortcut: a prompt row longer than chunk gets no time; read on to its end if users paste that much
      scan.offset += chunk
      scan.skipping = true
    }
  }
}

export function sentAt(read: ReadText, path: string, scan: Scan, id: string, chunk = 4 * 1024 * 1024): Promise<number | undefined> {
  if (!path) return Promise.resolve(undefined)
  scan.run = scan.run.then(() => scanMore(read, path, scan, id, chunk)).catch(() => {})
  return scan.run.then(() => scan.times.get(id))
}
