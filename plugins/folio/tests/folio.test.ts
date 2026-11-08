import { expect, mock, test } from 'claude-code/testing'

import { cutPath, diffRows, runText, split, writeTargets } from '../hooks/register'

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

const LONGOUT = `\x1b[31m${'r'.repeat(30)}\x1b[32m${'g'.repeat(30)}\x1b[0m\n`
const WRAP = (id: string, i = 1) => ({ key: `wrap:${id}:${i}` })
const joined = async (ui: any) => (await ui.findAll({ type: 'Text' })).filter((x: any) => x.text.includes('r'.repeat(30) + 'g'.repeat(30))).length
const codes = async (ui: any) => (await ui.findAll({ type: 'Code' })).map((c: any) => c.props.source)

test('no Wrap button when every line fits', async ($, on) => {
  const w = fenced(on)
  shell(on)
  const ui = await mount($, 'w1', { text: SHELL, isFirstOfReply: true })
  expect(await ui.find(WRAP('w1'))).toBeUndefined()
  await twice(ui, w, 'run:w1:1')
  await ui.redraw()
  expect(await ui.find(WRAP('w1'))).toBeUndefined()
})

test('Wrap rejoins a long code line on a plain card, and Unwrap puts it back', async ($, on) => {
  fenced(on)
  const long = `echo ${'x'.repeat(80)}`
  const ui = await mount($, 'w2', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  expect(await codes(ui)).toEqual([long])
  expect((await ui.find(WRAP('w2', 0)))?.text).toBe('↩ Wrap')
  await ui.press(WRAP('w2', 0))
  await ui.redraw()
  const rows = await codes(ui)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join('')).toBe(long)
  expect((await ui.find(WRAP('w2', 0)))?.text).toBe('→ Unwrap')
  await ui.press(WRAP('w2', 0))
  await ui.redraw()
  expect(await codes(ui)).toEqual([long])
  expect((await ui.find(WRAP('w2', 0)))?.text).toBe('↩ Wrap')
})

test('Wrap splits a long output line and both pieces keep their colour', async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 0, stdout: LONGOUT, stderr: '' })
  const ui = await mount($, 'w3', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w3:1')
  await ui.redraw()
  expect((await ui.find(WRAP('w3')))?.text).toBe('↩ Wrap')
  expect(await joined(ui)).toBe(1)
  await ui.press(WRAP('w3'))
  await ui.redraw()
  expect(await joined(ui)).toBe(0)
  expect((await ui.find(WRAP('w3')))?.text).toBe('→ Unwrap')
  const colored = async (color: string) => (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.color === color && x.children.every((c: unknown) => typeof c === 'string')).map((x: any) => x.text)
  const red = await colored('red')
  const green = await colored('green')
  expect(red.length).toBeGreaterThan(0)
  expect(green.length).toBeGreaterThan(0)
  expect(red.join('') + green.join('')).toBe('r'.repeat(30) + 'g'.repeat(30))
  expect(red.concat(green).every((t: string) => t.length <= 38)).toBe(true)
})

test('a wrapped row breaks at a space and rows rejoin to the input', async ($, on) => {
  fenced(on)
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
  const ui = await mount($, 'w5', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w5', 0))
  await ui.redraw()
  const rows = await codes(ui)
  const room = (await ui.findAll({ type: 'Box' })).map((b: any) => b.props.width).find((w: unknown) => typeof w === 'number' && w > 4) - 4
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join('')).toBe(long)
  expect(rows.every((r: string) => Array.from(r).length <= room)).toBe(true)
  expect(rows.slice(0, -1).every((r: string) => r.endsWith(' '))).toBe(true)
})

test('a word longer than the card still hard-cuts and rejoins', async ($, on) => {
  fenced(on)
  const long = `ab ${'x'.repeat(120)} cd`
  const ui = await mount($, 'w6', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w6', 0))
  await ui.redraw()
  const rows = await codes(ui)
  expect(rows.length).toBeGreaterThan(2)
  expect(rows.join('')).toBe(long)
})

test('leading indentation does not become a row of its own', async ($, on) => {
  fenced(on)
  const long = `${' '.repeat(4)}${'x'.repeat(200)}`
  const ui = await mount($, 'w15', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w15', 0))
  await ui.redraw()
  const rows = await codes(ui)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join('')).toBe(long)
  expect(rows.every((r: string) => r.trim() !== '')).toBe(true)
})

test('wrapped output breaks at a space and keeps colour on both rows', async ($, on) => {
  const w = fenced(on)
  const words = `\x1b[31m${'redish '.repeat(6)}\x1b[32m${'greenish '.repeat(6)}\x1b[0m\n`
  shell(on, { exitCode: 0, stdout: words, stderr: '' })
  const ui = await mount($, 'w7', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w7:1')
  await ui.redraw()
  await ui.press(WRAP('w7'))
  await ui.redraw()
  const colored = async (color: string) => (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.color === color && x.children.every((c: unknown) => typeof c === 'string')).map((x: any) => x.text)
  const red = await colored('red')
  const green = await colored('green')
  expect(red.length).toBeGreaterThan(1)
  expect(green.length).toBeGreaterThan(0)
  expect(red.join('') + green.join('')).toBe('redish '.repeat(6) + 'greenish '.repeat(6))
  expect(red.slice(0, -1).every((t: string) => t.endsWith(' '))).toBe(true)
})

test('a URL that fits the card moves whole to the next row', async ($, on) => {
  fenced(on)
  const url = 'https://example.com/path/ab'
  const long = `${'p'.repeat(30)}${url} ${'q'.repeat(10)}${url}`
  const ui = await mount($, 'w8', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w8', 0))
  await ui.redraw()
  const rows = await codes(ui)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.join('')).toBe(long)
  expect(rows.filter((r: string) => r.includes('https://')).every((r: string) => r.includes(url))).toBe(true)
})

test('a URL longer than the card splits and each output piece links the whole URL', async ($, on) => {
  const w = fenced(on)
  const url = `https://example.com/${'x'.repeat(80)}`
  shell(on, { exitCode: 0, stdout: `\x1b[31mgo ${url}\x1b[0m end\n`, stderr: '' })
  const ui = await mount($, 'w9', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w9:1')
  await ui.redraw()
  await ui.press(WRAP('w9'))
  await ui.redraw()
  const links = await ui.findAll({ type: 'Link' })
  expect(links.length).toBeGreaterThan(1)
  expect(links.every((l: any) => l.props.href === url)).toBe(true)
  expect(links.map((l: any) => l.children.map((c: any) => (typeof c === 'string' ? c : c.children.join(''))).join('')).join('')).toBe(url)
})

const URL_ = `https://example.com/${'x'.repeat(80)}`
const str = (n: any): string => (typeof n === 'string' ? n : n.type === 'Code' ? n.props.source : (n.children ?? []).map(str).join(''))
// Draw-order text of every Code row and every Text row that holds a Link.
const cardRows = async (ui: any) =>
  (await ui.findAll({})).filter((n: any) => n.type === 'Code' || (n.type === 'Text' && n.props.wrap === 'truncate-end')).map(str)
const linksOk = async (ui: any) => {
  const links = await ui.findAll({ type: 'Link' })
  expect(links.length).toBeGreaterThan(1)
  expect(links.every((l: any) => l.props.href === URL_)).toBe(true)
  expect(links.map(str).join('')).toBe(URL_)
}

test('a wrapped text card links each piece of a split URL and keeps every character', async ($, on) => {
  fenced(on)
  const long = `see ${URL_} end`
  const ui = await mount($, 'w10', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w10', 0))
  await ui.redraw()
  await linksOk(ui)
  expect((await cardRows(ui)).join('')).toBe(long)
  const rows = (await ui.findAll({ type: 'Text' })).filter((n: any) => n.props.wrap === 'truncate-end' && n.children.some((c: any) => c.type === 'Link'))
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((n: any) => n.props.color === 'text')).toBe(true)
})

test('a URL in quotes and a call keeps its closing punctuation out of the link', async ($, on) => {
  fenced(on)
  const long = `fetch("${URL_}"), x`
  const ui = await mount($, 'w14', { text: `\`\`\`\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w14', 0))
  await ui.redraw()
  const links = await ui.findAll({ type: 'Link' })
  expect(links.length).toBeGreaterThan(1)
  expect(links.every((l: any) => l.props.href === URL_)).toBe(true)
  expect(links.map(str).join('')).toBe(URL_)
  expect((await cardRows(ui)).join('')).toBe(long)
})

test('a wrapped python card keeps Code on rows without the URL', async ($, on) => {
  fenced(on)
  const long = `x = 1\n# ${URL_}\ny = 2`
  const ui = await mount($, 'w11', { text: `\`\`\`python\n${long}\n\`\`\``, isFirstOfReply: true })
  await ui.press(WRAP('w11', 0))
  await ui.redraw()
  await linksOk(ui)
  expect((await cardRows(ui)).join('')).toBe(long.replace(/\n/g, ''))
  const srcs = await codes(ui)
  expect(srcs).toContain('x = 1')
  expect(srcs).toContain('y = 2')
  expect(srcs.some((c: string) => c.includes('https://'))).toBe(false)
})

test('a shell card links the pieces of a split URL in its command', async ($, on) => {
  fenced(on)
  const long = `curl ${URL_} -o /tmp/f`
  const ui = await mount($, 'w12', { text: `\`\`\`bash\n${long}\n\`\`\``, isFirstOfReply: true })
  await linksOk(ui)
  expect((await cardRows(ui)).join('')).toBe(long)
})

test('a wrapped long output line shows 20 rows and a count of the rest', async ($, on) => {
  const w = fenced(on)
  const long = 'x'.repeat(30_000)
  shell(on, { exitCode: 0, stdout: `${long}\n`, stderr: '' })
  const ui = await mount($, 'w13', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w13:1')
  await ui.redraw()
  await ui.press(WRAP('w13'))
  await ui.redraw()
  const rows = (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.wrap === 'truncate-end' && /^x+$/.test(x.text)).map((x: any) => x.text)
  expect(rows.length).toBe(20)
  expect(rows.join('')).toBe(long.slice(0, rows.join('').length))
  const width = rows[0].length
  expect((await ui.find({ type: 'Text', text: /^… \+\d+ rows$/ }))?.text).toBe(`… +${Math.ceil(long.length / width) - 20} rows`)
})

test('the Wrap button shows while the command still runs', async ($, on) => {
  const clock = fenced(on).clock
  slow(on, LONGOUT)
  const ui = await mount($, 'w4', { text: SHELL, isFirstOfReply: true })
  await ui.press({ key: 'run:w4:1' })
  await clock.advance(300)
  void ui.press({ key: 'run:w4:1' })
  await clock.advance(300)
  await ui.redraw()
  expect((await ui.find({ key: 'run:w4:1' }))?.text).toBe('■ Stop')
  expect((await ui.find(WRAP('w4')))?.text).toBe('↩ Wrap')
})

test('no Wrap button once Hide took the output off', async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 0, stdout: LONGOUT, stderr: '' })
  const ui = await mount($, 'w5', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w5:1')
  await ui.redraw()
  expect(await ui.find(WRAP('w5'))).toBeDefined()
  await ui.press({ key: 'hide:w5:1' })
  await ui.redraw()
  expect(await ui.find(WRAP('w5'))).toBeUndefined()
})

test('a wrapped card stays wrapped when Run goes again', async ($, on) => {
  const w = fenced(on)
  shell(on, { exitCode: 0, stdout: LONGOUT, stderr: '' })
  const ui = await mount($, 'w6', { text: SHELL, isFirstOfReply: true })
  await twice(ui, w, 'run:w6:1')
  await ui.redraw()
  await ui.press(WRAP('w6'))
  await ui.press({ key: 'run:w6:1' })
  await w.clock.advance(1000)
  await ui.redraw()
  expect((await ui.find(WRAP('w6')))?.text).toBe('→ Unwrap')
  expect(await joined(ui)).toBe(0)
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

const patch = (...lines: string[]) => ({ type: 'update', filePath: '/p/a.txt', structuredPatch: [{ lines }] })
const created = (content: string) => ({ type: 'create', filePath: '/p/b.txt', content, structuredPatch: [] })

// Stands for the engine's own rows; `seen` counts how often the chain below folio ran.
function native(on: any, cwd: object = { value: '/p' }, root: object = cwd) {
  const seen = { calls: 0 }
  on('session.cwd', () => cwd)
  on('session.root', () => root)
  on('ui.render', { component: 'ToolUse' }, () => { seen.calls++; return { type: 'Text' as const, children: ['native'] } })
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text' as const, children: ['native block'] }))
  return seen
}
const VIEW = { columns: 80, rows: 20, isFullscreen: true }
const mountRow = ($: any, tool: string, output: unknown, extra: object = {}, file = '/p/a.txt', id = 'r1', viewport: object = VIEW) =>
  $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolUse', requestId: id,
    props: { tool_use_id: id, tool, input: { file_path: file }, output, isRunning: false, isErrored: false, isInterrupted: false, ...extra }, viewport })
const drawn = async ($: any, tool: string, output: unknown, extra: object = {}, file?: string) =>
  textOf(await mountRow($, tool, output, extra, file))
// A compact row is a Client, which draws once sized; anything else is the mounted tree's own Text.
const textOf = async (ui: any, id = 'r1') => {
  const at = id.includes(':') ? id : `fold:${id}`
  try {
    await ui.resize({ columns: 60, rows: 1, in: at })
    return (await ui.find({ type: 'Text', in: at }))?.text
  } catch {
    return (await ui.find({ type: 'Text' }))?.text
  }
}

for (const [name, tool, output, want] of [
  ['an edit', 'Edit', patch(' a', '-b', '-c', '+d'), '● Updated (a.txt)  +1 −2'],
  ['hunks added together', 'Edit', { structuredPatch: [{ lines: ['+a'] }, { lines: ['+b', '-c'] }] }, '● Updated (a.txt)  +2 −1'],
  ['only added lines', 'Edit', patch(' a', '+b'), '● Updated (a.txt)  +1'],
  ['only removed lines', 'Edit', patch(' a', '-b'), '● Updated (a.txt)  −1'],
  ['an overwrite', 'Write', patch('-a', '+b'), '● Wrote (a.txt)  +1 −1'],
  ['a new file', 'Write', created('a\nb\nc\n'), '● Created (a.txt)  +3'],
  ['a new file with no last newline', 'Write', created('a\nb'), '● Created (a.txt)  +2'],
  ['an empty new file', 'Write', created(''), '● Created (a.txt)  +0'],
] as const) {
  test(`${name} draws its counts on the row`, async ($, on) => {
    const seen = native(on)
    expect(await drawn($, tool, output)).toBe(want)
    expect(seen.calls).toBeGreaterThan(0)
  })
}

const click = async (ui: any, at: string) => {
  await ui.resize({ columns: 60, rows: 1, in: at })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: at })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: at })
}

