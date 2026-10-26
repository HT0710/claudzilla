import { expect, test } from 'claude-code/testing'

import { compactCommand, parse } from '../hooks/register'

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
  expect(run?.go).toBe('run brainstorming to write the spec')
  expect(parse("**Next:** say go and I'll write the spec.")?.go).toBe('write the spec')
  expect(parse('**Next:** say go and I will write the spec.')?.go).toBe('write the spec')
  expect(parse('**Next:** say go and I’ll write the spec.')?.go).toBe('write the spec')
  expect(parse('**Next:** say go and I run executing-plans.')?.go).toBe('run executing-plans')
})

test('parse: "say <word> and I\'ll X" gives X; an option letter gives "B: X"', () => {
  expect(parse("**Next:** say commit and I'll commit it on `fix/x`.")?.go).toBe('commit it on fix/x')
  expect(parse('**Next:** say push, and I will push the branch.')?.go).toBe('push the branch')
  expect(parse('**Next:** say so → I debug the load.')?.go).toBe('debug the load')
  expect(parse("**Next:** say B and I'll brainstorm the skill.")?.go).toBe('B: brainstorm the skill')
  // The letter is the one said right before X, not a later "or say C".
  expect(parse("**Next:** say commit and I'll commit it, or say C and I'll start.")?.go).toBe('commit it')
  // X is what follows the say, not an earlier "and I'll".
  expect(parse("**Next:** once it lands and I'll rerun CI. Say push and I'll push.")?.go).toBe('push')
  expect(parse("**Next:** Say B and I'll brainstorm it.")?.go).toBe('B: brainstorm it')
  // Double quotes read like backticks.
  expect(parse('**Next:** say "push" and I\'ll run fix 3: push the branch.')?.go).toBe('run fix 3: push the branch')
  expect(parse('**Next:** if it still shows, say "B" and I\'ll hide that row too.')?.go).toBe('B: hide that row too')
})

test('parse: other offers in a Next line give the act, or the word to say', () => {
  const go = (next: string) => parse(`**Next:** ${next}`)?.go
  expect(go('want me to tell `claudzilla-28` to rebase onto `main`?')).toBe('tell claudzilla-28 to rebase onto main')
  expect(parse('**Next:** want me to tell `claudzilla-28` to rebase onto `main`?')?.title).toBe('Tell claudzilla-28 to rebase onto main?')
  expect(go('Should I add track F to the HTML? That covers the phase table.')).toBe('add track F to the HTML')
  expect(go("say the word and I'll run the probe.")).toBe('run the probe')
  expect(go("say yes (or drop items by number), and I'll build it with TDD.")).toBe('build it with TDD')
  expect(go("say finish when you're ready to ship the fix, and I'll commit it, push and open the PR.")).toBe('commit it, push and open the PR')
  expect(go("approve the spec (or tell me what to change), and I'll run `writing-plans`.")).toBe('approve the spec, then run writing-plans')
  expect(go('say **push** to publish both commits.')).toBe('push')
  expect(go('say commit.')).toBe('commit')
  expect(go('say "commit" when you want it committed.')).toBe('commit')
  expect(go('say commit, or tell me to revert.')).toBe('commit')
  expect(go('reply `go` to accept Decision 1B and the values above.')).toBe('go')
  expect(go("say native (recommended) or subagent and I'll start Task 1.")).toBe('native')
  expect(go('pick A or B for where it goes; I recommend A, keeping it below `/compact`.')).toBe('A')
  expect(go('same seed, same 20 charts, ~$0.15. Go?')).toBe('go')
})

test('parse: a later Next line that asks nothing keeps the earlier ask', () => {
  expect(parse('**Next:** want me to run the probe?\n\n**Next:** read the log first.')?.go).toBe('run the probe')
})

