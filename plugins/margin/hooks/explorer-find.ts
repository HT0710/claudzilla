export const FIND_WAIT = 150
export const FIND_CAP = 10000
export type FindQuery = { text: string; matchCase: boolean; word: boolean; regex: boolean }
export type FindMatch = { line: number; start: number; end: number }
export type FindResult = { matches: FindMatch[]; bad: boolean; capped: boolean }

export function findIn(lines: readonly string[], query: FindQuery): FindResult {
  const none: FindResult = { matches: [], bad: false, capped: false }
  if (!query.text) return none
  const flags = query.matchCase ? 'g' : 'gi'
  const source = query.regex ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re: RegExp
  try {
    re = new RegExp(source, flags)
    // \b never matches beside punctuation, so word edges are lookarounds
    if (query.word) re = new RegExp(`(?<!\\w)(?:${source})(?!\\w)`, flags)
  } catch {
    return { ...none, bad: true }
  }
  const matches: FindMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    for (let m = re.exec(lines[i]); m; m = re.exec(lines[i])) {
      if (!m[0]) {
        re.lastIndex++
        continue
      }
      matches.push({ line: i + 1, start: m.index, end: m.index + m[0].length })
      if (matches.length > FIND_CAP) return { matches: matches.slice(0, FIND_CAP), bad: false, capped: true }
    }
  }
  return { ...none, matches }
}

// A move onto one of the find bar's own buttons keeps the field open.
export const leavesField = (e: { element?: string }, key: string): boolean => e.element !== key && !e.element?.startsWith('explorer:find:')

// The cell of `cells` each row of `total` marks: the one thumbOf maps it to.
export const markCells = (total: number, cells: number, rows: readonly number[]): boolean[] => {
  const marks = Array<boolean>(cells).fill(false)
  for (const r of rows) if (r >= 0 && r < total) marks[total <= cells ? r : Math.floor((r * cells) / total)] = true
  return marks
}

export type NameEntry = { path: string; kind: 'file' | 'dir' }
export const NAME_CAP = 5000

// Entries whose own name holds the text, folders first, then by code point.
export function filterNames(entries: readonly NameEntry[], text: string): NameEntry[] {
  const low = text.toLowerCase()
  if (!low) return []
  const nameOf = (e: NameEntry) => e.path.slice(e.path.lastIndexOf('/') + 1)
  return entries
    .filter(e => nameOf(e).toLowerCase().includes(low))
    .sort((a, b) => (a.kind === b.kind ? (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : a.kind === 'dir' ? -1 : 1))
}

export async function walkNames(
  list: (dir: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; isLink: boolean }[]>,
  folder: string,
  cap = NAME_CAP,
): Promise<NameEntry[]> {
  const out: NameEntry[] = []
  const queue = ['']
  for (let at = 0; at < queue.length; at++) {
    const rel = queue[at]!
    for (const e of await list(rel ? `${folder}/${rel}` : folder)) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const path = rel ? `${rel}/${e.name}` : e.name
      const dir = e.kind === 'dir' && !e.isLink
      out.push({ path, kind: dir ? 'dir' : 'file' })
      if (out.length >= cap) return out
      if (dir) queue.push(path)
    }
  }
  return out
}
