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
