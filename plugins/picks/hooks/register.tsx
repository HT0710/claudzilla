import type { Register } from 'claude-code'

export type Row = { id: string; text: string; tradeoff: string; picked: boolean }
export type Offer = { title: string; rows: Row[]; why: string }

// Bare digits are the only hotkeys the band arms; one goes to the draft row.
const MAX_ROWS = 8
// The panel's secondary gray; dimColor barely shows in some terminals.
const FAINT = '#808286'

// Null hides the band.
let offer: Offer | null = null

const question = (s: string) => {
  const t = s.trim().replace(/[.:]$/, '')
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${t.endsWith('?') ? '' : '?'}`
}

// Shown after a reply with a `**Picks:**` line, or a `**Next:**` asking "say go", outside ``` / ~~~ fences.
// A reply with exactly one `Decision` table yields its rows, and its heading is the title.
export function parse(answer: string): Offer | null {
  let picks: string | null = null
  let next: string | null = null
  let recommend = ''
  let why = ''
  let afterRecommend = false
  let fence = ''
  const tables: { topic: string; rows: Row[] }[] = []
  let topic: string | null = null
  let table: Row[] | null = null
  for (const line of answer.split('\n')) {
    const mark = line.match(/^\s*(```|~~~)/)?.[1]
    if (mark && (!fence || fence === mark)) {
      fence = fence ? '' : mark
      continue
    }
    if (fence) continue
    const heading = line.match(/^#{2,4}\s+Decision\b(?:\s+\d+)?\s*(?:[—–-]\s*(.*))?$/)
    if (heading) {
      topic = heading[1] ?? ''
      table = null
      continue
    }
    const cells = line.match(/^\|(.*)\|\s*$/)?.[1]?.split('|').map(c => c.trim())
    if (topic !== null && cells) {
      // The first table line is its header; a short first cell marks an option row.
      if (!table) tables.push({ topic, rows: (table = []) })
      else if (/^[\w.]{1,3}$/.test(cells[0]!) && cells[1]) table.push({ id: cells[0]!, text: cells[1], tradeoff: cells[2] ?? '', picked: false })
      continue
    }
    if (table) topic = null
    table = null
    const r = line.match(/^\*\*Recommend:\s*([^*]+?)\s*\*\*/)
    if (r) recommend = r[1]!
    // The first `- **Why:**` bullet under the Recommend line.
    const w = afterRecommend && !why ? line.match(/^\s*-\s*\*\*Why:\*\*\s*(.+)$/) : null
    // Drawn as plain text, so markdown marks would show raw.
    if (w) why = w[1]!.replace(/\*\*|`/g, '')
    afterRecommend = r ? true : afterRecommend && line.trim() !== ''
    const m = line.match(/^\*\*(Picks|Next):\*\*\s*(.+)$/)
    if (m?.[1] === 'Picks') picks = m[2]!
    // A bare `go` would match "run `go test`".
    else if (m && /\bsay\s+`?go\b/i.test(m[2]!)) next = m[2]!
  }
  if (picks === null && next === null) return null
  const pick = picks?.split(/[\s,]/)[0]
  const lone = tables.length === 1 ? tables[0]! : null
  const rows = lone ? lone.rows.map(row => ({ ...row, picked: row.id === recommend || row.id === pick })) : []
  const runs = next?.match(/\bI\s+run\s+(.+)$/)?.[1]
  const title = lone?.topic
    ? question(lone.topic)
    : runs
      ? question(`run ${runs}`)
      : picks !== null
        ? question(`go with ${picks}`)
        : `${next!.charAt(0).toUpperCase()}${next!.slice(1)}`
  return { title, rows, why }
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer' && !e.agentId) {
      offer = parse(e.answer)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (offer) {
      offer = null
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    offer = null
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = offer
    if (!shown || e.props.isWorking || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const theirs = await next(e)
    const sends = shown.rows.length
      ? shown.rows.slice(0, MAX_ROWS).map(row => ({ key: `pick:${row.id}`, text: row.text, tradeoff: row.tradeoff, picked: row.picked, send: row.id }))
      : [{ key: 'go', text: 'go', tradeoff: '', picked: false, send: 'go' }]
    // Tradeoffs line up in one column after the longest option.
    const width = Math.max(...sends.map(s => s.text.length)) + 4
    const pick = shown.rows.find(row => row.picked)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
          <Text bold wrap="truncate">{shown.title}</Text>
          <Text> </Text>
          {sends.map((s, i) => (
            <Button
              key={s.key}
              label={s.text}
              hotkey={String(i + 1)}
              plain
              onPress={async () => {
                // Our own submit skips our prompt.submit hook, so clear here.
                offer = null
                $.ui.invalidate('ui.render')
                await $.prompt.submit({ text: s.send, asUser: true })
              }}
            >
              {s.picked ? <Text color="claude">{s.text.padEnd(width)}</Text> : s.text.padEnd(width)}
              <Text color={FAINT}>{s.tradeoff}</Text>
            </Button>
          ))}
          <Button
            key="own"
            label="type your own…"
            hotkey={String(sends.length + 1)}
            plain
            onPress={async () => { await $.prompt.fill({ text: 'go, but ' }) }}
          >
            <Text color={FAINT}>type your own…</Text>
          </Button>
          {pick && shown.why ? <Text> </Text> : ''}
          {pick && shown.why ? (
            <Box flexDirection="row">
              {/* The pick's own blue ties the reason to its row. */}
              <Text color="claude" bold>{'Why: '}</Text>
              <Text wrap="truncate">{shown.why}</Text>
            </Box>
          ) : ''}
        </Box>
        {theirs}
      </Box>
    )
  })
}
