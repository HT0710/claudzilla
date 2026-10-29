import { expect, mock, test } from 'claude-code/testing'

import { runText, split } from '../hooks/register'

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
    // A line inside a fence is the block's own, drawn in its card.
    expect(await ui.find({ type: 'Text', text: 'more' })).toBeDefined()
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

test('run text keeps the block as a script, so pipes, ifs, heredocs and comments run as written', () => {
  const body = "ls |\n  wc -l  # count\nif true; then\n  echo yes\nfi\ncat <<'EOF'\nx\nEOF"
  expect(runText('bash', body)).toBe(body)
})

test('run text takes only the $ lines of a transcript, whatever its tag', () => {
  expect(runText('console', '$ ls\na.txt\n$ pwd')).toBe('ls\npwd')
  expect(runText('bash', '$ ls\nfoo.txt')).toBe('ls')
})

test('a non-shell fence, an untagged one and a comment-only block have no run text', () => {
  expect(runText('ts', 'run()')).toBeUndefined()
  expect(runText('', 'ls')).toBeUndefined()
  expect(runText('bash', '# only a comment\n')).toBeUndefined()
})

test('a fence inside a longer fence stays in its block', () => {
  expect(split('````md\n```bash\nls\n```\n````\nafter')).toEqual([
    { code: { lang: 'md', body: '```bash\nls\n```' } }, { text: 'after' }])
})

test('a tilde fence and a fence in a list item are blocks too', () => {
  expect(split('~~~sh\nls\n~~~')).toEqual([{ code: { lang: 'sh', body: 'ls' } }])
  expect(split('- step\n\n  ```bash\n  ls\n    -la\n  ```')).toEqual([{ text: '- step' }, { code: { lang: 'bash', body: 'ls\n  -la' } }])
})

test('a fence line with text after it does not close the block', () => {
  expect(split('```\n```bash\n```')).toEqual([{ code: { lang: '', body: '```bash' } }])
})

test('a fence that never closes stays text', () => {
  expect(split('a\n```bash\nls')).toEqual([{ text: 'a' }, { text: '```bash\nls' }])
})

const SHELL = 'Fix:\n\n```bash\ngit pull\n./install.sh\n```\n\nthen\n\n```\nsome output\n```'
const fenced = (on: any) => {
  const w = { copied: [] as string[], clock: mock.clock(on, { now: 0 }) }
  on('ui.render', { component: 'AssistantMessage' }, (_$: any, e: any) => ({ type: 'Text' as const, children: [e.props.text] }))
  on('ui.copy', (_: any, e: any) => { w.copied.push(e.text); return { value: { isCopied: true } } })
  return w
}

test('a shell fence gets Run and Copy, an untagged one Copy only', async ($, on) => {
  fenced(on)
  const ui = await mount($, 'f1', { text: SHELL, isFirstOfReply: true })
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.key)).toEqual(['run:f1:1', 'copy:f1:1', 'copy:f1:3'])
  // The card's top edge names the language; an untagged block's is bare.
  expect((await ui.findAll({ type: 'Text', text: /^╭─/ })).map((x: any) => x.text)).toEqual(['╭─ ', '╭─'])
  expect(await ui.find({ type: 'Text', text: 'bash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'then' })).toBeDefined()
})

test('Copy puts the block on the clipboard and says so for 2 s', async ($, on) => {
  const w = fenced(on)
  const clock = w.clock
  const ui = await mount($, 'f2', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'copy:f2:1' })
  expect(w.copied).toEqual(['git pull\n./install.sh'])
  await ui.redraw()
  expect((await ui.find({ key: 'copy:f2:1' }))?.text).toBe('✓ Copied')
  await clock.advance(2000)
  await ui.redraw()
  expect((await ui.find({ key: 'copy:f2:1' }))?.text).toBe('⧉ Copy')
})

test('a second Copy press keeps its own 2 s', async ($, on) => {
  const clock = fenced(on).clock
  const ui = await mount($, 'f6', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'copy:f6:1' })
  await clock.advance(1500)
  await ui.press({ key: 'copy:f6:1' })
  await clock.advance(1000)
  await ui.redraw()
  expect((await ui.find({ key: 'copy:f6:1' }))?.text).toBe('✓ Copied')
})

// Answers process.spawn beneath the mod with the result's output; each run's argv lands in `ran`.
const shell = (on: any, result = { exitCode: 0, stdout: 'main\nabc fix\n', stderr: '' }) => {
  const ran: string[][] = []
  on('process.spawn', async function* (_: any, e: any) {
    ran.push(e.argv)
    if (result.stdout) yield { stream: 'stdout', text: result.stdout }
    if (result.stderr) yield { stream: 'stderr', text: result.stderr }
    return { value: { code: result.exitCode, signal: null } }
  })
  return ran
}