test('parse: a choice, a step the user takes first, or a permission asks nothing', () => {
  for (const next of [
    'say fold to put it in `b529b62`, or commit to make it its own fix commit.',
    'say commit, or push with a PR.',
    'reply `1`, `2`, `both`, or `done`.',
    'run `/reload-plugins`, then say "show me card" and I\'ll send one.',
    'approve Read/Bash for this session, or tell me the path. I\'ll count the lines.',
    'allow Bash and I\'ll re-run the tests.',
    'say which one to start on and I\'ll investigate it.',
  ]) expect(parse(`**Next:** ${next}`)).toBeNull()
})

test('parse: the go detail stops at its first sentence or ", or"', () => {
  expect(parse("**Next:** say ship and I'll commit, push and merge it. A one-file diff skips the review.")?.go).toBe('commit, push and merge it')
  expect(parse("**Next:** say B and I'll brainstorm it, or say A to drop it.")?.go).toBe('B: brainstorm it')
  expect(parse("**Next:** say `go` and I'll apply 2B, or name a different choice.")?.go).toBe('apply 2B')
  expect(parse("**Next:** say commit and I'll fold this into `4f0af36`, or tell me the shorter wording first.")?.go).toBe('fold this into 4f0af36')
  expect(parse("**Next:** say go and I'll run `brainstorming`. Or say \"measure first\".")?.title).toBe('Run brainstorming?')
  expect(parse("**Next:** say go and I'll edit `a.md` and `b.ts`.")?.go).toBe('edit a.md and b.ts')
  expect(parse("**Next:** say go and I'll run it (or run `! make` yourself).")?.go).toBe('run it (or run ! make myself)')
  expect(parse("**Next:** say go and I'll add a guard (e.g. a null check).")?.go).toBe('add a guard (e.g. a null check)')
})

test('parse: the go detail is sent in the person\'s voice, I and you swapped; the title stays Claude\'s', () => {
  const go = (act: string) => parse(`**Next:** say go and I'll ${act}`)?.go
  expect(go('cut it, run the tests, and show you a card.')).toBe('cut it, run the tests, and show me a card')
  expect(go('make fix A, then you run `/reload-plugins` and drag.')).toBe('make fix A, then I run /reload-plugins and drag')
  expect(go('commit and wait for your push.')).toBe('commit and wait for my push')
  expect(go('check whether hot reload picked up the copy I synced last turn.')).toBe('check whether hot reload picked up the copy you synced last turn')
  expect(go("build it and hold the push until you confirm you're happy.")).toBe("build it and hold the push until I confirm I'm happy")
  expect(go('do steps 1–2, then hand step 3 to you.')).toBe('do steps 1–2, then hand step 3 to me')
  expect(go('ask what you mean, as that is how you work.')).toBe('ask what I mean, as that is how I work')
  expect(go('push it, but you run it since you asked.')).toBe('push it, but I run it since I asked')
  expect(go('edit my.config and I’ll wait.')).toBe('edit my.config and you’ll wait')
  // A bare "you" is the subject unless a verb or preposition takes it, or a stop word or the end follows.
  expect(go('fix the 3 issues you flagged.')).toBe('fix the 3 issues I flagged')
  expect(go('keep the API you wrote.')).toBe('keep the API I wrote')
  expect(go('check it, and do you want it merged?')).toBe('check it, and do I want it merged?')
  expect(go('fix it and let you know.')).toBe('fix it and let me know')
  expect(go('help you fix the test.')).toBe('help me fix the test')
  expect(go('send you the diff.')).toBe('send me the diff')
  expect(go('merge it and notify you once CI passes.')).toBe('merge it and notify me once CI passes')
  expect(go("ship it; I'll update you after the merge.")).toBe("ship it; you'll update me after the merge")
  expect(go('split it between you and me.')).toBe('split it between me and you')
  // A Roman numeral after a numbered word is no pronoun; after a name it still is.
  expect(go('start Phase I tests.')).toBe('start Phase I tests')
  expect(go('rebase after the PR I merge.')).toBe('rebase after the PR you merge')
  expect(go('push once on GitHub I see it.')).toBe('push once on GitHub you see it')
  expect(go('apply the option I picked.')).toBe('apply the option you picked')
  // The word to say is typed as written.
  expect(parse('**Next:** reply `your call` (recommended)')?.go).toBe('your call')
  expect(parse('**Next:** say "you decide" when ready.')?.go).toBe('you decide')
  expect(parse(ONE.replace('| A | no retry |', '| A | you retry by hand |'))?.go).toBe('A: I retry by hand')
  expect(go('rebase My live stack and test I/O.')).toBe('rebase Your live stack and test I/O')
  // Code and quoted text stay as written; "we" is both of us.
  expect(go('run `my-check` and post "you did it" in our channel.')).toBe('run my-check and post "you did it" in our channel')
  expect(parse("**Next:** want me to rebase your live stack?")?.go).toBe('rebase my live stack')
  expect(parse("**Next:** want me to rebase your live stack?")?.title).toBe('Rebase your live stack?')
})

