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

test('parse: no lone decision → title from "say go → I run X", else Next, else Picks', () => {
  expect(parse(PICKS)?.title).toBe('Run executing-plans?')
  expect(parse(TWO)?.title).toBe('Go with 2?')
  expect(parse('**Next:** if right, say `go` and I start.')?.title).toBe('If right, say `go` and I start.')
  expect(parse('**Picks:** 1B, 2A')?.title).toBe('Go with 1B, 2A?')
})

test('parse: Picks only inside a fence is ignored; a real one after it counts', () => {
  expect(parse('```md\n**Picks:** 9Z\n```')).toBeNull()
  expect(parse('~~~\n```\n**Picks:** 9Z\n~~~\n**Picks:** 1A')?.title).toBe('Go with 1A?')
})

test('parse: Next needs "say go"', () => {
  expect(parse('**Next:** run `go test ./auth`.')).toBeNull()
  expect(parse('plain reply')).toBeNull()
})

test('parse: one Decision table gives its rows with tradeoffs, the recommended one picked', () => {
  expect(parse(LONE)?.rows).toEqual([
    { id: '1', text: 'merge to main locally', tradeoff: 'no CI', picked: false },
    { id: '2', text: 'push + PR', tradeoff: 'CI runs', picked: true },
    { id: '3', text: 'keep the branch as-is', tradeoff: 'nothing lands', picked: false },
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
  expect([reason?.props.color, reason?.props.bold]).toEqual([undefined, undefined])
})

test('no Why under Recommend: no footer line', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Why: ' })).toBeUndefined()
})

test('one decision: plain rows, dim tradeoffs; each sends its id', async ($, on) => {
  const sent: string[] = []
  engine(on)
  on('prompt.submit', (_: any, e: any) => { sent.push(e.text); return { text: e.text } as any })
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['merge to main locally', 'push + PR', 'keep the branch as-is', 'type your own…'])
  expect((await ui.findAll({ type: 'Button' })).every((b: any) => b.props.plain)).toBe(true)
  // dimColor barely shows in some terminals; an explicit gray always does.
  expect((await ui.find({ type: 'Text', text: 'CI runs' }))?.props.color).toBe('#808286')
  expect((await ui.find({ key: 'pick:3' }))?.props.hotkey).toBe('3')
  await ui.press({ key: 'pick:3' })
  expect(sent).toEqual(['3'])
})

test('letter ids are what gets sent', async ($, on) => {
  const sent: string[] = []
  engine(on)
  on('prompt.submit', (_: any, e: any) => { sent.push(e.text); return { text: e.text } as any })
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['no retry', 'retry', 'type your own…'])
  await ui.press({ key: 'pick:B' })
  expect(sent).toEqual(['B'])
})

test('no table: 1 sends go and clears the band; 2 drafts "go, but "', async ($, on) => {
  const sent: string[] = []
  const filled: string[] = []
  engine(on)
  on('prompt.submit', (_: any, e: any) => { sent.push(e.text); return { text: e.text } as any })
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(PICKS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['go', 'type your own…'])
  expect((await ui.find({ key: 'own' }))?.props.hotkey).toBe('2')
  await ui.press({ key: 'own' })
  expect(filled).toEqual(['go, but '])
  await ui.press({ key: 'go' })
  expect(sent).toEqual(['go'])
  await ui.drawn()
  expect(await ui.find({ key: 'go' })).toBeUndefined()
})

test('no band for a subagent turn, an aborted turn, or while working', async ($, on) => {
  engine(on)
  // Module state may outlive a test: start from a reply with no picks.
  await $.turn.complete(done('plain'))
  await $.turn.complete(done(PICKS, { agentId: 'a1' }))
  await $.turn.complete(done(PICKS, { reason: 'aborted', isAborted: true }))
  let ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'go' })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete(done(PICKS))
  ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await ui.find({ key: 'go' })).toBeUndefined()
})

test('a typed prompt clears the band', async ($, on) => {
  engine(on)
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  await $.turn.complete(done(PICKS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'go' })).toBeDefined()
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ key: 'go' })).toBeUndefined()
})

test('/clear (session.end) clears the band', async ($, on) => {
  engine(on)
  on('session.end', () => ({ sessionId: 's1' }))
  await $.turn.complete(done(PICKS))
  const ui = await $.ui.mount({ plugin: 'picks', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'go' })).toBeDefined()
  await $.session.end({ reason: 'clear' })
  await ui.drawn()
  expect(await ui.find({ key: 'go' })).toBeUndefined()
})