test('the whole fold row lights under the pointer, and goes dark again', async ($, on) => {
  native(on)
  const ui = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await ui.resize({ columns: 60, rows: 1, in: 'fold:e1' })
  const back = async () => (await ui.find({ type: 'Box', in: 'fold:e1' }))?.props.backgroundColor
  expect(await back()).toBeUndefined()
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'fold:e1' })
  expect(await back()).toBe('#0f1c28')
  expect((await ui.find({ type: 'Text', text: /^Updated$/, in: 'fold:e1' }))?.props.color).toBeUndefined()
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'fold:e1' })
  expect(await back()).toBeUndefined()
})

test('the fold row takes the full width, so a press anywhere on it counts', async ($, on) => {
  native(on)
  const ui = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  expect((await ui.find({ type: 'Client' }))?.props.width).toBe('100%')
})

test('a run of edits folds into its first row, with one blank line above it', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('-a', '+b'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  const third = await mountRow($, 'Edit', patch('-d'), {}, '/p/a.txt', 'e3')
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2 −2')
  expect((await first.find({ type: 'Box' }))?.props.marginTop).toBe(1)
  expect(await textOf(second, 'e2')).toBeUndefined()
  expect(await textOf(third, 'e3')).toBeUndefined()
})

test('one file edited twice reads as one file', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/a.txt', 'e2')
  expect(await textOf(first, 'e1')).toBe('● Edited (1 file)  +2')
})

test('a row between edits starts a new run', async ($, on) => {
  native(on)
  on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'Text' as const, children: ['group'] }))
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolGroup', requestId: 'c1', props: { calls: [], isActive: false, isExpanded: false }, viewport: VIEW })
  const second = await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  expect(await textOf(first, 'e1')).toBe('● Updated (a.txt)  +1')
  expect(await textOf(second, 'e2')).toBe('● Updated (b.txt)  +1')
})

test("margin's hidden intent row does not break a run", async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await mountRow($, 'mcp__margin__intent', {}, {}, '/p/a.txt', 'i1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2')
})

test('a failed edit keeps its native row, reason included; the fold counts the rest', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  const third = await mountRow($, 'Edit', 'Error: ledger: /p/c.txt was edited by another session 2m ago.', { isErrored: true }, '/p/c.txt', 'e3')
  expect(await textOf(third, 'e3')).toBe('native')
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2')
})

test('a live edit never joins a run an old row started, so it keeps its own row', async ($, on) => {
  native(on)
  await mountRow($, 'Edit', patch('+old'), {}, '/p/old.txt', 'e1')
  const running = await mountRow($, 'Edit', undefined, { isRunning: true }, '/p/new.txt', 'e2')
  await running.unmount()
  const live = await mountRow($, 'Edit', patch('+b'), {}, '/p/new.txt', 'e2')
  expect(await textOf(live, 'e2')).toBe('● Updated (new.txt)  +1')
})

test('a live run draws running rows, then folds as its edits land', async ($, on) => {
  native(on)
  const row = (file: string, id: string) => ({ tool_use_id: id, tool: 'Edit', input: { file_path: file }, output: patch('+b'), isRunning: false, isErrored: false, isInterrupted: false })
  const first = await mountRow($, 'Edit', undefined, { isRunning: true }, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', undefined, { isRunning: true }, '/p/b.txt', 'e2')
  expect(await textOf(second, 'e2')).toBe('● Updating (b.txt)')
  await first.redraw(row('/p/a.txt', 'e1'))
  await second.redraw(row('/p/b.txt', 'e2'))
  await first.redraw(row('/p/a.txt', 'e1'))
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2')
})

const diffOf = async (ui: any) => (await ui.find({ type: 'Code' }))?.props.source

test('a click on the fold opens its file tree, and another closes it', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('-a', '+b'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Write', created('a\n'), {}, '/p/sub/b.txt', 'e2')
  await click(first, 'fold:e1')
  expect(await textOf(first, 'e1')).toBe('○ Edited (2 files)  +2 −1')
  expect(await textOf(first, 'file:e1')).toBe('  ├ a.txt           +1 −1')
  expect(await textOf(second, 'file:e2')).toBe('  └ sub/b.txt  new  +1')
  await click(first, 'fold:e1')
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2 −1')
})

test('a fold whose first edit made a new file draws closed and open', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Write', created('a\n'), {}, '/p/x.js', 'e1')
  const second = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e2')
  expect(await textOf(first, 'e1')).toBe('● Edited (2 files)  +2')
  await click(first, 'fold:e1')
  expect(await textOf(first, 'file:e1')).toBe('  ├ x.js   new      +1')
  expect(await textOf(second, 'file:e2')).toBe('  └ a.txt           +1')
})

test('the tree lines up its + and − counts in columns', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch(...Array(10).fill('+x'), '-y'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', patch(' a', '-b'), {}, '/p/b.txt', 'e2')
  const third = await mountRow($, 'Edit', patch('+c', '-d'), {}, '/p/c.txt', 'e3')
  await click(first, 'fold:e1')
  expect(await textOf(first, 'e1')).toBe('○ Edited (3 files)  +11 −3')
  expect(await textOf(first, 'file:e1')).toBe('  ├ a.txt           +10 −1')
  expect(await textOf(second, 'file:e2')).toBe('  ├ b.txt               −1')
  expect(await textOf(third, 'file:e3')).toBe('  └ c.txt           +1  −1')
})

const hunk = (...lines: string[]) => ({ structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 2, lines }] })

test('a long name moves the header counts to the same column', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a/long/folder/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  expect(await textOf(first, 'e1')).toBe('○ Edited (2 files)       +2')
  expect(await textOf(first, 'file:e1')).toBe('  ├ a/long/folder/a.txt  +1')
})

for (const [path, max, want] of [
  ['a.txt', 20, 'a.txt'],
  ['plugins/folio/hooks/register.tsx', 32, 'plugins/folio/hooks/register.tsx'],
  ['plugins/folio/hooks/register.tsx', 28, 'plugins/…/hooks/register.tsx'],
  ['plugins/folio/hooks/register.tsx', 24, 'plugins/…/register.tsx'],
  ['plugins/folio/hooks/register.tsx', 20, '…/hooks/register.tsx'],
  ['plugins/folio/hooks/register.tsx', 16, '…/register.tsx'],
  ['/home/me/project/deep/a.txt', 16, '…/deep/a.txt'],
  ['plugins/folio/a-very-long-file-name.tsx', 12, '…le-name.tsx'],
] as const) {
  test(`cutPath fits ${path} in ${max}`, () => {
    expect(cutPath(path, max)).toBe(want)
    expect(cutPath(path, max).length).toBeLessThanOrEqual(max)
  })
}

test('a long path is cut at half the chat width, and the counts stay', async ($, on) => {
  native(on)
  const file = '/p/plugins/folio/hooks/register.tsx'
  const ui = await mountRow($, 'Edit', patch('+b'), {}, file, 'e1', { columns: 40, rows: 20, isFullscreen: true })
  expect(await textOf(ui, 'e1')).toBe('● Updated (…/hooks/register.tsx)  +1')
})

test('a wide chat keeps the same path whole', async ($, on) => {
  native(on)
  const file = '/p/plugins/folio/hooks/register.tsx'
  const ui = await mountRow($, 'Edit', patch('+b'), {}, file, 'e1', { columns: 120, rows: 20, isFullscreen: true })
  expect(await textOf(ui, 'e1')).toBe('● Updated (plugins/folio/hooks/register.tsx)  +1')
})

