import type { Register } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

export type Row = { id: string; text: string; picked: boolean }
// `go` is the answer under two rows: what go accepts, or the lone option.
export type Offer = { title: string; rows: Row[]; why: string; go: string }

// Bare digits are the only hotkeys the band arms; one goes to the draft row.
const MAX_ROWS = 8
// The panel's secondary gray; dimColor barely shows in some terminals.
const FAINT = '#808286'

// Null hides the band.
let offer: Offer | null = null
// The command of the last reply's Compact reminder when it offered nothing else: the dim suggestion.
let compact: string | null = null

const t = tracer('picks')
// The band's last recorded state: a render runs on every scroll and keystroke, so only a change is traced.
let lastBand = ''

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

// Claude's words sent as the person's: I and you swap; "we" is both of them.
const SWAP: Record<string, string> = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', myself: 'yourself', 'i am': 'you are', 'i was': 'you were', "i'm": "you're", "i've": "you've", "i'll": "you'll", "i'd": "you'd",
  your: 'my', yours: 'mine', yourself: 'myself', 'you are': 'I am', 'you were': 'I was', "you're": "I'm", "you've": "I've", "you'll": "I'll", "you'd": "I'd",
}
// Code and quoted text match first and stay as written; "I/O" and "my.config" hold no pronoun.
const VOICE = /(`[^`]*`|"[^"]*"|“[^”]*”)|(?<![\w/-])(?:I(?:\s+(?:am|was)|['’](?:m|ve|ll|d))?|[Yy]ou(?:\s+(?:are|were)|['’](?:re|ve|ll|d))?|[Mm](?:e|y|ine|yself)|[Yy]our(?:s|self)?)(?![\w/-]|\.\w)/g
// A bare "you" opening a clause is its subject ("then you run" → "I"). Taken by a verb or preposition ("show you",
// "let you know", "to you"), or before a stop word or the end ("you the diff", "you."), an object ("me"); else the subject
// ("the issues you flagged" → "I").
const SUBJECT = /(?:^|[,;:—–(]|\b(?:and|or|then|so|if|when|once|until|unless|before|after|while|because|since|but|that|whether|what|how|where|why|who|which)\s)\s*$/i
const TAKEN = /\b(?:(?:to|for|with|from|at|by|about|of|into|on|between|let|lets|help|make|have|see|watch|hear|tell|ask|show|give|send|get|want|need|remind|thank|ping|notify|update|tag|email|message|brief|assign|keep|leave|walk|guide|bring|hand|owe|wish)|I(?:['’](?:ll|d)|\s+(?:will|can|could))\s+\w+)\s+$/i
const ENDS = /^(?:\s*(?:$|[.,;:!?)\]—–])|\s+(?:the|a|an|this|that|these|those|to|for|when|if|which|what|how|it|them|my|our|about|with|in|on|at|now|here|there|back|again|first|too|both|all|around|through|up|down|out|once|after|before|until|as|later|soon|today|tomorrow|by|via|while|since|because)\b)/i
const youTo = (before: string, after: string) => SUBJECT.test(before) ? 'I' : TAKEN.test(before) || ENDS.test(after) ? 'me' : 'I'
// "Phase I", "Type I": a lone I after a numbered word is a numeral; after a name ("the PR I merge") it is no.
const NUMERAL = /\b(?:Phase|Type|Part|Section|Option|Step|Stage|Level|Tier|Class|Chapter|Round|Wave|Milestone)\s+$/
const voice = (s: string) => s.replace(VOICE, (w, quoted: string | undefined, at: number) => {
  if (quoted) return w
  if (w === 'I' && NUMERAL.test(s.slice(0, at))) return w
  const key = w.toLowerCase().replace(/\s+/, ' ').replace('’', "'")
  let to = key === 'you' ? youTo(s.slice(0, at), s.slice(at + w.length)) : SWAP[key]!
  if (/^[A-HJ-Z]/.test(w)) to = `${to.charAt(0).toUpperCase()}${to.slice(1)}`
  return w.includes('’') ? to.replace("'", '’') : to
})

// Offers SAY misses, from 1338 real Next lines: the word to say is quoted, bold, or one plain word that asks no question.
const WORD = String.raw`(?:["\x60]([^"\x60]{1,30})["\x60]|\*\*([^*]{1,30})\*\*|(?!(?:which|what|whether|when|if|so|how|where|who)\b)(\w+))`
const VERB = String.raw`(?:say|reply)`
// "say fold to X, or commit to Y", "say A (or B)", "reply 1, 2, or done": a choice. A fallback ("or tell me", "or I revert") is not.
const CHOICE = new RegExp(String.raw`\b${VERB}\s+${WORD}(?:(?:\s+to\b[^,]*)?,?\s+or\s+(?!(?:tell|give|name|send|paste|I|leave|let|run|drop)\b)|\s*,\s*${WORD}\s*(?:,|\s+or\b)|\s*\(or\s+["\x60*]*\w+["\x60*]*\))`, 'i')
// Ticked so voice() leaves the word to say as written; cut() drops the ticks.
const word = (m: RegExpMatchArray) => `\`${m[1] ?? m[2] ?? m[3]}\``
const asked = (next: string): string | null => {
  let m: RegExpMatchArray | null
  if ((m = next.match(new RegExp(String.raw`\b${VERB}\s+${WORD}\s*\(recommended\)`, 'i')))) return word(m)
  if ((m = next.match(/\bI recommend\s+([A-Z0-9]{1,3})\b/))) return m[1]!
  // "run X, then say go": the user acts first.
  if (CHOICE.test(next) || /\bthen\s+say\b/i.test(next)) return null
  if ((m = next.match(/^(?:want(?: me)? to|should I|shall I)\s+([^?]+)\?/i))) return m[1]!
  if (/\bGo\?\s*$/.test(next)) return 'go'
  // "say the word / yes (or ...) / finish when ready, and I'll X"
  if ((m = next.match(new RegExp(String.raw`\b${VERB}\s+(?:the word|${WORD})(?:\s+when\b[^,]*)?\s*(?:\([^)]*\))?,?\s+${DOES}(.+)`, 'i')))) return m[4]!
  // "approve the spec (or ...), and I'll X"; approving a tool permission is not typed.
  if ((m = next.match(new RegExp(String.raw`^approve\b(?!\s+(?:Read|Bash|Write|Edit)\b)([^,(]*?)\s*(?:\([^)]*\))?,?(?:\s+or\s+[^,]+,)?\s+${DOES}(.+)`, 'i')))) return `approve${m[1] ? ` ${m[1].trim()}` : ''}, then ${m[2]!}`
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
    else if (m) {
      // A later Next that asks nothing leaves the earlier ask whole.
      const act = asked(m[2]!)
      if (act) [next, other] = [m[2]!, act]
    }
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
  const raw = other ?? does?.[1]
  const act = raw && cut(raw)
  // "say B and I'll X" also picks B; only the word said right before X.
  const letter = does && said!.slice(0, does.index).match(/\b[Ss]ay\s+[`"]?([A-Z])[`"]?,?\s*$/)?.[1]
  const title = lone?.topic
    ? question(lone.topic)
    : act
      ? question(act)
      : picks !== null
        ? question(`go with ${picks}`)
        : `${next!.charAt(0).toUpperCase()}${next!.slice(1)}`
  const todo = raw && cut(voice(raw)).replace(/[.:]$/, '')
  // The Picks line also holds fixes the lone option would drop; go's act follows it, but "say so and I'll X" is a fallback.
  const go = picks !== null ? (todo && /^say\s+[`"]?go\b/i.test(said ?? '') ?`${picks}, then ${todo}` : picks) : rows.length === 1 ? `${rows[0]!.id}: ${voice(rows[0]!.text)}` : todo ? `${letter ? `${letter}: ` : ''}${todo}` : 'go'
  return { title, rows, why, go }
}

// The id answers Claude; the option keeps the history readable.
const answer = (row: Row) => `${row.id}: ${voice(row.text)}`
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

// The command of a reply's one-line Compact reminder (rules-guard), outside ``` / ~~~ fences; null without one.
export function compactCommand(answer: string): string | null {
  let fence = ''
  let found: string | null = null
  for (const line of answer.split('\n')) {
    const mark = line.match(/^\s*(```|~~~)/)?.[1]
    if (mark && (!fence || fence === mark)) {
      fence = fence ? '' : mark
      continue
    }
    if (!fence && line.startsWith('**Compact — ')) found = [...line.matchAll(/Run `([^`]+)`/g)].at(-1)?.[1] ?? found
  }
  return found
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer' && !e.agentId) {
      const parsed = parse(e.answer)
      offer = parsed ?? await carried($)
      // A Next that asks nothing still names the next step: the engine's guess of it stays.
      compact = offer || /^\*\*Next:\*\*/m.test(e.answer) ? null : compactCommand(e.answer)
      t.event('picks.offer', {
        matched: !!offer,
        source: parsed ? 'reply' : offer ? 'carried' : 'none',
        title: offer?.title,
        options: offer?.rows.length ?? 0,
        picked: offer?.rows.find(row => row.picked)?.id,
      })
      $.ui.invalidate('ui.render')
    } else t.event('picks.offer', { skipped: e.agentId ? 'agent turn' : e.reason }, 'debug')
    const result = await next(e)
    // After next: the box takes no suggestion while the turn still runs.
    const text = e.reason === 'answer' && !e.agentId ? (offer ? suggestion(offer) : compact) : null
    if (text) await $.prompt.suggest({ text })
    if (offer && e.reason === 'answer' && !e.agentId) t.event('picks.suggest', { filled: !!text })
    return result
  })

  // The engine's own next-prompt guess would replace the pick; another mod's is left alone.
  on('prompt.suggest', async ($, e, next) => {
    const text = e.origin.kind === 'suggestion' ? (offer ? suggestion(offer) : compact) : null
    if (offer && e.origin.kind === 'suggestion') t.event('picks.suggest', { replaced: !!text }, 'debug')
    return next(text ? { ...e, text } : e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    compact = null
    if (offer) {
      t.event('picks.offer', { cleared: 'prompt sent' }, 'debug')
      offer = null
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    offer = null
    compact = null
    $.ui.invalidate('ui.render')
    await t.flush(traceIo($))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = offer
    const hidden = !shown ? 'no offer' : shown.rows.length < 2 ? 'under two options' : e.props.isWorking ? 'turn running' : e.props.hasSurvey ? 'survey open' : ''
    const key = hidden ? `hidden:${hidden}` : `shown:${shown!.title}`
    if (key !== lastBand) {
      lastBand = key
      t.event('picks.band', hidden ? { shown: false, reason: hidden } : { shown: true, options: shown!.rows.length })
    }
    // Under two options there is nothing to choose: the suggestion alone answers.
    if (!shown || hidden) return next(e)
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
            label="go ahead, except…"
            hotkey={String(sends.length + 1)}
            plain
            onPress={async () => { await $.prompt.fill({ text: 'go, but ' }) }}
          >
            <Text color={FAINT}>go ahead, except…</Text>
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