test('parse: Picks with a Next act gives "<picks>, then X"; alone, just the picks', () => {
  expect(parse("**Picks:** 1A, 2A\n\n**Next:** say go and I'll build it test-first.")?.go).toBe('1A, 2A, then build it test-first')
  expect(parse('**Picks:** 1A, 2A\n\n**Next:** say go.')?.go).toBe('1A, 2A')
  expect(parse('**Picks:** 1A, 2A')?.go).toBe('1A, 2A')
  // Only go's act follows the picks; "say so and I'll X" is a fallback.
  expect(parse("**Picks:** 2\n\n**Next:** press a digit. If no card shows, say so and I'll debug the load.")?.go).toBe('2')
})

test('parse: Picks only inside a fence is ignored; a real one after it counts', () => {
  expect(parse('```md\n**Picks:** 9Z\n```')).toBeNull()
  expect(parse('~~~\n```\n**Picks:** 9Z\n~~~\n**Picks:** 1A')?.title).toBe('Go with 1A?')
})

test('parse: Next needs "say go" or "say <word> and I\'ll X"', () => {
  expect(parse('**Next:** run `go test ./auth`.')).toBeNull()
  // A word other than go needs the "and I'll X" right after it.
  expect(parse('**Next:** say whether to fold these in.')).toBeNull()
  expect(parse("**Next:** say A (or B) and I'll start.")).toBeNull()
  expect(parse('plain reply')).toBeNull()
})

test('parse: a lone Decision table asks on its own, as a skill gate ends with its own question', () => {
  const gate = LONE.replace('**Picks:** 2', '**Next:** review the plan and pick 1, 2 or 3.')
  expect(parse(gate)?.rows.filter(r => r.picked).map(r => r.id)).toEqual(['2'])
  expect(parse(gate.replace('Decision — how to finish the branch', 'Decision'))).toBeNull()
  expect(parse(gate.replace('Decision — how to finish the branch', 'Decision-making'))).toBeNull()
  expect(parse(gate.replace('Decision — how', 'Decision: how'))?.title).toBe('How to finish the branch?')
  expect(parse(gate.replace('Decision — how', 'Decision 2:how'))?.title).toBe('How to finish the branch?')
})