test('a very narrow chat keeps a floor for the name', async ($, on) => {
  native(on)
  const file = '/p/plugins/folio/hooks/register.tsx'
  const ui = await mountRow($, 'Edit', patch('+b'), {}, file, 'e1', { columns: 24, rows: 20, isFullscreen: true })
  expect(await textOf(ui, 'e1')).toBe('● Updated (…/hooks/register.tsx)  +1')
})

test('the tree lines take the border colour', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  await first.resize({ columns: 60, rows: 1, in: 'file:e1' })
  expect((await first.find({ type: 'Text', text: /^  ├ $/, in: 'file:e1' }))?.props.color).toBe('promptBorder')
})

test('brackets and path slashes take the border colour', async ($, on) => {
  native(on)
  const ui = await mountRow($, 'Edit', patch('+b'), {}, '/p/sub/a.txt', 'e1')
  await ui.resize({ columns: 60, rows: 1, in: 'fold:e1' })
  for (const mark of [/^ \($/, /^\/$/, /^\)$/]) expect((await ui.find({ type: 'Text', text: mark, in: 'fold:e1' }))?.props.color).toBe('promptBorder')
  expect((await ui.find({ type: 'Text', text: /^a\.txt$/, in: 'fold:e1' }))?.props.color).toBeUndefined()
})

test('tree rows colour their path slashes too', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/sub/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  await first.resize({ columns: 60, rows: 1, in: 'file:e1' })
  expect((await first.find({ type: 'Text', text: /^\/$/, in: 'file:e1' }))?.props.color).toBe('promptBorder')
})

test('the header bolds only its verb, and colours the count', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  await first.resize({ columns: 60, rows: 1, in: 'fold:e1' })
  const piece = (text: RegExp) => first.find({ type: 'Text', text, in: 'fold:e1' })
  expect((await piece(/^Edited$/))?.props.bold).toBe(true)
  expect((await piece(/^2$/))?.props.color).toBe('claude')
  expect((await piece(/^ files$/))?.props.bold).toBeUndefined()
  expect((await piece(/^ \($/))?.props.color).toBe('promptBorder')
  expect((await piece(/^\)$/))?.props.color).toBe('promptBorder')
})

test('a click on a file opens its diff alone, and closing the fold closes it', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', hunk(' a', '+b'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', hunk(' a', '+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  expect(await diffOf(second)).toBeUndefined()
  await click(second, 'file:e2')
  expect(await diffOf(second)).toBe('@@ -3,1 +3,2 @@\n a\n+c')
  expect(await diffOf(first)).toBeUndefined()
  await click(first, 'fold:e1')
  expect(await diffOf(second)).toBeUndefined()
})

test('the tree line runs beside every open diff', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', hunk(' a', '+b'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', hunk(' a', '+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  await click(first, 'file:e1')
  await click(second, 'file:e2')
  const line = async (ui: any) => (await ui.find({ type: 'Text', text: /^│/ }))?.props.color
  expect(await line(first)).toBe('promptBorder')
  expect(await line(second)).toBe('promptBorder')
  // One row per diff line, and one more for the gap before the next file.
  const rows = async (ui: any) => (await ui.find({ type: 'Text', text: /^│/ }))?.text.split('\n').length
  expect(await rows(first)).toBe(3)
  expect(await rows(second)).toBe(2)
})

test('diffRows counts what the Code element draws', () => {
  const head = '@@ -3,1 +3,2 @@'
  expect(diffRows(`${head}\n a\n+b`, 40)).toBe(2)
  // A `...` row between hunks; `\ No newline` draws none.
  expect(diffRows(`${head}\n a\n+b\n@@ -50,1 +51,1 @@\n-c\n+d\n\\ No newline at end of file`, 40)).toBe(5)
  // 36 cells of room past a 1-digit gutter: 37 wraps once, a tab or a wide character takes two.
  expect(diffRows(`${head}\n+${'x'.repeat(36)}`, 40)).toBe(1)
  expect(diffRows(`${head}\n+${'x'.repeat(37)}`, 40)).toBe(2)
  expect(diffRows(`${head}\n+\t${'x'.repeat(35)}`, 40)).toBe(2)
  expect(diffRows(`${head}\n+漢${'x'.repeat(35)}`, 40)).toBe(2)
  // A joined emoji draws two cells; a 3-digit hunk gutter leaves 34 cells of room.
  expect(diffRows(`${head}\n+👨\u200D👩\u200D👧${'x'.repeat(34)}`, 40)).toBe(1)
  expect(diffRows(`@@ -98,3 +98,3 @@\n ${'x'.repeat(34)}`, 40)).toBe(1)
  expect(diffRows(`@@ -98,3 +98,3 @@\n ${'x'.repeat(35)}`, 40)).toBe(2)
})

test('the last row turns its corner to a tee while its diff is open', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', hunk(' a', '+b'), {}, '/p/a.txt', 'e1')
  const second = await mountRow($, 'Edit', hunk(' a', '+c'), {}, '/p/b.txt', 'e2')
  await click(first, 'fold:e1')
  expect(await textOf(second, 'file:e2')).toMatch(/^  └ /)
  await click(second, 'file:e2')
  expect(await textOf(second, 'file:e2')).toMatch(/^  ├ /)
  await click(second, 'file:e2')
  expect(await textOf(second, 'file:e2')).toMatch(/^  └ /)
})

test('a diff drops the control characters the Code element refuses', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', hunk(' a\f', '+b\r', '+\tc\u001b[0m'), {}, '/p/a.txt', 'e1')
  await click(first, 'fold:e1')
  expect(await diffOf(first)).toBe('@@ -3,1 +3,2 @@\n a\n+b\n+\tc[0m')
})

test('a diff too big for the Code element opens nothing, and the row stays', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Write', created(`${'x'.repeat(100_000)}\n`), {}, '/p/a.txt', 'e1')
  await click(first, 'fold:e1')
  expect(await diffOf(first)).toBeUndefined()
  expect(await textOf(first, 'e1')).toBe('● Created (a.txt)  +1')
})

test('a new file opens as all added lines', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Write', created('a\nb\n'), {}, '/p/a.txt', 'e1')
  await click(first, 'fold:e1')
  expect(await diffOf(first)).toBe('@@ -0,0 +1,2 @@\n+a\n+b')
})

test('a lone edit has no tree: a click opens its diff', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', hunk(' a', '+b'), {}, '/p/a.txt', 'e1')
  expect(await diffOf(first)).toBeUndefined()
  await click(first, 'fold:e1')
  expect(await diffOf(first)).toBe('@@ -3,1 +3,2 @@\n a\n+b')
  expect(await textOf(first, 'e1')).toBe('● Updated (a.txt)  +1')
  expect((await first.find({ type: 'Text', text: /^│/ }))?.props.color).toBe('promptBorder')
})

test('a surface other than the terminal keeps the native rows', async ($, on) => {
  native(on)
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'desktop', component: 'ToolUse', requestId: 'e1',
    props: { tool_use_id: 'e1', tool: 'Edit', input: { file_path: '/p/a.txt' }, output: patch('+b'), isRunning: false, isErrored: false, isInterrupted: false }, viewport: VIEW })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('native')
})

test('a switch of transcript ends the run, so an edit in the chat keeps its row', async ($, on) => {
  native(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text' as const, children: ['band'] }))
  await mountRow($, 'Edit', patch('+b'), {}, '/p/agent.txt', 'e1')
  const band = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AbovePrompt', requestId: 'b1', props: { view: { agentId: 'a1' } } as any, viewport: VIEW })
  await band.unmount?.()
  await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'AbovePrompt', requestId: 'b2', props: { view: {} } as any, viewport: VIEW })
  expect(await textOf(await mountRow($, 'Edit', patch('+c'), {}, '/p/a.txt', 'e2'), 'e2')).toBe('● Updated (a.txt)  +1')
})

test('a cwd that cannot be read leaves absolute paths whole', async ($, on) => {
  native(on, { deny: 'gone' })
  expect(await textOf(await mountRow($, 'Edit', patch('+b'), {}, '/x/a.txt', 'e1'), 'e1')).toBe('● Updated (/x/a.txt)  +1')
})

test('off the fullscreen layout each edit keeps its own row, as a printed row cannot change', async ($, on) => {
  native(on)
  const view = { columns: 80, rows: 20, isFullscreen: false }
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1', view)
  const second = await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2', view)
  expect(await textOf(first, 'e1')).toBe('● Updated (a.txt)  +1')
  expect(await textOf(second, 'e2')).toBe('● Updated (b.txt)  +1')
})

test('a file outside the session folder keeps its full path', async ($, on) => {
  native(on)
  expect(await drawn($, 'Edit', patch('-a', '+b'), {}, '/other/a.txt')).toBe('● Updated (/other/a.txt)  +1 −1')
})

test('a nested file keeps its path from the session folder', async ($, on) => {
  native(on)
  expect(await drawn($, 'Edit', patch('-a', '+b'), {}, '/p/sub/a.txt')).toBe('● Updated (sub/a.txt)  +1 −1')
})

const block = async ($: any, tool: string, output: unknown, extra: object = {}, id = 'r1') => {
  await mountRow($, tool, output, extra, '/p/a.txt', id)
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: id,
    props: { tool_use_id: id, tool, output, isErrored: false, ...extra }, viewport: VIEW })
  return (await ui.find({ type: 'Text' }))?.text
}

test('the engine block under a compact row draws nothing, open or closed', async ($, on) => {
  native(on)
  expect(await block($, 'Edit', patch('-a', '+b'), {}, 'b1')).toBeUndefined()
})

test('the engine block stays where the row stays native', async ($, on) => {
  native(on)
  expect(await block($, 'Edit', patch('-a', '+b'), { isExpanded: true }, 'b1')).toBe('native block')
  expect(await block($, 'Edit', "The user doesn't want to proceed.", { isErrored: true }, 'b2')).toBe('native block')
  expect(await block($, 'Edit', 'Error: ledger: /p/a.txt was edited by another session.', { isErrored: true }, 'b4')).toBe('native block')
  expect(await block($, 'Bash', { stdout: 'x' }, {}, 'b3')).toBe('native block')
})

test('a running edit draws its running row', async ($, on) => {
  native(on)
  expect(await drawn($, 'Edit', undefined, { isRunning: true }, '/p/sub/a.txt')).toBe('● Updating (sub/a.txt)')
})

test('an interrupted call stays native', async ($, on) => {
  native(on)
  expect(await drawn($, 'Edit', 'Error: cut.', { isErrored: true, isInterrupted: true })).toBe('native')
})

test('the mark and counts take the theme colours', async ($, on) => {
  native(on)
  const ui = await mountRow($, 'Edit', patch('-a', '+b'))
  await ui.resize({ columns: 60, rows: 1, in: 'fold:r1' })
  expect((await ui.find({ type: 'Text', text: /^●$/, in: 'fold:r1' }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: /^\+1$/, in: 'fold:r1' }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: /^−1$/, in: 'fold:r1' }))?.props.color).toBe('error')
})