// A command that writes `first`, then waits; `gate.open()` ends it, `gate.killed` says the stream was left.
const slow = (on: any, first = 'a\n') => {
  const gate = { open: () => {}, killed: false }
  on('process.spawn', async function* (_: any, _e: any, next: any) {
    try {
      yield { stream: 'stdout', text: first }
      // The engine aborts the signal when the mod leaves the stream, as it kills the child.
      await new Promise<void>(r => { gate.open = r; next.signal.addEventListener('abort', () => r()) })
      if (next.signal.aborted) return { value: { code: null, signal: 'SIGTERM' } }
      yield { stream: 'stdout', text: 'b\n' }
      return { value: { code: 0, signal: null } }
    } finally {
      gate.killed = true
    }
  })
  return gate
}

// Arms Run, then runs it as a person would: the second click a beat after the first.
const twice = async (ui: any, w: { clock: any }, key: string) => {
  await ui.press({ key })
  await w.clock.advance(300)
  await ui.press({ key })
}

const rows = async (ui: any, re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map((x: any) => x.text)

test('one Run press arms it and runs nothing', async ($, on) => {
  fenced(on)
  const ran = shell(on)
  const ui = await mount($, 'r1', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:r1:1' })
  await ui.redraw()
  expect((await ui.find({ key: 'run:r1:1' }))?.text).toBe('▶ Run? click again')
  expect(ran).toEqual([])
})

test('the second press runs it in a shell and draws the output in the card', async ($, on) => {
  const w = fenced(on)
  const ran = shell(on)
  const session = mock.session(on)
  const ui = await mount($, 'r2', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r2:1')
  await ui.redraw()
  // Its own session, so a prompt cannot open the terminal Claude Code draws on.
  expect(ran).toEqual([['bash', '-c', 'command -v setsid >/dev/null && exec setsid -w bash -c "$1"; exec bash -c "$1"', 'folio', 'git pull\n./install.sh']])
  expect(await rows(ui, /^(main|abc fix)$/)).toEqual(['main', 'abc fix'])
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeDefined()
  expect((await ui.find({ key: 'run:r2:1' }))?.text).toBe('▶ Run again')
  // Claude reads it next turn, as it reads a typed `!` command's output, trimmed the same way.
  expect(JSON.stringify(session.appended().map(r => r.message))).toContain('<bash-input>git pull\\n./install.sh</bash-input>')
  expect(JSON.stringify(session.appended().map(r => r.message))).toContain('<bash-stdout>main\\nabc fix</bash-stdout>')
})

test('a failed run shows its stderr and exit code', async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 2, stdout: '', stderr: 'fatal: no repo\n' })
  const ui = await mount($, 'r3', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r3:1')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'fatal: no repo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'output · exit 2' })).toBeDefined()
})

