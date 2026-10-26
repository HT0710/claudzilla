import { expect, test } from 'claude-code/testing'

const text = '━━━━\n\n**TL;DR** x\n\n──\n\n## H\n\n┈┈\n\nmore\n\n```text\n━━━━\n```\n\n━━━━'
const props = { text, isFirstOfReply: true }

for (const columns of [44, 84]) {
  test(`${columns} cols: heavy, separator and group lines fit the chat`, async ($, on) => {
    // Stands for the engine's own drawing of each chunk.
    on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
    const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm1',
      props, viewport: { columns, rows: 20 } })
    const w = columns - 4
    expect((await ui.findAll({ type: 'Text', text: /^━+$/ })).map(t => t.text.length)).toEqual([w, w])
    expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text.length).toBe(w / 2)
    expect((await ui.find({ type: 'Text', text: /^┈+$/ }))?.text.length).toBe(w / 4)
    // A line inside a fence is the reply's own text.
    expect(await ui.find({ type: 'Text', text: /^more\n\n```text\n━━━━\n```$/ })).toBeDefined()
  })
}

test("chunks after the bullet's keep its indent", async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm3',
    props, viewport: { columns: 44, rows: 20 } })
  const padOf = async (text: RegExp) => (await ui.findAll({ type: 'Box' })).find(b => text.test(b.text) && b.children.length === 1)?.props.paddingLeft
  expect(await padOf(/^## H$/)).toBe(2)
  expect(await padOf(/^\*\*TL;DR\*\* x$/)).toBeUndefined()
})

test("a block without the bullet takes no indent and the lines its room", async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm4',
    props: { ...props, isFirstOfReply: false }, viewport: { columns: 44, rows: 20 } })
  expect((await ui.findAll({ type: 'Text', text: /^━+$/ })).map(t => t.text.length)).toEqual([42, 42])
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.paddingLeft === 2)).toBe(false)
})

test('a summary block is the engine drawing, so its mark shows once', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm5',
    props: { ...props, isSummary: true }, viewport: { columns: 44, rows: 20 } })
  expect(await ui.find({ type: 'Text', text })).toBeDefined()
})

test('a reply with no frame lines is the engine drawing', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text' as const, children: ['engine'] }))
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm2',
    props: { text: 'plain\n', isFirstOfReply: true }, viewport: { columns: 44, rows: 20 } })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
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

test('traces the split decision', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const rows = sink(on, 'folio')
  await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'm9', props, viewport: { columns: 44, rows: 20 } })
  await $.session.end({ reason: 'other' })
  expect(rows().find(r => r.event === 'folio.split')?.data).toMatchObject({ rules: 4, split: true })
})

// Answers beneath the mod: the engine's drawing, the working directory, the clock, and which paths are files.
function files(on: any, kinds: Record<string, 'file' | 'dir'>) {
  const w = { stats: [] as string[], cwds: 0, clocks: 0, now: 1_000_000 }
  on('ui.render', { component: 'AssistantMessage' }, (_$: any, e: any) => ({ type: 'Text' as const, children: [e.props.text] }))
  on('session.cwd', () => (w.cwds++, { value: '/r' }))
  on('clock.now', () => (w.clocks++, { value: w.now }))
  on('fs.stat', (_: any, e: any) => {
    w.stats.push(e.path)
    const kind = kinds[e.path]
    return kind ? { value: { kind, size: 1, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }
  })
  return w
}
const mount = ($: any, requestId: string, props: object, surface = 'terminal') =>
  $.ui.mount({ plugin: 'folio', surface, component: 'AssistantMessage', requestId, props, viewport: { columns: 44, rows: 20 } })

test('a chunk with an existing path draws a Markdown link with the bullet', async ($, on) => {
  files(on, { '/r/a.ts': 'file' })
  const ui = await mount($, 'l1', { text: 'see `a.ts:65`\n\n──\n\nmore', isFirstOfReply: true })
  const md = await ui.find({ type: 'Markdown' })
  expect(md?.props.text).toContain('](file:///r/a.ts#L65)')
  expect(md?.props.pressableLinks).toEqual(['file:///r/a.ts#L65'])
  expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'more' })).toBeDefined()
})