test('parse: an Options heading is a decision; a Recommendation heading keeps it open', () => {
  const options = LETTERS.replace('### Decision — retry', '## Options').replace('**Recommend: A**', '## Recommendation\n\n**Recommend: A**\n- **Why:** fast.').replace('**Next:** say go.', '**Next:** pick A or B.')
  expect(parse(options)).toEqual({
    title: 'Pick one?',
    rows: [{ id: 'A', text: 'no retry', picked: true }, { id: 'B', text: 'retry', picked: false }],
    why: 'fast.',
    go: 'go',
  })
  expect(parse(options.replace('## Options', '### Retry options'))?.title).toBe('Pick one?')
  expect(parse(options.replace('## Options', '## Options — retry'))?.title).toBe('Retry?')
  expect(parse(options.replace('## Recommendation', '## recommendation'))?.rows[0]?.picked).toBe(true)
  // A reference table of options asks nothing: no Recommend, no card.
  expect(parse(options.replace('## Options', '## CLI options').replace(/## Recommendation[^]*/, ''))).toBeNull()
  expect(parse(options.replace('## Options', '## Options considered').replace('**Next:** pick A or B.', ''))).toBeNull()
  expect(parse(LETTERS.replace('### Decision', '### DECISION').replace('**Next:** say go.', ''))).toBeNull()
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
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  const frame = (await ui.findAll({ type: 'Box' })).find((b: any) => b.props.borderStyle === 'round')
  expect(frame?.props.borderColor).toBe('promptBorder')
  expect((await ui.find({ type: 'Text', text: 'How to finish the branch?' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: ' ' })).toBeDefined()
})

test('the pick is blue; a "Why: reason" line in the same blue gives its reason', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
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
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect((await ui.findAll({ type: 'Button' })).filter((b: any) => b.props.autoFocus).map((b: any) => b.props.label)).toEqual(['push + PR'])
})

test('the pick, or the go detail, is the dim suggestion in the prompt box, over the engine\'s own', async ($, on) => {
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
  expect(shown).toEqual(['2: push + PR', '2: push + PR', 'from another mod', '1B, 2A, then run executing-plans', 'run the tests'])
})

test('no card without 2+ options: go, with Picks or the run as detail, or the lone option, is only the suggestion', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  for (const reply of [PICKS, '**Next:** say go → I run executing-plans.', '**Next:** say go.', ONE, ONE.replace('**Recommend: A**', '**Recommend: A**\n\n**Picks:** A, fixes 1–3'), ONE.replace('**Recommend: A**', '')]) {
    await $.turn.complete(done(reply))
    const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    await ui.unmount()
  }
  expect(shown).toEqual(['1B, 2A, then run executing-plans', 'run executing-plans', 'go', 'A: no retry', 'A, fixes 1–3', 'A: no retry'])
})

test('rows with none picked: no suggestion, as the card has no go row', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  await $.turn.complete(done(LETTERS.replace('**Recommend: A**', '**Recommend: Z**')))
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } } as any)
  expect(shown).toEqual(['run the tests'])
})

test('a Stop hook continuation with no ask keeps the ask before it, unless a tool ran since', async ($, on) => {
  const shown: string[] = []
  let transcript: object[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  on('session.messages', () => ({ value: transcript }) as any)
  const ask = { role: 'assistant', text: "**Next:** say go and I'll delete note.txt.", toolUses: [] }
  const last = { role: 'assistant', text: 'no claim', toolUses: [] }
  transcript = [{ role: 'user', text: 'make note.txt', toolUses: [] }, ask, last]
  await $.turn.complete(done('no claim'))
  const tool = { role: 'assistant', text: '', toolUses: [{ id: 'u1', name: 'Bash', input: {} }] }
  transcript = [ask, tool, { role: 'user', text: '', toolUses: [], toolResults: [] }, last]
  await $.turn.complete(done('no claim'))
  transcript = [{ role: 'user', text: 'thanks', toolUses: [] }, last]
  await $.turn.complete(done('no claim'))
  expect(shown).toEqual(['delete note.txt'])
})

test('no Why under Recommend: no footer line', async ($, on) => {
  engine(on)
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Why: ' })).toBeUndefined()
})

test('one decision: plain rows, no tradeoffs; each drafts its id and option', async ($, on) => {
  const filled: string[] = []
  engine(on)
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LONE))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['merge to main locally', 'push + PR', 'keep the branch as-is', 'go ahead, except…'])
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
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['no retry', 'retry', 'go ahead, except…'])
  await ui.press({ key: 'pick:B' })
  expect(filled).toEqual(['B: retry'])
  expect(sent).toEqual([])
})