test('an armed Run left 3 s goes back to Run', async ($, on) => {
  const clock = fenced(on).clock
  const ran = shell(on)
  const ui = await mount($, 'r4', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:r4:1' })
  await clock.advance(3000)
  await ui.redraw()
  expect((await ui.find({ key: 'run:r4:1' }))?.text).toBe('▶ Run')
  await ui.press({ key: 'run:r4:1' })
  expect(ran).toEqual([])
})

test('Run again runs on one press, but not in the second after a run ends', async ($, on) => {
  const w = fenced(on)
  const ran = shell(on)
  const ui = await mount($, 'r10', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r10:1')
  // A Stop click that lands just after the command ended must not start it again.
  await w.clock.advance(900)
  await ui.press({ key: 'run:r10:1' })
  expect(ran).toHaveLength(1)
  await w.clock.advance(100)
  await ui.press({ key: 'run:r10:1' })
  expect(ran).toHaveLength(2)
})

test('a double-click arms Run and runs nothing', async ($, on) => {
  const w = fenced(on)
  const ran = shell(on)
  const ui = await mount($, 'r13', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:r13:1' })
  await w.clock.advance(50)
  await ui.press({ key: 'run:r13:1' })
  await ui.redraw()
  expect(ran).toEqual([])
  expect((await ui.find({ key: 'run:r13:1' }))?.text).toBe('▶ Run? click again')
  await w.clock.advance(250)
  await ui.press({ key: 'run:r13:1' })
  expect(ran).toHaveLength(1)
})

test('a double-click on Run again runs it and does not stop it', async ($, on) => {
  const clock = fenced(on).clock
  const gate = slow(on)
  const ui = await mount($, 'r14', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:r14:1' })
  await clock.advance(300)
  void ui.press({ key: 'run:r14:1' })
  await clock.advance(300)
  await ui.press({ key: 'run:r14:1' })
  await clock.advance(1000)
  gate.killed = false
  void ui.press({ key: 'run:r14:1' })
  await clock.advance(50)
  await ui.press({ key: 'run:r14:1' })
  await ui.redraw()
  expect(gate.killed).toBe(false)
  expect((await ui.find({ key: 'run:r14:1' }))?.text).toBe('■ Stop')
  await clock.advance(250)
  await ui.press({ key: 'run:r14:1' })
  expect(gate.killed).toBe(true)
})

test('a shell card breaks a long line into rows, so every character Run runs shows', async ($, on) => {
  fenced(on)
  const long = `curl -fsSL https://example.com/install.sh -o /tmp/i.sh && chmod +x /tmp/i.sh && /tmp/i.sh --yes ${'x'.repeat(200)}`
  const ui = await mount($, 'r15', { text: `\`\`\`bash\n${long}\n\`\`\``, isFirstOfReply: true })
  const rows = (await ui.findAll({ type: 'Code' })).map((c: any) => c.props.source)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join('')).toBe(long)
})

test('a shell card still draws on a terminal too narrow for its text', async ($, on) => {
  fenced(on)
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AssistantMessage', requestId: 'r16',
    props: { text: '```bash\necho hi\n```', isFirstOfReply: true }, viewport: { columns: 8, rows: 20 } })
  expect((await ui.findAll({ type: 'Code' })).map((c: any) => c.props.source).join('')).toBe('echo hi')
})

test('output shows while the command runs, and Stop ends it', async ($, on) => {
  const clock = fenced(on).clock
  const gate = slow(on)
  const session = mock.session(on)
  const ui = await mount($, 'r5', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:r5:1' })
  await clock.advance(300)
  void ui.press({ key: 'run:r5:1' })
  await clock.advance(100)
  await ui.redraw()
  expect((await ui.find({ key: 'run:r5:1' }))?.text).toBe('■ Stop')
  expect(await ui.find({ type: 'Text', text: 'a' })).toBeDefined()
  // Hide and the output's Copy wait for the end: half an output is not worth taking.
  expect(await ui.find({ key: 'hide:r5:1' })).toBeUndefined()
  expect(await ui.find({ key: 'copyout:r5:1' })).toBeUndefined()
  // The edge runs on to the corner, no gap where the buttons will go.
  expect(await ui.find({ type: 'Text', text: /^─┤$/ })).toBeDefined()
  await clock.advance(200)
  await ui.press({ key: 'run:r5:1' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'output · stopped' })).toBeDefined()
  expect(await ui.find({ key: 'hide:r5:1' })).toBeDefined()
  expect(await ui.find({ key: 'copyout:r5:1' })).toBeDefined()
  expect(gate.killed).toBe(true)
  expect((await ui.find({ key: 'run:r5:1' }))?.text).toBe('▶ Run again')
  // An empty or cut-short output alone reads like a quiet success.
  expect(JSON.stringify(session.appended().map(r => r.message))).toContain('(stopped by the user)')
})

test('a long output shows its last 20 lines and counts the earlier ones', async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 0, stdout: Array.from({ length: 25 }, (_, i) => `l${i + 1}`).join('\n') + '\n', stderr: '' })
  const ui = await mount($, 'r6', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r6:1')
  await ui.redraw()
  expect(await rows(ui, /^l\d+$/)).toEqual(Array.from({ length: 20 }, (_, i) => `l${i + 6}`))
  expect(await ui.find({ type: 'Text', text: '… 5 earlier lines' })).toBeDefined()
})

test("the output's Copy takes all of it, the lines not shown too", async ($, on) => {
  const w = fenced(on)
  const all = Array.from({ length: 25 }, (_, i) => `l${i + 1}`).join('\n')
  shell(on, { exitCode: 0, stdout: `${all}\n`, stderr: '' })
  const ui = await mount($, 'r11', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r11:1')
  await ui.press({ key: 'copyout:r11:1' })
  expect(w.copied).toEqual([all])
})

test('Hide takes the output off the card, and the block stays run', async ($, on) => {
  const w = fenced(on)
  const ran = shell(on)
  const ui = await mount($, 'r12', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r12:1')
  await ui.press({ key: 'hide:r12:1' })
  await w.clock.advance(1000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'main' })).toBeUndefined()
  expect((await ui.find({ key: 'run:r12:1' }))?.text).toBe('▶ Run again')
  await ui.press({ key: 'run:r12:1' })
  await ui.redraw()
  expect(ran).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'main' })).toBeDefined()
})