for (const [name, tool, output, extra] of [
  ['the expanded view', 'Edit', patch('-a', '+b'), { isExpanded: true }],
  ['an expanded error', 'Edit', 'Error: String to replace not found in file.', { isErrored: true, isExpanded: true }],
  ['a tool error', 'Edit', 'Error: String to replace not found in file.', { isErrored: true }],
  ['a tool error on Write', 'Write', 'Error: it failed.', { isErrored: true }],
  ['a hook denial', 'Edit', 'Error: ledger: /p/a.txt was edited by another session 2m ago.', { isErrored: true }],
  ['a rule denial', 'Write', 'Error: Permission to use Write has been denied.', { isErrored: true }],
  ['a refusal', 'Edit', "The user doesn't want to proceed with this tool use.", { isErrored: true }],
  ['another tool\'s error', 'Bash', 'Error: exit 1', { isErrored: true }],
  ['a held edit', 'Edit', { ...patch('-a', '+b'), staged: true }, {}],
  ['a held new file', 'Write', { ...created('a\n'), staged: true }, {}],
  ['a write that changed nothing', 'Write', { type: 'update', structuredPatch: [], originalFile: 'a' }, {}],
  ['a write too large to diff', 'Write', { type: 'update', structuredPatch: [], originalFile: null }, {}],
  ['another tool', 'Read', patch('-a', '+b'), {}],
] as const) {
  test(`${name} stays native`, async ($, on) => {
    native(on)
    expect(await drawn($, tool, output, extra)).toBe('native')
  })
}

const fetched = { bytes: 577, code: 200, codeText: 'OK', result: 'x', durationMs: 5, url: 'https://example.com/' }
const searched = { query: 'example domain', results: [], durationSeconds: 5, searchCount: 1 }
const agentDone = { status: 'completed', agentId: 'a1', content: [], totalToolUseCount: 3, totalDurationMs: 9, totalTokens: 9, prompt: 'p' }
for (const [name, tool, input, output, want] of [
  ['a fetch', 'WebFetch', { url: 'https://example.com/a?b' }, fetched, '● Fetched (example.com)  200 · 577 B'],
  ['a big fetch', 'WebFetch', { url: 'https://example.com' }, { ...fetched, bytes: 48_213 }, '● Fetched (example.com)  200 · 47 KB'],
  ['a fetch of a bad url', 'WebFetch', { url: 'nope' }, { ...fetched, code: 404 }, '● Fetched (nope)  404 · 577 B'],
  ['a search', 'WebSearch', { query: 'example domain' }, searched, '● Searched ("example domain")  1 search'],
  ['searches', 'WebSearch', { query: 'q' }, { ...searched, searchCount: 2 }, '● Searched ("q")  2 searches'],
  ['a search with no count', 'WebSearch', { query: 'q' }, { ...searched, searchCount: undefined }, '● Searched ("q")'],
  ['a background agent', 'Agent', { description: 'Say hi', prompt: 'p' }, { status: 'async_launched', agentId: 'a1', description: 'Say hi', prompt: 'p', outputFile: '/o' }, '● Agent (Say hi)  backgrounded'],
  ['a finished agent', 'Agent', { description: 'Say hi', prompt: 'p' }, agentDone, '● Agent (Say hi)  done'],
  ['a remote agent', 'Agent', { description: 'Say hi', prompt: 'p' }, { status: 'remote_launched', taskId: 't', sessionUrl: 'u', description: 'Say hi', prompt: 'p', outputFile: '/o' }, '● Agent (Say hi)  remote'],
  ['a skill', 'Skill', { skill: 'caveman:caveman-help' }, { success: true, commandName: 'caveman:caveman-help' }, '● Skill (caveman:caveman-help)  loaded'],
  ['a forked skill', 'Skill', { skill: 's' }, { success: true, commandName: 's', status: 'forked', agentId: 'a', result: 'r' }, '● Skill (s)  done'],
  ['a background skill', 'Skill', { skill: 's' }, { success: true, commandName: 's', status: 'forked', agentId: 'a', result: 'r', background: true }, '● Skill (s)  backgrounded'],
] as const) {
  test(`${name} draws a one-line row, and its engine block nothing`, async ($, on) => {
    native(on)
    expect(await drawn($, tool, output, { input })).toBe(want)
    const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'r1',
      props: { tool_use_id: 'r1', tool, output, isErrored: false }, viewport: VIEW })
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
  })
}

for (const [name, tool, input, output, extra] of [
  ['a failed fetch', 'WebFetch', { url: 'https://x.y' }, 'Error: refused', { isErrored: true }],
  ['an expanded search', 'WebSearch', { query: 'q' }, searched, { isExpanded: true }],
  ['an interrupted agent', 'Agent', { description: 'd' }, 'Error: cut.', { isErrored: true, isInterrupted: true }],
  ['an agent of unknown shape', 'Agent', { description: 'd' }, { status: 'teammate_spawned' }, {}],
  ['a skill not found', 'Skill', { skill: 's' }, { success: false, commandName: 's' }, {}],
] as const) {
  test(`${name} stays native, engine block too`, async ($, on) => {
    native(on)
    expect(await drawn($, tool, output, { input, ...extra })).toBe('native')
    expect(await block($, tool, output, { input, ...extra }, 'b1')).toBe('native block')
  })
}

for (const [name, tool, input, want] of [
  ['a running fetch', 'WebFetch', { url: 'https://example.com/a' }, '● Fetching (example.com)'],
  ['a running search', 'WebSearch', { query: 'example domain' }, '● Searching ("example domain")'],
  ['a running agent', 'Agent', { description: 'Say hi' }, '● Agent (Say hi)  running'],
  ['a running skill', 'Skill', { skill: 'caveman:caveman-help' }, '● Loading (caveman:caveman-help)'],
  ['a running write', 'Write', { file_path: '/p/a.txt' }, '● Writing (a.txt)'],
] as const) {
  test(`${name} draws its running row, and its engine block stays`, async ($, on) => {
    native(on)
    expect(await drawn($, tool, undefined, { input, isRunning: true })).toBe(want)
    expect(await block($, tool, undefined, { input, isRunning: true }, 'b1')).toBe('native block')
  })
}

test('a running row takes the theme colours, its dot dim', async ($, on) => {
  native(on)
  const ui = await mountRow($, 'WebFetch', undefined, { input: { url: 'https://example.com' }, isRunning: true })
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('inactive')
  expect((await ui.find({ type: 'Text', text: /^Fetching$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^ \($/ }))?.props.color).toBe('promptBorder')
})

// A background agent's finish row, after its Agent call drew as a1; `seen` counts the chain below folio.
function finished(on: any) {
  native(on)
  const seen = { calls: 0 }
  on('ui.render', { component: 'UserMessage' }, () => { seen.calls++; return { type: 'Text' as const, children: ['native'] } })
  return seen
}
const launched = { status: 'async_launched', agentId: 'x1', description: 'Slow task', prompt: 'p', outputFile: '/o' }
const notice = async ($: any, task: object, extra: object = {}) => {
  await mountRow($, 'Agent', launched, { input: { description: 'Slow task', prompt: 'p' } }, '/p/a.txt', 'a1')
  return $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'UserMessage', requestId: 'n1',
    props: { text: 'n', origin: { kind: 'task-notification' }, isExpanded: false, task: { toolUseId: 'a1', ...task }, ...extra }, viewport: VIEW })
}

for (const [status, durationMs, want, dot] of [
  ['completed', 12_000, '● Agent (Slow task)  done · 12s', 'success'],
  ['failed', 122_000, '● Agent (Slow task)  failed · 2m 2s', 'error'],
  ['killed', 12_000, '● Agent (Slow task)  stopped · 12s', 'inactive'],
  ['completed', 3_723_000, '● Agent (Slow task)  done · 1h 2m', 'success'],
  ['completed', undefined, '● Agent (Slow task)  done', 'success'],
] as const) {
  test(`a ${status} background agent's notification reads ${want}`, async ($, on) => {
    const seen = finished(on)
    const ui = await notice($, { status, durationMs })
    expect(await textOf(ui)).toBe(want)
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(dot)
    expect(seen.calls).toBeGreaterThan(0)
  })
}

for (const [name, task, extra] of [
  ['an unknown status', { status: 'paused', durationMs: 12_000 }, {}],
  ['an unknown call', { status: 'completed', toolUseId: 'b9' }, {}],
  ['no call id', { status: 'completed', toolUseId: undefined }, {}],
  ['an expanded row', { status: 'completed' }, { isExpanded: true }],
  ['another origin', { status: 'completed' }, { origin: { kind: 'composer' } }],
  ['no task', { status: 'completed' }, { task: undefined }],
] as const) {
  test(`a notification with ${name} stays native`, async ($, on) => {
    finished(on)
    expect(await textOf(await notice($, task, extra))).toBe('native')
  })
}

test('hideEditDiff false keeps the native notification row', async ($, on) => {
  finished(on)
  configured(on, { '/cfg/claudzilla.json': off })
  await $.session.start(start)
  expect(await textOf(await notice($, { status: 'completed', durationMs: 12_000 }))).toBe('native')
})

// Counts the redraws the one blink timer asks for.
const blinks = (on: any) => {
  const w = { periods: 0, clock: mock.clock(on, { now: 0 }) }
  on('ui.invalidate', (_$: any, e: any, next: any) => (w.periods++, next(e)))
  return w
}

test("a running row's dot blinks with the clock", async ($, on) => {
  native(on)
  const { clock } = blinks(on)
  const ui = await mountRow($, 'WebSearch', undefined, { input: { query: 'q' }, isRunning: true })
  expect(await textOf(ui)).toBe('● Searching ("q")')
  await clock.advance(500)
  await ui.redraw()
  expect(await textOf(ui)).toBe('  Searching ("q")')
  await clock.advance(500)
  await ui.redraw()
  expect(await textOf(ui)).toBe('● Searching ("q")')
})

test('the blink timer stops once no running row is drawn, and never starts idle', async ($, on) => {
  native(on)
  const w = blinks(on)
  const ui = await mountRow($, 'WebSearch', searched, { input: { query: 'q' } })
  await w.clock.advance(2000)
  expect(w.periods).toBe(0)
  await ui.redraw({ tool_use_id: 'r1', tool: 'WebSearch', input: { query: 'q' }, output: undefined, isRunning: true, isErrored: false, isInterrupted: false })
  await w.clock.advance(500)
  expect(w.periods).toBeGreaterThan(0)
  await ui.redraw({ tool_use_id: 'r1', tool: 'WebSearch', input: { query: 'q' }, output: searched, isRunning: false, isErrored: false, isInterrupted: false })
  await w.clock.advance(1500)
  const stopped = w.periods
  await w.clock.advance(5000)
  expect(w.periods).toBe(stopped)
})

for (const [tool, output, input] of [
  ['Edit', patch('-a', '+b'), undefined],
  ['Write', created('a\n'), undefined],
  ['WebFetch', fetched, { url: 'https://example.com' }],
  ['WebSearch', searched, { query: 'q' }],
  ['Agent', agentDone, { description: 'd' }],
  ['Skill', { success: true, commandName: 's' }, { skill: 's' }],
] as const) {
  test(`an interrupted ${tool} with output, not errored, stays native`, async ($, on) => {
    native(on)
    expect(await drawn($, tool, output, { isInterrupted: true, ...(input && { input }) })).toBe('native')
  })
}

