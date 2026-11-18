import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { CUT, gitArgs, latestOf, listDir, loadFile, projectRoot, statOf } from '../hooks/explorer-load'
import { cellsOf, expandTabs, fileWindow, layoutFor, layoutOf, lineAt, sliceTokens, thumbOf } from '../hooks/explorer-layout'
import { MAX_HISTORY, back, current, forward, navStart, remember, visit } from '../hooks/explorer-nav'
import { tokenize } from '../hooks/explorer-tokens'
import { iconOf, sortListing, treeRows } from '../hooks/explorer-tree'
import { disk, explorer, explorerRoot, mountPane, open, pathText, ran, lines, setup, store, textOf } from './explorer-helpers'

test('tokenize: a keyword, a string, a comment and a number', () => {
  expect(tokenize('const s = "a" // x 42')).toEqual([
    { text: 'const', kind: 'keyword' },
    { text: ' s = ', kind: 'plain' },
    { text: '"a"', kind: 'string' },
    { text: ' ', kind: 'plain' },
    { text: '// x 42', kind: 'comment' },
  ])
  expect(tokenize('n = 3.5').find(t => t.kind === 'number')?.text).toBe('3.5')
})

test('tokenize keeps every character in order', () => {
  const line = 'if (x) { return "a\\"b" + `t` } # 0x1F'
  expect(tokenize(line).map(t => t.text).join('')).toBe(line)
})

test('tokenize: a string unclosed at the line end runs to it', () => {
  expect(tokenize('say "hi')).toEqual([
    { text: 'say ', kind: 'plain' },
    { text: '"hi', kind: 'string' },
  ])
})

test('tokenize: a double slash inside a string is not a comment', () => {
  expect(tokenize('"http://x"').map(t => t.kind)).toEqual(['string'])
})

test('tokenize: a hash inside a word does not start a comment', () => {
  const kinds = tokenize('this.#count; return x')
  expect(kinds.find(t => t.text === 'return')?.kind).toBe('keyword')
  expect(kinds.some(t => t.kind === 'comment')).toBe(false)
})

const text = (tokens: { text: string }[]) => tokens.map(t => t.text).join('')

test('tabs stop every 4 cells', () => {
  expect(expandTabs('a\tb')).toBe('a   b')
  expect(expandTabs('abcd\te')).toBe('abcd    e')
})

test('wide glyphs count 2 cells, a code point at a time', () => {
  expect(cellsOf('中a')).toBe(3)
  expect(cellsOf('😀')).toBe(2)
  expect(cellsOf('✅\u{1F680}')).toBe(4)
})

test('a slice keeps the token kind of the cells it shows', () => {
  expect(sliceTokens(tokenize('const x = 1'), 2, 4)).toEqual([
    { text: 'nst', kind: 'keyword' },
    { text: ' ', kind: 'plain' },
  ])
})

test('a slice starting inside a wide glyph shows a space for its right half', () => {
  expect(text(sliceTokens(tokenize('中ab'), 1, 3))).toBe(' ab')
  expect(text(sliceTokens(tokenize('中ab'), 0, 3))).toBe('中a')
  expect(sliceTokens(tokenize('"中"'), 2, 1)[0]).toEqual({ text: ' ', kind: 'plain' })
})

test('a wide glyph crossing the right edge becomes a space, no overflow', () => {
  expect(text(sliceTokens(tokenize('ab中'), 0, 3))).toBe('ab ')
})

test('no wrap: one row per line, widest counted after tabs', () => {
  const l = layoutOf(['a', 'bbbbbbbbbb', '', 'x\ty'], 4, false)
  expect(l.rows).toBe(4)
  expect(lineAt(l, 2)).toBe(2)
  expect(l.widest).toBe(10)
})

test('wrap breaks a line at the exact column', () => {
  const l = layoutOf(['abcdefghij'], 4, true)
  expect(l.rows).toBe(3)
  expect(lineAt(l, 2)).toBe(0)
  expect(l.starts[1]).toBe(3)
})

test('wrap: an empty line still takes one row', () => {
  expect(layoutOf(['', 'ab'], 4, true).rows).toBe(2)
})

