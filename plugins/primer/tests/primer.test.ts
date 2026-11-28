import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { costArgs, doctorArgs, draft, openSlug, experimentalArgs, featureLines, find, fit, handoffNote, parse, reportArgs, rows } from '../hooks/register'

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
function host(on: Parameters<TestBody>[1], { stdout = '/repo\nv1.4.0\n', exitCode = 0, guide = MD as string | null, proc = undefined as ((c: string) => ReturnType<typeof ran>) | undefined, files = undefined as ((p: string) => string | undefined) | undefined } = {}) {
  const seen = { registered: [] as unknown[], opened: [] as any[], closed: [] as any[], read: [] as string[], toasts: [] as string[] }
  on('process.run', (_, e: any) => proc?.(e.argv.join(' ')) ?? ran(exitCode, stdout))
  on('fs.read', (_, e: any) => {
    if (e.path.endsWith('/.off')) throw new Error('ENOENT')
    if (e.path.endsWith('/claudzilla.json')) {
      const c = files?.(e.path)
      if (c === undefined) throw new Error('ENOENT')
      return { value: c }
    }
    seen.read.push(e.path)
    const f = files?.(e.path)
    if (f !== undefined) return { value: f }
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
  on('ui.panes', () => ({ value: seen.opened.length > seen.closed.length ? [{ id: 'primer' }] : [] }) as any)
  on('ui.close', (_, e) => {
    seen.closed.push(e)
    return { value: undefined } as any
  })
  on('ui.toast', (_, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return seen
}
const start = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const run = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'claudzilla', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
async function open($: Parameters<TestBody>[0], args = '', columns = 100, bodyRows = 40) {
  await $.session.start(start)
  await run($, args)
  return $.ui.mount({ plugin: 'primer', surface: 'terminal', component: 'Pane', props: props(columns, 'dock', bodyRows), requestId: 'primer' })
}
const wheel = ($: Parameters<TestBody>[0], by: number, pointer?: { column: number; row: number }) =>
  $.ui.scroll({ component: 'Pane', requestId: 'primer', offset: 0, by, bodyRows: 6, contentRows: 6, origin: { kind: 'person' }, ...(pointer ? { pointer } : {}) })

test('registers /claudzilla with the doctor hint', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla', argumentHint: '[topic | report [what happened] | compact | doctor [fix] | handoff [ask] | experimental [id on|off] | cost [session-id | all [--since d] [--until d] [--project p]]]' }))
})

test('bare /claudzilla toggles the guide; a topic opens it either way', async ($, on) => {
  const seen = host(on)
  await open($)
  await run($, '')
  expect(seen.closed).toEqual([expect.objectContaining({ id: 'primer' })])
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
  expect(seen.opened).toEqual([expect.objectContaining({ id: 'primer', focus: true, closeOnEscape: true })])
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
  expect((await ui.findAll({ type: 'Text' })).slice(0, 2).map(t => t.props.color)).toEqual(['#a396d2', '#a396d2'])
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

test('reportArgs: the word report, any case, then the description', () => {
  expect(reportArgs('report')).toBe('')
  expect(reportArgs('Report the panel is blank')).toBe('the panel is blank')
  expect(reportArgs('picks')).toBeUndefined()
  expect(reportArgs('reporting')).toBeUndefined()
})

test('report writes a snapshot and flushes', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  const timers: [number, () => void][] = []
  const handoff: unknown[] = []
  const order: string[] = []
  const proc = (c: string) => {
    if (c.includes('rev-parse HEAD')) return ran(0, 'abc123\n')
    if (c.includes('--show-current')) return ran(0, 'feat/x\n')
    if (c.includes('status')) return ran(0, ' M a\n')
    if (c.includes('uname')) return ran(0, 'Linux 6\n')
    if (c.includes('node -v')) return ran(0, 'v22.1.0\n')
    if (c.includes('stty')) return ran(0, '40 120\n')
    return undefined
  }
  const files = (p: string) =>
    ({
      '/cfg/settings.json': '{"enabledPlugins":{"margin@claudzilla":true,"off@claudzilla":false,"x@other":true}}',
      '/cfg/settings.overrides.json': '{"model":"secret-model","env":{"A":"b"}}',
      '/cfg/claudzilla.json': '{"rulesGuard":{"trace":false}}',
    })[p]
  const seen = host(on, { proc, files })
  on('env.get', (_, e: any) => ({ value: ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' } as Record<string, string>)[e.name] }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  on('session.version', () => ({ value: { version: '2.1.9' } }) as any)
  on('fs.write', (_, e: any) => { order.push('write'); writes.push({ path: e.path, text: e.text }); return { value: undefined } as any })
  on('clock.after', (_, e: any) => { if (e.ms === 500) order.push('handoff'); timers.push([e.ms, e.fn]); return { value: undefined } as any })
  on('command.run', (_, e: any) => { handoff.push(e); return { value: {} } as any })
  await $.session.start(start)
  await run($, 'report the panel is blank')
  const row = writes.map(w => w.text).join('\n').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(r => r.event === 'report.snapshot')
  expect(row).toMatchObject({ part: 'primer', level: 'info' })
  expect(row.data).toMatchObject({ version: 'v1.4.0', commit: 'abc123', branch: 'feat/x', dirty: true, claudeCode: '2.1.9', os: 'Linux 6', node: 'v22.1.0', columns: 120, rows: 40, mods: ['margin@claudzilla'], overrideKeys: ['model', 'env.A'], configKeys: ['rulesGuard.trace'] })
  expect(JSON.stringify(row)).not.toContain('secret-model')
  expect(seen.opened).toHaveLength(0)
  // The harness hands over no callback: the hand-off is only seen scheduled, and not run inside the hook.
  expect(timers.filter(([ms]) => ms === 500)).toHaveLength(1)
  expect(handoff).toEqual([])
  expect(order.indexOf('write')).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('write')).toBeLessThan(order.indexOf('handoff'))
})

test('report does not open the guide pane', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  await run($, 'report')
  await run($, 'Report x')
  expect(seen.opened).toHaveLength(0)
  expect(seen.closed).toHaveLength(0)
})

test('report with every source failing still writes a snapshot and schedules the hand-off', async ($, on) => {
  const timers: number[] = []
  const writes: string[] = []
  host(on, { proc: c => ({ value: { exitCode: c.includes('mkdir') ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }), guide: null })
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  on('session.version', () => { throw new Error('x') })
  on('fs.write', (_, e: any) => { writes.push(e.text); return { value: undefined } as any })
  on('clock.after', (_, e: any) => { timers.push(e.ms); return { value: undefined } as any })
  await $.session.start(start)
  await run($, 'report')
  expect(writes.join('')).toContain('report.snapshot')
  expect(timers).toContain(500)
})

test('draft: keep and drop on one plain line', () => {
  expect(draft({ keep: 'plan path docs/p.md; branch feat/x.', drop: 'debug logs' })).toBe('/compact Keep: plan path docs/p.md; branch feat/x. Drop: debug logs.')
  expect(draft({ keep: 'a\nb', drop: 'c' })).toBe('/compact Keep: a b. Drop: c.')
  expect(draft({ keep: 'a' })).toBe('/compact Keep: a.')
})

test('draft: clear wins; nothing to keep is no draft', () => {
  expect(draft({ clear: true, keep: 'x' })).toBe('/clear')
  expect(draft({ drop: 'x' })).toBeUndefined()
  expect(draft({ keep: '  ' })).toBeUndefined()
})

test('/claudzilla compact hands off to the skill after the hook returns, and opens no pane', async ($, on) => {
  const timers: [number, () => void][] = []
  const handoff: unknown[] = []
  const seen = host(on)
  on('clock.after', (_, e: any) => { timers.push([e.ms, e.fn]); return { value: undefined } as any })
  on('command.run', (_, e: any) => { handoff.push(e); return { value: {} } as any })
  await $.session.start(start)
  await run($, 'Compact')
  expect(timers.map(([ms]) => ms)).toEqual([500])
  expect(handoff).toEqual([])
  expect(seen.opened).toHaveLength(0)
})

test('a second handoff while one is waiting schedules nothing', async ($, on) => {
  const timers: number[] = []
  const writes: string[] = []
  host(on, { proc: c => ({ value: { exitCode: 0, stdout: c.includes('find') ? '/cfg/projects/p/s1.jsonl\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) })
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  on('clock.now', () => ({ value: 0 }) as any)
  on('fs.write', (_, e: any) => { writes.push(e.path); return { value: undefined } as any })
  on('clock.after', (_, e: any) => { timers.push(e.ms); return { value: undefined } as any })
  await $.session.start(start)
  await run($, 'handoff')
  await run($, 'handoff')
  expect(timers.filter(ms => ms === 500)).toHaveLength(1)
  expect(writes).toHaveLength(1)
})

test('compact_draft fills the box once the turn ends; a subagent call fills nothing', async ($, on) => {
  const filled: string[] = []
  const registered: any[] = []
  host(on)
  on('tool.register', (_, e: any) => { registered.push(e); return { value: undefined } as any })
  on('prompt.fill', (_, e: any) => { filled.push(e.text); return { isFilled: true } as any })
  on('turn.complete', () => ({ text: '' }) as any)
  const done = (extra = {}) => ({ answer: 'x', reason: 'answer' as const, durationMs: 1, isAborted: false, turnId: 't1', ...extra })
  await $.session.start(start)
  expect(registered.map(r => r.name)).toContain('compact_draft')
  await $.tool.call({ tool: 'mcp__primer__compact_draft', keep: 'k', drop: 'd', agentId: 'a1' } as any)
  await $.turn.complete(done() as any)
  expect(filled).toEqual([])
  expect(await $.tool.call({ tool: 'mcp__primer__compact_draft', keep: 'k', drop: 'd' } as any)).toMatchObject({ result: expect.stringContaining('prompt box') })
  expect(filled).toEqual([])
  await $.turn.complete(done({ agentId: 'a1' }) as any)
  expect(filled).toEqual([])
  await $.turn.complete(done() as any)
  await $.turn.complete(done() as any)
  expect(filled).toEqual(['/compact Keep: k. Drop: d.'])
})

test("compact_draft's chat rows draw nothing; other tools' rows still draw", async ($, on) => {
  const props = { tool_use_id: 'u1', input: { keep: 'k', drop: 'd' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }
  on('ui.render', { component: ['ToolUse', 'ToolResult'] }, () => ({ type: 'Text' as const, children: ['engine row'] }) as any)
  for (const component of ['ToolUse', 'ToolResult'] as const) {
    const ui = await $.ui.mount({ plugin: 'primer', surface: 'terminal', component, props: { ...props, tool: 'mcp__primer__compact_draft' }, requestId: 'u1' } as any)
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
  }
  const other = await $.ui.mount({ plugin: 'primer', surface: 'terminal', component: 'ToolUse', props: { ...props, tool: 'Bash' }, requestId: 'u2' } as any)
  expect(await other.find({ type: 'Text', text: 'engine row' })).toBeDefined()
})

test('a palette label colours the header', async ($, on) => {
  host(on, { files: p => (p === '/cfg/claudzilla.json' ? JSON.stringify({ palette: { shared: { label: '#112233' } } }) : undefined) })
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  const ui = await open($)
  expect((await ui.findAll({ type: 'Text' })).slice(0, 2).map(t => t.props.color)).toEqual(['#112233', '#112233'])
})

test('experimentalArgs: other commands pass through', () => { expect(experimentalArgs('report x')).toBe(undefined); expect(experimentalArgs('')).toBe(undefined) })
test('experimentalArgs: bare lists', () => { expect(experimentalArgs(' Experimental ')).toEqual({}) })
test('experimentalArgs: id and state', () => { expect(experimentalArgs('experimental agentRouting on')).toEqual({ id: 'agentRouting', state: 'on' }); expect(experimentalArgs('experimental agentRouting ON')).toEqual({ id: 'agentRouting', state: 'on' }) })
test('experimentalArgs: malformed gives usage', () => {
  const error = 'Use: /claudzilla experimental [<id> on|off]'
  expect(experimentalArgs('experimental agentRouting')).toEqual({ error })
  expect(experimentalArgs('experimental agentRouting maybe')).toEqual({ error })
})
test('costArgs: bare, id, all with flags', () => {
  expect(costArgs('cost', 's1')).toEqual(['--session', 's1'])
  expect(costArgs('cost abc', 's1')).toEqual(['--session', 'abc'])
  expect(costArgs('cost all --since 2026-11-01', 's1')).toEqual(['all', '--since', '2026-11-01'])
  expect(costArgs('report x', 's1')).toBeUndefined()
  expect(costArgs('cost a b', 's1')).toEqual({ error: 'Use: /claudzilla cost [session-id | all [--since d] [--until d] [--project p]]' })
})
test('featureLines: one line per feature', () => {
  expect(featureLines([{ id: 'a', description: 'First.', on: true }, { id: 'b', description: '', on: false }])).toBe('a: on — First.\nb: off — ')
  expect(featureLines([])).toBe('No experimental features.')
})

const LABS = MD + '\n### Labs\n<!-- topic: labs -->\n\nTry things.\n'
const FEATURES = (on: boolean) => JSON.stringify([{ id: 'agentRouting', description: 'Route lookups.', on }])
// Runs the experimental script mock beside the FIND lookup; `calls` records its argv tails in order.
function labs(on: Parameters<TestBody>[1], { list = ran(0, FEATURES(false)), set = ran(0, '') } = {}) {
  const calls: string[] = []
  host(on, {
    guide: LABS,
    proc: c => {
      const m = /experimental\.mjs (.*)$/.exec(c)
      if (!m) return ran(0, '/repo\nv1.4.0\n')
      calls.push(m[1]!)
      return m[1]!.startsWith('--set') ? set : list
    },
  })
  return calls
}
const texts = async (ui: Awaited<ReturnType<typeof open>>) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('experimental lists features in the labs topic', async ($, on) => {
  labs(on)
  const ui = await open($, 'experimental')
  expect(await texts(ui)).toContain('agentRouting: off')
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('### Labs')
})

test('experimental <id> on writes, then lists', async ($, on) => {
  const calls = labs(on, { list: ran(0, FEATURES(true)) })
  const text = await texts(await open($, 'experimental agentRouting on'))
  expect(calls).toEqual(['--set agentRouting on', '--list'])
  expect(text).toContain('agentRouting on. Applies from the next session or after /clear.')
  expect(text).toContain('agentRouting: on')
})

test("experimental shows the script's refusal", async ($, on) => {
  labs(on, { set: { value: { exitCode: 3, stdout: '', stderr: 'No experimental feature "nope". Known: agentRouting\n', isStdoutTruncated: false, isStderrTruncated: false } } })
  expect(await texts(await open($, 'experimental nope on'))).toContain('No experimental feature "nope". Known: agentRouting')
})

test('experimental without the core install', async ($, on) => {
  labs(on, { list: ran(1, '') })
  expect(await texts(await open($, 'experimental'))).toContain('Experimental features need the claudzilla core install.')
})

function cost(on: Parameters<TestBody>[1], res: ReturnType<typeof ran>) {
  const calls: string[] = []
  on('session.id', () => ({ value: 's1' }) as any)
  on('session.cwd', () => ({ value: '/proj' }) as any)
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  host(on, { guide: LABS, proc: c => (c.includes('cost-trace.mjs') ? (calls.push(c), res) : ran(0, '/repo\nv1.4.0\n')) })
  return calls
}
const FAIL = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

test('cost runs report with the session and cwd', async ($, on) => {
  const calls = cost(on, ran(0, 'Session x'))
  await open($, 'cost')
  expect(calls).toEqual(['node /cfg/hooks/cost-trace.mjs report --session s1 --cwd /proj'])
})
test('cost shows the report lines', async ($, on) => {
  cost(on, ran(0, 'Session s1  list $1.20\nrouting off'))
  expect(await texts(await open($, 'cost'))).toContain('Session s1  list $1.20')
})
test('cost with a bad argument shows the usage line and runs nothing', async ($, on) => {
  const calls = cost(on, ran(0, 'Session x'))
  const shown = String(await texts(await open($, 'cost a b')))
  expect(shown).toContain('Use: /claudzilla cost')
  expect(shown).not.toContain('No topic')
  expect(calls).toEqual([])
})
test('cost with a failing script shows its message', async ($, on) => {
  cost(on, FAIL('boom\n'))
  expect(await texts(await open($, 'cost'))).toContain('boom')
})
test('cost with a silent failure gives a fallback line', async ($, on) => {
  cost(on, FAIL(''))
  expect(await texts(await open($, 'cost'))).toContain('Could not read the cost log.')
})

const J = (o: object) => JSON.stringify(o)
const asst = (content: unknown, extra: object = {}) => J({ type: 'assistant', message: { content }, ...extra })
const tool = (name: string, input: object, extra: object = {}) => asst([{ type: 'tool_use', name, input }], extra)
const typed = (text: string, extra: object = {}) => J({ type: 'user', message: { content: text }, ...extra })
const tail = (...r: string[]) => r.map((l, i) => `${i + 1}:${l}`).join('\n')
const note = (...r: string[]) => handoffNote({ sessionId: 's1', path: '/t/s1.jsonl', now: 0, numbered: tail(...r) })

test('handoffNote: header names the session, resume command and transcript', () => {
  const n = note(typed('hi'))
  expect(n).toContain('claude --resume s1')
  expect(n).toContain('/t/s1.jsonl')
})

test('handoffNote: where we were from the last margin intent', () => {
  const n = note(
    tool('mcp__margin__intent', { wants: 'OLD ask', steps: [{ text: 'old', status: 'pending' }] }),
    tool('mcp__margin__intent', { wants: 'NEW ask', steps: [{ text: 'one', status: 'completed' }, { text: 'two', status: 'in_progress' }] }),
    tool('mcp__margin__intent', { now: 2 }),
  )
  expect(n).toContain('NEW ask')
  expect(n).toContain('- one')
  expect(n).toContain('- two')
  expect(n).not.toContain('[completed]')
  expect(n).toContain('Last step started: 2')
  expect(n).not.toContain('Now: step')
  expect(n).not.toContain('OLD ask')
})

test('handoffNote: an Esc stop after the last prompt is named, and never to be continued', () => {
  const rows = [typed('do it'), tool('mcp__margin__intent', { wants: 'ASK', steps: [{ text: 'push' }] }), tool('mcp__margin__intent', { now: 1 })]
  for (const t of ['[Request interrupted by user]', '[Request interrupted by user for tool use]']) {
    const n = note(...rows, J({ type: 'user', message: { content: [{ type: 'text', text: t }] } }))
    expect(n).toMatch(/Last step started: 1\nThe user stopped step 1 with Esc \(line \d+\)\. Never continue it unasked\./)
  }
  const esc = typed('[Request interrupted by user]')
  expect(note(...rows, esc, typed('again'))).not.toContain('The user stopped')
  expect(note(...rows)).not.toContain('The user stopped')
  expect(note(...rows, esc, typed('<command-name>/claudzilla</command-name>'))).toContain('The user stopped step 1')
  expect(note(typed('do it'), esc)).toMatch(/## Stopped\n\nThe user stopped the last turn with Esc \(line \d+\)\./)
  expect(note(...rows, typed('/compact Keep: x.'), esc)).not.toContain('The user stopped')
})

const lines = (n: number, w: number) => Array.from({ length: n }, (_, i) => String(i).padStart(w, '0')).join('\n')
const reply = (text: string) => note(typed('q'), asst([{ type: 'text', text }]))

test('handoffNote: last reply up to 6000 characters is whole', () => {
  const t = lines(1000, 5) + 'x'
  expect(t.length).toBe(6000)
  expect(reply(t)).toContain(t.split('\n').map(l => `> ${l}`).join('\n') + '\n')
})

test('handoffNote: last reply over 6000 keeps its first 4800 and last 1200 at line breaks', () => {
  const t = lines(1200, 5) + '\n**Next:** say "go"'
  const n = reply(t)
  expect(n).toMatch(/> 00799\n> …\n> \d{5}\n/)
  expect(n).toContain('> 00000\n> 00001\n')
  expect(n).toContain('> **Next:** say "go"')
  expect(n).not.toContain('> 00900\n')
})

test('handoffNote: a single line over 6000 falls back to a hard cut', () => {
  const t = 'a'.repeat(4800) + 'Q'.repeat(2000) + 'z'.repeat(1200)
  const n = reply(t)
  expect(n).toContain('> ' + 'a'.repeat(4800) + '…' + 'z'.repeat(1200))
  expect(n).not.toContain('Q')
})

test('handoffNote: earlier replies over 600 cut to 300 and 300 at line breaks', () => {
  const t = lines(500, 5)
  const n = note(typed('p1'), asst([{ type: 'text', text: t }]), typed('p2'), asst([{ type: 'text', text: 'last' }]))
  expect(n).toMatch(/> 00049\n> …\n> \d{5}\n/)
  expect(n).not.toContain('> 00100\n')
})

test('handoffNote: an earlier reply of 600 characters or less is kept whole', () => {
  const t = 'x'.repeat(600)
  expect(note(typed('p1'), asst([{ type: 'text', text: t }]), typed('p2'), asst([{ type: 'text', text: 'last' }]))).toContain('> ' + t + '\n')
})

const prevNote = ['# Handoff from aaaaaaaa-1', '', '## Where we were', '', 'old goal'].join('\n')

test('handoffNote: a prompt holding an earlier note quotes only the user\'s ask', () => {
  const n = note(typed(`${prevNote}\n\n## User's ask\n\nContinue.`), asst([{ type: 'text', text: 'done' }]))
  expect(n).toContain('## Recent turns\n\n- User: Continue.\n\n> done\n')
  expect(n).not.toContain('old goal')
})

test('handoffNote: an earlier note with no ask leaves only the reply in its turn', () => {
  expect(note(typed(prevNote), asst([{ type: 'text', text: 'done' }]))).toContain('## Recent turns\n\n> done\n')
})

test('handoffNote: a synthetic limit reply is not a turn\'s reply', () => {
  const lim = asst([{ type: 'text', text: "You've hit your limit" }], { message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: "You've hit your limit" }] } })
  const n = note(typed('p1'), lim)
  expect(n).toContain('- User: p1')
  expect(n).not.toContain('hit your limit')
})

test('handoffNote: with no typed prompt in the tail the last reply is still quoted', () => {
  const tn = typed('<task-notification>done</task-notification>')
  const long = 'x'.repeat(50) + '\n' + 'y'.repeat(5000)
  const n = note(tn, asst([{ type: 'text', text: 'older' }]), tn, asst([{ type: 'text', text: 'short' }]), asst([{ type: 'text', text: long }]), asst([{ type: 'text', text: 'tiny' }]))
  expect(n).toContain('## Recent turns\n\n> ' + 'x'.repeat(50) + '\n> ' + 'y'.repeat(5000))
  expect(n).toContain('> ' + 'y'.repeat(5000))
  expect(n).not.toContain('- You:')
})

test('handoffNote: usage-limit turns do not push the real reply out of Recent turns', () => {
  const lim = asst([{ type: 'text', text: "You've hit your limit" }], { message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: "You've hit your limit" }] } })
  const t = 'z'.repeat(5000)
  const n = note(typed('real'), asst([{ type: 'text', text: t }]), typed('again'), lim, typed('again'), lim, typed('continue'), lim)
  expect(n).toContain('- User: real\n\n> ' + t)
  expect(n).not.toContain('- User: again')
  expect(n).not.toContain('- User: continue')
})

test('handoffNote: a reply before the first typed prompt in the tail is kept, whole when no later turn has a reply', () => {
  const t = 'q'.repeat(5000)
  const n = note(asst([{ type: 'text', text: t }]), typed('push it'), typed('push it'))
  expect(n).toContain('> ' + t)
  expect(n).toContain('- User: push it')
})

test('handoffNote: a turn with tool calls and then a limit row keeps its prompt', () => {
  const lim = asst([{ type: 'text', text: "You've hit your limit" }], { message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: "You've hit your limit" }] } })
  const n = note(typed('p1'), asst([{ type: 'text', text: 'R1' }]), typed('p2'), tool('Bash', { command: 'ls' }), lim)
  expect(n).toContain('- User: p2')
})

test('handoffNote: a turn stopped with Esc and no reply keeps its prompt', () => {
  const n = note(typed('p1'), asst([{ type: 'text', text: 'R1' }]), typed('p2'), typed('[Request interrupted by user]'))
  expect(n).toContain('- User: p2')
})

test('handoffNote: every line of the last reply is quoted', () => {
  const n = note(typed('q'), asst([{ type: 'text', text: '## Heading\nbody\n\nend' }]))
  expect(n).toContain('> ## Heading\n> body\n> \n> end')
  expect(n).not.toContain('\n## Heading')
})

test('handoffNote: last 3 typed prompts, tool results and commands skipped', () => {
  const n = note(
    typed('p1'), typed('p2'), typed('p3'),
    J({ type: 'user', message: { content: [{ type: 'tool_result', content: 'RESULT' }] } }),
    typed('<command-name>/x</command-name>'),
    typed('META', { isMeta: true }),
    typed('SUMMARY', { isCompactSummary: true }),
    typed('p4'),
    typed('[Request interrupted by user]'),
    typed('p5'),
  )
  expect(n.indexOf('p3')).toBeLessThan(n.indexOf('p4'))
  expect(n.indexOf('p4')).toBeLessThan(n.indexOf('p5'))
  for (const s of ['p1', 'p2', 'RESULT', 'command-name', 'META', 'SUMMARY', 'interrupted']) expect(n).not.toContain(s)
})

test('handoffNote: housekeeping compact turns do not set the goal or the replies', () => {
  const cmd = typed('<command-message>claudzilla-compact</command-message>\n<command-name>/claudzilla-compact</command-name>')
  const rows = (c: string) => [
    typed('real'), tool('mcp__margin__intent', { wants: 'REAL goal' }), asst([{ type: 'text', text: 'REAL reply' }]),
    c, tool('mcp__margin__intent', { wants: 'HOUSE goal' }), tool('mcp__margin__intent', { now: 3 }), asst([{ type: 'text', text: 'HOUSE reply' }]),
  ]
  for (const c of [cmd, typed('/compact Keep: x.'), typed('<command-name>/compact</command-name>')]) {
    const n = note(...rows(c))
    expect(n).toContain('REAL goal')
    expect(n).toContain('REAL reply')
    for (const s of ['HOUSE', 'Last step started', '/compact', 'claudzilla-compact']) expect(n).not.toContain(s)
  }
  const after = note(...rows(cmd), typed('next'), tool('mcp__margin__intent', { wants: 'NEXT goal' }), asst([{ type: 'text', text: 'NEXT reply' }]))
  expect(after).toContain('NEXT goal')
  expect(after).toContain('NEXT reply')
  expect(after).not.toContain('HOUSE')
})

test('handoffNote: recent turns pair each prompt with its own last text reply', () => {
  const r = (text: string) => asst([{ type: 'text', text }])
  const n = note(
    typed('p1'), r('R1'), typed('p2'), r('R2a'), tool('Bash', {}), r('R2b'), typed('p3'), tool('Bash', {}),
    typed('p4'), r('R4'), typed('p5'), r('R5'),
  )
  expect(n).toContain('## Recent turns\n\n- User: p3\n\n- User: p4\n\n> R4\n\n- User: p5\n\n> R5\n')
  for (const s of ['p1', 'p2', 'R2', 'Last reply', 'Last prompts']) expect(n).not.toContain(s)
})

test('handoffNote: a turn keeps its longest text reply, the later one on a tie', () => {
  const r = (text: string) => asst([{ type: 'text', text }])
  const n = note(typed('p1'), r('LONG result'), typed('<task-notification>done</task-notification>'), r('short'), typed('p2'), r('aa'), r('bb'))
  expect(n).toContain('- User: p1\n\n> LONG result\n')
  expect(n).not.toContain('short')
  expect(n).toContain('> bb')
  expect(n).not.toContain('> aa')
})

test('handoffNote: a long compact summary keeps its head and its end', () => {
  const sum = '9:' + typed('H'.repeat(3000) + '~'.repeat(2000) + 'T'.repeat(5000), { isCompactSummary: true })
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), summary: sum })
  expect(n).toContain('H'.repeat(3000) + '…' + 'T'.repeat(5000) + '\nCut; full text at line 9.')
  expect(n).not.toContain('~')
})

test('handoffNote: away recap: no section', () => {
  const recap = J({ type: 'system', subtype: 'away_summary', content: 'RECAP push pending' })
  const n = note(recap, typed('later'))
  expect(n).not.toContain('RECAP')
  expect(n).not.toContain('## Away recap')
})

test('handoffNote: where we were shows for an intent after the last typed prompt, with a lag line first', () => {
  const n = note(typed('ask'), tool('mcp__margin__intent', { wants: 'NEW' }))
  expect(n).toContain('## Where we were\n\nMay lag: Recent turns wins.\nNEW')
})

test('handoffNote: where we were is hidden when the intent is before the last typed prompt, and the wants stays in earlier asks', () => {
  const intents = '1:' + tool('mcp__margin__intent', { wants: 'CURRENT' })
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(tool('mcp__margin__intent', { wants: 'CURRENT' }), typed('later')), intents })
  expect(n).not.toContain('## Where we were')
  expect(n.slice(n.indexOf('## Earlier asks'))).toContain('- Line 1: CURRENT')
})

