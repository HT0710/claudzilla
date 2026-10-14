import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}
const done = (answer: string, extra: object = {}) =>
  ({ answer, reason: 'answer' as const, durationMs: 1, isAborted: false, turnId: 't1', ...extra })
const PICKS = '## Decision\n\n**Picks:** 1B, 2A\n\n**Next:** say go → I run executing-plans.'
const LONE = [
  '### Decision — how to finish the branch',
  '',
  '| # | option | tradeoff |',
  '|---|---|---|',
  '| 1 | merge to main locally | no CI |',
  '| 2 | push + PR | CI runs |',
  '| 3 | keep the branch as-is | nothing lands |',
  '',
  '**Recommend: 2**',
  '- **Why:** your finish-via-pr memory says PR, merge once CI is green.',
  '',
  '**Picks:** 2',
].join('\n')
const LETTERS = '### Decision — retry\n\n| # | option | tradeoff |\n|---|---|---|\n| A | no retry | fast |\n| B | retry | +1 dep |\n\n**Recommend: A**\n\n**Next:** say go.'
const ONE = LETTERS.replace('| B | retry | +1 dep |\n', '')
const TWO = `${LONE.replace('Decision — how', 'Decision 1 — how')}\n\n${LETTERS.replace('Decision — retry', 'Decision 2 — retry')}`

const engine = (on: any) => {
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text' as const, children: ['engine'] }))
}
const labels = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)

test('parse: the lone decision heading is the title, as a question', () => {
  expect(parse(LONE)?.title).toBe('How to finish the branch?')
  expect(parse(LETTERS)?.title).toBe('Retry?')
})

test('parse: a Recommend and Why outside the decision are not its own', () => {
  const fixesFirst = '### Fixes\n\n| # | fix |\n|---|---|\n| 1 | trim |\n\n**Recommend: fixes 1**\n- **Why:** fixes reason\n\n' + LETTERS
  const offer = parse(fixesFirst)
  expect(offer?.why).toBe('')
  expect(offer?.rows.filter(r => r.picked).map(r => r.id)).toEqual(['A'])
})

test('parse: a Decision with no table gives no rows, even with a table under another heading', () => {
  const prose = '### Decision — force push\n\nNeeds a yes.\n\n**Recommend: A**\n\n### Fixes\n\n| # | fix |\n|---|---|\n| 1 | trim |\n\n**Picks:** A'
  expect(parse(prose)?.rows).toEqual([])
})

test('parse: two Decisions, only one with a table, give no rows', () => {
  const second = '\n\n### Decision 2 — force push\n\nNeeds a yes.\n\n**Recommend: A**\n\n**Picks:** 1B, 2A'
  const first = LETTERS.replace('Decision — retry', 'Decision 1 — retry').replace('**Recommend: A**', '**Recommend: B**')
  expect(parse(first + second)?.rows).toEqual([])
})

test('parse: the bold-label Recommend form picks too, and only one row is ever picked', () => {
  expect(parse(LETTERS.replace('**Recommend: A**', '**Recommend:** B'))?.rows.filter(r => r.picked).map(r => r.id)).toEqual(['B'])
  expect(parse(LONE.replace('**Picks:** 2', '**Picks:** 3'))?.rows.filter(r => r.picked).map(r => r.id)).toEqual(['2'])
})

test('parse: no lone decision → title from "say go → I run X", else Picks, else Next', () => {
  expect(parse(PICKS)?.title).toBe('Run executing-plans?')
  expect(parse(TWO)?.title).toBe('Go with 2?')
  expect(parse('**Next:** if right, say `go` and I start.')?.title).toBe('If right, say `go` and I start.')
  expect(parse('**Picks:** 1B, 2A')?.title).toBe('Go with 1B, 2A?')
})

test('parse: "say go and I\'ll <do X>" gives X as the title and the go detail', () => {
  const run = parse("**Next:** say go and I'll run `brainstorming` to write the spec.")
  expect(run?.title).toBe('Run brainstorming to write the spec?')
  expect(run?.go).toBe('go: run brainstorming to write the spec')
  expect(parse("**Next:** say go and I'll write the spec.")?.go).toBe('go: write the spec')
  expect(parse('**Next:** say go and I will write the spec.')?.go).toBe('go: write the spec')
  expect(parse('**Next:** say go and I’ll write the spec.')?.go).toBe('go: write the spec')
  expect(parse('**Next:** say go and I run executing-plans.')?.go).toBe('go: run executing-plans')
})

test('parse: Picks only inside a fence is ignored; a real one after it counts', () => {
  expect(parse('```md\n**Picks:** 9Z\n```')).toBeNull()
  expect(parse('~~~\n```\n**Picks:** 9Z\n~~~\n**Picks:** 1A')?.title).toBe('Go with 1A?')
})

test('parse: Next needs "say go"', () => {
  expect(parse('**Next:** run `go test ./auth`.')).toBeNull()
  expect(parse('plain reply')).toBeNull()
})

test('parse: a lone Decision table asks on its own, as a skill gate ends with its own question', () => {
  const gate = LONE.replace('**Picks:** 2', '**Next:** review the plan and pick 1, 2 or 3.')
  expect(parse(gate)?.rows.filter(r => r.picked).map(r => r.id)).toEqual(['2'])
  expect(parse(gate.replace('Decision — how to finish the branch', 'Decision'))).toBeNull()
  expect(parse(gate.replace('Decision — how to finish the branch', 'Decision-making'))).toBeNull()
})