test('directories and missing files stay plain', async ($, on) => {
  files(on, { '/r/src': 'dir' })
  const ui = await mount($, 'l2', { text: 'see `src` `src/b.ts`', isFirstOfReply: true })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'see `src` `src/b.ts`' })).toBeDefined()
})

test('same file, two lines, two links', async ($, on) => {
  files(on, { '/r/c.ts': 'file' })
  const ui = await mount($, 'l3', { text: '`c.ts:3` then `c.ts:9`', isFirstOfReply: true })
  expect((await ui.find({ type: 'Markdown' }))?.props.pressableLinks).toEqual(['file:///r/c.ts#L3', 'file:///r/c.ts#L9'])
})

test('existence is checked once per path', async ($, on) => {
  const w = files(on, { '/r/once.ts': 'file' })
  const ui = await mount($, 'l4', { text: 'see `once.ts:1` and `once.ts:2`', isFirstOfReply: true })
  await ui.redraw()
  expect(w.stats.filter(p => p === '/r/once.ts')).toHaveLength(1)
})

test('the chain beneath still runs on a linked chunk', async ($, on) => {
  let calls = 0
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => {
    calls++
    return { type: 'Text' as const, children: [e.props.text] }
  })
  files(on, { '/r/e.ts': 'file' })
  await mount($, 'l5', { text: 'see `e.ts`\n\n──\n\nmore', isFirstOfReply: true })
  expect(calls).toBe(2)
})

test('a press with no panel toasts once', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  files(on, { '/r/f.ts': 'file' })
  const ui = await mount($, 'l6', { text: 'see `f.ts:4`', isFirstOfReply: true })
  const key = (await ui.find({ type: 'Markdown' }))!.props.key
  await ui.press({ key, link: { href: 'file:///r/f.ts#L4' } })
  await ui.press({ key, link: { href: 'file:///r/f.ts#L4' } })
  expect(toasts).toEqual(['folio: install the margin part to preview files; ctrl+click opens them'])
})

test('a press whose show fails in panel says nothing', async ($, on) => {
  const toasts: string[] = []
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), margin: { show: async () => { throw new Error('unreadable') } } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  files(on, { '/r/n.ts': 'file' })
  const ui = await mount($, 'l15', { text: 'see `n.ts`', isFirstOfReply: true })
  const key = (await ui.find({ type: 'Markdown' }))!.props.key
  await ui.press({ key, link: { href: 'file:///r/n.ts#L1' } })
  expect(toasts).toEqual([])
})

test('a press calls panel.show with the path and line', async ($, on) => {
  const shown: unknown[] = []
  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), margin: { show: async (a: unknown) => { shown.push(a) } } }))
  files(on, { '/r/a.ts': 'file' })
  const ui = await mount($, 'l17', { text: 'see `a.ts:65`', isFirstOfReply: true })
  const key = (await ui.find({ type: 'Markdown' }))!.props.key
  await ui.press({ key, link: { href: 'file:///r/a.ts#L65' } })
  expect(shown).toEqual([{ path: '/r/a.ts', line: 65 }])
})

test("a linked block takes the engine's blank row and white bullet", async ($, on) => {
  files(on, { '/r/o.ts': 'file' })
  const ui = await mount($, 'l16', { text: 'see `o.ts`\n\n──\n\nmore `o.ts:2`', isFirstOfReply: true })
  expect((await ui.find({ type: 'Text', text: '● ' }))?.props.color).toBe('text')
  const tops = (await ui.findAll({ type: 'Box' })).filter((b: any) => b.children.some((c: any) => c.type === 'Markdown')).map((b: any) => b.props.marginTop)
  expect(tops).toEqual([1, 1])
})

