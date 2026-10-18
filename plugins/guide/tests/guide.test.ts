import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { find, fit, parse, rows } from '../hooks/register'

const MD = '# claudzilla guide\n\n## Basics\n\n### What claudzilla is\n<!-- topic: start -->\n\nIntro.\n\n### Talk to Claude\n<!-- topic: talk -->\n\nSay it.\n\n## Screen\n\n### The picks card\n<!-- topic: picks -->\n\nDigits.\n'

test('parse splits sections with part, heading, slug', () => {
  expect(parse(MD).map(s => [s.part, s.slug, s.heading])).toEqual([['Basics', 'start', 'What claudzilla is'], ['Basics', 'talk', 'Talk to Claude'], ['Screen', 'picks', 'The picks card']])
  expect(parse(MD)[1]!.body).toBe('Say it.')
})
test('parse handles CRLF', () => { expect(parse(MD.replace(/\n/g, '\r\n')).map(s => s.slug)).toEqual(['start', 'talk', 'picks']) })
test('parse ignores fences', () => {
  const md = MD.replace('Say it.', 'Say it.\n\n```md\n### Not a section\n<!-- topic: nope -->\n```')
  expect(parse(md).map(s => s.slug)).toEqual(['start', 'talk', 'picks'])
  expect(parse(md)[1]!.body).toContain('### Not a section')
})
test('parse skips a ### with no topic line', () => { expect(parse(MD.replace('<!-- topic: talk -->\n', '')).map(s => s.slug)).toEqual(['start', 'picks']) })
test('find: empty arg opens start', () => { expect(find(parse(MD), '').section?.slug).toBe('start') })
test('find normalizes the slug', () => { expect(find(parse(MD), '  Picks ').section?.slug).toBe('picks') })
test('find: unknown slug gives a note, no section', () => { expect(find(parse(MD), 'nope')).toEqual({ note: 'No topic "nope". Pick one from the list.' }) })

const TABLE = '| key | does |\n|---|---|\n| `go` | accept every recommendation |\n| `1B` | pick option B |'
test('fit keeps a table that fits', () => { expect(fit(TABLE, 80)).toBe(TABLE) })
test('fit turns a too-wide table into one line per row', () => {
  expect(fit(`Intro.\n\n${TABLE}\n\nAfter.`, 30)).toBe('Intro.\n\n**`go`** — accept every recommendation  \n**`1B`** — pick option B\n\nAfter.')
})
test('fit joins extra cells with a dot', () => { expect(fit('| a | b | c |\n|---|---|---|\n| x | y | z |', 5)).toBe('**x** — y · z') })
test('fit leaves tables in fences alone', () => { expect(fit('```\n' + TABLE + '\n```', 10)).toBe('```\n' + TABLE + '\n```') })

const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const MISSING = 'Guide not found. Read it at https://github.com/HT0710/claudzilla/blob/main/GUIDE.md'
const props = (bodyColumns = 100, placement: 'dock' | 'inline' = 'dock', bodyRows = 40) => ({ title: 'guide', isFocused: true, bodyColumns, placement, scroll: { offset: 0, bodyRows }, view: {} })