test('handoffNote: earlier asks lists the newest 10 Overview topics, oldest first, when there are topics', () => {
  const topics = Array.from({ length: 12 }, (_, i) => `topic ${i + 1}`)
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), overview: { topics }, intents: '1:' + tool('mcp__margin__intent', { wants: 'PAST' }) })
  const list = n.slice(n.indexOf('## Earlier asks')).split('\n').filter(l => l.startsWith('- topic'))
  expect(list).toEqual(topics.slice(2).map(t => `- ${t}`))
  expect(n).not.toContain('PAST')
})

test('handoffNote: earlier asks keeps the current wants after 9 topics when where we were is hidden', () => {
  const topics = Array.from({ length: 12 }, (_, i) => `topic ${i + 1}`)
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(tool('mcp__margin__intent', { wants: 'CURRENT' }), typed('later')), overview: { topics } })
  expect(n).not.toContain('## Where we were')
  const list = n.slice(n.indexOf('## Earlier asks')).split('\n').filter(l => l.startsWith('- topic') || l.includes('CURRENT'))
  expect(list).toEqual([...topics.slice(3).map(t => `- ${t}`), '- CURRENT'])
})

test('handoffNote: esc stop with a stale intent says the last turn, not a step', () => {
  const n = note(tool('mcp__margin__intent', { wants: 'OLD' }), tool('mcp__margin__intent', { now: 2 }), typed('later'), typed('[Request interrupted by user]'))
  expect(n).toContain('stopped the last turn with Esc')
  expect(n).not.toContain('step 2')
})

