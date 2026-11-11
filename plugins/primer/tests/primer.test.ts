import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { draft, experimentalArgs, featureLines, find, fit, handoffNote, parse, reportArgs, rows } from '../hooks/register'

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

test('registers /claudzilla with the experimental hint', async ($, on) => {
  const seen = host(on)
  await $.session.start(start)
  expect(seen.registered).toContainEqual(expect.objectContaining({ name: 'claudzilla', argumentHint: '[topic | report [what happened] | compact | handoff | experimental [id on|off]]' }))
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
  expect(n).toContain('- [completed] one')
  expect(n).toContain('- [in_progress] two')
  expect(n).toContain('Now: step 2')
  expect(n).not.toContain('OLD ask')
})

test('handoffNote: last reply cut to 2000 characters', () => {
  const n = note(asst([{ type: 'text', text: 'x'.repeat(2500) }]))
  expect(n).toContain('x'.repeat(2000) + '…')
  expect(n).not.toContain('x'.repeat(2001))
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

test('handoffNote: away recap only when newer than the last reply', () => {
  const reply = asst([{ type: 'text', text: 'done' }], { timestamp: '2026-01-01T10:00:00Z' })
  const recap = (ts: string) => J({ type: 'system', subtype: 'away_summary', content: 'RECAP', timestamp: ts })
  expect(note(reply, recap('2026-01-01T11:00:00Z'))).toContain('RECAP')
  expect(note(reply, recap('2026-01-01T09:00:00Z'))).not.toContain('RECAP')
})

test('handoffNote: last 10 unique edited files', () => {
  const rows = Array.from({ length: 12 }, (_, i) => tool(i % 2 ? 'Write' : 'Edit', { file_path: `/f/${i}` }))
  rows.push(tool('Edit', { file_path: '/f/3' }))
  const n = note(...rows)
  const list = n.slice(n.indexOf('## Edited files')).split('\n').filter(l => l.startsWith('- /f/'))
  expect(list).toEqual(['/f/3', '/f/11', '/f/10', '/f/9', '/f/8', '/f/7', '/f/6', '/f/5', '/f/4', '/f/2'].map(f => `- ${f}`))
})

test('handoffNote: compact draft inline with its line', () => {
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: tail(typed('hi')), draft: '42:' + tool('mcp__primer__compact_draft', { keep: 'K', drop: 'D' }) })
  expect(n).toContain('Compact draft')
  expect(n).toContain('Keep: K')
  expect(n).toContain('Drop: D')
  expect(n).toContain('line 42')
})

test('handoffNote: a partial first line is skipped', () => {
  const n = handoffNote({ sessionId: 's1', path: 'p', now: 0, numbered: '7:{"type":"user","mess\n' + tail(typed('kept')) })
  expect(n).toContain('kept')
})

test('handoffNote: empty sections are left out', () => {
  const n = note(typed('only'))
  for (const h of ['Where we were', 'Edited files', 'Compact draft']) expect(n).not.toContain(h)
})

test('handoffNote: how to dig names grep, haiku and compact summaries', () => {
  const n = note(typed('hi'))
  for (const s of ['grep -n', 'haiku', 'isCompactSummary', 'Never Read it whole']) expect(n).toContain(s)
})

const CFG = '/cfg'
const NOTE = `${CFG}/claudzilla-handoff/s1.md`
const done = (extra = {}) => ({ answer: 'x', reason: 'answer' as const, durationMs: 1, isAborted: false, turnId: 't1', ...extra })

// A session idle after a reply: transcript found, greps answered, box as given.
function handoffHost(on: Parameters<TestBody>[1], o: { find?: string; box?: string; writeFails?: boolean; clearFails?: boolean; filled?: boolean; drop?: boolean } = {}) {
  const seen = { order: [] as string[], writes: [] as [string, string][], commands: [] as string[], fills: [] as string[], argvs: [] as string[] }
  const clock = mock.clock(on, { now: 0 })
  const base = host(on, {
    proc: c => {
      seen.argvs.push(c)
      if (c.includes('chmod 700')) seen.order.push('mkdir')
      if (c.startsWith('find ')) return ran(0, o.find ?? '/cfg/projects/p/s1.jsonl\n')
      if (c.includes('compact_draft')) return ran(0, '7:{"x":1}\n')
      return ran(0, '1:{"type":"user","message":{"content":"hi"}}\n')
    },
  })
  on('env.get', (_, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? CFG : undefined }) as any)
  on('session.id', () => ({ value: 's1' }) as any)
  on('fs.write', (_, e: any) => { if (o.writeFails) throw new Error('disk full'); seen.order.push('write'); seen.writes.push([e.path, e.text ?? e.content]); return { value: undefined } as any })
  on('command.run', (_, e: any) => { if (e.command === 'clear') { seen.commands.push('clear'); if (o.clearFails) throw new Error('no'); } return { value: {} } as any })
  on('prompt.read', () => ({ value: { text: o.box ?? '', cursor: 0 } }) as any)
  on('prompt.fill', (_, e: any) => { seen.fills.push(e.text); return { isFilled: o.filled ?? true } as any })
  on('prompt.submit', (_, e: any) => ({ text: e.text }) as any)
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  return { seen: Object.assign(seen, { toasts: base.toasts }), clock }
}
const handoff = ($: Parameters<TestBody>[0]) => $.command.run({ command: 'claudzilla', args: 'handoff', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
const submit = ($: Parameters<TestBody>[0], text = 'work') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as any)
const turnStart = ($: Parameters<TestBody>[0], extra = {}) => $.turn.start({ text: 'work', turnId: 't1', ...extra } as any)

test('/claudzilla handoff writes the note, then clears and fills @note after the hook returns', async ($, on) => {
  const { seen, clock } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  expect(seen.writes).toHaveLength(1)
  expect(seen.writes[0]![0]).toBe(NOTE)
  expect(seen.writes[0]![1]).toContain('claude --resume s1')
  expect(seen.commands).toEqual([])
  await clock.advance(500)
  expect(seen.commands).toEqual(['clear'])
  expect(seen.fills).toEqual([`@${NOTE} `])
})

test('/claudzilla handoff passes the transcript path as $1, not in the script', async ($, on) => {
  const { seen } = handoffHost(on)
  await $.session.start(start)
  await handoff($)
  const sh = seen.argvs.filter(a => a.startsWith('sh -c') && !a.includes('chmod'))
  expect(sh).toHaveLength(2)
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

test('/claudzilla handoff keeps typed text', async ($, on) => {
  const { seen, clock } = handoffHost(on, { box: 'fix it' })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.fills).toEqual([`fix it @${NOTE} `])
})

test('/claudzilla handoff toasts the note path when /clear fails', async ($, on) => {
  const { seen, clock } = handoffHost(on, { clearFails: true })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.toasts.some(t => t.includes(NOTE) && !t.includes('new session'))).toBe(true)
})

test('/claudzilla handoff toasts the note path when the fill fails', async ($, on) => {
  const { seen, clock } = handoffHost(on, { filled: false })
  await $.session.start(start)
  await handoff($)
  await clock.advance(500)
  expect(seen.toasts.some(t => t.includes(NOTE))).toBe(true)
})