test('colour codes draw as coloured text, and Claude and Copy get it plain', async ($, on) => {
  const w = fenced(on)
  const envs: unknown[] = []
  on('process.spawn', async function* (_: any, e: any) {
    envs.push(e.env)
    yield { stream: 'stdout', text: '\x1b[31mred\x1b[0m\r\n\x1b[1;38;5;208mfire\nstill\x1b[0m\x1b[2K\n\x1b[38;2;0;128;255mdeep\x1b[39m plain\n' }
    return { value: { code: 0, signal: null } }
  })
  const session = mock.session(on)
  const ui = await mount($, 'r7', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r7:1')
  await ui.redraw()
  // Tools print colour without a terminal only when told to.
  expect(envs).toEqual([{ FORCE_COLOR: '1', CLICOLOR_FORCE: '1' }])
  const paint = async (text: string) => (await ui.findAll({ type: 'Text', text })).find((x: any) => x.text === text && x.children.every((c: unknown) => typeof c === 'string'))?.props
  expect(await paint('red')).toMatchObject({ color: 'red' })
  expect(await paint('fire')).toMatchObject({ color: '#ff8700', bold: true })
  // A colour set on one line holds on the next until reset.
  expect(await paint('still')).toMatchObject({ color: '#ff8700', bold: true })
  expect(await paint('deep')).toMatchObject({ color: '#0080ff' })
  expect(await rows(ui, /^deep plain$/)).toEqual(['deep plain'])
  await ui.press({ key: 'copyout:r7:1' })
  expect(w.copied).toEqual(['red\nfire\nstill\ndeep plain'])
  expect(JSON.stringify(session.appended().map(r => r.message))).toContain('<bash-stdout>red\\nfire\\nstill\\ndeep plain</bash-stdout>')
})

test('a run that fails to start shows exit 1 and why', async ($, on) => {
  const w = fenced(on)
  on('process.spawn', async function* () { return { deny: 'no bash' } })
  const ui = await mount($, 'r8', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r8:1')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /no bash/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'output · exit 1' })).toBeDefined()
})

test('a refused row for Claude says so', async ($, on) => {
  const w = fenced(on)
  shell(on)
  const toasts: string[] = []
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('session.append', () => ({ deny: 'no rows here' }) as any)
  const ui = await mount($, 'r9', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:r9:1')
  expect(toasts).toEqual(['folio: Claude will not see this output (no rows here)'])
})

test('a reply that opens with a code block draws the bullet on its card', async ($, on) => {
  const firsts: boolean[] = []
  on('ui.render', { component: 'AssistantMessage' }, (_$: any, e: any) => { firsts.push(e.props.isFirstOfReply); return { type: 'Text' as const, children: [e.props.text] } })
  const ui = await mount($, 'b1', { text: '```bash\nls\n```\n\nafter', isFirstOfReply: true })
  expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
  expect(firsts).toEqual([false])
})

test('style holds past the shown lines and across chunks; other codes and overwritten progress go', async ($, on) => {
  const w = fenced(on)
  on('process.spawn', async function* () {
    // A red that is never reset, 25 lines up, split mid-line and mid-code.
    yield { stream: 'stdout', text: '\x1b[3' }
    yield { stream: 'stdout', text: '1mtop\n' + Array.from({ length: 23 }, (_, i) => `l${i}`).join('\n') + '\nla' }
    yield { stream: 'stdout', text: 'st\n\x1b[0m\x1b(B\x1b]8;;https://x.y\x07link\x1b]8;;\x07 \x1b[38:5:196mcolon\x1b[0m\n10%\r20%\r30%\r\n' }
    return { value: { code: 0, signal: null } }
  })
  const session = mock.session(on)
  const ui = await mount($, 'p1', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:p1:1')
  await ui.redraw()
  const paint = async (text: string) => (await ui.findAll({ type: 'Text', text })).find((x: any) => x.text === text && x.children.every((c: unknown) => typeof c === 'string'))?.props
  expect(await paint('last')).toMatchObject({ color: 'red' })
  expect(await rows(ui, /^(link colon|30%)$/)).toEqual(['link colon', '30%'])
  expect(await ui.find({ type: 'Text', text: '… 7 earlier lines' })).toBeDefined()
  const row = JSON.stringify(session.appended().map(r => r.message))
  expect(row).toContain('last\\nlink colon\\n30%</bash-stdout>')
  expect(row).not.toContain('\\u001b')
})

test("Claude gets the end of a long output, where the errors are", async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 1, stdout: `START${'x'.repeat(40_000)}END\n`, stderr: '' })
  const session = mock.session(on)
  const ui = await mount($, 'p2', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:p2:1')
  const row = JSON.stringify(session.appended().map(r => r.message))
  expect(row).toContain('END</bash-stdout>')
  expect(row).not.toContain('START')
})