test('handoffNote: earlier asks falls back to past wants with no Overview topics', () => {
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), overview: { topics: [] }, intents: '1:' + tool('mcp__margin__intent', { wants: 'PAST' }) })
  expect(n).toContain('- Line 1: PAST')
})

const wt = (path: string, git = 'Branch: b\nHEAD: abc') => ({ path, git })
const gitNote = (rows: string[], worktrees: { path: string; git: string }[], cwd?: string) => handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(...rows), cwd, worktrees })

test('git block: a worktree touched by Read gets its own ### heading', () => {
  const g = gitNote([tool('Read', { file_path: '/x/claudzilla-b/a.md' })], [wt('/x/claudzilla'), wt('/x/claudzilla-b')])
  expect(g).toContain('## Git')
  expect(g).toContain('### /x/claudzilla-b')
  expect(g).not.toContain('### /x/claudzilla\n')
  expect(g).toContain('Branch: b')
})

test('git block: a sibling prefix is not a match', () => {
  const g = gitNote([tool('Read', { file_path: '/x/claudzilla-b/a.md' })], [wt('/x/claudzilla'), wt('/x/claudzilla-b')], '/x/claudzilla')
  expect(g).not.toContain('### /x/claudzilla\n')
  expect(g).toContain('### /x/claudzilla-b')
})

