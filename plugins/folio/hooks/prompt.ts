const graphemes = new Intl.Segmenter()
const pieces = (text: string) => [...graphemes.segment(text)].map(s => s.segment)

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export const cells = (text: string) =>
  pieces(text).reduce((sum, g) =>
    sum + (/\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFF}\uFE0F]/u.test(g) ? 2 : 1), 0)

// Display only: the sent text keeps its tabs, controls, blank lines and paste tags.
export const tidy = (text: string) =>
  text.replace(/^<\/?pasted_content id="[^"]*">$\n?/gm, '').replace(/\t/g, ' ').replace(CONTROLS, '')
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

// A reduce, because Math.max(...lines) throws on a very long list.
export const widest = (lines: string[]) => lines.reduce((m, l) => Math.max(m, cells(l)), 0)

export const stamp = (ms: number, now = Date.now()) => {
  const d = new Date(ms)
  const hm = d.toTimeString().slice(0, 5)
  const [weekday, month] = d.toDateString().split(' ')
  return d.toDateString() === new Date(now).toDateString() ? hm : `${weekday} ${d.getDate()} ${month} ${hm}`
}

export type ReadText = (path: string, offset: number, length: number) => Promise<string>
// `rows`: per prompt id prefix, the text of each attachment row the engine draws under its card; `last` is the prompt still collecting them.
// `calls`: the same per tool call id, for a tool hook's rows; `results`: calls whose result was read, so their rows are all in.
export type Scan = { offset: number; times: Map<string, number>; rows: Map<string, string[]>; calls: Map<string, string[]>; results: Set<string>; last: string; run: Promise<unknown>; skipping: boolean }
export const newScan = (): Scan => ({ offset: 0, times: new Map(), rows: new Map(), calls: new Map(), results: new Set(), last: '', run: Promise.resolve(), skipping: false })

// Attachment types the engine's renderer draws as one `⎿` row; any other type renders null (Claude Code 2.1.332).
const DRAWN = new Set(['file', 'directory', 'at_mention_reference', 'compact_file_reference', 'nested_memory', 'dynamic_skill', 'hook_system_message', 'skill_listing', 'hook_blocking_error'])
const draws = (a: { type?: string; isInitial?: boolean; hookEvent?: string }) =>
  a.type === 'skill_listing' ? !a.isInitial
    : a.type === 'hook_blocking_error' ? a.hookEvent !== 'Stop' && a.hookEvent !== 'SubagentStop'
      : DRAWN.has(a.type ?? '')
const ATTACHMENT = /"attachment":\{"type":"(\w+)"/
// A tool hook's row follows its call, not the prompt.
const TOOL_HOOKS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])
// Only a hook message is long enough to wrap; '' stands for a one-line row.
const rowText = (a: { type?: string; hookName?: string; content?: unknown }) =>
  a.type === 'hook_system_message' ? `${a.hookName} says: ${String(a.content ?? '')}` : ''
// The engine wraps a `  ⎿  ` row's text in what that 5-column prefix leaves (66 columns, 2.1.332).
export const rowLines = (texts: string[] | undefined, columns: number) =>
  (texts ?? []).reduce((sum, t) => sum + (t ? wrap(t, Math.max(columns - 5, 1)).length : 1), 0)
const add = (map: Map<string, string[]>, key: string, text: string) => map.set(key, [...(map.get(key) ?? []), text])

const bytes = (s: string) => new TextEncoder().encode(s).length

// Reads at least once, so a known prompt still collects attachment rows written after it.
const scanMore = async (read: ReadText, path: string, scan: Scan, found: () => boolean, chunk: number) => {
  for (let first = true; first || !found(); first = false) {
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
      const kind = ATTACHMENT.exec(line)?.[1]
      if (kind && kind !== 'queued_command') {
        if (DRAWN.has(kind)) {
          try {
            const a = JSON.parse(line).attachment
            if (!draws(a)) continue
            if (typeof a.toolUseID === 'string' && TOOL_HOOKS.has(a.hookEvent)) add(scan.calls, a.toolUseID, rowText(a))
            else if (scan.last) add(scan.rows, scan.last, rowText(a))
          } catch {}
        }
        continue
      }
      // An attachment whose kind the regex missed loses only itself, not the rest of the run.
      if (!kind && line.includes('"type":"attachment"') && !line.includes('"queued_command"')) continue
      // Any other row, such as the reply, ends the run of attachments under the card.
      scan.last = ''
      if (!line.includes('"type":"user"') && !line.includes('"queued_command"')) continue
      try {
        const row = JSON.parse(line)
        const ms = Date.parse(row.timestamp)
        const sent = row.type === 'user' || (row.type === 'attachment' && row.attachment?.type === 'queued_command')
        if (sent && typeof row.uuid === 'string' && Number.isFinite(ms)) scan.times.set(row.uuid.slice(0, ID_PREFIX), ms)
        const results = Array.isArray(row.message?.content) ? row.message.content.filter((c: { type?: string }) => c?.type === 'tool_result') : []
        for (const c of results) if (typeof c.tool_use_id === 'string') scan.results.add(c.tool_use_id)
        const tool = results.length > 0
        if (sent && typeof row.uuid === 'string' && !tool) scan.last = row.uuid.slice(0, ID_PREFIX)
      } catch {}
    }
    if (!lines.length) {
      if (dropped) continue
      if (!full) break
      // shortcut: a prompt row longer than chunk gets no time, and a drawn attachment that long gets no rail row;
      // read on to its end if users paste or mention that much
      scan.offset += chunk
      scan.skipping = true
    }
  }
}

// The engine renames a multi-block message id by zeroing its last 12 characters, so rows match on the first 24.
export const ID_PREFIX = 24

export function sentAt(read: ReadText, path: string, scan: Scan, id: string, chunk = 4 * 1024 * 1024): Promise<number | undefined> {
  if (!path) return Promise.resolve(undefined)
  scan.run = scan.run.then(() => scanMore(read, path, scan, () => scan.times.has(id), chunk)).catch(() => {})
  return scan.run.then(() => scan.times.get(id.slice(0, ID_PREFIX)))
}

// Reads until every call's result is in, so `calls` holds all their hook rows.
export function callsSeen(read: ReadText, path: string, scan: Scan, ids: string[], chunk = 4 * 1024 * 1024): Promise<unknown> {
  if (!path) return Promise.resolve()
  scan.run = scan.run.then(() => scanMore(read, path, scan, () => ids.every(id => scan.results.has(id)), chunk)).catch(() => {})
  return scan.run
}
