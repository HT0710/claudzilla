import type { Register } from 'claude-code'

// md-display.pl's frame lines, as a share of the width: heavy whole, separator half, group break a quarter.
const SHARE: Record<string, number> = { '━': 1, '─': 2, '┈': 4 }
const RULE = /^([━─┈])\1*$/

type Part = { text: string } | { rule: string }

// Splits a reply at frame lines outside ``` / ~~~ fences.
export function split(text: string): Part[] {
  const parts: Part[] = []
  let chunk: string[] = []
  let fence = ''
  const flush = () => {
    const t = chunk.join('\n').replace(/^\n+|\n+$/g, '')
    if (t) parts.push({ text: t })
    chunk = []
  }
  for (const line of text.split('\n')) {
    const mark = line.match(/^\s*(```|~~~)/)?.[1]
    if (mark && (!fence || fence === mark)) fence = fence ? '' : mark
    const rule = !fence && !mark ? line.match(RULE)?.[1] : undefined
    if (rule) {
      flush()
      parts.push({ rule })
    } else chunk.push(line)
  }
  flush()

  return parts
}

export const register: Register = on => {
  // A hook's text is fixed when printed; drawn here, the lines follow a resize or a docked pane.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary block split up would repeat the engine's ` · summary` mark per chunk.
    if (e.props.isSummary) return next(e)
    const parts = split(e.props.text)
    if (!parts.some(p => 'rule' in p)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The engine indents only the block that draws the bullet, so later chunks take its two columns here.
    const indent = e.props.isFirstOfReply ? 2 : 0
    const room = Math.max((e.viewport?.columns ?? 80) - indent - 2, 4)
    const rows = []
    let isFirst = e.props.isFirstOfReply
    for (const p of parts) {
      if ('rule' in p) {
        rows.push(
          <Box paddingLeft={indent} marginTop={1}>
            <Text wrap="truncate">{p.rule.repeat(Math.floor(room / SHARE[p.rule]!))}</Text>
          </Box>,
        )
      } else {
        const drawn = await next({ ...e, props: { ...e.props, text: p.text, isFirstOfReply: isFirst } })
        rows.push(isFirst ? drawn : <Box paddingLeft={indent}>{drawn}</Box>)
        isFirst = false
      }
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