test('git block: a Bash word touches a worktree', () => {
  const g = gitNote([tool('Bash', { command: "sed -i 's/a/b/' /x/claudzilla-b/a.md" })], [wt('/x/claudzilla'), wt('/x/claudzilla-b')])
  expect(g).toContain('### /x/claudzilla-b')
  expect(g).not.toContain('### /x/claudzilla\n')
})

test('git block: a relative Bash word after a cd resolves against that dir, not the cwd', () => {
  const g = gitNote([tool('Bash', { command: 'cd /x/claudzilla-b && cat a.md' })], [wt('/x/claudzilla'), wt('/x/claudzilla-b')], '/x/claudzilla')
  expect(g).toContain('### /x/claudzilla-b')
  expect(g).not.toContain('### /x/claudzilla\n')
})

test('git block: after a cd it cannot follow, relative Bash words touch nothing', () => {
  const rows = [tool('Read', { file_path: '/x/claudzilla-b/z' }), tool('Bash', { command: 'cd ~/y && cat a.md' })]
  expect([...gitNote(rows, [wt('/x/claudzilla'), wt('/x/claudzilla-b')], '/x/claudzilla').matchAll(/### (\S+)/g)].map(m => m[1])).toEqual(['/x/claudzilla-b'])
})

test('git block: a bare cd takes no shell operator as its dir', () => {
  const rows = [tool('Read', { file_path: '/x/claudzilla-b/z' }), tool('Bash', { command: 'cd && cat a.md' })]
  expect([...gitNote(rows, [wt('/x/claudzilla'), wt('/x/claudzilla-b')], '/x/claudzilla').matchAll(/### (\S+)/g)].map(m => m[1])).toEqual(['/x/claudzilla-b'])
})

test('git block: at most 3 worktrees, newest touch first', () => {
  const g = gitNote(['a', 'b', 'c', 'd'].map(n => tool('Read', { file_path: `/x/${n}/f` })), ['a', 'b', 'c', 'd'].map(n => wt(`/x/${n}`)))
  expect(g).not.toContain('### /x/a')
  expect([...g.matchAll(/### (\/x\/\w)/g)].map(m => m[1])).toEqual(['/x/d', '/x/c', '/x/b'])
})

test('git block: cwd alone shows when nothing else was touched', () => {
  expect(gitNote([typed('hi')], [wt('/x/wt')], '/x/wt')).toContain('### /x/wt')
})

const dirtyGit = (...lines: string[]) => ['Branch: b', 'Dirty files:', ...lines, ' 2 files changed, 2 insertions(+)'].join('\n')

test('git block: a dirty file untouched by the session gets (not this session)', () => {
  const g = gitNote([tool('Edit', { file_path: '/x/wt/a.md' })], [wt('/x/wt', dirtyGit(' M a.md', ' M b.md'))])
  expect(g).toMatch(/ M a\.md\n/)
  expect(g).toContain(' M b.md (not this session)')
  expect(g).toContain(' 2 files changed, 2 insertions(+)\n')
})

test('git block: a Bash-touched dirty file has no suffix', () => {
  const g = gitNote([tool('Bash', { command: 'sed -i s/a/b/ /x/wt/b.md' })], [wt('/x/wt', dirtyGit(' M b.md'))])
  expect(g).toContain(' M b.md\n')
})

test('git block: a quoted rename uses the new path', () => {
  const git = wt('/x/wt', dirtyGit('R  "a b.md" -> "c d.md"'))
  expect(gitNote([tool('Edit', { file_path: '/x/wt/c d.md' })], [git])).toContain('"c d.md"\n')
  expect(gitNote([tool('Read', { file_path: '/x/wt/z' })], [git])).toContain('"c d.md" (not this session)')
})

test('git block: a relative cd or git -C resolves against the session cwd', () => {
  const trees = [wt('/x/claudzilla'), wt('/x/claudzilla-b')]
  for (const command of ['cd ../claudzilla-b && ls', 'git -C ../claudzilla-b status']) {
    const g = gitNote([tool('Bash', { command })], trees, '/x/claudzilla')
    expect(g).toContain('### /x/claudzilla-b')
    expect(g).not.toContain('### /x/claudzilla\n')
  }
})

test('git block: a file only a subagent edited has no suffix, and its worktree shows', () => {
  const git = wt('/x/wt', dirtyGit(' M a.md', ' M b.md'))
  const g = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), worktrees: [git], agentEdits: ['/x/wt/a.md'] })
  expect(g).toContain('### /x/wt')
  expect(g).toContain(' M a.md\n')
  expect(g).toContain(' M b.md (not this session)')
  expect(g).not.toContain('Written:')
})

test('git block: relative bash paths resolve against the session cwd', () => {
  const git = wt('/x/wt', dirtyGit(' M a.md', ' M b.md', ' M plugins/x.ts', ' M -la'))
  let g = gitNote([tool('Bash', { command: 'git mv a.md b.md' })], [git], '/x/wt')
  expect(g).toContain(' M a.md\n')
  expect(g).toContain(' M b.md\n')
  expect(g).toContain(' M plugins/x.ts (not this session)')
  g = gitNote([tool('Bash', { command: "sed -i 's/a/b/' plugins/x.ts" })], [git], '/x/wt')
  expect(g).toContain(' M plugins/x.ts\n')
  expect(g).toContain(' M a.md (not this session)')
  g = gitNote([tool('Bash', { command: 'ls -la' })], [git], '/x/wt')
  expect(g).toContain(' M -la (not this session)')
})

test('git block: a new untracked folder the session wrote into has no suffix', () => {
  const g = gitNote([tool('Write', { file_path: '/x/wt/newdir/x.md' })], [wt('/x/wt', dirtyGit('?? newdir/', '?? other/'))])
  expect(g).toContain('?? newdir/\n')
  expect(g).toContain('?? other/ (not this session)')
})

test('git block: no touch, no cwd, no worktree output: no Git section', () => {
  expect(note(typed('hi'))).not.toContain('## Git')
})

test('handoffNote: earlier asks are the last 5 distinct wants, newest last, with lines', () => {
  const at = (n: number, w: string) => `${n}:` + tool('mcp__margin__intent', { wants: w })
  const intents = [at(10, 'a1'), at(20, 'a2'), at(30, 'a3'), at(40, 'a4'), at(50, 'a5'), at(60, 'a2'), at(70, 'a6')].join('\n')
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), intents })
  const list = n.slice(n.indexOf('## Earlier asks')).split('\n').filter(l => l.startsWith('- Line'))
  expect(list).toEqual(['- Line 30: a3', '- Line 40: a4', '- Line 50: a5', '- Line 60: a2', '- Line 70: a6'])
})

test('handoffNote: earlier asks ignore blob rows and skip the current ask', () => {
  const at = (n: number, w: string, type = 'assistant') => `${n}:` + J({ type, message: { content: [{ type: 'tool_use', name: 'mcp__margin__intent', input: { wants: w } }] } })
  const intents = [at(10, 'old'), at(20, 'BLOB', 'api-request-blob'), at(30, 'CURRENT')].join('\n')
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(tool('mcp__margin__intent', { wants: 'CURRENT' })), intents })
  const asks = n.slice(n.indexOf('## Earlier asks'))
  expect(asks).toContain('- Line 10: old')
  expect(asks).not.toContain('BLOB')
  expect(n.split('CURRENT')).toHaveLength(2)
})

test('handoffNote: earlier asks skip intents made during compact housekeeping', () => {
  const at = (n: number, w: string) => `${n}:` + tool('mcp__margin__intent', { wants: w })
  const numbered = tail(typed('real'), tool('mcp__margin__intent', { wants: 'REAL' }), typed('/compact Keep: x.'), tool('mcp__margin__intent', { wants: 'HOUSE' }))
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered, intents: [at(2, 'REAL'), at(4, 'HOUSE'), at(9, 'OLD')].join('\n') })
  const asks = n.slice(n.indexOf('## Earlier asks'))
  expect(asks).toContain('- Line 9: OLD')
  expect(asks).not.toContain('HOUSE')
})

