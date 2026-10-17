import type { Register } from 'claude-code'

export type Row = { id: string; text: string; picked: boolean }
// `go` is the answer under two rows: what go accepts, or the lone option.
export type Offer = { title: string; rows: Row[]; why: string; go: string }

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

// "→ I X", "and I'll X", "and I will X" or "and I run X"; plain "and I start" stays prose.
const DOES = /(?:→\s*I|\band\s+I(?:['’]ll|\s+will|(?=\s+run\b)))\s+/.source
// A bare `go` would match "run `go test`"; another word needs DOES right after it, or it asks a question. \x60 is a backtick.
const SAY = new RegExp(String.raw`\bsay\s+[\x60"]?(?:go\b|\w+[\x60"]?,?\s+${DOES})`, 'i')
// Ticks would show raw; a second sentence or ", or ..." is another ask.
const cut = (s: string) => s.replace(/`/g, '').split(/(?<=[.?])(?<!\b(?:e\.g|i\.e)\.)\s|,\s+or\b/)[0]!

// Offers SAY misses, from 1338 real Next lines: the word to say is quoted, bold, or one plain word that asks no question.
const WORD = String.raw`(?:["\x60]([^"\x60]{1,30})["\x60]|\*\*([^*]{1,30})\*\*|(?!(?:which|what|whether|when|if|so|how|where|who)\b)(\w+))`
const VERB = String.raw`(?:say|reply)`
// "say fold to X, or commit to Y", "say A (or B)", "reply 1, 2, or done": a choice. A fallback ("or tell me", "or I revert") is not.
const CHOICE = new RegExp(String.raw`\b${VERB}\s+${WORD}(?:(?:\s+to\b[^,]*)?,?\s+or\s+(?!(?:tell|give|name|send|paste|I|leave|let|run|drop)\b)|\s*,\s*${WORD}\s*(?:,|\s+or\b)|\s*\(or\s+["\x60*]*\w+["\x60*]*\))`, 'i')
const word = (m: RegExpMatchArray) => (m[1] ?? m[2] ?? m[3])!
const asked = (next: string): string | null => {
  let m: RegExpMatchArray | null
  if ((m = next.match(new RegExp(String.raw`\b${VERB}\s+${WORD}\s*\(recommended\)`, 'i')))) return word(m)
  if ((m = next.match(/\bI recommend\s+([A-Z0-9]{1,3})\b/))) return m[1]!
  // "run X, then say go": the user acts first.
  if (CHOICE.test(next) || /\bthen\s+say\b/i.test(next)) return null
  if ((m = next.match(/^(?:want(?: me)? to|should I|shall I)\s+([^?]+)\?/i))) return cut(m[1]!)
  if (/\bGo\?\s*$/.test(next)) return 'go'
  // "say the word / yes (or ...) / finish when ready, and I'll X"
  if ((m = next.match(new RegExp(String.raw`\b${VERB}\s+(?:the word|${WORD})(?:\s+when\b[^,]*)?\s*(?:\([^)]*\))?,?\s+${DOES}(.+)`, 'i')))) return cut(m[4]!)
  // "approve the spec (or ...), and I'll X"; approving a tool permission is not typed.
  if ((m = next.match(new RegExp(String.raw`^approve\b(?!\s+(?:Read|Bash|Write|Edit)\b)([^,(]*?)\s*(?:\([^)]*\))?,?(?:\s+or\s+[^,]+,)?\s+${DOES}(.+)`, 'i')))) return `approve${m[1] ? ` ${m[1].trim()}` : ''}, then ${cut(m[2]!)}`
  // "say push to publish", "say commit.", "say commit, then push", "say "commit" when ready"
  if ((m = next.match(new RegExp(String.raw`^${VERB}\s+${WORD}(?:\s+(?:to|when|then)\b|\s*(?:[.,→]|$))`, 'i')))) return word(m)
  return null
}

type Decision = { topic: string; rows: Row[] | null; recommend: string; why: string; afterRecommend: boolean; options: boolean }

// Parsed from a reply with a `**Picks:**` line, a `**Next:**` asking "say go" (or "say <word> and I'll X"), or one titled Decision table (an Options one needs its Recommend), outside ``` / ~~~ fences; the card draws only for 2+ options.
// A reply with exactly one `Decision`, holding a table, yields its rows; its heading is the title.
// A decision owns the table, Recommend and Why under its heading, up to the next heading.
export function parse(answer: string): Offer | null {
  let picks: string | null = null
  let next: string | null = null
  // The act of a Next line SAY misses, from asked().
  let other: string | null = null
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
      // Drift from the Decision format: `## Options` + `## Recommendation` is still one decision.
      if (current && /^#{2,4}\s+Recommendations?\s*$/i.test(line)) {
        inTable = false
        continue
      }
      const heading = line.match(/^#{2,4}\s+(?:Decision\b(?:\s+\d+)?|(?:\w+\s+)?([Oo]ptions)\b)(?:(?:\s*[—–:]|\s+-)\s*(.*))?\s*$/)
      current = heading ? { topic: heading[2] || (heading[1] ? 'pick one' : ''), rows: null, recommend: '', why: '', afterRecommend: false, options: !!heading[1] } : null
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
        current.rows.push({ id: cells[0]!, text: cells[1], picked: false })
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
    else if (m && SAY.test(m[2]!)) [next, other] = [m[2]!, null]
    else if (m && (other = asked(m[2]!))) next = m[2]!
  }
  const lone = decisions.length === 1 && decisions[0]!.rows?.length ? decisions[0]! : null
  // A skill gate ends with its own question, so its lone decision table is the ask; a table of options with no Recommend asks nothing.
  if (picks === null && next === null && !(lone?.topic && (!lone.options || lone.recommend))) return null
  const pick = picks?.split(/[\s,]/)[0]
  const ids = lone?.rows?.map(row => row.id) ?? []
  // One row at most: the decision's own Recommend, else the first Picks token.
  const chosen = ids.includes(lone?.recommend ?? '') ? lone!.recommend : pick
  const rows = lone ? lone.rows!.map(row => ({ ...row, picked: row.id === chosen })) : []
  const why = lone?.why ?? ''
  // X follows the say that let the line in, not an earlier "and I'll".
  const said = other ? undefined : next?.slice(next.search(SAY))
  const does = said?.match(new RegExp(`${DOES}(.+)$`))
  const act = other ?? (does && cut(does[1]!))
  // "say B and I'll X" also picks B; only the word said right before X.
  const letter = does && said!.slice(0, does.index).match(/\b[Ss]ay\s+[`"]?([A-Z])[`"]?,?\s*$/)?.[1]
  const title = lone?.topic
    ? question(lone.topic)
    : act
      ? question(act)
      : picks !== null
        ? question(`go with ${picks}`)
        : `${next!.charAt(0).toUpperCase()}${next!.slice(1)}`
  const todo = act?.replace(/[.:]$/, '')
  // The Picks line also holds fixes the lone option would drop; go's act follows it, but "say so and I'll X" is a fallback.
  const go = picks !== null ? (todo && /^say\s+[`"]?go\b/i.test(said ?? '') ?`${picks}, then ${todo}` : picks) : rows.length === 1 ? `${rows[0]!.id}: ${rows[0]!.text}` : todo ? `${letter ? `${letter}: ` : ''}${todo}` : 'go'
  return { title, rows, why, go }
}

// The id answers Claude; the option keeps the history readable.
const answer = (row: Row) => `${row.id}: ${row.text}`
// Dim in the empty prompt box; → or Tab, then Enter, sends it. Rows, none picked: no card row to match.
const suggestion = (o: Offer) => {
  if (o.rows.length < 2) return o.go
  const pick = o.rows.find(row => row.picked)
  return pick ? answer(pick) : null
}

// A Stop hook's continuation ends the turn on its own reply ("no claim"), an assistant message right after the ask;
// a tool call or a user message in between means the ask is stale.
const carried = async ($: { session: { messages: () => Promise<{ role: string; text: string; toolUses: unknown[] }[]> } }) => {
  for (const m of (await $.session.messages()).slice(0, -1).reverse()) {
    if (m.role !== 'assistant' || m.toolUses.length) return null
    const found = m.text ? parse(m.text) : null
    if (found) return found
  }
  return null
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer' && !e.agentId) {
      offer = parse(e.answer) ?? await carried($)
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
    // Under two options there is nothing to choose: the suggestion alone answers.
    if (!shown || shown.rows.length < 2 || e.props.isWorking || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const theirs = await next(e)
    const sends = shown.rows.slice(0, MAX_ROWS).map(row => ({ key: `pick:${row.id}`, text: row.text, picked: row.picked, send: answer(row) }))
    const pick = shown.rows.find(row => row.picked)
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
          <Text bold wrap="truncate">{shown.title}</Text>
          <Text> </Text>
          {/* No tradeoffs: the reply's table, just above, holds them. */}
          {sends.map((s, i) => (
            <Button
              key={s.key}
              label={s.text}
              hotkey={String(i + 1)}
              plain
              // ctrl+x tab focuses the band; Enter then drafts the pick.
              autoFocus={s.picked ? true : undefined}
              // Drafted, not sent: only the box's own Enter clears the dim suggestion and records history.
              onPress={async () => { await $.prompt.fill({ text: s.send }) }}
            >
              {s.picked ? <Text color="claude">{s.text}</Text> : s.text}
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
              <Text wrap="wrap">{shown.why}</Text>
            </Box>
          ) : ''}
        </Box>
        {theirs}
      </Box>
    )
  })
}