test('the window clamps the top to both ends', () => {
  expect(fileWindow(100, 95, 10)).toEqual({ top: 90, last: 100 })
  expect(fileWindow(100, -5, 10)).toEqual({ top: 0, last: 10 })
  expect(fileWindow(4, 0, 10)).toEqual({ top: 0, last: 4 })
})

test('the thumb is the shown share of the cells, at least one', () => {
  expect(thumbOf(100, 20, 0, 10)).toEqual({ from: 0, to: 2 })
  expect(thumbOf(100, 20, 80, 10)).toEqual({ from: 8, to: 10 })
  expect(thumbOf(1000000, 1, 0, 10)).toEqual({ from: 0, to: 1 })
})

test('the layout cache returns the same layout while its inputs are unchanged', () => {
  const loaded = {}
  const lines = ['abc']
  const first = layoutFor(undefined, loaded, 10, false, lines)
  expect(layoutFor(first, loaded, 10, false, lines)).toBe(first)
  expect(layoutFor(first, loaded, 5, false, lines)).not.toBe(first)
  expect(layoutFor(first, loaded, 10, true, lines)).not.toBe(first)
  expect(layoutFor(first, {}, 10, false, lines)).not.toBe(first)
})

const file = (path: string, line?: number) => ({ kind: 'file' as const, path, line })

test('a file opened again with no line adds no step', () => {
  const nav = visit(navStart('/r'), file('/r/a.ts'))
  expect(visit(nav, file('/r/a.ts'))).toBe(nav)
})

test('a line jump in the file shown adds a step, and back returns to the line before', () => {
  let nav = visit(navStart('/r'), file('/r/a.ts', 5))
  nav = remember(nav, 3, 5)
  nav = visit(nav, file('/r/a.ts', 40))
  expect(nav.entries).toHaveLength(3)
  expect(current(back(nav))).toEqual({ kind: 'file', path: '/r/a.ts', line: 5, top: 3 })
})

test('a folder shown again adds no step', () => {
  const nav = navStart('/r')
  expect(visit(nav, { kind: 'folder', path: '/r' })).toBe(nav)
})

test('opening a place while back drops the forward entries', () => {
  let nav = visit(navStart('/r'), file('/r/a.ts'))
  nav = visit(nav, file('/r/b.ts'))
  nav = back(nav)
  nav = visit(nav, file('/r/c.ts'))
  expect(nav.entries.map(p => p.path)).toEqual(['/r', '/r/a.ts', '/r/c.ts'])
})

test('back at the first entry and forward at the last change nothing', () => {
  const nav = navStart('/r')
  expect(back(nav)).toBe(nav)
  expect(forward(nav)).toBe(nav)
})

test('history holds 20 entries, and the oldest drops', () => {
  let nav = navStart('/r')
  for (let i = 0; i < 25; i++) nav = visit(nav, file(`/r/f${i}.ts`))
  expect(MAX_HISTORY).toBe(20)
  expect(nav.entries).toHaveLength(20)
  expect(nav.entries[0]!.path).toBe('/r/f5.ts')
  expect(nav.at).toBe(19)
})

const glyph = (hex: number) => String.fromCharCode(hex)

test('folders list before files, each by name', () => {
  expect(sortListing([{ name: 'b.ts', kind: 'file' }, { name: 'src', kind: 'dir' }, { name: 'a', kind: 'dir' }]).map(e => e.name)).toEqual(['a', 'src', 'b.ts'])
})

test('treeRows sorts each folder and indents a child folder 1 column, a child file 2', () => {
  const listed = new Map([
    ['/p', [{ name: 'src', kind: 'dir' as const }, { name: 'R.md', kind: 'file' as const }]],
    ['/p/src', [{ name: 'x.ts', kind: 'file' as const }, { name: 'lib', kind: 'dir' as const }]],
    ['/p/src/lib', [{ name: 'y.ts', kind: 'file' as const }]],
  ])
  const rows = treeRows('/p', new Set(['/p/src', '/p/src/lib']), listed)
  expect(rows.map(r => [r.name, r.x])).toEqual([['src', 0], ['lib', 1], ['y.ts', 3], ['x.ts', 2], ['R.md', 0]])
})