test('handoffNote: steps print without status', () => {
  const n = note(tool('mcp__margin__intent', { wants: 'W', steps: [{ text: 'one', status: 'completed' }] }))
  expect(n).toContain('\n- one\n')
  expect(n).not.toContain('completed')
})

test('handoffNote: compact draft inline with its line', () => {
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), draft: '42:' + tool('mcp__primer__compact_draft', { keep: 'K', drop: 'D' }) })
  expect(n).toContain('Compact draft')
  expect(n).toContain('Keep: K')
  expect(n).toContain('Drop: D')
  expect(n).toContain('line 42')
})

test('handoffNote: model-written sections are capped', () => {
  const big = (c: string) => c.repeat(5000)
  const n = handoffNote({
    sessionId: 's1', path: 'p', now: 0,
    numbered: tail(tool('mcp__margin__intent', { wants: big('W'), steps: [{ text: big('S') }, ...Array.from({ length: 30 }, (_, i) => ({ text: `step${i}` }))] })),
    draft: '42:' + tool('mcp__primer__compact_draft', { keep: big('K'), drop: big('D') }),
  })
  for (const c of 'WSKD') expect(n).toContain(c.repeat(500) + '…')
  for (const c of 'WSKD') expect(n).not.toContain(c.repeat(501))
  expect(n).toContain('- step18')
  expect(n).not.toContain('- step19')
})

test('handoffNote: compact draft only when after the last compact summary', () => {
  const d = '42:' + tool('mcp__primer__compact_draft', { keep: 'K', drop: 'D' })
  const mk = (n: number) => handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), draft: d, summary: `${n}:` + typed('S', { isCompactSummary: true }) })
  expect(mk(41)).toContain('Compact draft')
  expect(mk(42)).not.toContain('Compact draft')
  expect(mk(99)).not.toContain('Compact draft')
})

test('handoffNote: a deferred_tools_record naming compact_draft is not a draft', () => {
  const rec = '4686:' + J({ type: 'attachment', attachment: { type: 'deferred_tools_record', names: ['mcp__primer__compact_draft'] } })
  expect(handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), draft: rec })).not.toContain('Compact draft')
})

test('handoffNote: a partial first line is skipped', () => {
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: '7:{"type":"user","mess\n' + tail(typed('kept')) })
  expect(n).toContain('kept')
})

test('handoffNote: no Edited files section', () => {
  expect(note(tool('Edit', { file_path: '/f/1' }))).not.toContain('Edited files')
})

test('handoffNote: empty sections are left out', () => {
  const n = note(typed('only'))
  for (const h of ['Where we were', 'Git', 'Earlier asks', 'Away recap', 'Compact draft']) expect(n).not.toContain('## ' + h)
})

test('handoffNote: last compact summary inline with its line, only when present', () => {
  const mk = (text?: string) => handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), summary: text === undefined ? undefined : '77:' + typed(text, { isCompactSummary: true }) })
  const n = mk('GOAL and decisions')
  expect(n).toContain('## Last compact summary\n\nAt line 77.\nGOAL and decisions\n')
  expect(n).not.toContain('Last compact summary: line')
  expect(mk()).not.toContain('Last compact summary')
  const long = mk('a'.repeat(8001))
  expect(long).toContain('a'.repeat(3000) + '…' + 'a'.repeat(5000) + '\nCut; full text at line 77.')
  expect(mk('a'.repeat(8000))).not.toContain('Cut;')
})

test('handoffNote: how to dig says only the Git block was checked', () => {
  expect(note(typed('hi'))).toContain('The Git block was checked when this note was written. Everything else is the old session\'s claim: re-check it before acting on it.')
})

test('handoffNote: how to dig names grep, haiku and compact summaries', () => {
  const n = note(typed('hi'))
  for (const s of ['If this note is your whole prompt: when the old session stopped mid-step on its own, continue that step; when the user stopped it, say which step and wait. When its last reply ended on an offer, end yours with that offer as your `Next:` line, unchanged, and wait. Otherwise say in one line what you loaded, then wait for the user\'s ask.', 'Text after this note, with or without a `## User\'s ask` heading, is the user\'s ask: work on it instead of waiting.', 'Check git before saying what is pending. Don\'t restate the last reply.', 'grep -n', 'isCompactSummary', 'Never Read it whole', 'Read with `offset` and `limit`', 'the old transcript yourself, by line number']) expect(n).toContain(s)
})

