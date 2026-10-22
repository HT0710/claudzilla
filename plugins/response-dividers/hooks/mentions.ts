export type Mention = { span: string; path: string; line: number }

// A link Claude wrote, or a code span; the link is matched first so a span inside it stays the link's.
const SPAN = /(\[[^\]\n]*\]\([^)\n]*\))|`([^`\n]+)`/g
// `path`, `path:N` or `path:N-M`; the line is the first number.
const PATH = /^([^\s:]+)(?::(\d+)(?:-\d+)?)?$/
const VERSION = /^v?\d+(\.\d+)+$/

// Runs `fn` on each code span outside ``` / ~~~ fences and outside links; its answer replaces the span.
function spans(text: string, fn: (span: string) => string | undefined): string {
  let fence = ''
  return text
    .split('\n')
    .map(line => {
      const mark = line.match(/^\s*(```|~~~)/)?.[1]
      if (mark && (!fence || fence === mark)) fence = fence ? '' : mark
      if (fence || mark) return line
      return line.replace(SPAN, (all, link?: string, span?: string) => (link ? all : (fn(span!) ?? all)))
    })
    .join('\n')
}

// Code spans that look like one file path.
export function mentions(text: string): Mention[] {
  const found: Mention[] = []
  spans(text, span => {
    const [, path, line] = span.match(PATH) ?? []
    if (path && !path.startsWith('-') && !VERSION.test(path) && (path.includes('/') || /\.\w+$/.test(path))) {
      found.push({ span, path, line: line ? Number(line) : 1 })
    }
    return undefined
  })
  return found
}

// Each span in `hrefs` as a markdown link to its href.
export function linked(text: string, hrefs: Map<string, string>): string {
  return spans(text, span => {
    const href = hrefs.get(span)
    return href ? `[\`${span}\`](${href})` : undefined
  })
}

// `(`, `)`, `#` and `?` survive encodeURI but would end the markdown link or start a fragment or query.
export const href = (path: string, line: number) =>
  `file://${encodeURI(path).replace(/[()#?]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}#L${line}`