test('an empty folder is known as empty, and a closed folder is not open', () => {
  const listed = new Map([['/p', [{ name: 'e', kind: 'dir' as const }]], ['/p/e', []]])
  const [row] = treeRows('/p', new Set(), listed)
  expect(row).toMatchObject({ name: 'e', empty: true, open: false })
})

test('names starting with a dot are dim, and so is everything inside them', () => {
  const listed = new Map([['/p', [{ name: '.github', kind: 'dir' as const }]], ['/p/.github', [{ name: 'ci.yml', kind: 'file' as const }]]])
  expect(treeRows('/p', new Set(['/p/.github']), listed).map(r => r.dim)).toEqual([true, true])
})

test('a broken link lists as a faint file', () => {
  const [row] = treeRows('/p', new Set(), new Map([['/p', [{ name: 'l', kind: 'file' as const, broken: true }]]]))
  expect(row).toMatchObject({ kind: 'file', broken: true })
})

test('icons: folder open and closed, empty, and the file types', () => {
  expect(iconOf('src', 'dir', { open: false, empty: false })).toEqual({ glyph: glyph(0xf07b), color: 'claude' })
  expect(iconOf('src', 'dir', { open: true, empty: false }).glyph).toBe(glyph(0xf07c))
  expect(iconOf('src', 'dir', { open: false, empty: true }).glyph).toBe(glyph(0xf07c))
  expect(iconOf('a.ts', 'file').glyph).toBe(glyph(0xe628))
  expect(iconOf('a.tsx', 'file').glyph).toBe(glyph(0xe628))
  expect(iconOf('a.md', 'file')).toEqual({ glyph: glyph(0xe609), color: 'docs' })
  expect(iconOf('a.json', 'file').glyph).toBe(glyph(0xe60b))
  expect(iconOf('a.py', 'file')).toEqual({ glyph: glyph(0xe606), color: 'test' })
  expect(iconOf('a.sh', 'file')).toEqual({ glyph: glyph(0xe795), color: 'feat' })
  expect(iconOf('a.bin', 'file')).toEqual({ glyph: glyph(0xf15b), color: 'faint' })
})

test('an extension named like an object member gets the faint file icon', () => {
  expect(iconOf('a.constructor', 'file')).toEqual({ glyph: glyph(0xf15b), color: 'faint' })
})

// The test client has no fs, process or session; this stands for the engine `$` the loaders take.
const engine = () => {
  const handlers = new Map<string, (_: unknown, e: any) => any>()
  const call = (name: string) => async (arg: unknown) => {
    const out = await handlers.get(name)!(undefined, name === 'process.run' ? { argv: arg } : { path: arg })
    if (out && 'deny' in out) throw new Error(out.deny)
    return out?.value
  }
  const $ = {
    process: { run: call('process.run') },
    fs: { stat: call('fs.stat'), read: call('fs.read'), list: call('fs.list') },
    session: { cwd: call('session.cwd') },
  } as unknown as EngineInterface
  return { $, on: (name: string, fn: (_: unknown, e: any) => any) => void handlers.set(name, fn) }
}

test('every git run carries --no-optional-locks and quotePath off, before the subcommand', async () => {
  const { $, on } = engine()
  const argvs: string[][] = []
  on('process.run', (_, e) => (argvs.push([...e.argv]), ran(0, '/repo\n')))
  expect(await projectRoot($)).toBe('/repo')
  expect(gitArgs('status')).toEqual(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status'])
  for (const argv of argvs) expect(argv.slice(0, 4)).toEqual(['git', '--no-optional-locks', '-c', 'core.quotePath=false'])
})

test('outside a repo, or with an empty answer, the root is the session working directory', async () => {
  const { $, on } = engine()
  on('session.cwd', () => ({ value: '/home/me/notes' }))
  let answer = ran(128)
  on('process.run', () => answer)
  expect(await projectRoot($)).toBe('/home/me/notes')
  answer = ran(0, '')
  expect(await projectRoot($)).toBe('/home/me/notes')
})

test('statOf is undefined for a missing path', async () => {
  const { $, on } = engine()
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  expect(await statOf($, '/r/none')).toBeUndefined()
})

test('a missing file loads as missing, and never throws', async () => {
  const { $, on } = engine()
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  expect(await loadFile($, '/r/gone.ts')).toMatchObject({ missing: true, unreadable: true, lines: [] })
})

test('a file holding a NUL byte is unreadable, under 4 MiB', async () => {
  const { $, on } = engine()
  on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: 'ab\0cd' }))
  expect(await loadFile($, '/r/a.bin')).toMatchObject({ unreadable: true, missing: false })
})