// Stands for the clone lookup and GUIDE.md; drives /claudzilla the way a session does.
function host(on: Parameters<TestBody>[1], { stdout = '/repo\nv1.4.0\n', exitCode = 0, guide = MD as string | null } = {}) {
  const seen = { registered: [] as unknown[], opened: [] as any[], closed: [] as any[], read: [] as string[] }
  on('process.run', () => ran(exitCode, stdout))
  on('fs.read', (_, e: any) => {
    seen.read.push(e.path)
    if (guide === null) throw new Error('ENOENT')
    return { value: guide }
  })
  on('command.register', (_, e) => {
    seen.registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    seen.opened.push(e)
    return { value: { isPlaced: true } } as any
  })
  on('ui.panes', () => ({ value: seen.opened.length > seen.closed.length ? [{ id: 'guide' }] : [] }) as any)
  on('ui.close', (_, e) => {
    seen.closed.push(e)
    return { value: undefined } as any
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return seen
}
const start = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const run = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'claudzilla', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
async function open($: Parameters<TestBody>[0], args = '', columns = 100, bodyRows = 40) {
  await $.session.start(start)
  await run($, args)
  return $.ui.mount({ plugin: 'guide', surface: 'terminal', component: 'Pane', props: props(columns, 'dock', bodyRows), requestId: 'guide' })
}
const wheel = ($: Parameters<TestBody>[0], by: number, pointer?: { column: number; row: number }) =>
  $.ui.scroll({ component: 'Pane', requestId: 'guide', offset: 0, by, bodyRows: 6, contentRows: 6, origin: { kind: 'person' }, ...(pointer ? { pointer } : {}) })

test('registers /claudzilla with a topic hint', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla', argumentHint: '[topic]' }))
})

test('bare /claudzilla toggles the guide; a topic opens it either way', async ($, on) => {
  const seen = host(on)
  await open($)
  await run($, '')
  expect(seen.closed).toEqual([expect.objectContaining({ id: 'guide' })])
  expect(seen.opened).toHaveLength(1)
  await run($, '')
  expect(seen.opened).toHaveLength(2)
  await run($, 'picks')
  expect(seen.opened).toHaveLength(3)
  expect(seen.closed).toHaveLength(1)
})

test('opens on start with the topic list', async ($, on) => {
  const seen = host(on)
  const ui = await open($)
  expect(seen.opened).toEqual([expect.objectContaining({ id: 'guide', focus: true, closeOnEscape: true })])
  expect(seen.read).toEqual(['/repo/GUIDE.md'])
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['topic:talk', 'topic:picks'])
  // A Button lights and presses as wide as it draws: each topic fills the column, as the shown one does.
  expect((await ui.find({ type: 'Text', text: '  Talk to Claude'.padEnd(20) }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: '  What claudzilla is' }))?.props).toEqual(expect.objectContaining({ inverse: true, color: 'claude' }))
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(expect.arrayContaining(['BASICS', 'SCREEN']))
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('### What claudzilla is\n`/claudzilla start`\n\nIntro.')
})

test('topic arg opens that section', async ($, on) => {
  host(on)
  const ui = await open($, 'picks')
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('### The picks card\n`/claudzilla picks`\n\nDigits.')
})

test('unknown topic shows the note', async ($, on) => {
  host(on)
  const ui = await open($, 'nope')
  expect(await ui.find({ type: 'Text', text: 'No topic "nope". Pick one from the list.' })).toBeDefined()
})

test('picking a topic redraws that section', async ($, on) => {
  host(on)
  const ui = await open($)
  await ui.press({ key: 'topic:talk' })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('Say it.')
})

test('rerunning /claudzilla with a topic switches the open pane', async ($, on) => {
  host(on)
  const ui = await open($)
  await run($, 'talk')
  await ui.redraw()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('Say it.')
})

test('missing link shows the GitHub URL', async ($, on) => {
  host(on, { exitCode: 1, stdout: '' })
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: MISSING })).toBeDefined()
})

test('missing GUIDE.md shows the GitHub URL', async ($, on) => {
  host(on, { guide: null })
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: MISSING })).toBeDefined()
})

test('a GUIDE.md with no topics shows the GitHub URL', async ($, on) => {
  host(on, { guide: '# claudzilla guide\n\nNo topics yet.\n' })
  const ui = await open($)
  expect(await ui.find({ type: 'Text', text: MISSING })).toBeDefined()
})

test('header shows the version', async ($, on) => {
  const seen = host(on)
  const ui = await open($)
  expect(seen.opened[0].title).toBe('Guide')
  expect((await ui.findAll({ type: 'Text' })).slice(0, 2).map(t => t.text)).toEqual(['claudzilla', 'v1.4.0'])
})