const chainNote = (extra: Partial<Parameters<typeof handoffNote>[0]>, ...rows: string[]) => handoffNote({ sessionId: 'wwwwwwww-1', path: '/t/w.jsonl', now: 0, numbered: tail(...(rows.length ? rows : [typed('last ask')])), ...extra })
const chainOf = (n: string) => (/## Chain\n\n([\s\S]*?)(\n\n## |\n$)/.exec(n)?.[1] ?? '')
const E1 = '- 1 aaaaaaaa (root): goal one · /t/a.jsonl'
const E2 = '- 2 bbbbbbbb: goal two · /t/b.jsonl'
const earlier = (...entries: string[]) => ['# Handoff from bbbbbbbb-2', '', 'Written x. Its transcript: /t/b.jsonl', '', '## Chain', '', 'This is session 3 of a chain. Search an earlier transcript when the ask needs it.', ...entries, '', '## Paths', '', 'x'].join('\n')

test('chain: inline form copies entries from the first prompt, then the writer', () => {
  const n = chainNote({ firstPrompt: earlier(E1, E2), overview: { topics: [], summary: 'now goal' } })
  expect(chainOf(n)).toBe(`This is session 4 of a chain. Search an earlier transcript when the ask needs it.\n\n${E1}\n${E2}\n- 3 wwwwwwww: now goal`)
})

test('chain: @ form copies entries from the earlier note file', () => {
  const n = chainNote({ firstPrompt: '@/cfg/claudzilla-handoff/bbbbbbbb-2.md go', earlierNote: earlier(E1, E2), overview: { topics: [], summary: 'g' } })
  expect(chainOf(n)).toContain(`${E1}\n${E2}\n- 3 wwwwwwww: g`)
})

test('chain: depth 1, earlier note with no Chain: its writer is entry 1 (root), from its header and Where we were line', () => {
  const prev = ['# Handoff from aaaaaaaa-1', '', 'Written x. Its transcript: /t/a.jsonl', '', '## Where we were', '', 'May lag: Recent turns wins.', '', 'Fix the parser', '- step', '', '## Paths'].join('\n')
  const n = chainNote({ firstPrompt: prev, overview: { topics: [], summary: 'g' } })
  expect(chainOf(n)).toContain('- 1 aaaaaaaa (root): Fix the parser · /t/a.jsonl\n- 2 wwwwwwww: g')
})

test('chain: depth 1, earlier note with no Where we were: root goal is its last earlier ask', () => {
  const prev = ['# Handoff from aaaaaaaa-1', '', 'Written x. Its transcript: /t/a.jsonl', '', '## Earlier asks', '', '- first ask', '- last ask', '', '## Paths'].join('\n')
  const n = chainNote({ firstPrompt: prev, overview: { topics: [], summary: 'g' } })
  expect(chainOf(n)).toContain('- 1 aaaaaaaa (root): last ask · /t/a.jsonl\n- 2 wwwwwwww: g')
})

test('chain: the writer entry has no path, and the next note adds it from the header', () => {
  const n = chainNote({ firstPrompt: earlier(E1, '- 2 bbbbbbbb: goal two'), overview: { topics: [], summary: 'g' } })
  expect(chainOf(n)).toContain(`${E1}\n${E2}\n- 3 wwwwwwww: g`)
  expect(chainOf(n)).not.toContain('/t/w.jsonl')
})

test('chain: root entry marked (root), no other entry marked', () => {
  const n = chainNote({ firstPrompt: earlier(E1, E2) })
  expect(chainOf(n).match(/\(root\)/g)).toHaveLength(1)
})

test('chain: cap is first plus last 5', () => {
  const all = Array.from({ length: 8 }, (_, i) => `- ${i + 1} id${i + 1}xxxxx${i ? '' : ' (root)'}: g${i + 1} · /t/${i + 1}.jsonl`)
  const lines = chainOf(chainNote({ firstPrompt: earlier(...all.slice(0, 7)) })).split('\n').slice(2)
  expect(lines).toHaveLength(6)
  expect(lines[0]).toContain('- 1 ')
  expect(lines[1]).toContain('- 4 ')
  expect(lines[5]).toContain('- 8 ')
})

test('chain: writer goal is the Overview session line when present', () => {
  const n = chainNote({ firstPrompt: earlier(E1), overview: { topics: [], summary: 'SESSION LINE' } }, tool('mcp__margin__intent', { wants: 'WANTS' }), typed('later'))
  expect(chainOf(n)).toContain('wwwwwwww: SESSION LINE')
})

test('chain: goal is the last intent wants with no session line, else the last typed prompt cut to 200', () => {
  expect(chainOf(chainNote({ firstPrompt: earlier(E1) }, typed('p'), tool('mcp__margin__intent', { wants: 'WANTS' })))).toContain('wwwwwwww: WANTS')
  const long = 'x'.repeat(300)
  expect(chainOf(chainNote({ firstPrompt: earlier(E1) }, typed(long)))).toMatch(new RegExp(`wwwwwwww: x{200}…$`))
})

test('chain: @ form with the file gone: Earlier links lost. line, then an entry with the id from the path and no transcript path', () => {
  const n = chainNote({ firstPrompt: '@/cfg/claudzilla-handoff/bbbbbbbb-2.md' })
  expect(chainOf(n)).toBe('This is session 3 of a chain. Search an earlier transcript when the ask needs it.\n\nEarlier links lost.\n- 1 bbbbbbbb (root)\n- 2 wwwwwwww: last ask')
})

test('chain: @ form with an empty earlier note is lost, id from the path', () => {
  const n = chainNote({ firstPrompt: '@/cfg/claudzilla-handoff/bbbbbbbb-2.md', earlierNote: '' })
  expect(chainOf(n)).toContain('Earlier links lost.\n- 1 bbbbbbbb (root)\n- 2 wwwwwwww')
})

test('chain: @ form with a headerless earlier note takes the id from the path', () => {
  const n = chainNote({ firstPrompt: '@/cfg/claudzilla-handoff/bbbbbbbb-2.md', earlierNote: 'just text' })
  expect(chainOf(n)).toContain('- 1 bbbbbbbb (root)\n- 2 wwwwwwww')
})

test('/claudzilla handoff: the earlier note read throws, the written note says the links are lost', async ($, on) => {
  const { seen } = handoffHost(on, { head: typed('@/x/claudzilla-handoff/bbbbbbbb-2.md') + '\n', files: p => { if (p.endsWith('bbbbbbbb-2.md')) throw new Error('ENOENT'); return undefined } })
  await $.session.start(start)
  await handoff($)
  expect(seen.writes[0]![1]).toContain('Earlier links lost.\n- 1 bbbbbbbb (root)')
})

test('chain: header N is one past the last entry', () => {
  expect(chainOf(chainNote({ firstPrompt: earlier(E1, E2) }))).toMatch(/^This is session 4 of a chain/)
})

test('chain: absent when the first prompt is not a handoff', () => {
  expect(chainNote({ firstPrompt: 'fix the bug' })).not.toContain('## Chain')
  expect(chainNote({})).not.toContain('## Chain')
})

test('/claudzilla handoff reads the first prompt from the transcript head and the earlier note for the @ form', async ($, on) => {
  const { seen } = handoffHost(on, { head: [J({ type: 'user', isMeta: true, message: { content: 'meta' } }), typed('@/x/claudzilla-handoff/bbbbbbbb-2.md')].join('\n') + '\n', files: p => (p === '/cfg/claudzilla-handoff/bbbbbbbb-2.md' ? earlier(E1, E2) : undefined) })
  await $.session.start(start)
  await handoff($)
  expect(seen.argvs.some(a => a.includes('head -c 200000'))).toBe(true)
  expect(seen.writes[0]![1]).toContain(`${E2}\n- 3 s1:`)
})

const CFG = '/cfg'
const NOTE = `${CFG}/claudzilla-handoff/s1.md`
const done = (extra = {}) => ({ answer: 'x', reason: 'answer' as const, durationMs: 1, isAborted: false, turnId: 't1', ...extra })

// A session idle after a reply: transcript found, greps answered, box as given.
function handoffHost(on: Parameters<TestBody>[1], o: { find?: string; worktrees?: string[]; writeFails?: boolean; clearFails?: boolean; submitFails?: boolean; submitDrop?: boolean; filled?: boolean; drop?: boolean; git?: string; head?: string; agentEdits?: string; files?: (p: string) => string | undefined } = {}) {
  const seen = { order: [] as string[], writes: [] as [string, string][], commands: [] as string[], fills: [] as string[], submits: [] as any[], argvs: [] as string[] }
  const clock = mock.clock(on, { now: 0 })
  const base = host(on, {
    files: o.files,
    proc: c => {
      seen.argvs.push(c)
      if (c.includes('chmod 700')) seen.order.push('mkdir')
      if (c.startsWith('find ')) return ran(0, o.find ?? '/cfg/projects/p/s1.jsonl\n')
      if (c.includes('worktree list')) return ran(0, (o.worktrees ?? []).map(w => `worktree ${w}\nHEAD abc\n`).join('\n'))
      if (c.includes('rev-parse')) return o.git === undefined ? ran(0, '') : ran(0, o.git)
      if (c.includes('subagents')) return ran(0, o.agentEdits ?? '')
      if (c.includes('head -c 200000')) return ran(0, o.head ?? '')
      if (c.includes('compact_draft')) return ran(0, '7:{"x":1}\n')
      return ran(0, '1:{"type":"user","message":{"content":"hi"}}\n')
    },
  })
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? CFG : undefined }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  on('session.cwd', () => ({ value: '/proj' }) as any)
  on('fs.write', (_, e: any) => { if (o.writeFails) throw new Error('disk full'); seen.order.push('write'); seen.writes.push([e.path, e.text ?? e.content]); return { value: undefined } as any })
  on('command.run', (_, e: any) => { if (e.command === 'clear') { seen.commands.push('clear'); if (o.clearFails) throw new Error('no'); } return { value: {} } as any })
  on('prompt.fill', (_, e: any) => { seen.fills.push(e.text); return { isFilled: o.filled ?? true } as any })
  on('prompt.submit', (_, e: any) => { if (e.origin?.kind === 'plugin') { seen.submits.push(e); if (o.submitFails) throw new Error('no'); if (o.submitDrop) return { drop: 'refused' } as any } return { text: e.text } as any })
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  return { seen: Object.assign(seen, { toasts: base.toasts, registered: base.registered }), clock }
}
const handoff = ($: Parameters<TestBody>[0]) => $.command.run({ command: 'claudzilla', args: 'handoff', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
const submit = ($: Parameters<TestBody>[0], text = 'work') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any)
const turnStart = ($: Parameters<TestBody>[0], extra = {}) => $.turn.start({ text: 'work', turnId: 't1', ...extra } as any)

test('/claudzilla handoff writes the note, then clears and sends the note as the user after the hook returns', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  expect(seen.writes).toHaveLength(1)
  expect(seen.writes[0]![0]).toBe(NOTE)
  expect(seen.writes[0]![1]).toContain('claude --resume s1')
  expect(seen.commands).toEqual([])
  await clock.advance(500)
  expect(seen.commands).toEqual(['clear'])
  expect(seen.submits).toHaveLength(1)
  expect(seen.submits[0]).toMatchObject({ text: seen.writes[0]![1], origin: { kind: 'plugin', asUser: true } })
  expect(seen.fills).toEqual([])
})