test('a fetch between edits starts a new run, and takes no part in it', async ($, on) => {
  native(on)
  const first = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  const web = await mountRow($, 'WebFetch', fetched, { input: { url: 'https://example.com' } }, '/p/a.txt', 'w1')
  const second = await mountRow($, 'Edit', patch('+c'), {}, '/p/b.txt', 'e2')
  expect(await textOf(first, 'e1')).toBe('● Updated (a.txt)  +1')
  expect(await textOf(web, 'w1')).toBe('● Fetched (example.com)  200 · 577 B')
  expect(await textOf(second, 'e2')).toBe('● Updated (b.txt)  +1')
})

test('hideEditDiff false keeps the native fetch row', async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': off })
  await $.session.start(start)
  expect(await drawn($, 'WebFetch', fetched, { input: { url: 'https://example.com' } })).toBe('native')
})

// One map of config files, as a session finds them: machine, then the repo's shared and local.
function configured(on: any, files: Record<string, string>) {
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('fs.read', (_: unknown, e: any) => (files[e.path] ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '' } }))
}
const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const off = JSON.stringify({ folio: { hideEditDiff: false } })
const on_ = JSON.stringify({ folio: { hideEditDiff: true } })

test('hideEditDiff false in the machine file keeps the native diff', async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': off })
  await $.session.start(start)
  expect(await drawn($, 'Edit', patch('-a', '+b'))).toBe('native')
})

test("a repo's local file wins over the shared and machine files", async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': on_, '/repo/.claude/claudzilla.json': on_, '/repo/.claude/claudzilla.local.json': off })
  await $.session.start(start)
  expect(await drawn($, 'Edit', patch('-a', '+b'))).toBe('native')
})

test('hideEditDiff false keeps the native error row', async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': off })
  await $.session.start(start)
  expect(await drawn($, 'Edit', 'Error: it failed.', { isErrored: true })).toBe('native')
})

test('a bad config file or value leaves the default', async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': '{ nope', '/repo/.claude/claudzilla.json': JSON.stringify({ folio: { hideEditDiff: 'no' } }) })
  await $.session.start(start)
  expect(await drawn($, 'Edit', patch('-a', '+b'))).toBe('● Updated (a.txt)  +1 −1')
})

const lit = async ($: any) => {
  const ui = await mountRow($, 'Edit', patch('+b'), {}, '/p/a.txt', 'e1')
  await ui.resize({ columns: 60, rows: 1, in: 'fold:e1' })
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'fold:e1' })
  return (await ui.find({ type: 'Box', in: 'fold:e1' }))?.props.backgroundColor
}

test('a palette lit colours the fold row under the pointer', async ($, on) => {
  native(on)
  configured(on, { '/cfg/claudzilla.json': JSON.stringify({ palette: { shared: { lit: '#112233' } } }) })
  await $.session.start(start)
  expect(await lit($)).toBe('#112233')
})

test('a palette in a repo file is not read', async ($, on) => {
  native(on)
  configured(on, { '/repo/.claude/claudzilla.json': JSON.stringify({ palette: { shared: { lit: '#112233' } } }) })
  await $.session.start(start)
  expect(await lit($)).toBe('#0f1c28')
})

test('a bad palette value keeps the default, silently', async ($, on) => {
  const toasts: string[] = []
  native(on)
  configured(on, { '/cfg/claudzilla.json': JSON.stringify({ palette: { shared: { lit: 'red' } } }) })
  on('ui.toast', (_: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  await $.session.start(start)
  expect(await lit($)).toBe('#0f1c28')
  expect(toasts).toEqual([])
})

for (const [command, want] of [
  ["sed -i 's/a/b/' a.txt", ['a.txt']],
  ["sed -i.bak -e 's/a/b/' -e 's/c/d/' a.txt b.txt", ['a.txt', 'b.txt']],
  ["sed -Ei 's/a/b/' a.txt", ['a.txt']],
  ['echo x > a.txt', ['a.txt']],
  ['echo x >> a.txt && echo y >b.txt', ['a.txt', 'b.txt']],
  ['printf x > "my file.txt"', ['my file.txt']],
  ['echo x | tee -a a.txt b.txt', ['a.txt', 'b.txt']],
  ["cat > a.txt <<'EOF'\nline > not.txt\nEOF", ['a.txt']],
  ['cat <<EOF > a.txt\nx\nEOF\necho done', ['a.txt']],
  ["cd sub && sed -i 's/a/b/' ./a.txt", ['sub/a.txt']],
  ['cd /abs && echo x > a.txt', ['/abs/a.txt']],
  ['ls 2>/dev/null; echo x >&2; echo y > /dev/null', []],
  ["sed 's/a/b/' a.txt", []],
  ['grep -n x a.txt | head', []],
  ['echo "a > b"', []],
  ["echo 'x >> y' | cat", []],
] as const) {
  test(`writeTargets finds ${JSON.stringify(want)} in ${JSON.stringify(command)}`, () => {
    expect(writeTargets(command)).toEqual([...want])
  })
}

// Files under /p as the engine's fs sees them; a Bash call beneath the mod applies `run` to them.
function bashFs(on: any, files: Record<string, string>, run: (files: Record<string, string>) => void = () => {}, isError = false) {
  const seen = { reads: 0 }
  on('ui.render', { component: 'ToolGroup' }, (_$: any, e: any) => ({ type: 'Text' as const, children: [`expanded:${e.props.isExpanded}`] }))
  on('fs.read', (_: any, e: any) => (seen.reads++, e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }))
  on('tool.call', () => (run(files), { result: { stdout: '', stderr: '' }, ...(isError ? { isError: true } : {}) }) as any)
  return seen
}
const bash = ($: any, command: string, id = 'b1') => $.tool.call({ tool: 'Bash', command, tool_use_id: id } as any)
const call = (id: string, tool: string, input: object, extra: object = {}) =>
  ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, output: { stdout: '' }, ...extra })
let groups = 0
const group = ($: any, calls: object[], extra: object = {}, viewport: object = VIEW) =>
  $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolGroup', requestId: `g${++groups}`,
    props: { calls, isActive: false, isExpanded: false, ...extra }, viewport })
// The fold's header where folio draws one, else the engine's line.
const groupOf = async ($: any, calls: object[], extra: object = {}, viewport: object = VIEW) =>
  textOf(await group($, calls, extra, viewport), `fold:g${groups}`)
const useRow = async ($: any, c: any, extra: object = {}) =>
  (await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolUse', requestId: c.tool_use_id, props: { ...c, ...extra }, viewport: VIEW }))
const rowsOf = async (ui: any) => (await ui.findAll({ type: 'Text', text: /^● / })).map((t: any) => t.text)

for (const [name, command, before, after, want] of [
  ['an edit', "sed -i 's/a/b/' a.txt", { '/p/a.txt': 'a\nc\n' }, { '/p/a.txt': 'b\nc\n' }, ['● Updated (a.txt)  +1 −1']],
  ['a new file', 'printf "x\\ny\\n" > new.txt', {}, { '/p/new.txt': 'x\ny\n' }, ['● Created (new.txt)  +2']],
  ['two files', 'echo x | tee a.txt sub/b.txt', { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\nx\n', '/p/sub/b.txt': 'x\n' }, ['● Ran (echo x | tee a.txt sub/b.txt)  +2']],
  ['a cd first', 'cd sub && echo x >> b.txt', { '/p/sub/b.txt': 'a\nb\n' }, { '/p/sub/b.txt': 'x\n' }, ['● Updated (sub/b.txt)  +1 −2']],
] as const) {
  test(`a Bash call that writes ${name} draws its edit rows`, async ($, on) => {
    native(on)
    bashFs(on, { ...before }, files => Object.assign(files, after))
    await bash($, command)
    expect([await textOf(await useRow($, call('b1', 'Bash', { command })), 'fold:b1')]).toEqual([...want])
  })
}

// A standalone Bash call that wrote two files, folded.
async function twoWrites($: any, on: any, viewport: object = VIEW) {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => Object.assign(files, { '/p/a.txt': 'a\nx\n', '/p/sub/b.txt': 'x\n' }))
  await bash($, 'echo x | tee a.txt sub/b.txt')
  return $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolUse', requestId: 'b1', props: call('b1', 'Bash', { command: 'echo x | tee a.txt sub/b.txt' }), viewport })
}

test('a press on a standalone Bash write of two files opens a tree of them, and a file row its diff', async ($, on) => {
  const ui = await twoWrites($, on)
  expect(await treeOf(ui)).toEqual([])
  await click(ui, 'fold:b1')
  expect(await textOf(ui, 'fold:b1')).toBe('○ Ran (echo x | tee a.txt sub/b.txt)  +2')
  expect(await treeOf(ui)).toEqual(['  ├ Updated (a.txt)  +1', '  └ Created (sub/b.txt)  +1'])
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -1,1 +1,2 @@\n a\n+x')
  await click(ui, 'fold:b1')
  expect(await treeOf(ui)).toEqual([])
})

test('a press on a standalone Bash write of one file opens its diff, with no tree', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt')
  const ui = await useRow($, call('b1', 'Bash', { command: 'echo b > a.txt' }))
  await click(ui, 'fold:b1')
  expect(await textOf(ui, 'fold:b1')).toBe('○ Updated (a.txt)  +1 −1')
  expect(await treeOf(ui)).toEqual([])
  expect(await diffOf(ui)).toBe('@@ -1,1 +1,1 @@\n-a\n+b')
})

test('a standalone Bash write title cuts its command to the width, keeping the counts', async ($, on) => {
  const ui = await twoWrites($, on, { ...VIEW, columns: 20 })
  expect(await textOf(ui, 'fold:b1')).toBe('● Ran (echo x …)  +2')
  await ui.unmount()
  const narrow = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolUse', requestId: 'b1', props: call('b1', 'Bash', { command: 'echo x | tee a.txt sub/b.txt' }), viewport: { ...VIEW, columns: 8 } })
  expect(await textOf(narrow, 'fold:b1')).toBe('● Ran (…)  +2')
})

test('a standalone Bash write of one file too big for a diff keeps a plain row', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': lines(2100) }, files => (files['/p/a.txt'] = lines(2100, 4)))
  await bash($, "sed -i 's/l5/X/' a.txt")
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: "sed -i 's/l5/X/' a.txt" })))).toEqual(['● Updated (a.txt)  +1 −1'])
})

test('off the fullscreen layout a standalone Bash write keeps a plain row per file', async ($, on) => {
  const ui = await twoWrites($, on, { columns: 80, rows: 20 })
  expect(await rowsOf(ui)).toEqual(['● Updated (a.txt)  +1', '● Created (sub/b.txt)  +1'])
})

// A group holding a recorded Bash write, as folio's fold draws it: the header's text, and the tree's rows once open.
// A file row that opens a diff is a Client, read once sized.
const treeOf = async (ui: any) => {
  const rows: string[] = []
  for (const x of await ui.findAll({})) {
    if (x.type === 'Client' && x.key.startsWith('file:')) rows.push(await textOf(ui, x.key))
    else if (x.type === 'Text' && /^  [├└] ./.test(x.text)) rows.push(x.text)
  }
  return rows
}