test('a summary block and a non-terminal surface pass through', async ($, on) => {
  files(on, { '/r/g.ts': 'file' })
  const summary = await mount($, 'l7', { text: 'see `g.ts`', isFirstOfReply: true, isSummary: true })
  expect(await summary.find({ type: 'Markdown' })).toBeUndefined()
  const desktop = await mount($, 'l8', { text: 'see `g.ts`', isFirstOfReply: true }, 'desktop')
  expect(await desktop.find({ type: 'Markdown' })).toBeUndefined()
})

test('a path in a reply with no divider lines is linked', async ($, on) => {
  files(on, { '/r/h.ts': 'file' })
  const ui = await mount($, 'l9', { text: 'see `h.ts:3`', isFirstOfReply: true })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('#L3')
})

test('a block after a tool call takes no bullet and no extra indent', async ($, on) => {
  files(on, { '/r/i.ts': 'file' })
  const ui = await mount($, 'l10', { text: 'see `i.ts`\n\n──\n\nmore `i.ts:2`', isFirstOfReply: false })
  expect(await ui.findAll({ type: 'Markdown' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '● ' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Box' })).some((b: any) => b.props.paddingLeft === 2)).toBe(false)
})

test('a file missing at first links once it exists', async ($, on) => {
  const kinds: Record<string, 'file' | 'dir'> = {}
  const w = files(on, kinds)
  const ui = await mount($, 'l11', { text: 'see `j.ts`', isFirstOfReply: true })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  kinds['/r/j.ts'] = 'file'
  w.now += 5_001
  await ui.redraw()
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toContain('](file:///r/j.ts#L1)')
})

test('a missing path is asked once within 5 s', async ($, on) => {
  const w = files(on, {})
  const ui = await mount($, 'l12', { text: 'see `k.ts`', isFirstOfReply: true })
  w.now += 4_000
  await ui.redraw()
  expect(w.stats.filter(p => p === '/r/k.ts')).toHaveLength(1)
})

test('a reply with no path-like span makes no engine calls', async ($, on) => {
  const w = files(on, {})
  const ui = await mount($, 'l13', { text: 'plain `--force` words', isFirstOfReply: true })
  await ui.redraw()
  expect([w.cwds, w.clocks, w.stats.length]).toEqual([0, 0, 0])
})

test('a failing working directory leaves the chunk plain and the lines drawn', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  on('session.cwd', () => ({ deny: 'gone' }))
  const ui = await mount($, 'l14', { text: 'see `m.ts`\n\n──\n\nmore', isFirstOfReply: true })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'see `m.ts`' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
})

test("records the chat's width for md-display.pl once per change", async ($, on) => {
  const writes: [string, string][] = []
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['you'] }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'TMPDIR' ? '/t' : undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.write', (_: any, e: any) => { writes.push([e.path, e.text]); return { value: undefined } })
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'UserMessage', requestId: 'u1',
    props: { text: 'hi' }, viewport: { columns: 103, rows: 20 } })
  await ui.redraw()
  expect(writes).toEqual([['/t/claudzilla-rules/cols-s1', '103']])
})

test('a /clear writes the width again for the new session id', async ($, on) => {
  const writes: string[] = []
  let id = 's1'
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['you'] }))
  on('env.get', (_: any, e: any) => ({ value: e.name === 'TMPDIR' ? '/t' : undefined }))
  on('session.id', () => ({ value: id }))
  on('fs.write', (_: any, e: any) => { writes.push(e.path); return { value: undefined } })
  on('session.end', () => ({ sessionId: id }))
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'UserMessage', requestId: 'u2',
    props: { text: 'hi' }, viewport: { columns: 103, rows: 20 } })
  await $.session.end({ reason: 'clear' })
  id = 's2'
  await ui.redraw()
  expect(writes.filter(p => p.includes('/cols-'))).toEqual(['/t/claudzilla-rules/cols-s1', '/t/claudzilla-rules/cols-s2'])
})