test('/claudzilla handoff follows a symlinked projects folder', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  expect(seen.argvs).toContain('find -H /cfg/projects -maxdepth 2 -name s1.jsonl')
})

test('/claudzilla handoff fills @note when the send fails', async ($, on) => {
  const { seen, clock } = handoffHost(on, { submitFails: true })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.fills).toEqual([`@${NOTE} `])
})

test('/claudzilla handoff fills @note when the send is refused', async ($, on) => {
  const { seen, clock } = handoffHost(on, { submitDrop: true })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.fills).toEqual([`@${NOTE} `])
})

test('/claudzilla-handoff is registered and runs the same handoff', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla-handoff' }))
  await $.command.run({ command: 'claudzilla-handoff', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(seen.writes[0]![0]).toBe(NOTE)
  await clock.advance(500)
  expect(seen.commands).toEqual(['clear'])
})

test('/claudzilla handoff <ask> sends the note then the ask; the note file stays without it', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  await $.command.run({ command: 'claudzilla', args: 'Handoff  fix the folio test ', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  expect(seen.writes[0]![1]).not.toContain('fix the folio test')
  await clock.advance(500)
  expect(seen.submits[0].text).toBe(`${seen.writes[0]![1]}\n\n## User's ask\n\nfix the folio test`)
})

test('/claudzilla-handoff <ask> keeps the ask in the @note fallback', async ($, on) => {
  const { seen, clock } = handoffHost(on, { submitFails: true })
  await $.session.start(start)
  await $.command.run({ command: 'claudzilla-handoff', args: 'fix it', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.advance(500)
  expect(seen.fills).toEqual([`@${NOTE} fix it`])
})

test('/claudzilla handoff from a plugin or peer hands off without the ask', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  await $.command.run({ command: 'claudzilla', args: 'handoff do X', origin: { kind: 'peer-send-message' }, presentation: { isFullscreen: true, columns: 120 } } as any)
  await clock.advance(500)
  expect(seen.submits[0].text).toBe(seen.writes[0]![1])
})

test('/claudzilla handoffs is not a handoff', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await run($, 'handoffs')
  expect(seen.writes).toEqual([])
})

test('/claudzilla handoff passes the transcript path as $1, not in the script', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  const sh = seen.argvs.filter(a => a.startsWith('sh -c') && !a.includes('chmod') && !a.includes('rev-parse'))
  expect(sh).toHaveLength(6)
  for (const a of sh) {
    expect(a.split('/cfg/projects/p/s1.jsonl')).toHaveLength(2)
    expect(a.endsWith('/cfg/projects/p/s1.jsonl')).toBe(true)
  }
})

test('/claudzilla handoff mid-turn answers and does nothing', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  await turnStart($)
  const r: any = await handoff($)
  expect(r.text).toContain('turn')
  await clock.advance(500)
  expect(seen.writes).toEqual([])
  expect(seen.commands).toEqual([])
})

test("/claudzilla handoff after a subagent's turn.complete still counts the turn running", async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await turnStart($)
  await $.turn.complete(done({ agentId: 'g1' }) as any)
  const r: any = await handoff($)
  expect(r.text).toContain('turn')
  expect(seen.writes).toEqual([])
})

test("/claudzilla handoff: a subagent's turn.start does not make it refuse", async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await turnStart($, { agentId: 'g1' })
  await handoff($)
  expect(seen.writes).toHaveLength(1)
})

test('/claudzilla handoff: a prompt.submit alone does not make it refuse', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await submit($)
  await handoff($)
  expect(seen.writes).toHaveLength(1)
})

test('/claudzilla handoff after the main turn completes runs', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await turnStart($)
  await $.turn.complete(done() as any)
  await handoff($)
  expect(seen.writes).toHaveLength(1)
})

test('/claudzilla handoff with no transcript answers and does nothing', async ($, on) => {
  const { seen, clock } = handoffHost(on, { find: '' })
  await $.session.start(start)
  const r: any = await handoff($)
  expect(r.text).toBeTruthy()
  await clock.advance(500)
  expect(seen.writes).toEqual([])
  expect(seen.commands).toEqual([])
})

test('/claudzilla handoff skips /clear when the write fails', async ($, on) => {
  const { seen, clock } = handoffHost(on, { writeFails: true })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.toasts.some(t => t.startsWith('Handoff note not written'))).toBe(true)
  expect(seen.commands).toEqual([])
})

test('/claudzilla handoff makes the note folder 0700 before writing', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  const i = seen.argvs.indexOf(`sh -c mkdir -p "$1" && chmod 700 "$1" sh ${CFG}/claudzilla-handoff`)
  expect(i).toBeGreaterThanOrEqual(0)
  expect(seen.writes).toHaveLength(1)
  expect(seen.order.indexOf('mkdir')).toBeLessThan(seen.order.indexOf('write'))
})

test('/claudzilla handoff toasts the note path when /clear fails', async ($, on) => {
  const { seen, clock } = handoffHost(on, { clearFails: true })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.toasts.some(t => t.includes(NOTE) && !t.includes('new session'))).toBe(true)
  expect(seen.submits).toEqual([])
})

test('/claudzilla handoff toasts the note path when the send and the fill fail', async ($, on) => {
  const { seen, clock } = handoffHost(on, { submitFails: true, filled: false })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.toasts.some(t => t.includes(NOTE))).toBe(true)
})

test('/claudzilla handoff runs git in the session cwd and puts it in the note', async ($, on) => {
  const { seen } = handoffHost(on, { git: 'Branch: b\nCommits on no remote: 7\n', worktrees: ['/proj'] })
  await $.session.start(start)
  await handoff($)
  expect(seen.argvs.some(a => a.includes('rev-parse') && a.endsWith(' /proj'))).toBe(true)
  expect(seen.writes[0]![1]).toContain('### /proj')
  expect(seen.writes[0]![1]).toContain('Commits on no remote: 7')
})

test('writeHandoff: GIT runs once per listed worktree', async ($, on) => {
  const { seen } = handoffHost(on, { git: 'Branch: b\n', worktrees: ['/proj', '/proj-b'] })
  await $.session.start(start)
  await handoff($)
  const runs = seen.argvs.filter(a => a.includes('rev-parse --git-dir'))
  expect(runs.length).toBe(2)
  expect(runs.map(a => a.slice(a.lastIndexOf(' ') + 1)).sort()).toEqual(['/proj', '/proj-b'])
})

test('/claudzilla handoff passes subagent edit paths to the note', async ($, on) => {
  const { seen } = handoffHost(on, { worktrees: ['/proj'], git: 'Branch: b\nDirty files:\n M a.md\n M b.md\n', agentEdits: '"file_path":"/proj/a.md"\n"notebook_path":"/proj/n.ipynb"\n' })
  await $.session.start(start)
  await handoff($)
  expect(seen.argvs.find(a => a.includes('subagents'))).toContain('/subagents')
  const n = seen.writes[0][1]
  expect(n).toContain(' M a.md\n')
  expect(n).toContain(' M b.md (not this session)')
})

test('/claudzilla handoff lists unpushed commits of HEAD only', async ($, on) => {
  const { seen } = handoffHost(on, { worktrees: ['/proj'] })
  await $.session.start(start)
  await handoff($)
  const g = seen.argvs.find(a => a.includes('rev-parse'))!
  expect(g).toContain('log --oneline HEAD --not --remotes')
  expect(g).not.toContain('--branches')
})