test('a group holding a Bash edit folds into one row with its counts', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, "sed -i 's/a/b/' a.txt", 'b1')
  const calls = [call('r1', 'Read', { file_path: '/p/a.txt' }), call('b1', 'Bash', { command: "sed -i 's/a/b/' a.txt" }), call('b2', 'Bash', { command: 'ls' })]
  const ui = await group($, calls)
  expect(await textOf(ui, `fold:g${groups}`)).toBe('● Read (1 file) · Ran (2 commands)  +1 −1')
  expect((await ui.find({ type: 'Box' }))?.props.marginTop).toBe(1)
  expect(await treeOf(ui)).toEqual([])
})

test('a group of one call says command', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt', 'b1')
  expect(await groupOf($, [call('b1', 'Bash', { command: 'echo b > a.txt' })])).toBe('● Ran (1 command)  +1 −1')
})

test('a group whose Bash write changed nothing still folds, with no counts', async ($, on) => {
  native(on)
  bashFs(on, { '/p/c.txt': 'c\n' })
  await bash($, "sed -i 's/x/y/' c.txt", 'b2')
  expect(await groupOf($, [call('r1', 'Read', { file_path: '/p/a.txt' }), call('b2', 'Bash', { command: "sed -i 's/x/y/' c.txt" })])).toBe('● Read (1 file) · Ran (1 command)')
})

test('a click on the group opens a tree of its calls, and another closes it', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n', '/p/c.txt': 'c\n' }, files => {
    if (files['/p/a.txt'] === 'a\n') Object.assign(files, { '/p/a.txt': 'b\n', '/p/sub/b.txt': 'x\n' })
  })
  await bash($, 'echo x | tee a.txt sub/b.txt', 'b1')
  await bash($, "sed -i 's/x/y/' c.txt", 'b2')
  const long = `echo ${'x'.repeat(200)}`
  const calls = [call('b1', 'Bash', { command: 'echo x | tee a.txt sub/b.txt' }), call('b2', 'Bash', { command: "sed -i 's/x/y/' c.txt" }),
    call('b3', 'Bash', { command: 'ls -la\nmore' }), call('r1', 'Read', { file_path: '/p/sub/a.txt' }), call('g1', 'Grep', { pattern: 'foo', path: '/p' }),
    call('b4', 'Bash', { command: long }), call('b5', 'Bash', { command: 'false' }, { isErrored: true }),
    call('b6', 'Bash', { command: 'sleep 9' }, { isInterrupted: true })]
  const ui = await group($, calls)
  const at = `fold:g${groups}`
  await click(ui, at)
  expect(await textOf(ui, at)).toBe('○ Ran (6 commands) · Read (1 file) · Searched (1 pattern)  +2 −1')
  const rows = await treeOf(ui)
  expect(rows.slice(0, 6)).toEqual(['  ├ Updated (a.txt)  +1 −1', '  ├ Created (sub/b.txt)  +1', "  ├ sed -i 's/x/y/' c.txt", '  ├ ls -la', '  ├ Read (sub/a.txt)', '  ├ Grep (foo)'])
  expect(rows[6]).toMatch(/^  ├ echo x+…$/)
  expect(rows[6]!.length).toBeLessThanOrEqual(VIEW.columns)
  expect(rows.slice(7)).toEqual(['  ├ false  failed', '  └ sleep 9  interrupted'])
  expect((await ui.find({ type: 'Text', text: /^failed$/ }))?.props.color).toBe('error')
  await click(ui, at)
  expect(await textOf(ui, at)).toBe('● Ran (6 commands) · Read (1 file) · Searched (1 pattern)  +2 −1')
  expect(await treeOf(ui)).toEqual([])
})

// A group of a Bash edit of b1 and an ls, folio's fold opened.
const bashTree = async ($: any, on: any, before: Record<string, string>, command: string, write: Record<string, string>) => {
  native(on)
  bashFs(on, { ...before }, files => Object.assign(files, write))
  await bash($, command, 'b1')
  const ui = await group($, [call('b2', 'Bash', { command: 'ls' }), call('r1', 'Read', { file_path: '/p/a.txt' }), call('b1', 'Bash', { command })])
  await click(ui, `fold:g${groups}`)
  return ui
}
const lines = (n: number, at = -1) => Array.from({ length: n }, (_, i) => (i === at ? 'X' : `l${i + 1}`)).join('\n') + '\n'

test('a press on a Bash edit row in a group opens its diff, and another closes it', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': lines(9) }, "sed -i 's/l5/X/' a.txt", { '/p/a.txt': lines(9, 4) })
  expect(await diffOf(ui)).toBeUndefined()
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+X\n l6\n l7\n l8')
  expect((await ui.find({ type: 'Text', text: /^│/ }))?.props.color).toBe('promptBorder')
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBeUndefined()
})

test('a Bash edit diff splits changes far apart into hunks', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': lines(20) }, 'x > a.txt', { '/p/a.txt': lines(20).replace('l2\n', 'Y\n').replace('l19\n', '') })
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -1,5 +1,5 @@\n l1\n-l2\n+Y\n l3\n l4\n l5\n@@ -16,5 +16,4 @@\n l16\n l17\n l18\n-l19\n l20')
})

test('a file a Bash call made opens as all added lines', async ($, on) => {
  const ui = await bashTree($, on, {}, 'printf "x\\ny\\n" > a.txt', { '/p/a.txt': 'x\ny\n' })
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -0,0 +1,2 @@\n+x\n+y')
})

test("a group's last Bash edit row turns its corner to a tee while its diff is open", async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': 'a\n' }, 'echo b > a.txt', { '/p/a.txt': 'b\n' })
  expect(await treeOf(ui)).toEqual(['  ├ ls', '  ├ Read (a.txt)', '  └ Updated (a.txt)  +1 −1'])
  await click(ui, 'file:b1:0')
  expect((await treeOf(ui))[2]).toBe('  ├ Updated (a.txt)  +1 −1')
})

test('only Bash edit rows in a group take a press: commands and reads stay plain text', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': 'a\n' }, 'echo b > a.txt', { '/p/a.txt': 'b\n' })
  expect((await ui.findAll({ type: 'Client' })).map((x: any) => x.key)).toEqual([`fold:g${groups}`, 'file:b1:0'])
})

test('closing a group closes its open diffs', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': 'a\n' }, 'echo b > a.txt', { '/p/a.txt': 'b\n' })
  await click(ui, 'file:b1:0')
  await click(ui, `fold:g${groups}`)
  await click(ui, `fold:g${groups}`)
  expect(await diffOf(ui)).toBeUndefined()
})

test('a Bash edit of a file too big to diff keeps its row, which opens nothing', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': lines(2001) }, "sed -i 's/l5$/X/' a.txt", { '/p/a.txt': lines(2001, 4) })
  expect(await treeOf(ui)).toEqual(['  ├ ls', '  ├ Read (a.txt)', '  └ Updated (a.txt)  +1 −1'])
  expect((await ui.findAll({ type: 'Client' })).map((x: any) => x.key)).toEqual([`fold:g${groups}`])
})

test('emptying a long file takes the cheap count, with no line-by-line diff', async ($, on) => {
  const ui = await bashTree($, on, { '/p/a.txt': 'a\n'.repeat(25_000) }, ': > a.txt', { '/p/a.txt': '' })
  expect((await treeOf(ui)).at(-1)).toBe('  └ Updated (a.txt)  −25000')
  expect((await ui.findAll({ type: 'Client' })).map((x: any) => x.key)).toEqual([`fold:g${groups}`])
})

test('a live group reads Running with a blinking dot, then Ran once done', async ($, on) => {
  native(on)
  const { clock } = blinks(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt', 'b1')
  const edit = call('b1', 'Bash', { command: 'echo b > a.txt' })
  const sleep = call('b2', 'Bash', { command: 'sleep 9' }, { isRunning: true, output: undefined })
  const ui = await group($, [edit, sleep], { isActive: true })
  const at = `fold:g${groups}`
  expect(await textOf(ui, at)).toBe('● Running (2 commands)  +1 −1')
  expect((await ui.find({ type: 'Text', text: /^●$/, in: at }))?.props.color).toBe('inactive')
  await clock.advance(500)
  await ui.redraw()
  expect(await textOf(ui, at)).toBe('  Running (2 commands)  +1 −1')
  await click(ui, at)
  expect(await treeOf(ui)).toEqual(['  ├ Updated (a.txt)  +1 −1', '  └ sleep 9'])
  await ui.redraw({ calls: [edit, { ...sleep, isRunning: false, output: { stdout: '' } }], isActive: false, isExpanded: false })
  expect(await textOf(ui, at)).toBe('○ Ran (2 commands)  +1 −1')
  expect((await ui.find({ type: 'Text', text: /^○$/, in: at }))?.props.color).toBe('success')
})

test('a group with no Bash write folds too, one part per tool kind in first-call order', async ($, on) => {
  native(on)
  bashFs(on, {})
  await bash($, 'ls', 'b3')
  const calls = [call('r1', 'Read', { file_path: '/p/a.txt' }), call('g1', 'Grep', { pattern: 'foo' }), call('b3', 'Bash', { command: 'ls' }),
    call('g2', 'Glob', { pattern: '*.ts' }), call('r2', 'Read', { file_path: '/p/b.txt' }), call('w1', 'WebFetch', { url: 'https://x.dev' })]
  expect(await groupOf($, calls)).toBe('● Read (2 files) · Searched (2 patterns) · Ran (1 command) · WebFetch (1)')
})

test('a group names its edits and writes in the past tense', async ($, on) => {
  native(on)
  bashFs(on, {})
  const calls = [call('e1', 'Edit', { file_path: '/p/a.txt' }), call('e2', 'Edit', { file_path: '/p/b.txt' }), call('w1', 'Write', { file_path: '/p/c.txt' })]
  expect(await groupOf($, calls)).toBe('● Edited (2 files) · Wrote (1 file)')
})

test('a live read-only group reads each kind in its running form', async ($, on) => {
  native(on)
  blinks(on)
  bashFs(on, {})
  const calls = [call('r1', 'Read', { file_path: '/p/a.txt' }), call('g1', 'Grep', { pattern: 'foo' }, { isRunning: true, output: undefined })]
  expect(await groupOf($, calls, { isActive: true })).toBe('● Reading (1 file) · Searching (1 pattern)')
})

test('a group with no calls stays the engine line', async ($, on) => {
  native(on)
  bashFs(on, {})
  expect(await groupOf($, [])).toBe('expanded:false')
})

test('an expanded group, as ctrl+o or --verbose draw it, stays native', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt', 'b1')
  expect(await groupOf($, [call('b1', 'Bash', { command: 'echo b > a.txt' })], { isExpanded: true })).toBe('expanded:true')
})

test('off the fullscreen layout a group keeps the engine line, as a printed row cannot change', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt', 'b1')
  expect(await groupOf($, [call('b1', 'Bash', { command: 'echo b > a.txt' })], {}, { columns: 80, rows: 20 })).toBe('expanded:false')
})