test('a file over the read cap is unreadable', async () => {
  const { $, on } = engine()
  on('fs.stat', () => ({ value: { kind: 'file', size: 5_000_000, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => {
    throw new Error('over 4 MiB')
  })
  expect(await loadFile($, '/r/big.log')).toMatchObject({ unreadable: true, missing: false })
})

test('a text file splits on CRLF, drops the last newline, cuts lines at CUT; an empty file has no lines', async () => {
  const { $, on } = engine()
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => ({ value: `a\r\nb\r\n${'x'.repeat(CUT + 10)}\n` }))
  const loaded = await loadFile($, '/r/a.ts')
  expect(loaded.lines.slice(0, 2)).toEqual(['a', 'b'])
  expect(loaded.lines[2]).toHaveLength(CUT)
  on('fs.read', () => ({ value: '' }))
  expect((await loadFile($, '/r/empty.ts')).lines).toEqual([])
})

test('a link lists as its target kind; a broken link as a faint file; a failed list as none', async () => {
  const { $, on } = engine()
  on('fs.list', () => ({ value: [
    { name: 'dirlink', kind: 'other', size: 0, mtimeMs: 0, isLink: true },
    { name: 'broken', kind: 'other', size: 0, mtimeMs: 0, isLink: true },
    { name: 'a.ts', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
  ] }))
  on('fs.stat', (_, e) => (e.path.endsWith('dirlink') ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true } } : { deny: 'ENOENT' }))
  expect(await listDir($, '/r')).toEqual([
    { name: 'dirlink', kind: 'dir' },
    { name: 'broken', kind: 'file', broken: true },
    { name: 'a.ts', kind: 'file' },
  ])
  on('fs.list', () => ({ deny: 'ENOENT' }))
  expect(await listDir($, '/gone')).toEqual([])
})

test('only the newest begun load is latest', () => {
  const guard = latestOf()
  const a = guard.begin()
  const b = guard.begin()
  expect(guard.isLatest(a)).toBe(false)
  expect(guard.isLatest(b)).toBe(true)
})

test('a path that is not a plain file is unreadable and never read', async () => {
  const { $, on } = engine()
  let reads = 0
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 1, isLink: false } }))
  on('fs.read', () => (reads++, { value: 'x' }))
  expect(await loadFile($, '/r/pipe')).toMatchObject({ unreadable: true, missing: false, lines: [] })
  expect(reads).toBe(0)
})

// Probe, first: an answered `file` place shows in the mounted pane.
test('probe: the file atom place shows in the mounted pane', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\n')
  expect(await pathText(ui)).toBe('repo/a.ts')
})

test('a file shows its lines numbered, the clicked line lit', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts', line: 65 }, lines(200))
  expect(textOf(await ui.find({ key: 'row:65' }))).toMatch(/^ +65 /)
  expect((await ui.find({ key: 'row:65' }))?.props.backgroundColor).toBe('#0f1c28')
})

test('the header starts at the project root name', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  expect(await pathText(ui)).toBe('repo/src/a.ts')
})

test('a file outside the project root shows its path from ~', async ($, on) => {
  const ui = await explorer($, on, { path: '/home/me/notes.md' }, lines(3))
  expect(await pathText(ui)).toBe('~/notes.md')
})