test('/claudzilla handoff git script prints HEAD after Branch', async ($, on) => {
  const { seen } = handoffHost(on, { worktrees: ['/proj'] })
  await $.session.start(start)
  await handoff($)
  const g = seen.argvs.find(a => a.includes('rev-parse --git-dir'))!
  expect(g).toContain('echo "HEAD: $(git -C "$1" rev-parse --short HEAD)"')
  expect(g.indexOf('echo "Branch:')).toBeLessThan(g.indexOf('echo "HEAD:'))
})

test('/claudzilla handoff: no worktree output leaves the Git section out', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  expect(seen.writes[0]![1]).not.toContain('## Git')
})

test('/claudzilla handoff anchors the draft and intent greps on the tool_use call', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  expect(seen.argvs.some(a => a.includes('"type":"tool_use","id":"[^"]*","name":"mcp__primer__compact_draft"'))).toBe(true)
  expect(seen.argvs.some(a => a.includes('mcp__margin__intent') && a.includes('tail -40'))).toBe(true)
  expect(seen.argvs.some(a => a.includes('"isCompactSummary":true'))).toBe(true)
})

test('openSlug: a topic wins; no topic keeps an open Guide and starts a closed one on start', () => {
  expect(openSlug('lore', true, 'picks')).toBe('lore')
  expect(openSlug(' Lore ', false, 'picks')).toBe('lore')
  expect(openSlug(undefined, true, 'picks')).toBe('picks')
  expect(openSlug(undefined, false, 'picks')).toBe('start')
})

const LORE = MD + '\n## Worlds\n\n### Lore\n<!-- topic: lore -->\n\nLong ago.\n'
const quick = ($: Parameters<TestBody>[0], command: string, args = '') =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
const mountGuide = ($: Parameters<TestBody>[0]) => $.ui.mount({ plugin: 'primer', surface: 'terminal', component: 'Pane', props: props(100, 'dock', 40), requestId: 'primer' })

test('registers /claudzilla-guide and /claudzilla-worlds', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla-guide', argumentHint: '[topic]' }))
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla-worlds' }))
})

test('/claudzilla-worlds opens on lore and never closes the Guide', async ($, on) => {
  const seen = host(on, { guide: LORE })
  await $.session.start(start)
  await quick($, 'claudzilla-worlds')
  const ui = await mountGuide($)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('### Lore')
  await quick($, 'claudzilla-worlds')
  expect(seen.closed).toEqual([])
})

test('bare /claudzilla-guide opens on start, then keeps the shown topic and never closes', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  await quick($, 'claudzilla-guide')
  expect(seen.opened).toHaveLength(1)
  await run($, 'picks')
  await quick($, 'claudzilla-guide')
  const ui = await mountGuide($)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('### The picks card')
  expect(seen.closed).toEqual([])
})

test('/claudzilla-guide <topic> opens that topic, and its words are only a topic', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  await quick($, 'claudzilla-guide', 'talk')
  const ui = await mountGuide($)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('### Talk to Claude')
  await quick($, 'claudzilla-guide', 'compact')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join(' ')).toContain('No topic "compact"')
  expect(seen.toasts).toEqual([])
})

test('doctorArgs: exact doctor or doctor fix, any case', () => {
  expect(doctorArgs(' Doctor ')).toBe('check')
  expect(doctorArgs('doctor FIX')).toBe('fix')
  expect(doctorArgs('doctors')).toBeUndefined()
  expect(doctorArgs('doctor fix now')).toBeUndefined()
})

function doctor(on: Parameters<TestBody>[1], res: ReturnType<typeof ran>) {
  const calls: string[] = []
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }) as any)
  const seen = host(on, { guide: LABS, proc: c => (c.includes('doctor.mjs') ? (calls.push(c), res) : ran(0, '/repo\nv1.4.0\n')) })
  return { calls, seen }
}

test('/claudzilla doctor runs the clone\'s doctor and shows its output', async ($, on) => {
  const { calls } = doctor(on, ran(0, 'claudzilla doctor  @ cee0f89\n✓ links 19/19'))
  const shown = await texts(await open($, 'doctor'))
  expect(calls).toEqual(['node /cfg/hooks/doctor.mjs'])
  expect(shown).toContain('✓ links 19/19')
})

test('/claudzilla doctor with a failed run says so', async ($, on) => {
  doctor(on, ran(1, ''))
  expect(await texts(await open($, 'doctor'))).toContain('Could not run the doctor.')
})

test('/claudzilla doctor fix hands off to claudzilla-doctor', async ($, on) => {
  const timers: number[] = []
  const { calls, seen } = doctor(on, ran(0, 'x'))
  on('clock.after', (_, e: any) => { timers.push(e.ms); return { value: undefined } as any })
  await $.session.start(start)
  await run($, 'doctor fix')
  expect(timers).toContain(500)
  expect(calls).toEqual([])
  expect(seen.opened).toHaveLength(0)
})

test('paths: written lists Edit, Write and NotebookEdit paths, deduplicated, newest 15', () => {
  const rows = Array.from({ length: 17 }, (_, i) => tool(i % 2 ? 'Write' : 'Edit', { file_path: `/x/f${i}.ts` }))
  rows.push(tool('NotebookEdit', { notebook_path: '/x/n.ipynb' }), tool('Edit', { file_path: '/x/f16.ts' }))
  const n = note(...rows)
  const sec = n.slice(n.indexOf('## Paths'), n.indexOf('## How to dig'))
  expect(sec.match(/^- \/x\//gm)).toHaveLength(15)
  expect(sec).toContain('/x/n.ipynb')
  expect(sec.match(/\/x\/f16\.ts/g)).toHaveLength(1)
  expect(sec).not.toContain('/x/f0.ts')
  expect(sec).not.toContain('/x/f1.ts')
  expect(sec).toContain('/x/f3.ts')
})

test('paths: cited takes paths from the last 2 assistant text replies', () => {
  const n = note(asst([{ type: 'text', text: 'old docs/superpowers/specs/old.md' }]), asst([{ type: 'text', text: 'see docs/superpowers/plans/x.md and docs/chancery/a/ledger.md.' }]), asst([{ type: 'text', text: 'run /tmp/baton-ctx/ctx.py' }]))
  const sec = n.slice(n.indexOf('## Paths'))
  expect(sec).toContain('- docs/superpowers/plans/x.md')
  expect(sec).toContain('- docs/chancery/a/ledger.md')
  expect(sec).toContain('- /tmp/baton-ctx/ctx.py')
  expect(sec).not.toContain('old.md')
})

test('recent turns: a closing line break with a long final line keeps the last 1200 characters', () => {
  const n = note(typed('go'), asst([{ type: 'text', text: 'h'.repeat(5000) + '\n' + 'z'.repeat(2000) + '\n' }]))
  expect(n).toContain('…' + 'z'.repeat(1199))
  expect(n).toContain('h'.repeat(4800))
})

test('paths: cited paths keep their absolute prefix and lose wrapping marks', () => {
  const t = (text: string) => { const n = note(asst([{ type: 'text', text }])); return n.slice(n.indexOf('## Paths')) }
  expect(t('spec at `/home/u/c/docs/chancery/2026-11-28-baton/spec.md`.')).toContain('- /home/u/c/docs/chancery/2026-11-28-baton/spec.md\n')
  expect(t('see `/x/plan.ledger.md` now')).toContain('- /x/plan.ledger.md\n')
  expect(t('see (/x/plan.ledger.md) now')).toContain('- /x/plan.ledger.md\n')
  expect(t('progress in .superpowers/sdd/x/progress.md.')).toContain('- .superpowers/sdd/x/progress.md\n')
})

test('paths: commands keeps the last 5 distinct test or tmux commands', () => {
  const cmds = ['claude plugin test plugins/primer', 'ls -la', 'bash tests/hooks.test.sh', 'tmux send-keys -t x', 'npm test', 'bun test a', 'pytest -q', 'claude plugin test plugins/primer']
  const n = note(...cmds.map(command => tool('Bash', { command })))
  const sec = n.slice(n.indexOf('## Paths'), n.indexOf('## How to dig'))
  expect(sec).toContain('`claude plugin test plugins/primer`')
  expect(sec).toContain('`tmux send-keys -t x`')
  expect(sec).not.toContain('ls -la')
  expect(sec).not.toContain('bash tests/hooks.test.sh')
  expect(sec.match(/^- `/gm)).toHaveLength(5)
})

test('paths: section left out when empty', () => {
  expect(note(typed('hi'), asst([{ type: 'text', text: 'plain reply' }]))).not.toContain('## Paths')
})

test('paths: a multi-line command shows its matching line only', () => {
  const n = note(tool('Bash', { command: 'claude plugin test plugins/primer\necho done' }))
  const sec = n.slice(n.indexOf('## Paths'), n.indexOf('## How to dig'))
  expect(sec.match(/^- `/gm)).toHaveLength(1)
  expect(sec).toContain('`claude plugin test plugins/primer`')
  expect(sec).not.toContain('echo done')
})
test('paths: a multi-line command shows the line that matches', () => {
  const n = note(tool('Bash', { command: 'cd /x && W=1\nclaude plugin test plugins/folio' }))
  const sec = n.slice(n.indexOf('## Paths'), n.indexOf('## How to dig'))
  expect(sec).toContain('- `claude plugin test plugins/folio`')
  expect(sec).not.toContain('cd /x')
})