test("a folded group's calls as ctrl+o rows, one each, stay native", async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n', '/p/c.txt': 'c\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt', 'b1')
  await bash($, "sed -i 's/x/y/' c.txt", 'b2')
  const calls = [call('b1', 'Bash', { command: 'echo b > a.txt' }), call('b2', 'Bash', { command: "sed -i 's/x/y/' c.txt" }),
    call('b3', 'Bash', { command: 'ls' }), call('r1', 'Read', { file_path: '/p/a.txt' })]
  await groupOf($, calls)
  for (const c of calls) expect(await textOf(await useRow($, c, { isExpanded: true }), c.tool_use_id)).toBe('native')
})

test('a running Bash call drawn as its own row keeps its native row', async ($, on) => {
  native(on)
  expect(await drawn($, 'Bash', undefined, { isRunning: true, input: { command: 'sleep 9' } })).toBe('native')
})

test('an errored Bash edit stays native and its group folds with no counts', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'), true)
  await bash($, 'echo b > a.txt; false')
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: 'x' }, { isErrored: true })))).toEqual([])
  expect(await groupOf($, [call('b1', 'Bash', { command: 'x' }, { isErrored: true })])).toBe('● Ran (1 command)')
})

test('a standalone Bash write that changed nothing keeps its native row and engine block', async ($, on) => {
  native(on)
  bashFs(on, { '/p/c.txt': 'c\n' })
  await bash($, "sed -i 's/x/y/' c.txt")
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: "sed -i 's/x/y/' c.txt" })))).toEqual([])
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: '' }, isErrored: false }, viewport: VIEW })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('native block')
})

test('a Bash write folio holds no record of, as after a reload, draws one Ran row and drops the engine block', async ($, on) => {
  native(on)
  bashFs(on, {})
  const command = "sed -i 's/a/b/' a.txt\nmore"
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command })))).toEqual(["● Ran (sed -i 's/a/b/' a.txt)"])
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: '' }, isErrored: false }, viewport: VIEW })
  expect((await ui.find({ type: 'Text' }))?.text).toBeUndefined()
  expect(await rowsOf(await useRow($, call('b2', 'Bash', { command: 'ls' })))).toEqual([])
  expect(await textOf(await useRow($, call('b3', 'Bash', { command }, { isErrored: true })), 'b3')).toBe('native')
})

test('a Bash edit in ctrl+o outside a group, and its engine block, stay native', async ($, on) => {
  native(on)
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt')
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: 'x' }), { isExpanded: true }))).toEqual([])
  const result = async (extra: object) => {
    const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
      props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: '' }, isErrored: false, ...extra }, viewport: VIEW })
    const text = (await ui.find({ type: 'Text' }))?.text
    await ui.unmount()
    return text
  }
  expect(await result({ isExpanded: true })).toBe('native block')
  expect(await result({})).toBeUndefined()
})

test('a Bash call with no write target reads no file', async ($, on) => {
  native(on)
  const seen = bashFs(on, {})
  await bash($, 'ls -la | grep x')
  expect(seen.reads).toBe(0)
})

// Git repos at /p and /q: `head` is HEAD's text per file; status and show answer from it and the live files.
function gitFs(on: any, head: Record<string, string>, files: Record<string, string>, run: (files: Record<string, string>) => void = () => {}) {
  const seen = bashFs(on, files, run)
  const git = { statuses: 0, noRepo: false }
  on('process.run', (_: any, e: any) => {
    const argv: string[] = e.argv
    const top = argv[argv.indexOf('-C') + 1]!.startsWith('/q') ? '/q' : '/p'
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } })
    if (argv.includes('rev-parse')) return git.noRepo ? { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } : ok(`${top}\n`)
    if (argv.includes('status')) {
      git.statuses++
      const rel = (f: string) => f.slice(top.length + 1)
      const rows = [...new Set([...Object.keys(head), ...Object.keys(files)])].filter(f => f.startsWith(`${top}/`)).flatMap(f =>
        !(f in head) ? [`?? ${rel(f)}`] : !(f in files) ? [` D ${rel(f)}`] : head[f] !== files[f] ? [` M ${rel(f)}`] : [])
      return ok(rows.map(r => `${r}\0`).join(''))
    }
    const shown = argv.find(a => a.startsWith('HEAD:'))
    if (shown) return `${top}/${shown.slice(5)}` in head ? ok(head[`${top}/${shown.slice(5)}`]!) : { value: { exitCode: 128, stdout: '', stderr: 'bad' } }
    return { value: { exitCode: 1, stdout: '', stderr: '' } }
  })
  return { seen, git }
}

test('a script that edits a clean tracked file keeps its command and output, and a press opens the file and its diff from HEAD', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  const ui = await useRow($, call('b1', 'Bash', { command: 'python fix.py' }))
  expect(await textOf(ui, 'fold:b1')).toBe('● Ran (python fix.py)  +1 −1')
  await click(ui, 'fold:b1')
  expect(await treeOf(ui)).toEqual(['  └ Updated (a.txt)  +1 −1'])
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -1,1 +1,1 @@\n-a\n+b')
  const result = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: 'ok' }, isErrored: false }, viewport: VIEW })
  expect((await result.find({ type: 'Text' }))?.text).toBeUndefined()
})

test('a script row keeps the native result without the engine diff', async ($, on) => {
  const seen: any[] = []
  on('session.cwd', () => ({ value: '/p' }))
  on('session.root', () => ({ value: '/p' }))
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text' as const, children: ['native'] }))
  on('ui.render', { component: 'ToolResult' }, (_: any, e: any) => { seen.push(e.props.output); return { type: 'Text' as const, children: ['native block'] } })
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: 'ok', bashEditDiff: { files: [{ filePath: '/p/a.txt', hunks: [] }] } }, isErrored: false }, viewport: VIEW })
  expect(seen).toEqual([{ stdout: 'ok' }])
})

const scriptResult = async ($: any, isErrored = false) => {
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: 'ok' }, isErrored }, viewport: VIEW })
  const text = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return text
}

test('a script result draws nothing, closed or open', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  const ui = await useRow($, call('b1', 'Bash', { command: 'python fix.py' }))
  expect(await scriptResult($)).toBeUndefined()
  await click(ui, 'fold:b1')
  expect(await scriptResult($)).toBeUndefined()
})

const openScript = async ($: any, on: any, output: object) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  const ui = await useRow($, call('b1', 'Bash', { command: 'python fix.py' }, { output }))
  await click(ui, 'fold:b1')
  return ui
}
const outRows = async (ui: any) => (await ui.findAll({ type: 'Text' })).filter((x: any) => x.props.wrap === 'truncate-end' && /^ {2,4}[└ ]/.test(x.text))

test('an open script row draws its output as the last branch, and its result draws nothing', async ($, on) => {
  const ui = await openScript($, on, { stdout: 'created\n' })
  expect(await treeOf(ui)).toEqual(['  ├ Updated (a.txt)  +1 −1', '  └ created'])
  expect(await scriptResult($)).toBeUndefined()
})

test('a script output of six lines shows three and a count of the rest', async ($, on) => {
  const ui = await openScript($, on, { stdout: '1\n2\n3\n4\n5\n6\n\n' })
  expect((await outRows(ui)).map((x: any) => x.text)).toEqual(['  └ 1', '    2', '    3', '    … +3 lines'])
})

test('script stderr draws in the error colour after stdout', async ($, on) => {
  const ui = await openScript($, on, { stdout: 'out', stderr: 'bad\n' })
  const rows = await outRows(ui)
  expect(rows.map((x: any) => x.text)).toEqual(['  └ out', '    bad'])
  expect(rows[1].children.at(-1).props.color).toBe('error')
})

test('a script with no output ends its tree on the file row', async ($, on) => {
  const ui = await openScript($, on, { stdout: '', stderr: '' })
  expect(await treeOf(ui)).toEqual(['  └ Updated (a.txt)  +1 −1'])
})

test('an errored script call shows its output while closed', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  await useRow($, call('b1', 'Bash', { command: 'python fix.py' }))
  expect(await scriptResult($, true)).toBe('native block')
})

test('off the fullscreen layout a script write keeps the engine row', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'python fix.py')
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolUse', requestId: 'b1',
    props: call('b1', 'Bash', { command: 'python fix.py' }), viewport: { columns: 80, rows: 20 } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('native')
})

test('a script after a leading cd into a subfolder is checked in the repo', async ($, on) => {
  native(on)
  gitFs(on, {}, {}, files => (files['/p/sub/b.txt'] = 'x\n'))
  await bash($, 'cd sub && ./fix.sh')
  expect(await textOf(await useRow($, call('b1', 'Bash', { command: 'cd sub && ./fix.sh' })), 'fold:b1')).toBe('● Ran (cd sub && ./fix.sh)  +1')
})

test('a script after a leading cd into a repo outside the session root runs no git', async ($, on) => {
  native(on)
  const { git } = gitFs(on, { '/q/a.txt': 'a\n' }, { '/q/a.txt': 'a\n' }, files => (files['/q/a.txt'] = 'b\n'))
  await bash($, 'cd /q && ./fix.sh')
  expect(git.statuses).toBe(0)
  expect(await textOf(await useRow($, call('b1', 'Bash', { command: 'cd /q && ./fix.sh' })), 'fold:b1')).toBe('native')
})

test('a script that makes an untracked file draws it as created', async ($, on) => {
  native(on)
  gitFs(on, {}, {}, files => (files['/p/new.txt'] = 'x\ny\n'))
  await bash($, './gen.sh')
  const ui = await useRow($, call('b1', 'Bash', { command: './gen.sh' }))
  expect(await textOf(ui, 'fold:b1')).toBe('● Ran (./gen.sh)  +2')
  await click(ui, 'fold:b1')
  expect(await treeOf(ui)).toEqual(['  └ Created (new.txt)  +2'])
})

test('a script counts a file already dirty against its text before the call, and skips dirty files it left alone', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n', '/p/b.txt': 'b\n' }, { '/p/a.txt': 'a\nx\n', '/p/b.txt': 'b\ny\n' }, files => (files['/p/a.txt'] = 'a\nx\nz\n'))
  await bash($, 'node patch.mjs')
  expect(await textOf(await useRow($, call('b1', 'Bash', { command: 'node patch.mjs' })), 'fold:b1')).toBe('● Ran (node patch.mjs)  +1')
})

const many = (n: number, text = 'x\n') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`/p/f${i}.txt`, text]))
for (const [name, files, write] of [
  ['over 100 files dirty before it', many(101), { '/p/a.txt': 'b\n' }],
  ['over 100 files it made dirty', {}, many(101)],
  ['a binary file', {}, { '/p/a.bin': 'a\0b\n' }],
] as const) {
  test(`a script with ${name} keeps the engine row`, async ($, on) => {
    native(on)
    gitFs(on, {}, { ...files }, f => Object.assign(f, write))
    await bash($, './s.sh')
    expect(await textOf(await useRow($, call('b1', 'Bash', { command: './s.sh' })), 'fold:b1')).toBe('native')
  })
}