test('a row press drafts its option in the person\'s voice; the row shows it as written', async ($, on) => {
  const filled: string[] = []
  engine(on)
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LETTERS.replace('| B | retry |', '| B | you retry by hand |')))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await labels(ui)).toEqual(['no retry', 'you retry by hand', 'go ahead, except…'])
  await ui.press({ key: 'pick:B' })
  expect(filled).toEqual(['B: I retry by hand'])
})

test('go ahead, except… drafts "go, but "', async ($, on) => {
  const filled: string[] = []
  engine(on)
  on('prompt.fill', (_: any, e: any) => { filled.push(e.text); return { isFilled: true } })
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
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
  let ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete(done(LETTERS))
  ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND, props: { ...BAND.props, isWorking: true } })
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})

test('a typed prompt clears the band', async ($, on) => {
  engine(on)
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeDefined()
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})

test('/clear (session.end) clears the band', async ($, on) => {
  engine(on)
  on('session.end', () => ({ sessionId: 's1' }))
  await $.turn.complete(done(LETTERS))
  const ui = await $.ui.mount({ plugin: 'ballot', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick:A' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await ui.drawn()
  expect(await ui.find({ key: 'pick:A' })).toBeUndefined()
})

// The tracer writes through fs.write; the harness has no fs, so these answer beneath the mod and keep what it writes.
function sink(on: any, part: string) {
  const files = new Map<string, string>()
  on('env.get', (_: any, e: any) => ({ value: ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_: any, e: any) => (e.path.endsWith('.off') ? { deny: 'no marker' } : { value: '' }))
  on('fs.write', (_: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('session.end', () => ({ sessionId: 's1' }))
  return (): any[] => (files.get(`/cfg/claudzilla-trace/s1.${part}.jsonl`) ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
}

test('traces the offer matched', async ($, on) => {
  engine(on)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const rows = sink(on, 'ballot')
  await $.turn.complete(done(LONE))
  await $.session.end({ reason: 'other' })
  expect(rows().find(r => r.event === 'ballot.offer')?.data).toMatchObject({ matched: true, options: 3 })
})

const CLINE = '**Compact — suggest:** `~320k` tokens re-sent every turn; Task 3 done, Task 4 needs only the plan. Run `/claudzilla compact`.'

test('compactCommand: the command from the reminder line, outside fences', () => {
  expect(compactCommand('Done.\n\n' + CLINE)).toBe('/claudzilla compact')
  expect(compactCommand(CLINE.replace('/claudzilla compact', '/clear'))).toBe('/clear')
  expect(compactCommand('```md\n' + CLINE + '\n```')).toBeNull()
  expect(compactCommand('Done. Run `/claudzilla compact`.')).toBeNull()
})

test('a reply with only a Compact line suggests its command, over the engine guess; Next still wins', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }) as any)
  on('session.messages', () => ({ value: [] }) as any)
  const guess = { text: 'run the tests', origin: { kind: 'suggestion' } } as any
  await $.turn.complete(done('Done.\n\n' + CLINE))
  await $.prompt.suggest(guess)
  await $.turn.complete(done(LONE + '\n\n' + CLINE))
  await $.prompt.submit({ text: 'hi' } as any)
  await $.prompt.suggest(guess)
  expect(shown).toEqual(['/claudzilla compact', '/claudzilla compact', '2: push + PR', 'run the tests'])
})

test('a Compact line under a Next that asks nothing leaves the engine guess alone', async ($, on) => {
  const shown: string[] = []
  engine(on)
  on('prompt.suggest', (_: any, e: any) => { shown.push(e.text); return { isShown: true } })
  on('session.messages', () => ({ value: [] }) as any)
  await $.turn.complete(done('Done.\n\n' + CLINE + '\n\n**Next:** run the tests.'))
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } } as any)
  expect(shown).toEqual(['run the tests'])
})