test('a NUL byte shows the unreadable panel, with no path line in it', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.bin' }, 'ab\0cd')
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'It is binary, unreadable or over 4 MiB.' })).toBeDefined()
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
})

test('an empty file shows no panel', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/empty.ts' }, '')
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeUndefined()
})

test('keywords take the shared label colour, strings the feat colour', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'const s = "x"')
  expect((await ui.find({ type: 'Text', text: 'const' }))?.props.color).toBe('#a396d2')
  expect((await ui.find({ type: 'Text', text: '"x"' }))?.props.color).toBe('#98c379')
})

test('control characters show as spaces, and tabs stop at 4', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.log' }, 'one\n\x1b[31mred\x1b[0m\n\fpage\tend\n')
  expect(textOf(await ui.find({ key: 'row:2' }))).toContain(' [31mred [0m')
  // The tab after ' page' (5 cells) stops at cell 8: 3 spaces.
  expect(textOf(await ui.find({ key: 'row:3' }))).toContain(' page   end')
})

test('the wheel moves the view by notches, so a press reaches the plugin module memory', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, lines(200))
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 3, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 0, row: 6 } })
  // The answered `file` key is no engine read, so the pane is not subscribed to it: redraw by hand.
  await ui.redraw()
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
})

test('a line jump lights its line, and reopening with no line keeps the remembered spot', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 5 }, lines(50))
  expect((await ui.find({ key: 'row:5' }))?.props.backgroundColor).toBe('#0f1c28')
  open({ path: '/repo/a.ts' })
  await ui.redraw()
  expect((await ui.find({ key: 'row:5' }))?.props.backgroundColor).toBe('#0f1c28')
  open({ path: '/repo/a.ts', line: 40 })
  await ui.redraw()
  expect((await ui.find({ key: 'row:40' }))?.props.backgroundColor).toBe('#0f1c28')
})

test('an empty file opened at a line, then another file at a line, still draws code rows', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/empty.ts', line: 1 }, '')
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
  disk.set('/repo/b.ts', { text: lines(50), mtimeMs: 1 })
  open({ path: '/repo/b.ts', line: 40 })
  await ui.redraw()
  expect((await ui.find({ key: 'row:40' }))?.props.backgroundColor).toBe('#0f1c28')
})

test('a line past the end centres on the last line', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 999 }, lines(50))
  expect(await ui.find({ key: 'row:50' })).toBeDefined()
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
})

test('a long header path is cut from the left with an ellipsis', async ($, on) => {
  const ui = await explorer($, on, { path: `/repo/${'deep/'.repeat(20)}a.ts` }, lines(3))
  const head = await pathText(ui)
  expect(head).toMatch(/^….*\/a\.ts$/)
  expect(head.length).toBeLessThanOrEqual(36)
})

test('with no file open the pane says so', async ($, on) => {
  const ui = await explorerRoot($, on)
  expect(await ui.find({ type: 'Text', text: 'No file open' })).toBeDefined()
})

test('a file that is gone shows it no longer exists', async ($, on) => {
  await setup($, on)
  open({ path: '/repo/gone.ts' })
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'It no longer exists.' })).toBeDefined()
})

test('back returns to the file shown before, at its line', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 5 }, lines(50))
  disk.set('/repo/b.ts', { text: lines(5), mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/b.ts')
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/a.ts')
  expect((await ui.find({ key: 'row:5' }))?.props.backgroundColor).toBe('#0f1c28')
})

test('forward returns to the file after back', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(5))
  disk.set('/repo/b.ts', { text: lines(5), mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/a.ts')
  await ui.press({ key: 'forward' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/b.ts')
})

test('path segments: the root and each folder are links, the last part is plain text', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  expect(await ui.find({ type: 'Button', key: '/repo' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: '/repo/src' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: '/repo/src/a.ts' })).toBeUndefined()
  expect(await pathText(ui)).toBe('repo/src/a.ts')
})

test('a folder place in the file atom shows no file, not the unreadable panel', async ($, on) => {
  await setup($, on)
  store.set('file', { rev: 900000, path: '/repo', kind: 'folder' })
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'No file open' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeUndefined()
})