test('parse: one Decision table gives its rows, the recommended one picked', () => {
  expect(parse(LONE)?.rows).toEqual([
    { id: '1', text: 'merge to main locally', picked: false },
    { id: '2', text: 'push + PR', picked: true },
    { id: '3', text: 'keep the branch as-is', picked: false },
  ])
})

test("parse: the Why under Recommend is kept for the footer", () => {
  expect(parse(LONE)?.why).toBe('your finish-via-pr memory says PR, merge once CI is green.')
  expect(parse(LETTERS)?.why).toBe('')
})

test('parse: several Decision tables or none give no rows', () => {
  expect(parse(TWO)?.rows).toEqual([])
  expect(parse(PICKS)?.rows).toEqual([])
})

test('card: promptBorder frame, bold title, blank line', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  const frame = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.borderStyle === 'round')
  expect(frame?.props.borderColor).toBe('promptBorder')
  expect((await ui.find({ type: 'Text', text: 'How to finish the branch?' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: ' ' })).toBeDefined()
})

test('the pick is blue; a "Why: reason" line in the same blue gives its reason', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text', text: /^push \+ PR\s*$/ }))?.props.color).toBe('claude')
  const line = (await ui.findAll({ type: 'Box' })).find((b: any) => b.text === 'Why: your finish-via-pr memory says PR, merge once CI is green.')
  expect(line).toBeDefined()
  const label = await ui.find({ type: 'Text', text: 'Why: ' })
  expect([label?.props.color, label?.props.bold]).toEqual(['claude', true])
  const reason = await ui.find({ type: 'Text', text: 'your finish-via-pr memory says PR, merge once CI is green.' })
  expect([reason?.props.color, reason?.props.bold, reason?.props.wrap]).toEqual([undefined, undefined, 'wrap'])
})

test('ctrl+x tab lands on the pick', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect((await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.autoFocus).map((b: any) => b.props.label)).toEqual(['push + PR'])
})

test('the pick, or go with its detail, is the dim suggestion in the prompt box, over the engine\'s own', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  const guess = { text: 'run the tests', origin: { kind: 'suggestion' } } as any
  await $.turn.complete(done(LONE))
  await $.prompt.suggest(guess)
  await $.prompt.suggest({ text: 'from another mod', origin: { kind: 'plugin', name: 'other' } } as any)
  await $.turn.complete(done(PICKS))
  await $.prompt.submit({ text: 'hi' } as any)
  await $.prompt.suggest(guess)
  expect(shown).toEqual(['2: push + PR', '2: push + PR', 'from another mod', 'go: 1B, 2A', 'run the tests'])
})

test('no card without 2+ options: go, with Picks or the run as detail, or the lone option, is only the suggestion', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  for (const reply of [PICKS, '**Next:** say go → I run executing-plans.', '**Next:** say go.', ONE, ONE.replace('**Recommend: A**', '**Recommend: A**\n\n**Picks:** A, fixes 1–3'), ONE.replace('**Recommend: A**', '')]) {
    await $.turn.complete(done(reply))
    const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    await ui.unmount()
  }
  expect(shown).toEqual(['go: 1B, 2A', 'go: run executing-plans', 'go', 'A: no retry', 'go: A, fixes 1–3', 'A: no retry'])
})

test('rows with none picked: no suggestion, as the card has no go row', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  await $.turn.complete(done(LETTERS.replace('**Recommend: A**', '**Recommend: Z**')))
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } } as any)
  expect(shown).toEqual(['run the tests'])
})

test('no Why under Recommend: no footer line', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Why: ' })).toBeUndefined()
})

test('one decision: plain rows, no tradeoffs; each drafts its id and option', async ($, on) => {
  const filled: string[] = []
  engine(on)
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['merge to main locally', 'push + PR', 'keep the branch as-is', 'type your own…'])
  expect((await ui.findAll({ type: 'Button' })).every((b: any) => b.props.plain)).toBe(true)
  // The reply's table, just above, already holds them.
  expect(await ui.find({ type: 'Text', text: /CI runs/ })).toBeUndefined()
  expect((await ui.find({ key: 'pick:3' }))?.props.hotkey).toBe('3')
  await ui.press({ key: 'pick:3' })
  expect(filled).toEqual(['3: keep the branch as-is'])
})

test('a press puts its id and option in the prompt box, unsent, so the box clears its suggestion on Enter', async ($, on) => {
  const sent: string[] = []
  const filled: string[] = []
  engine(on)
  on('prompt.submit', (_: any, e: any) => { sent.push(e.text); return { text: e.text } as any })
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['no retry', 'retry', 'type your own…'])
  await ui.press({ key: 'pick:B' })
  expect(filled).toEqual(['B: retry'])
  expect(sent).toEqual([])
})

test('type your own… drafts "go, but "', async ($, on) => {
  const filled: string[] = []
  engine(on)
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'own' }))?.props.hotkey).toBe('3')
  await ui.press({ key: 'own' })
  expect(filled).toEqual(['go, but '])
})

test('no band for a subagent turn, an aborted turn, or while working', async ($, on) => {
  engine(on)
  // Module state may outlive a test: start from a reply with no picks.
  await $.turn.complete(done('plain'))
  await $.turn.complete(done(LETTERS, { agentId: 'a1' }))
  await $.turn.complete(done(LETTERS, { reason: 'aborted', isAborted: true }))
  let ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete(done(LETTERS))
  ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})

test('a typed prompt clears the band', async ($, on) => {
  engine(on)
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeDefined()
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})

test('/clear (session.end) clears the band', async ($, on) => {
  engine(on)
  on('session.end', () => ({ sessionId: 's1' }))
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeDefined()
  await $.session.end({ reason: 'clear' })
  await ui.drawn()
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})