test('no tag, no version', async ($, on) => {
  const seen = host(on, { stdout: '/repo\n\n' })
  const ui = await open($)
  expect(seen.opened[0].title).toBe('Guide')
  expect((await ui.findAll({ type: 'Text' })).slice(0, 2).map(t => t.text)).toEqual(['claudzilla', expect.stringMatching(/^─+$/)])
})

test('topics sit in a column left of the section, a vertical divider between', async ($, on) => {
  host(on)
  const ui = await open($, '', 72)
  const layout = await ui.find({ key: 'layout' })
  expect(layout?.props.flexDirection).toBe('row')
  expect((layout?.children as any[]).map(c => c.props.key)).toEqual(['topics', 'section', 'divider'])
  expect((await ui.find({ key: 'divider' }))?.props).toEqual(expect.objectContaining({ position: 'absolute', left: 22, top: 0 }))
  const topics = ((await ui.find({ key: 'topics' }))?.children as any[]).map(c => c.props.key)
  expect(topics).toEqual(['part:Basics', 'topic:start', 'topic:talk', 'gap:Screen', 'part:Screen', 'topic:picks'])
})

test('a very narrow pane stacks the topics over the section, a divider between', async ($, on) => {
  host(on)
  const ui = await open($, '', 50)
  const order = async () => ((await ui.find({ key: 'layout' }))?.children as any[]).map(c => c.props.key)
  expect((await ui.find({ key: 'layout' }))?.props.flexDirection).toBe('column')
  expect(await order()).toEqual(['topics', 'divider', 'section'])
  await ui.redraw(props(50, 'inline'))
  expect(await order()).toEqual(['topics', 'divider', 'section'])
})

const LONG = MD.replace('Intro.', Array.from({ length: 12 }, (_, i) => `Line ${i}.`).join('\n\n'))
const marginTop = async (ui: { find: (q: { key: string }) => Promise<any> }) => (await ui.find({ key: 'text' }))?.props.marginTop
const tocKeys = async (ui: { find: (q: { key: string }) => Promise<any> }) => ((await ui.find({ key: 'topics' }))?.children as any[]).map(c => c.props.key)

// 6 body rows: the header and its rule leave 4 to each zone.
test('beside, the wheel over the topics scrolls them alone', async ($, on) => {
  host(on, { guide: LONG })
  const ui = await open($, '', 100, 6)
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk', 'gap:Screen'])
  await wheel($, 5, { column: 3, row: 2 })
  expect(await tocKeys(ui)).toEqual(['topic:talk', 'gap:Screen', 'part:Screen', 'topic:picks'])
  expect(await marginTop(ui)).toBe(-0)
})

test('beside, the wheel over the section scrolls it alone, up to its end', async ($, on) => {
  host(on, { guide: LONG })
  const ui = await open($, '', 100, 6)
  await wheel($, 3, { column: 40, row: 2 })
  expect(await marginTop(ui)).toBe(-3)
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk', 'gap:Screen'])
  await wheel($, 1000, { column: 40, row: 2 })
  const text = (await ui.find({ type: 'Markdown' }))?.props.text as string
  expect(await marginTop(ui)).toBe(-(rows(text, 100 - 4 - 22 - 3) - 4))
})

test('the keys scroll the section; picking a topic starts it at the top', async ($, on) => {
  host(on, { guide: LONG })
  const ui = await open($, '', 100, 6)
  await wheel($, 2)
  expect(await marginTop(ui)).toBe(-2)
  await ui.press({ key: 'topic:talk' })
  expect(await marginTop(ui)).toBe(-0)
})

test('stacked, dragging the divider resizes the topics, and the wheel over them scrolls them', async ($, on) => {
  host(on, { guide: LONG })
  const ui = await open($, '', 50, 12)
  // 12 body rows: 10 under the header, 9 around the divider; the topics take half, 5.
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk', 'gap:Screen', 'part:Screen'])
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk'])
  await wheel($, 1, { column: 3, row: 3 })
  expect(await tocKeys(ui)).toEqual(['topic:start', 'topic:talk', 'gap:Screen'])
  await wheel($, 1, { column: 3, row: 9 })
  expect(await marginTop(ui)).toBe(-1)
})