test('a folder that becomes a repo mid-session gets script writes', async ($, on) => {
  native(on)
  const { git } = gitFs(on, {}, {}, files => (files['/p/new.txt'] = `${files['/p/new.txt'] ?? ''}x\n`))
  git.noRepo = true
  await bash($, 'git init', 'b1')
  git.noRepo = false
  await bash($, './gen.sh', 'b2')
  expect(await textOf(await useRow($, call('b2', 'Bash', { command: './gen.sh' })), 'fold:b2')).toBe('● Ran (./gen.sh)  +1')
})

test('a command that changes nothing keeps the engine group', async ($, on) => {
  native(on)
  gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\nx\n' })
  await bash($, 'ls -la')
  expect(await groupOf($, [call('b1', 'Bash', { command: 'ls -la' })])).toBe('● Ran (1 command)')
})

test('a command with parsed write targets runs no git status', async ($, on) => {
  native(on)
  const { git } = gitFs(on, { '/p/a.txt': 'a\n' }, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt')
  expect(git.statuses).toBe(0)
})

test('hideEditDiff false keeps Bash edits native and their group folded', async ($, on) => {
  native(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('process.run', (() => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '' } })) as any)
  bashFs(on, { '/cfg/claudzilla.json': off, '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await $.session.start(start)
  await bash($, 'echo b > a.txt')
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: 'x' })))).toEqual([])
  expect(await groupOf($, [call('b1', 'Bash', { command: 'x' })])).toBe('expanded:false')
})

test('a session end forgets Bash edits', async ($, on) => {
  native(on)
  on('session.end', () => ({ sessionId: 's1' }))
  bashFs(on, { '/p/a.txt': 'a\n' }, files => (files['/p/a.txt'] = 'b\n'))
  await bash($, 'echo b > a.txt')
  await $.session.end({ reason: 'clear' } as any)
  expect(await groupOf($, [call('b1', 'Bash', { command: 'x' })])).toBe('● Ran (1 command)')
})

test('rows name files from the session root, not the folder a shell cd left', async ($, on) => {
  const live = { value: '/p' }
  native(on, live, { value: '/p' })
  const writes = [{ '/p/a.txt': 'x\n' }, { '/p/new.txt': 'n\nm\n' }, { '/p/sub/b.txt': 'b\nc\n' }]
  bashFs(on, { '/p/a.txt': 'a\n', '/p/sub/b.txt': 'b\n' }, files => Object.assign(files, writes.shift()))
  const commands = ["sed -i 's/a/x/' a.txt", 'printf "n\\nm\\n" > new.txt', 'cd sub && echo c >> b.txt']
  for (const [i, command] of commands.entries()) await bash($, command, `b${i}`)
  live.value = '/p/sub'
  const rows = []
  for (const [i, command] of commands.entries()) rows.push(await textOf(await useRow($, call(`b${i}`, 'Bash', { command })), `fold:b${i}`))
  expect(rows).toEqual(['● Updated (a.txt)  +1 −1', '● Created (new.txt)  +2', '● Updated (sub/b.txt)  +1'])
  expect(await textOf(await mountRow($, 'Edit', patch('-a', '+b'), {}, '/p/a.txt', 'e1'), 'e1')).toBe('● Updated (a.txt)  +1 −1')
})

// Core's spawn of Agent call a1 as agent g1 on `model`; then g1's first request, at `effort`.
async function spawnAgent($: any, on: any, model: string, effort?: string) {
  on('agent.spawn', () => ({ model, agentId: 'g1' }) as any)
  on('turn.step', async function* (_: any, e: any) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } } as any)
  await $.agent.spawn({ prompt: 'p', description: 'Slow task', tool_use_id: 'a1' } as any)
  if (effort) for await (const _ of $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1, agentId: 'g1' } as any));
}

test('a running agent row tags the model it spawned on and the effort its requests ask', async ($, on) => {
  native(on)
  await spawnAgent($, on, 'claude-opus-5-5', 'high')
  const ui = await mountRow($, 'Agent', undefined, { input: { description: 'Fix login bug', effort: 'max' }, isRunning: true }, '/p/a.txt', 'a1')
  expect(await textOf(ui, 'a1')).toBe('● Agent (Fix login bug) [opus · high]  running')
  expect((await ui.find({ type: 'Text', text: /^opus · high$/ }))?.props.color).toBe('inactive')
  expect((await ui.find({ type: 'Text', text: /^ \[$/ }))?.props.color).toBe('promptBorder')
})

for (const [name, input, output, want] of [
  ['a finished agent takes its resolved model over the input one', { description: 'Find callers', model: 'haiku', effort: 'medium' },
    { ...agentDone, resolvedModel: 'claude-sonnet-5-5' }, '● Agent (Find callers) [sonnet · medium]  done'],
  ['a finished agent with only an input model', { description: 'd', model: 'haiku' }, agentDone, '● Agent (d) [haiku]  done'],
  ['a backgrounded agent with only an effort', { description: 'Review diff', effort: 'low' },
    { status: 'async_launched', agentId: 'a1', description: 'Review diff', prompt: 'p', outputFile: '/o' }, '● Agent (Review diff) [low]  backgrounded'],
] as const) {
  test(`${name}: ${want}`, async ($, on) => {
    native(on)
    expect(await drawn($, 'Agent', output, { input })).toBe(want)
  })
}

test("a background agent's finish row keeps its tag", async ($, on) => {
  finished(on)
  await spawnAgent($, on, 'claude-haiku-5-5', 'medium')
  expect(await textOf(await notice($, { status: 'completed', durationMs: 9_000 }))).toBe('● Agent (Slow task) [haiku · medium]  done · 9s')
})

test("a finish row takes the spawn's description when the call's row drew none", async ($, on) => {
  finished(on)
  await spawnAgent($, on, 'claude-haiku-5-5', 'medium')
  await mountRow($, 'Agent', launched, { input: {} }, '/p/a.txt', 'a1')
  const ui = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'UserMessage', requestId: 'n1',
    props: { text: 'n', origin: { kind: 'task-notification' }, isExpanded: false, task: { toolUseId: 'a1', status: 'completed', durationMs: 1_000 } }, viewport: VIEW })
  expect(await textOf(ui)).toBe('● Agent (Slow task) [haiku · medium]  done · 1s')
})

const reloaded = (command: string, hunks: object[], output: object = {}) =>
  call('b1', 'Bash', { command }, { output: { stdout: 'created\n', stderr: '', bashEditDiff: { files: [{ filePath: '/p/f.txt', hunks }] }, ...output } })
const HUNK = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: [' k', '-a', '+b'] }

for (const command of ["python - <<'EOF'\nopen('f.txt','w')\nEOF", 'python fix.py']) {
  test(`a reloaded Bash edit with an engine diff folds as a script: ${command.split('\n')[0]}`, async ($, on) => {
    native(on)
    const ui = await useRow($, reloaded(command, [HUNK]))
    expect(await textOf(ui, 'b1')).toMatch(/^● Ran \(.*\)  \+1 −1$/)
    await click(ui, 'fold:b1')
    expect(await treeOf(ui)).toEqual(['  ├ Updated (f.txt)  +1 −1', '  └ created'])
    expect(await rowsOf(ui)).toEqual([])
    const result = await $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
      props: { tool_use_id: 'b1', tool: 'Bash', output: { stdout: 'created\n', bashEditDiff: { files: [{ filePath: '/p/f.txt', hunks: [HUNK] }] } }, isErrored: false }, viewport: VIEW })
    expect((await result.find({ type: 'Text' }))?.text).toBeUndefined()
  })
}

for (const command of ['echo x > f.txt', "sed -i 's/a/b/' f.txt"]) {
  test(`a reloaded Bash write the parse sees folds as its edit, not a script: ${command}`, async ($, on) => {
    native(on)
    const ui = await useRow($, reloaded(command, [HUNK]))
    expect(await textOf(ui, 'b1')).toBe('● Updated (f.txt)  +1 −1')
  })
}

test('a reloaded Bash edit opens its diff on a press of the file row', async ($, on) => {
  native(on)
  const ui = await useRow($, reloaded('python fix.py', [HUNK]))
  await click(ui, 'fold:b1')
  await click(ui, 'file:b1:0')
  expect(await diffOf(ui)).toBe('@@ -1,2 +1,1 @@\n k\n-a\n+b')
})

test('a reloaded Bash edit with one hunk and no old lines is a new file', async ($, on) => {
  native(on)
  // The engine's bashEditDiff for a new file: @@ -1,0 +1,N @@.
  const ui = await useRow($, reloaded('python fix.py', [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }]))
  await click(ui, 'fold:b1')
  expect((await treeOf(ui))[0]).toBe('  ├ Created (f.txt)  +1')
})

test('a ToolResult drawn first keeps the engine diff until the row records the edit', async ($, on) => {
  const seen = seenResult(on)
  await reloadedResult($)
  expect(seen).toEqual([RELOADED_OUT])
  expect(await textOf(await useRow($, reloaded('python fix.py', [HUNK])), 'b1')).toMatch(/^● Ran \(.*\)  \+1 −1$/)
  expect(seen.at(-1)).toEqual({ stdout: 'ok' })
})

const seenResult = (on: any) => {
  const seen: any[] = []
  on('session.cwd', () => ({ value: '/p' }))
  on('session.root', () => ({ value: '/p' }))
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text' as const, children: ['native'] }))
  on('ui.render', { component: 'ToolResult' }, (_: any, e: any) => { seen.push(e.props.output); return { type: 'Text' as const, children: ['native block'] } })
  return seen
}
const RELOADED_OUT = { stdout: 'ok', bashEditDiff: { files: [{ filePath: '/p/f.txt', hunks: [HUNK] }] } }
const reloadedResult = ($: any, extra: object = {}) =>
  $.ui.mount({ plugin: 'folio', surface: 'terminal', component: 'ToolResult', requestId: 'b1',
    props: { tool_use_id: 'b1', tool: 'Bash', output: RELOADED_OUT, isErrored: false, ...extra }, viewport: VIEW })

test('with hideEditDiff false a reloaded Bash result keeps the engine diff', async ($, on) => {
  const seen = seenResult(on)
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : undefined }))
  on('process.run', (() => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '' } })) as any)
  on('fs.read', (_: any, e: any) => (e.path === '/cfg/claudzilla.json' ? { value: off } : { deny: 'ENOENT' }))
  await $.session.start(start)
  await (await reloadedResult($)).unmount()
  await useRow($, reloaded('python fix.py', [HUNK]))
  await reloadedResult($)
  expect(seen).toEqual([RELOADED_OUT, RELOADED_OUT])
})

test('an expanded reloaded Bash result keeps the engine diff', async ($, on) => {
  const seen = seenResult(on)
  await (await reloadedResult($, { isExpanded: true })).unmount()
  await useRow($, reloaded('python fix.py', [HUNK]), { isExpanded: true })
  await reloadedResult($, { isExpanded: true })
  expect(seen).toEqual([RELOADED_OUT, RELOADED_OUT])
})

test('a Bash result without bashEditDiff and a record keeps today\'s row', async ($, on) => {
  native(on)
  expect(await rowsOf(await useRow($, call('b1', 'Bash', { command: 'python fix.py' })))).toEqual([])
})
