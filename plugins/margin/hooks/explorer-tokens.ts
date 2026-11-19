export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number'
export type Token = { text: string; kind: TokenKind; hit?: 'match' | 'current' }

const KEYWORDS = new Set(
  'const let var function return if else for while class import export from async await new typeof true false null undefined def elif lambda None True False pass fi then do done echo'.split(' '),
)

// Strings come first so a "//" or "#" inside one never starts a comment.
const TOKEN = /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\/\/.*|(?<!\S)#.*)|(\b\d[\w.]*)|(\b[A-Za-z_]\w*\b)/g

/** Splits one code line into coloured runs; adjacent runs of one kind merge. */
export function tokenize(line: string): Token[] {
  const out: Token[] = []
  const push = (text: string, kind: TokenKind) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += text
    else out.push({ text, kind })
  }
  let at = 0
  for (const m of line.matchAll(TOKEN)) {
    push(line.slice(at, m.index), 'plain')
    push(m[0], m[1] ? 'string' : m[2] ? 'comment' : m[3] ? 'number' : KEYWORDS.has(m[0]) ? 'keyword' : 'plain')
    at = m.index + m[0].length
  }
  push(line.slice(at), 'plain')
  return out
}
