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

type Decision = { topic: string; rows: Row[] | null; recommend: string; why: string; afterRecommend: boolean }

// Shown after a reply with a `**Picks:**` line, or a `**Next:**` asking "say go", outside ``` / ~~~ fences.
// A reply with exactly one `Decision`, holding a table, yields its rows; its heading is the title.
// A decision owns the table, Recommend and Why under its heading, up to the next heading.
export function parse(answer: string): Offer | null {
  let picks: string | null = null
  let next: string | null = null
  let fence = ''
  const decisions: Decision[] = []
  let current: Decision | null = null
  let inTable = false
  for (const line of answer.split('\n')) {
    const mark = line.match(/^\s*(```|~~~)/)?.[1]
    if (mark && (!fence || fence === mark)) {
      fence = fence ? '' : mark
      continue
    }
    if (fence) continue
    if (/^#{1,6}\s/.test(line)) {
      const heading = line.match(/^#{2,4}\s+Decision\b(?:\s+\d+)?\s*(?:[—–-]\s*(.*))?$/)
      current = heading ? { topic: heading[1] ?? '', rows: null, recommend: '', why: '', afterRecommend: false } : null
      if (current) decisions.push(current)
      inTable = false
      continue
    }
    const cells = line.match(/^\|(.*)\|\s*$/)?.[1]?.split('|').map(c => c.trim())
    if (current && cells) {
      // Only the decision's first table; its first line is the header; a short first cell marks an option row.
      if (!current.rows) {
        current.rows = []
        inTable = true
      } else if (inTable && /^[\w.]{1,3}$/.test(cells[0]!) && cells[1]) {
        current.rows.push({ id: cells[0]!, text: cells[1], tradeoff: cells[2] ?? '', picked: false })
      }
      continue
    }
    inTable = false
    if (current) {
      // `**Recommend: B**` or `**Recommend:** B`: the first token is the option id.
      const r = line.match(/^\*\*Recommend:\s*(?:\*\*\s*)?([^*\s,]+)/)
      if (r) current.recommend = r[1]!
      // The first `- **Why:**` bullet under the Recommend line.
      const w = current.afterRecommend && !current.why ? line.match(/^\s*-\s*\*\*Why:\*\*\s*(.+)$/) : null
      // Drawn as plain text, so markdown marks would show raw.
      if (w) current.why = w[1]!.replace(/\*\*|`/g, '')
      current.afterRecommend = r ? true : current.afterRecommend && line.trim() !== ''
    }
    const m = line.match(/^\*\*(Picks|Next):\*\*\s*(.+)$/)
    if (m?.[1] === 'Picks') picks = m[2]!
    // A bare `go` would match "run `go test`".
    else if (m && /\bsay\s+`?go\b/i.test(m[2]!)) next = m[2]!
  }
  if (picks === null && next === null) return null
  const pick = picks?.split(/[\s,]/)[0]
  const lone = decisions.length === 1 && decisions[0]!.rows?.length ? decisions[0]! : null
  const ids = lone?.rows?.map(row => row.id) ?? []
  // One row at most: the decision's own Recommend, else the first Picks token.
  const chosen = ids.includes(lone?.recommend ?? '') ? lone!.recommend : pick
  const rows = lone ? lone.rows!.map(row => ({ ...row, picked: row.id === chosen })) : []
  const why = lone?.why ?? ''
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

// The id answers Claude; the option keeps the history readable.
const answer = (row: Row) => `${row.id}: ${row.text}`
// Dim in the empty prompt box; → or Tab, then Enter, sends it. Rows, none picked: no card row to match.
const suggestion = (o: Offer) => {
  const pick = o.rows.find(row => row.picked)
  return pick ? answer(pick) : o.rows.length ? null : 'go'
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer' && !e.agentId) {
      offer = parse(e.answer)
      $.ui.invalidate('ui.render')
    }
    const result = await next(e)
    // After next: the box takes no suggestion while the turn still runs.
    const text = offer && e.reason === 'answer' && !e.agentId ? suggestion(offer) : null
    if (text) await $.prompt.suggest({ text })
    return result
  })

  // The engine's own next-prompt guess would replace the pick; another mod's is left alone.
  on('prompt.suggest', async ($, e, next) => {
    const text = offer && e.origin.kind === 'suggestion' ? suggestion(offer) : null
    return next(text ? { ...e, text } : e)
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
      ? shown.rows.slice(0, MAX_ROWS).map(row => ({ key: `pick:${row.id}`, text: row.text, tradeoff: row.tradeoff, picked: row.picked, send: answer(row) }))
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
              // ctrl+x tab focuses the band; Enter then sends the pick, or go.
              autoFocus={s.picked || s.key === 'go' ? true : undefined}
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