test('a pane narrower than the topics fits each row to it, cut with an ellipsis', async ($, on) => {
  host(on)
  // 20 columns: 16 for the rows, under the 20 the longest heading wants.
  const ui = await open($, '', 20)
  expect(await ui.find({ type: 'Text', text: '  Talk to Claude' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '  What claudzil…' }))?.props).toEqual(expect.objectContaining({ inverse: true }))
})

test('a note that wraps in a narrow pane takes its rows from the zones', async ($, on) => {
  host(on)
  // 20 columns, 16 body rows: the note wraps to 4 rows, leaving 10; the topics take 5, the section 4.
  const ui = await open($, 'nope', 20, 16)
  expect((await ui.find({ key: 'topics' }))?.props.height).toBe(5)
  expect((await ui.find({ key: 'section' }))?.props.height).toBe(4)
})

test('stacked, /claudzilla <topic> scrolls the topics to it', async ($, on) => {
  host(on, { guide: LONG })
  const ui = await open($, '', 50, 12)
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk'])
  await run($, 'picks')
  expect(await tocKeys(ui)).toEqual(['gap:Screen', 'part:Screen', 'topic:picks'])
  // The wheel moves on from there, not from where the topics were before.
  await wheel($, -1, { column: 3, row: 3 })
  expect(await tocKeys(ui)).toEqual(['topic:talk', 'gap:Screen', 'part:Screen'])
})

test('stacked, the topics keep 3 rows however far the divider is dragged up', async ($, on) => {
  host(on, { guide: LONG })
  // 12 body rows: the topics take 5.
  const ui = await open($, '', 50, 12)
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: -9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↑2', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -9, button: 'left', in: 'divider' })
  expect(await tocKeys(ui)).toEqual(['part:Basics', 'topic:start', 'topic:talk'])
})

test('stacked, the section keeps 3 rows however far the divider is dragged down', async ($, on) => {
  host(on, { guide: LONG })
  // 12 body rows: 10 under the header, 9 around the divider; the topics take 5, at most 6.
  const ui = await open($, '', 50, 12)
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓1', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 9, button: 'left', in: 'divider' })
  expect(await tocKeys(ui)).toHaveLength(6)
  expect((await ui.find({ key: 'section' }))?.props.height).toBe(3)
})

test('rows counts wrapped words, list indents, code lines and table borders', () => {
  expect(rows('aaa bbb ccc', 8)).toBe(2)
  expect(rows('aaa bbb ccc', 12)).toBe(1)
  expect(rows('- aaa bbb ccc', 13)).toBe(2)
  expect(rows('- aaa bbb ccc', 14)).toBe(1)
  expect(rows('```\nx\ny\n```', 10)).toBe(2)
  expect(rows('| a |\n|---|\n| b |', 10)).toBe(4)
  expect(rows('**bold** `code` [link](https://x)', 17)).toBe(1)
  expect(rows('`**Recommend:**`', 14)).toBe(2)
})

// The renderer stretches a table past the section column, so beside the topics every table is a list.
test('beside the topics every table draws as lines', async ($, on) => {
  host(on, { guide: MD.replace('Say it.', `Say it.\n\n${TABLE}`) })
  const ui = await open($, 'talk', 160)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('**`go`** — accept every recommendation  \n')
})

test('topic comments are not drawn', async ($, on) => {
  host(on)
  const ui = await open($)
  expect(JSON.stringify(await ui.drawn())).not.toContain('<!-- topic:')
})

test('a pane narrower than a table draws it as lines', async ($, on) => {
  host(on, { guide: MD.replace('Say it.', `Say it.\n\n${TABLE}`) })
  const ui = await open($, 'talk', 20)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('**`go`** — accept every recommendation  \n')
})
