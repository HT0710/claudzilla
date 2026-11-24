import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { CUT, OPEN_EDITOR_SH, gitArgs, latestOf, listDir, listNames, loadFile, projectRoot, statOf } from '../hooks/explorer-load'
import { markCells } from '../hooks/explorer-find'
import { cellsOf, expandTabs, fileWindow, layoutFor, layoutOf, lineAt, sliceTokens, thumbOf } from '../hooks/explorer-layout'
import { MAX_HISTORY, back, current, forward, navStart, remember, visit } from '../hooks/explorer-nav'
import { tokenize } from '../hooks/explorer-tokens'
import { iconOf, sortListing, treeRows } from '../hooks/explorer-tree'
import { fieldPad, refOf } from '../hooks/tab-file'
import { fileKey } from '../hooks/git-data'
import { LIT } from '../hooks/kit'
import { clock, disk, props, chevron, tapTree, treeRow, explorer, explorerRoot, failList, hold, lists, mountPane, launch, open, pathText, ran, reads, runs, lines, listed, setup, sets, store, textOf, tree, waitFor } from './explorer-helpers'

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

test('a file opened again from another place starts where it was left', () => {
  let nav = visit(navStart('/r'), file('/r/a.ts'))
  nav = back(remember(nav, 200))
  nav = visit(nav, file('/r/a.ts'))
  expect(current(nav)).toEqual({ kind: 'file', path: '/r/a.ts', top: 200 })
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
  const call = (name: string) => async (arg: unknown, init?: unknown) => {
    const out = await handlers.get(name)!(undefined, name === 'process.run' ? { argv: arg, init } : { path: arg })
    if (out && 'deny' in out) throw new Error(out.deny)
    return out?.value
  }
  const $ = {
    process: { run: call('process.run') },
    fs: { stat: call('fs.stat'), read: call('fs.read'), list: call('fs.list') },
    session: { cwd: call('session.cwd'), root: call('session.root') },
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

test('the root comes from where the session started, not where the shell moved to', async () => {
  const { $, on } = engine()
  on('session.root', () => ({ value: '/home/me/itsm' }))
  on('session.cwd', () => ({ value: '/home/me/itsm/am3' }))
  // am3 is its own repo; the start folder is in none.
  on('process.run', (_, e) => (e.init?.cwd === '/home/me/itsm' ? ran(128) : ran(0, '/home/me/itsm/am3\n')))
  expect(await projectRoot($)).toBe('/home/me/itsm')
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
  expect((await ui.find({ key: 'explorer:gutter' }))?.props.props.rows.find((r: { line: number }) => r.line === 65)?.cell).toMatch(/65 $/)
  expect((await ui.find({ key: 'row:65' }))?.props.backgroundColor).toBe('#0f1c28')
})

test('a lit line paints its code text and the rest of the row, not only its number', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts', line: 65 }, lines(200))
  const texts: any[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'Text') texts.push(n)
    walk([n.children, n.props?.children])
  }
  walk(await ui.find({ key: 'row:65' }))
  expect(texts.length).toBeGreaterThan(1)
  expect(texts.every(t => t.props?.backgroundColor === LIT)).toBe(true)
  expect(texts.map(textOf).join('')).toMatch(/^line 65 +$/)
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

test('a long header path is cut at a folder name, and each folder still shown is a link', async ($, on) => {
  const dirs = Array.from({ length: 20 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`)
  const ui = await explorer($, on, { path: `/repo/${dirs.join('/')}/a.ts` }, lines(3))
  const head = await pathText(ui)
  expect(head).toMatch(/^…\/d\d\d\/.*\/a\.ts$/)
  const shown = head.split('/').slice(1, -1)
  for (const [i, name] of shown.entries()) {
    const at = `/repo/${dirs.slice(0, dirs.indexOf(name) + 1).join('/')}`
    expect(await ui.find({ type: 'Button', key: at }), `${i}: ${name}`).toBeDefined()
  }
  expect(await ui.find({ type: 'Button', key: '/repo' })).toBeUndefined()
  await ui.press({ key: `/repo/${dirs.join('/')}` })
  await ui.redraw()
  expect(await pathText(ui)).toMatch(/\/d20$/)
})

test('the ellipsis of a cut header path opens the project root', async ($, on) => {
  const dirs = Array.from({ length: 20 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`)
  const ui = await explorer($, on, { path: `/repo/${dirs.join('/')}/a.ts` }, lines(3))
  await ui.press({ key: 'cut' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo')
})

test('a last name too long for the header keeps the plain cut path', async ($, on) => {
  const ui = await explorer($, on, { path: `/repo/src/${'x'.repeat(60)}.ts` }, lines(3))
  expect(await pathText(ui)).toMatch(/^…x+\.ts$/)
  expect(await ui.find({ type: 'Button', key: '/repo/src' })).toBeUndefined()
})

test('the header folder buttons sit in a Box that does not shrink, so no letter is lost', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  const parts = await ui.find({ key: 'parts' })
  expect(parts?.props.flexShrink).toBe(0)
  expect(textOf(parts)).toBe('repo/src/a.ts')
})

test('an empty root folder page shows one faint empty row', async ($, on) => {
  const ui = await explorerRoot($, on)
  expect((await ui.find({ type: 'Text', text: 'empty' }))?.props.color).toBe('#4f5c68')
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

test('a folder place in the file atom shows its folder page, not the unreadable panel', async ($, on) => {
  await setup($, on)
  open({ path: '/repo', kind: 'folder' })
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: 'empty' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeUndefined()
})

test('with no file open, the root folder page lists folders before files', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }] })
  expect(await treeRow(ui, 'src')).toBeDefined()
  expect(await treeRow(ui, 'README.md')).toBeDefined()
})

test('a closed folder shows the closed chevron, an open one the open chevron', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'src', kind: 'dir' }], '/repo/src': [{ name: 'a.ts', kind: 'file' }] })
  expect(await chevron(ui, '▸')).toBeDefined()
  await tapTree(ui, 'src')
  await ui.drawn()
  expect(await chevron(ui, '▾')).toBeDefined()
  expect(await treeRow(ui, 'a.ts')).toBeDefined()
})

test('an empty folder has no chevron and draws the open-folder icon, and a press does nothing', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'empty', kind: 'dir' }], '/repo/empty': [] })
  expect(await chevron(ui, '▸')).toBeUndefined()
  expect(await chevron(ui, String.fromCharCode(0xf07c))).toBeDefined()
  await tapTree(ui, 'empty')
  expect(await treeRow(ui, 'empty')).toBeDefined()
})

test('a press on a file opens it, and the header shows it', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'a.ts', kind: 'file' }] })
  disk.set('/repo/a.ts', { text: 'x\n', mtimeMs: 1 })
  await tapTree(ui, 'a.ts')
  await ui.drawn()
  expect(await pathText(ui)).toBe('repo/a.ts')
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
})

test('a folder segment opens its folder page', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3), { '/repo/src': [{ name: 'lib.ts', kind: 'file' }] })
  await ui.press({ key: '/repo/src' })
  await ui.redraw()
  expect(await treeRow(ui, 'lib.ts')).toBeDefined()
})

test('opening a folder expands the folders down to the open file', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/lib/a.ts' }, 'x\n', {
    '/repo': [{ name: 'src', kind: 'dir' }],
    '/repo/src': [{ name: 'lib', kind: 'dir' }],
    '/repo/src/lib': [{ name: 'a.ts', kind: 'file' }],
  })
  await ui.press({ key: '/repo' })
  await ui.redraw()
  expect(await treeRow(ui, 'a.ts')).toBeDefined()
})

test('a folder of 5,000 files draws only the rows that fit', async ($, on) => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}.ts`, kind: 'file' as const }))
  const ui = await explorerRoot($, on, { '/repo': many })
  expect(await treeRow(ui, 'f0000.ts')).toBeDefined()
  expect(await treeRow(ui, 'f0100.ts')).toBeUndefined()
})

test('only the folders on screen are listed', async ($, on) => {
  const dirs = Array.from({ length: 60 }, (_, i) => ({ name: `d${String(i).padStart(2, '0')}`, kind: 'dir' as const }))
  const ui = await explorerRoot($, on, { '/repo': dirs })
  expect(await treeRow(ui, 'd00')).toBeDefined()
  expect(lists).toContain('/repo')
  expect(lists).toContain('/repo/d00')
  expect(lists).not.toContain('/repo/d30')
  expect(lists.length).toBeLessThanOrEqual(1 + 17)
})

test('a dot name draws in the faint colour', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: '.git', kind: 'dir' }] })
  expect((await treeRow(ui, '.git')).props.props.left.at(-1).color).toBe('#4f5c68')
})

test('a reference is path:line, or path:first-last, relative to the working directory', () => {
  expect(refOf('hooks/kit.tsx', 183, 183)).toBe('hooks/kit.tsx:183')
  expect(refOf('hooks/kit.tsx', 183, 190)).toBe('hooks/kit.tsx:183-190')
})

test('a gutter drag from line 183 to 190 copies the reference, lowest line first', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/hooks/kit.tsx', line: 183 }, lines(300))
  await ui.pointer({ type: 'down', x: 0, y: 8, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'move', x: 0, y: 15, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 15, button: 'left', in: 'explorer:gutter' })
  expect(copied).toEqual(['hooks/kit.tsx:183-190'])
})

test('a file outside the working directory copies as an absolute path', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/home/me/notes.md', line: 2 }, lines(5))
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  expect(copied).toEqual(['/home/me/notes.md:2'])
})

test('the notice reads copied and the reference, in the header', async ($, on) => {
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/hooks/kit.tsx', line: 183 }, lines(300))
  await ui.pointer({ type: 'down', x: 0, y: 8, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 8, button: 'left', in: 'explorer:gutter' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('copied hooks/kit.tsx:183')
  await clock.advance(3000)
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/hooks/kit.tsx')
})

test('a notice still up when another file opens clears after 3 seconds', async ($, on) => {
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/hooks/kit.tsx', line: 183 }, lines(300))
  await ui.pointer({ type: 'down', x: 0, y: 8, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 8, button: 'left', in: 'explorer:gutter' })
  disk.set('/repo/b.ts', { text: lines(5), mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  await clock.advance(3000)
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/b.ts')
})

test('a press on the code clears the lit row', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 3 }, lines(10))
  expect((await ui.find({ key: 'row:3' }))?.props.backgroundColor).toBe('#0f1c28')
  await ui.press({ key: 'code:0' })
  await ui.redraw()
  expect((await ui.find({ key: 'row:3' }))?.props.backgroundColor).toBeUndefined()
})

const barOf = async (ui: { find: (q: any) => Promise<any> }, key: 'explorer:vbar' | 'explorer:hbar') => (await ui.find({ key }))?.props.props

test('the vertical bar has one cell per pane row, and its thumb covers the view', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, lines(200))
  const bar = await barOf(ui, 'explorer:vbar')
  expect(bar).toMatchObject({ axis: 'v', cells: 16, total: 200, from: 0 })
  expect(bar.to).toBeGreaterThan(0)
})

test('a drag on the thumb posts once on release, and the view moves', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, lines(200))
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'explorer:vbar' })
  await ui.pointer({ type: 'move', x: 0, y: 4, button: 'left', in: 'explorer:vbar' })
  await ui.pointer({ type: 'up', x: 0, y: 4, button: 'left', in: 'explorer:vbar' })
  await ui.redraw()
  // Four cells of 200 rows over 16 cells: the view moves 50 rows, so the thumb starts at cell 4.
  expect((await barOf(ui, 'explorer:vbar')).from).toBe(4)
})

test('a press off the thumb jumps there', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, lines(200))
  await ui.pointer({ type: 'down', x: 0, y: 15, button: 'left', in: 'explorer:vbar' })
  await ui.pointer({ type: 'up', x: 0, y: 15, button: 'left', in: 'explorer:vbar' })
  await ui.redraw()
  expect((await barOf(ui, 'explorer:vbar')).from).toBeGreaterThan(0)
})

test('a long line shows the sideways bar, and a wheel tick on it moves 4 columns', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/long.ts' }, `${'x'.repeat(300)}END\n`)
  expect(await barOf(ui, 'explorer:hbar')).toBeDefined()
  // Inner body rows: 19 less the top rule is 18. The header and rule take 2, so 15 code rows take body rows 2 to 16,
  // and the bar is body row 17. The pane row is body row + RULE (1), so 18.
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 1, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 8, row: 18 } })
  await ui.redraw()
  expect((await barOf(ui, 'explorer:hbar')).top).toBe(4)
})

const CHECK = String.fromCharCode(0xeab2)

test('the menu button pins the card, and Copy path copies the path from the working directory', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('none')
  await ui.press({ key: 'menu' })
  await ui.redraw()
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('flex')
  expect(await ui.find({ type: 'Text', text: 'Copy path' })).toBeDefined()
  await ui.press({ key: 'copy-path' })
  expect(copied).toEqual(['src/a.ts'])
})

test('an action unpins the card, so its display is none', async ($, on) => {
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'copy-path' })
  await ui.redraw()
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('none')
})

const card = async (ui: any) => (await ui.find({ key: 'explorer:menu-card' }))?.props.display

test('a tab body too short for the card opens it at the top, left of the menu button, with no divider', async ($, on) => {
  await setup($, on)
  disk.set('/repo/src/a.ts', { text: lines(3), mtimeMs: 1 })
  open({ path: '/repo/src/a.ts' })
  // 8 pane rows less the rule leave the tab 7, one short of the card's 8 at top 2.
  const short = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, scroll: { offset: 0, bodyRows: 8 } }, requestId: 'margin' })
  await short.press({ key: 'menu' })
  await short.redraw()
  const box = await short.find({ key: 'explorer:menu-card' })
  expect([box?.props.top, box?.props.right]).toEqual([0, 3])
  expect(textOf(box)).not.toContain('─')
  expect(textOf(box)).toContain('Wrap lines')
})

test('a tall tab body keeps the card below the header, with its divider', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.redraw()
  const box = await ui.find({ key: 'explorer:menu-card' })
  expect([box?.props.top, box?.props.right]).toEqual([2, 0])
  expect(textOf(box)).toContain('─')
})

test('a pinned card makes the pane take Escape; unpinning gives it back', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).closeOnEscape), { value: { isPlaced: true } }) as any)
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBe(true)
  await ui.press({ key: 'code:0' })
  await ui.redraw()
  await clock.advance(0)
  expect(await card(ui)).toBe('none')
  expect(opens.at(-1)).toBeUndefined()
})

test('a press outside the pinned card unpins it; Wrap lines keeps it pinned', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'wrap' })
  await ui.redraw()
  expect(await card(ui)).toBe('flex')
  await ui.press({ key: 'code:0' })
  await ui.redraw()
  expect(await card(ui)).toBe('none')
})

test('a gutter press unpins the card', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(30))
  await ui.press({ key: 'menu' })
  await ui.redraw()
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await waitFor(() => false)
  await ui.redraw()
  expect(await card(ui)).toBe('none')
})

test('Copy absolute path copies the full path', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'copy-abs' })
  expect(copied).toEqual(['/repo/src/a.ts'])
})

test('a file outside the working directory copies its absolute path, and Mention gives it too', async ($, on) => {
  const copied: string[] = []
  const filled: Array<{ text: string }> = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  on('prompt.fill', (_, e) => (filled.push(e as any), { isFilled: true }) as any)
  const ui = await explorer($, on, { path: '/home/me/notes.md' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'copy-path' })
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'mention' })
  expect(copied).toEqual(['/home/me/notes.md'])
  expect(filled[0]!.text).toBe('@/home/me/notes.md')
})

test('on a folder page, Copy path has no trailing slash and Mention ends with one', async ($, on) => {
  const copied: string[] = []
  const filled: Array<{ text: string }> = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  on('prompt.fill', (_, e) => (filled.push(e as any), { isFilled: true }) as any)
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'src', kind: 'dir' }] })
  open({ path: '/repo/src', kind: 'folder' })
  await ui.redraw()
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'copy-path' })
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'mention' })
  expect(copied).toEqual(['src'])
  expect(filled[0]!.text).toBe('@src/')
})

test('Mention to Claude appends @path to the draft', async ($, on) => {
  const filled: Array<{ text: string; mode?: string }> = []
  on('prompt.fill', (_, e) => (filled.push(e as any), { isFilled: true }) as any)
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'mention' })
  expect(filled).toEqual([expect.objectContaining({ text: '@src/a.ts', mode: 'append' })])
})

test('Mention quotes a path with a space', async ($, on) => {
  const filled: Array<{ text: string }> = []
  on('prompt.fill', (_, e) => (filled.push(e as any), { isFilled: true }) as any)
  const ui = await explorer($, on, { path: '/repo/a b.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'mention' })
  expect(filled[0]!.text).toBe('@"a b.ts"')
})

test('toolbar glyphs take the claude colour, and a path folder part has no colour', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  for (const code of [0xea9b, 0xea9c, 0xeb37, 0xeb94]) expect((await ui.find({ type: 'Text', text: String.fromCharCode(code) }))?.props.color).toBe('claude')
  const folder = await ui.find({ type: 'Text', text: 'src' })
  expect(folder).toBeDefined()
  expect(folder?.props.color).toBeUndefined()
})

// The live engine throws on a Button with no string or Text child.
const bareButtons = (n: any): number => {
  if (!n || typeof n !== 'object') return 0
  if (Array.isArray(n)) return n.reduce((sum: number, x) => sum + bareButtons(x), 0)
  const kids = [n.children, n.props?.children].flat(Infinity).filter(x => x !== undefined && x !== null && x !== false && x !== '')
  const labelled = kids.some(k => typeof k === 'string' || k?.type === 'Text')
  return (n.type === 'Button' && !labelled ? 1 : 0) + bareButtons(kids)
}

test('a blank line draws a Button with a Text child, so no Button is bare', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'one\n\ntwo\n')
  expect(await ui.find({ key: 'row:2' })).toBeDefined()
  expect(bareButtons(await ui.drawn())).toBe(0)
})

test('the header row never takes more cells than the pane body, at any path length', async ($, on) => {
  await setup($, on)
  for (let n = 1; n < 40; n++) {
    const name = `${'n'.repeat(n)}.ts`
    disk.set(`/repo/${name}`, { text: 'x\n', mtimeMs: 1 })
    open({ path: `/repo/${name}` })
    const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 30 }, requestId: `h${n}` })
    // toolbar Box 5 + path + right Box 3
    expect(5 + cellsOf(await pathText(ui)) + 3, name).toBeLessThanOrEqual(30 - 2)
  }
})

test('Open in editor runs the launch script with the path as its argument, and says opened', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  runs.length = 0
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'open-editor' })
  await ui.redraw()
  const detached = runs.find(a => a[0] === 'sh' && a.includes(OPEN_EDITOR_SH))
  expect(detached?.at(-1)).toBe('/repo/src/a.ts')
  expect(await pathText(ui)).toBe('opened src/a.ts')
})

test('the launch script never holds the path, so a hostile name cannot run', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/$(touch x) "q".ts' }, lines(3))
  runs.length = 0
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'open-editor' })
  await ui.redraw()
  const detached = runs.find(a => a[0] === 'sh' && a.includes(OPEN_EDITOR_SH))
  expect(detached).toEqual(['sh', '-c', OPEN_EDITOR_SH, 'sh', '/repo/$(touch x) "q".ts'])
})

test('Wrap lines toggles, keeps the top source line, and shows a check while on', async ($, on) => {
  const text = Array.from({ length: 60 }, (_, i) => `L${i + 1} ${'x'.repeat(100)}`).join('\n')
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 30 }, text)
  const top = textOf(await ui.find({ key: 'code:0' })).split(' ')[0]
  expect(await ui.find({ key: 'explorer:hbar' })).toBeDefined()
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'wrap' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: CHECK })).toBeDefined()
  expect(textOf(await ui.find({ key: 'code:0' })).split(' ')[0]).toBe(top)
  expect(await ui.find({ key: 'explorer:hbar' })).toBeUndefined()
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('flex')
})

const longLines = (n: number) => Array.from({ length: n }, (_, i) => `L${i + 1} ${'x'.repeat(100)}`).join('\n')

test('wrapped rows each carry their own gutter key, and a drag on a continuation row copies its source line', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => (copied.push(e.text), { value: { isCopied: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, longLines(10))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'wrap' })
  await ui.redraw()
  const rows = (await ui.find({ key: 'explorer:gutter' }))?.props.props.rows
  expect(new Set(rows.map((r: any) => r.row)).size).toBe(rows.length)
  expect(rows[1].line).toBe(1)
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  expect(copied).toEqual(['a.ts:1'])
})

test('Open in editor says it failed when the launch fails', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  launch.exit = 1
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'open-editor' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('failed to open src/a.ts')
})

test('a refresh deep in a wrapped file keeps the top source line', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 55 }, longLines(60))
  await ui.press({ key: 'menu' })
  await ui.press({ key: 'wrap' })
  await ui.redraw()
  const top = textOf(await ui.find({ key: 'code:0' })).split(' ')[0]
  await ui.press({ key: 'refresh' })
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'code:0' })).split(' ')[0]).toBe(top)
})

const hostOk = (on: any) => on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

test('an Edit to the open file reloads it at once', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(3))
  disk.set('/repo/a.ts', { text: 'fresh\nlines\n', mtimeMs: 2 })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as any)
  await ui.redraw()
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('fresh')
})

test('a NotebookEdit names its file in notebook_path', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/n.ipynb' }, 'old\n')
  disk.set('/repo/n.ipynb', { text: 'new\n', mtimeMs: 2 })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb' } as any)
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('new')
})

test('a Bash call reloads when the open file mtime changed', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\n')
  disk.set('/repo/a.ts', { text: 'b\n', mtimeMs: 2 })
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/a/b/ a.ts' } as any)
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('b')
  expect(textOf(await ui.find({ key: 'row:1' }))).not.toContain('a')
})

test('the five-second check shows a deleted open file as no longer existing', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__margin__${e.name}` } }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\n')
  await $.session.start({ source: 'startup', cwd: '/repo', surface: null, isInteractive: false } as any)
  disk.delete('/repo/a.ts')
  await clock.advance(5000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'It no longer exists.' })).toBeDefined()
})

test('a stale reload result is dropped as stale', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'old\n')
  hold.reads = []
  disk.set('/repo/a.ts', { text: 'first\n', mtimeMs: 2 })
  const first = ui.press({ key: 'refresh' })
  await waitFor(() => hold.reads!.length === 1)
  disk.set('/repo/a.ts', { text: 'second\n', mtimeMs: 3 })
  const second = ui.press({ key: 'refresh' })
  await waitFor(() => hold.reads!.length === 2)
  hold.reads[1]!()
  await second
  hold.reads[0]!()
  await first
  hold.reads = undefined
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('second')
  expect(textOf(await ui.find({ key: 'row:1' }))).not.toContain('first')
})

test('a Write call re-lists the open folder page', async ($, on) => {
  hostOk(on)
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'a.ts', kind: 'file' }] })
  tree.set('/repo', [{ name: 'a.ts', kind: 'file' }, { name: 'b.ts', kind: 'file' }])
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts' } as any)
  await ui.redraw()
  expect(await ui.find({ key: `row:x:${fileKey('/repo/b.ts')}` })).toBeDefined()
})

test('a Write into a folder seen empty re-lists it, so it shows as non-empty', async ($, on) => {
  hostOk(on)
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'empty', kind: 'dir' }], '/repo/empty': [] })
  expect(await chevron(ui, '▸')).toBeUndefined()
  tree.set('/repo/empty', [{ name: 'n.ts', kind: 'file' }])
  await $.tool.call({ tool: 'Write', file_path: '/repo/empty/n.ts' } as any)
  await ui.redraw()
  expect(await chevron(ui, '▸')).toBeDefined()
})

test('a Write while a file shows re-lists the folder when back returns to it', async ($, on) => {
  hostOk(on)
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'a.ts', kind: 'file' }] })
  disk.set('/repo/a.ts', { text: 'x', mtimeMs: 1 })
  await tapTree(ui, 'a.ts')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'forward' })
  tree.set('/repo', [{ name: 'a.ts', kind: 'file' }, { name: 'b.ts', kind: 'file' }])
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts' } as any)
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(await ui.find({ key: `row:x:${fileKey('/repo/b.ts')}` })).toBeDefined()
})

test('refresh re-lists the open folder page', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, 'x\n', { '/repo/src': [{ name: 'a.ts', kind: 'file' }] })
  await ui.press({ key: '/repo/src' })
  await ui.redraw()
  tree.set('/repo/src', [{ name: 'a.ts', kind: 'file' }, { name: 'c.ts', kind: 'file' }])
  await ui.press({ key: 'refresh' })
  await ui.redraw()
  expect(await ui.find({ key: `row:x:${fileKey('/repo/src/c.ts')}` })).toBeDefined()
})

test('an empty file reloaded with content shows it at the atom line', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 3 }, '')
  disk.set('/repo/a.ts', { text: lines(5), mtimeMs: 2 })
  await ui.press({ key: 'refresh' })
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:3' }))).toContain('line 3')
})

test('a file shown again after a folder page is read again', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, 'old\n', { '/repo/src': [{ name: 'a.ts', kind: 'file' }] })
  await ui.press({ key: '/repo/src' })
  await ui.redraw()
  disk.set('/repo/src/a.ts', { text: 'new\n', mtimeMs: 2 })
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('new')
})

test('a reload in flight keeps its text when a folder page draws and completes', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, 'old\n', { '/repo/src': [{ name: 'a.ts', kind: 'file' }] })
  hold.reads = []
  disk.set('/repo/src/a.ts', { text: 'new\n', mtimeMs: 2 })
  const refresh = ui.press({ key: 'refresh' })
  await waitFor(() => hold.reads!.length === 1)
  await ui.press({ key: '/repo/src' })
  await ui.redraw()
  hold.reads[0]!()
  await refresh
  hold.reads = undefined
  const before = reads.length
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('new')
  expect(reads.length).toBe(before)
})

test('an old draw read landing after a newer reload keeps the newer text', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'x\n')
  disk.set('/repo/b.ts', { text: 'old\n', mtimeMs: 1 })
  hold.reads = []
  open({ path: '/repo/b.ts' })
  const drew = ui.redraw()
  await waitFor(() => hold.reads!.length === 1)
  disk.set('/repo/b.ts', { text: 'new\n', mtimeMs: 2 })
  const refresh = ui.press({ key: 'refresh' })
  await waitFor(() => hold.reads!.length === 2)
  hold.reads[1]!()
  await refresh
  hold.reads[0]!()
  await drew
  hold.reads = undefined
  await ui.redraw()
  expect(textOf(await ui.find({ key: 'row:1' }))).toContain('new')
})

test('a Bash call before the Explorer has drawn writes no place', async ($, on) => {
  await setup($, on)
  hostOk(on)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  expect(sets).not.toContain('file')
})

test('refresh lists a folder again after its listing failed', async ($, on) => {
  await setup($, on)
  tree.set('/repo', [{ name: 'a.ts', kind: 'file' }])
  failList.on = true
  const ui = await mountPane($)
  expect(await ui.find({ key: `row:x:${fileKey('/repo/a.ts')}` })).toBeUndefined()
  failList.on = false
  await ui.press({ key: 'refresh' })
  await ui.redraw()
  expect(await ui.find({ key: `row:x:${fileKey('/repo/a.ts')}` })).toBeDefined()
})

test('a notice longer than the header keeps the verb, a space and the end of the path', async ($, on) => {
  on('ui.copy', () => ({ value: { isCopied: true } }) as any)
  const deep = `/elsewhere/${'dir/'.repeat(14)}file.ts`
  const ui = await explorer($, on, { path: deep, line: 1 }, lines(5))
  await ui.pointer({ type: 'down', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'explorer:gutter' })
  await ui.redraw()
  const text = await pathText(ui)
  expect(text).toMatch(/^copied …\S*dir\/file\.ts:\d+$/)
  expect([...text].length).toBeLessThanOrEqual(44 - 2 - 6)
})

test('the menu divider is plain rule cells over the padding, between the card borders', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/src/a.ts' }, lines(3))
  // the longest label + 1-cell mark, plus the padding cell on each side
  const dashes = 'Copy absolute path'.length + 1 + 2
  expect(await ui.find({ type: 'Text', text: new RegExp(`^─{${dashes}}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Box', marginX: -1 })).toBeDefined()
})

test('a tree row is a row Client in a Box that lights the whole row on hover', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'src', kind: 'dir' }, { name: 'a.ts', kind: 'file' }], '/repo/src': [{ name: 'b.ts', kind: 'file' }] })
  const row = await treeRow(ui, 'src')
  expect(String(row.props.module)).toMatch(/row\.tsx$/)
  expect(row.props.key).toBe(`row:x:${fileKey('/repo/src')}`)
  expect(await ui.find({ type: 'Button', key: '/repo/src' })).toBeUndefined()
  const walk = (n: any, up: any[] = []): any[] =>
    !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(x => walk(x, up)) : n.props?.key === row.props.key ? up : walk([n.children, n.props?.children], [...up, n])
  const lit = walk(await ui.drawn()).findLast(n => n.hover?.backgroundColor === LIT)
  expect(lit?.props.flexDirection).toBe('column')
  const left = row.props.props.left.map((x: any) => x.text)
  expect(left).toEqual(['▸', ' ', expect.any(String), ' ', 'src'])
})

test('a press on a tree file row opens it, and on a folder row toggles it', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'src', kind: 'dir' }, { name: 'a.ts', kind: 'file' }], '/repo/src': [{ name: 'b.ts', kind: 'file' }] })
  disk.set('/repo/a.ts', { text: 'x\n', mtimeMs: 1 })
  await tapTree(ui, 'src')
  await ui.drawn()
  expect(await treeRow(ui, 'b.ts')).toBeDefined()
  await tapTree(ui, 'src')
  await ui.drawn()
  expect(await treeRow(ui, 'b.ts')).toBeUndefined()
  await tapTree(ui, 'a.ts')
  await ui.drawn()
  expect(await pathText(ui)).toBe('repo/a.ts')
})

const keyMatching = async (ui: any, re: RegExp) => {
  const keys: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (typeof n.props?.key === 'string' && re.test(n.props.key)) keys.push(n.props.key)
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return keys[0]
}
const fieldKey = async (ui: any) => (await keyMatching(ui, /^explorer:find(:\d+)?$/)) ?? 'explorer:find'
const findText = async (ui: any, text: string) => ui.input({ key: await fieldKey(ui), text, kind: 'change' })
const isLit = async (ui: any, n: number) => (await ui.find({ key: `row:${n}` }))?.props.backgroundColor === LIT

test('the field sits centred, is held at the left gap as it grows right, then pins right once the label drops', () => {
  // A 60-column header: the path's room is 44, the field's 47 (the hidden search and menu buttons give 3).
  const x = (n: number) => 'x'.repeat(n)
  // The group is label + text + 5 (cursor, gap, Enter mark, space) + the submit word.
  expect(fieldPad('type a name ', '', 'open', 44, 47)).toBe(11)
  expect(fieldPad('lines with ', x(6), 'next', 44, 47)).toBe(9)
  expect(fieldPad('lines with ', x(26), 'next', 44, 47)).toBe(0)
  expect(fieldPad('lines with ', x(27), 'next', 44, 47)).toBe(0)
  expect(fieldPad('', x(36), 'next', 44, 47)).toBe(2)
  expect(fieldPad('', x(38), 'next', 44, 47)).toBe(0)
})

test('the search button is drawn on a file', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  expect(await ui.find({ key: 'explorer:search' })).toBeDefined()
})

test('search opens the field with its hint drawn before it, no label and autofocus', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const field = await ui.find({ key: 'explorer:find' })
  expect(field?.props.placeholder).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'type text to find ' })).toBeDefined()
  expect(field?.props.submitLabel).toBe('next')
  expect(await ui.find({ key: 'explorer:search' })).toBeUndefined()
  expect(await ui.find({ key: 'menu' })).toBeUndefined()
  expect(field?.props.autoFocus).toBe(true)
  expect(field?.props.label).toBeUndefined()
})

test('the label appears once text is typed', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'lines with ' })).toBeUndefined()
  await findText(ui, 'line 4')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'lines with ' })).toBeDefined()
})

test('a typed find waits 150 ms before it runs', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'line 42')
  await clock.advance(149)
  await ui.redraw()
  expect(await isLit(ui, 42)).toBe(false)
  await clock.advance(1)
  await ui.redraw()
  expect(await isLit(ui, 42)).toBe(true)
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
})

test('each key restarts the wait', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'line 4')
  await clock.advance(100)
  await findText(ui, 'line 42')
  await clock.advance(149)
  await ui.redraw()
  expect(await isLit(ui, 4)).toBe(false)
  await clock.advance(1)
  await ui.redraw()
  expect(await isLit(ui, 42)).toBe(true)
  expect(await isLit(ui, 4)).toBe(false)
})

test('clearing the text clears the lit line that find set', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'line 42')
  await clock.advance(150)
  await findText(ui, '')
  await ui.redraw()
  expect(await isLit(ui, 42)).toBe(false)
})

const texts = (n: any, out: { text: string; color?: string; bg?: string }[] = []) => {
  if (!n || typeof n !== 'object') return out
  if (Array.isArray(n)) return n.forEach(x => texts(x, out)), out
  if (n.type === 'Text' && typeof textOf(n) === 'string') out.push({ text: textOf(n), color: n.props?.color, bg: n.props?.backgroundColor })
  texts([n.children, n.props?.children], out)
  return out
}
const barTexts = async (ui: any) => texts(await ui.find({ key: 'explorer:find-bar' }))
const barText = async (ui: any) => textOf(await ui.find({ key: 'explorer:find-bar' }))
const submit = async (ui: any, text: string) => {
  await ui.input({ key: await fieldKey(ui), text, kind: 'submit' })
  await ui.redraw()
}
const search = async (ui: any, text: string) => {
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, text)
  await clock.advance(150)
  await ui.redraw()
}
const AB = 'a\nb\na'

test('the find bar takes 2 rows', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  const closed = (await barOf(ui, 'explorer:vbar')).cells
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect((await barOf(ui, 'explorer:vbar')).cells).toBe(closed - 2)
})

test('the bar counts matches, with the current number in warning', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 1')
  const t = await barTexts(ui)
  expect(t.find(x => x.text === '1')?.color).toBe('warning')
  expect(t.find(x => x.text === 'of')?.color).toBe('#4f5c68')
  expect(t.find(x => x.text === '111')?.color).toBeUndefined()
  expect(await barText(ui)).toContain('1 of 111')
})

// The width of the Box that holds the field keyed `key`.
const fieldWidth = async (ui: any, key: string) => {
  let width: number | undefined
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const kids = [n.children, n.props?.children].flat(5).filter(Boolean)
    if (typeof n.props?.width === 'number' && kids.some((k: any) => k?.props?.key === key)) width = n.props.width
    walk(kids)
  }
  walk(await ui.drawn())
  return width
}

test('a short field takes its own width, so the first key draws centred', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'claudz')
  expect(await fieldWidth(ui, 'explorer:find')).toBeUndefined()
})

test('text past the header room is cut, so the field keeps its own width', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'x'.repeat(200))
  const key = await fieldKey(ui)
  expect(key).not.toBe('explorer:find')
  expect((await ui.find({ key })).props.value.length).toBeLessThan(200)
  expect(await fieldWidth(ui, key)).toBeUndefined()
})

test('search asks the pane for the keys', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).focus), { value: { isPlaced: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await waitFor(() => opens.length > 0)
  expect(opens).toEqual([true])
})

test('an open field makes the pane take Escape; closing it gives that back', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).closeOnEscape), { value: { isPlaced: true } }) as any)
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBe(true)
  await ui.press({ key: 'explorer:find:close' })
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBeUndefined()
})

test('Escape is asked only while the field is empty', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).closeOnEscape), { value: { isPlaced: true } }) as any)
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBe(true)
  await findText(ui, 'line 1')
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBeUndefined()
  await findText(ui, '')
  await ui.redraw()
  await clock.advance(0)
  expect(opens.at(-1)).toBe(true)
})

test('Enter with no name match keeps the typed text drawn', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'zzz')
  await ui.input({ key: 'explorer:name', text: 'zzz', kind: 'submit' })
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:name' })).toBeUndefined()
  expect((await ui.find({ key: 'explorer:name:1' }))?.props.value).toBe('zzz')
})

test('a press elsewhere closes an empty field, not one with text', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await ui.press({ key: 'refresh' })
  await fieldGone(ui)
  await search(ui, 'line 1')
  await ui.press({ key: 'refresh' })
  await ui.redraw()
  expect(await keyMatching(ui, /^explorer:find(:\d+)?$/)).toBeDefined()
})

test('a press on the scroll bar closes an empty field and still jumps', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 1 }, lines(200))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await ui.pointer({ type: 'down', x: 0, y: 10, button: 'left', in: 'explorer:vbar' })
  await ui.pointer({ type: 'up', x: 0, y: 10, button: 'left', in: 'explorer:vbar' })
  await fieldGone(ui)
  expect((await barOf(ui, 'explorer:vbar')).from).toBeGreaterThan(0)
})

test('a field closing draws the pane once with no buttons, so the engine drops its focus ring', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'a.ts', kind: 'file' }] })
  disk.set('/repo/a.ts', { text: 'x\n', mtimeMs: 1 })
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await tapTree(ui, 'a.ts')
  expect(await ui.find({ key: 'back' })).toBeUndefined()
  await clock.advance(0)
  await ui.redraw()
  expect(await ui.find({ key: 'back' })).toBeDefined()
  expect(await pathText(ui)).toBe('repo/a.ts')
})

test('a press on a tree row closes an empty name field and still opens the file', async ($, on) => {
  const ui = await explorerRoot($, on, { '/repo': [{ name: 'a.ts', kind: 'file' }] })
  disk.set('/repo/a.ts', { text: 'x\n', mtimeMs: 1 })
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await tapTree(ui, 'a.ts')
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:name' })).toBeUndefined()
  expect(await pathText(ui)).toBe('repo/a.ts')
})

test('the find bar keeps toggles left and ✕ right, with prev, count and next centred on the pane', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 1')
  const [left, mid, right] = await Promise.all(['left', 'mid', 'right'].map(k => ui.find({ key: `explorer:find:${k}` })))
  expect([mid?.props.flexGrow, mid?.props.justifyContent]).toEqual([1, 'center'])
  expect(right?.props.justifyContent).toBe('flex-end')
  // Equal sides, so the middle centres on the pane, not on the room left over.
  expect(right?.props.width).toBe(left?.props.width)
  expect(textOf(left)).not.toContain('✕')
  expect(textOf(right)).toContain('✕')
})

test('the count is one Text, so the bar stays one row tall', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 1')
  expect((await barTexts(ui)).some(x => x.text === '1 of 111')).toBe(true)
})

test('no matches shows no matches in warning and greys the steps', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'zzz')
  const t = await barTexts(ui)
  expect(t.find(x => x.text === 'no matches')?.color).toBe('warning')
  expect(t.find(x => x.text === 'prev')?.color).toBe('#4f5c68')
  expect(t.find(x => x.text === 'next')?.color).toBe('#4f5c68')
})

test('an empty field shows no count and greys the steps', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const t = await barTexts(ui)
  expect(await barText(ui)).not.toMatch(/of|no matches|bad pattern/)
  expect(t.find(x => x.text === 'prev')?.color).toBe('#4f5c68')
  expect(t.find(x => x.text === 'next')?.color).toBe('#4f5c68')
})

test('Enter steps to the next match and wraps', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  expect(await barText(ui)).toContain('1 of 2')
  await submit(ui, 'a')
  expect(await barText(ui)).toContain('2 of 2')
  await submit(ui, 'a')
  expect(await barText(ui)).toContain('1 of 2')
})

test('Enter re-keys the find field so the engine redraws its text', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  expect(await ui.find({ key: 'explorer:find' })).toBeDefined()
  await submit(ui, 'a')
  expect(await ui.find({ key: 'explorer:find' })).toBeUndefined()
  expect((await ui.find({ key: 'explorer:find:1' }))?.props.value).toBe('a')
  await ui.press({ key: 'explorer:find:close' })
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect(await keyMatching(ui, /^explorer:find(:\d+)?$/)).toBeDefined()
})

test('Enter on a pending run flushes it and stays on match 1', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'a')
  await submit(ui, 'a')
  expect(await barText(ui)).toContain('1 of 2')
  await submit(ui, 'a')
  expect(await barText(ui)).toContain('2 of 2')
})

test('prev and next step too', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  await ui.press({ key: 'explorer:find:next' })
  await ui.redraw()
  expect(await barText(ui)).toContain('2 of 2')
  await ui.press({ key: 'explorer:find:prev' })
  await ui.redraw()
  expect(await barText(ui)).toContain('1 of 2')
  await ui.press({ key: 'explorer:find:prev' })
  await ui.redraw()
  expect(await barText(ui)).toContain('2 of 2')
})

test('a toggle re-runs from the first match', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  await submit(ui, 'a')
  expect(await barText(ui)).toContain('2 of 2')
  await ui.press({ key: 'explorer:find:case' })
  await ui.redraw()
  expect(await barText(ui)).toContain('1 of 2')
})

test('the toggles survive closing the find', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await ui.press({ key: 'explorer:find:regex' })
  await ui.redraw()
  await ui.press({ key: 'explorer:find:close' })
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:find-bar' })).toBeUndefined()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const on_ = (await ui.find({ key: 'explorer:find:regex' }))
  expect(texts(on_)[0]?.text).toBeDefined()
  expect(JSON.stringify(on_)).toContain('"inverse":true')
})

test('a bad pattern shows bad pattern in error and greys the steps', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await ui.press({ key: 'explorer:find:regex' })
  await findText(ui, '(')
  await clock.advance(150)
  await ui.redraw()
  const t = await barTexts(ui)
  expect(t.find(x => x.text === 'bad pattern')?.color).toBe('error')
  expect(await barText(ui)).not.toContain(' of ')
  expect(t.find(x => x.text === 'prev')?.color).toBe('#4f5c68')
})

test('the current match and the other matches take their colours', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a a')
  await search(ui, 'a')
  const t = texts(await ui.find({ key: 'row:1' })).filter(x => x.bg && x.bg !== LIT)
  expect(t[0]).toMatchObject({ color: 'inverseText', bg: 'warning' })
  expect(t[1]).toMatchObject({ color: '#e5c07b', bg: '#3a3220' })
})

test('a reload keeps the current match, not the first on its line', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a a a\nb\na\n')
  await search(ui, 'a')
  await ui.press({ key: 'explorer:find:next' })
  await ui.press({ key: 'explorer:find:next' })
  await ui.redraw()
  const current = async () => texts(await ui.find({ key: 'explorer:find-bar' })).find(x => x.color === 'warning')?.text
  expect(await current()).toBe('3')
  disk.set('/repo/a.ts', { text: 'a a a\nb\na\n', mtimeMs: 2 })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as any)
  await ui.redraw()
  expect(await current()).toBe('3')
})

test('a find with no match keeps a lit line it did not set', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 5 }, lines(20))
  expect(await isLit(ui, 5)).toBe(true)
  await search(ui, 'zzz')
  expect(await isLit(ui, 5)).toBe(true)
  await findText(ui, '')
  await ui.redraw()
  expect(await isLit(ui, 5)).toBe(true)
})

test('a whitespace query highlights the spaces', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a b')
  await search(ui, ' ')
  expect(texts(await ui.find({ key: 'row:1' })).find(x => x.text === ' ')?.bg).toBeDefined()
})

test('at 36 columns the bar drops its step words before it overflows', async ($, on) => {
  await setup($, on)
  disk.set('/repo/a.ts', { text: Array.from({ length: 10001 }, () => 'x').join('\n'), mtimeMs: 1 })
  open({ path: '/repo/a.ts' })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 36 }, requestId: 'margin' })
  await search(ui, 'x')
  const text = await barText(ui)
  expect(text).toContain('‹  1 of 10000+  ›')
  expect(cellsOf(text)).toBeLessThanOrEqual(34)
})

test('the scroll bar marks the cell that holds a match', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(200))
  await search(ui, 'line 150')
  const bar = await barOf(ui, 'explorer:vbar')
  const at = markCells(200, bar.cells, [149]).indexOf(true)
  expect(bar.marks.map((m: string | null, i: number) => (m ? i : -1)).filter((i: number) => i >= 0)).toEqual([at])
  expect(bar.marks[at]).toBe('warning')
})

test('the matched line number takes the warning colour', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(200))
  await search(ui, 'line 150')
  const rows = (await ui.find({ key: 'explorer:gutter' }))?.props.props.rows
  expect(rows.filter((r: any) => r.hit).map((r: any) => r.line)).toEqual([150])
})

test('a file with no find has no marks', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(200))
  const bar = await barOf(ui, 'explorer:vbar')
  expect(bar.marks.every((m: string | null) => m === null)).toBe(true)
})

const fieldGone = async (ui: any) => {
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:find' })).toBeUndefined()
  expect(await ui.find({ key: 'explorer:find-bar' })).toBeUndefined()
}

test('opening another file ends find', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  disk.set('/repo/b.ts', { text: lines(300), mtimeMs: 1 })
  await search(ui, 'line 1')
  expect(await isLit(ui, 1)).toBe(true)
  open({ path: '/repo/b.ts' })
  await fieldGone(ui)
  expect(await isLit(ui, 1)).toBe(false)
})

test('a folder page ends find', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 1')
  open({ path: '/repo', kind: 'folder' })
  await fieldGone(ui)
})

test('a line jump in the same file ends find', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 42')
  open({ path: '/repo/a.ts', line: 5 })
  await fieldGone(ui)
})

test('opening the same file with no line keeps find', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'line 42')
  open({ path: '/repo/a.ts' })
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:find' })).toBeDefined()
  expect(await isLit(ui, 42)).toBe(true)
})

const editTo = async ($: any, ui: any, text: string) => {
  disk.set('/repo/a.ts', { text, mtimeMs: 2 })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as any)
  await ui.redraw()
}

test('an Edit that inserts a line above moves the current match down with its place', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  await submit(ui, 'a')
  await editTo($, ui, 'x\na\nb\na')
  expect(await barText(ui)).toContain('2 of 2')
  expect(await isLit(ui, 4)).toBe(true)
})

test('an Edit that removes the current line moves to the next match', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\nb\na\nc\na')
  await search(ui, 'a')
  await submit(ui, 'a')
  await editTo($, ui, 'a\nb\nc\na')
  expect(await barText(ui)).toContain('2 of 2')
  expect(await isLit(ui, 4)).toBe(true)
})

test('a file that shrank below the current line falls back to the first match', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, AB)
  await search(ui, 'a')
  await submit(ui, 'a')
  await editTo($, ui, 'a')
  expect(await barText(ui)).toContain('1 of 1')
  expect(await isLit(ui, 1)).toBe(true)
})

test('inside a repo the listing runs ls-files in the folder and reads its paths', async () => {
  const { $, on } = engine()
  const argvs: string[][] = []
  on('process.run', (_, e) => (argvs.push([...e.argv]), ran(0, 'hooks/a.ts\0b.ts\0')))
  expect(await listNames($, '/r')).toEqual([
    { path: 'hooks', kind: 'dir' },
    { path: 'hooks/a.ts', kind: 'file' },
    { path: 'b.ts', kind: 'file' },
  ])
  expect(argvs[0]).toEqual(gitArgs('-C', '/r', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '-s'))
})

test('a truncated ls-files drops its cut last row and reports the cap', async () => {
  const { $: eng, on: onE } = engine()
  onE('process.run', () => ran(0, 'a.ts\0hooks/b.ts\0hooks/c', true))
  let capped = 0
  expect(await listNames(eng, '/r', () => capped++)).toEqual([
    { path: 'hooks', kind: 'dir' },
    { path: 'a.ts', kind: 'file' },
    { path: 'hooks/b.ts', kind: 'file' },
  ])
  expect(capped).toBe(1)
})

test('a submodule in the listing is a folder, and a conflicted file is listed once', async () => {
  const { $, on } = engine()
  on('process.run', () => ran(0, ['160000 98dc 0\tlib/sub', '100644 aa 1\tc.ts', '100644 bb 2\tc.ts', 'new.ts', ''].join('\0')))
  expect(await listNames($, '/r')).toEqual([
    { path: 'lib', kind: 'dir' },
    { path: 'lib/sub', kind: 'dir' },
    { path: 'c.ts', kind: 'file' },
    { path: 'new.ts', kind: 'file' },
  ])
})

test('outside a repo the listing falls back to the walk', async () => {
  const { $, on } = engine()
  on('process.run', () => ran(128))
  on('fs.list', () => ({ value: [{ name: 'a.ts', kind: 'file', isLink: false }, { name: '.git', kind: 'dir', isLink: false }] }))
  expect(await listNames($, '/r')).toEqual([{ path: 'a.ts', kind: 'file' }])
})

const nameRoot = async ($: any, on: any) => {
  await setup($, on)
  tree.set('/repo', [{ name: 'hooks', kind: 'dir' }, { name: 'ab.ts', kind: 'file' }])
  tree.set('/repo/hooks', [{ name: 'abc.ts', kind: 'file' }])
  disk.set('/repo/ab.ts', { text: 'x', mtimeMs: 1 })
  disk.set('/repo/hooks/abc.ts', { text: 'y', mtimeMs: 1 })
  listed.out = 'hooks/abc.ts\0ab.ts\0hooks/zz.ts\0'
  return mountPane($)
}
const nameType = async (ui: any, text: string) => {
  await ui.input({ key: 'explorer:name', text, kind: 'change' })
  await ui.redraw()
}
const nameOpen = async (ui: any, text: string) => {
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await nameType(ui, text)
}
const pieces = async (ui: any) => {
  const out: any[][] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.props?.module && Array.isArray(n.props?.props?.left)) out.push(n.props.props.left)
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return out
}
const nameRows = async (ui: any) => (await pieces(ui)).map(l => l.map((x: any) => x.text).join('').trim())

test('a capped name listing says so beside the field', async ($, on) => {
  const ui = await nameRoot($, on)
  listed.out = 'hooks/abc.ts\0ab.ts\0hooks/zz'
  listed.cut = true
  await nameOpen(ui, 'zz')
  expect(await nameRows(ui)).toEqual([])
  expect(await ui.find({ type: 'Text', text: 'named (capped) ' })).toBeDefined()
})

test('search on a folder page opens the name field, and the tree hides while text is typed', async ($, on) => {
  const ui = await nameRoot($, on)
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const field = await ui.find({ key: 'explorer:name' })
  expect(field?.props.placeholder).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'type a name ' })).toBeDefined()
  expect(field?.props.submitLabel).toBe('open')
  expect(field?.props.autoFocus).toBe(true)
  expect(await treeRow(ui, 'hooks')).toBeDefined()
  await nameType(ui, 'ab')
  expect(await treeRow(ui, 'hooks')).toBeUndefined()
  expect(await nameRows(ui)).toEqual(expect.arrayContaining([expect.stringContaining('abc.ts')]))
})

test('a result row shows its parent folder in faint text, and a direct child shows none', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  const rows = await pieces(ui)
  const nested = rows.find(l => l.some((x: any) => x.text === 'abc.ts'))!
  const direct = rows.find(l => l.some((x: any) => x.text === 'ab.ts'))!
  expect(nested.at(-1).text).toContain('hooks')
  expect(nested.at(-1).color).toBe('#4f5c68')
  expect(direct.at(-1).text).toBe('ab.ts')
})

test('Enter opens the top row', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab.')
  await ui.input({ key: 'explorer:name', text: 'ab.', kind: 'submit' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/ab.ts')
})

test('Enter on a folder row opens its page', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'hooks')
  await ui.input({ key: 'explorer:name', text: 'hooks', kind: 'submit' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/hooks')
  expect(await ui.find({ key: 'explorer:name' })).toBeUndefined()
})

test('no match shows no match in faint text', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'qqq')
  const t = await ui.find({ type: 'Text', text: 'no match' })
  expect(t).toBeDefined()
  expect(t.props.color).toBe('#4f5c68')
})

test('Enter on a file hit opens the file in the code area', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab.')
  await ui.input({ key: 'explorer:name', text: 'ab.', kind: 'submit' })
  await ui.redraw()
  expect(texts(await ui.drawn()).some(t => t.text.trim() === 'x')).toBe(true)
})

// The engine answers a ring move; the test engine has nothing beneath the plugins, so a test registers it first.
const ring = (on: any) => on('ui.focus', () => ({ value: {} }))
const step = async ($: any, ui: any, dir: 'up' | 'down', times = 1) => {
  for (let i = 0; i < times; i++) await $.ui.focus({ component: 'Pane', requestId: 'margin', element: `explorer:name:${dir}`, origin: { kind: 'person' } })
  await ui.redraw()
}
const litRows = async (ui: any) => {
  const out: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (String(n.key ?? n.props?.key).startsWith('x:') && n.props?.backgroundColor) {
      const left: any[] = []
      const inner = (m: any) => {
        if (!m || typeof m !== 'object') return
        if (Array.isArray(m)) return m.forEach(inner)
        if (m.props?.module && Array.isArray(m.props?.props?.left)) left.push(...m.props.props.left)
        inner([m.children, m.props?.children])
      }
      inner(n)
      return void out.push(left.map((x: any) => x.text).join('').trim())
    }
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return out
}
const rowsOf = async (ui: any) => (await nameRows(ui)).map(r => r.slice(r.indexOf(' ') + 1))

test('Down lights the first result, then the next', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  const rows = await nameRows(ui)
  expect(await litRows(ui)).toEqual([])
  await step($, ui, 'down')
  expect(await litRows(ui)).toEqual([rows[0]])
  await step($, ui, 'down')
  expect(await litRows(ui)).toEqual([rows[1]])
  expect(await ui.find({ key: 'explorer:name' })).toBeDefined()
})

test('Up from the first result clears the light', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  await step($, ui, 'down')
  await step($, ui, 'up')
  expect(await litRows(ui)).toEqual([])
})

test('Down stops at the last result', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  const rows = await nameRows(ui)
  await step($, ui, 'down', rows.length + 3)
  expect(await litRows(ui)).toEqual([rows.at(-1)])
})

test('Enter opens the lit result', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  const second = (await rowsOf(ui))[1]
  await step($, ui, 'down', 2)
  await ui.input({ key: 'explorer:name', text: 'ab', kind: 'submit' })
  await ui.redraw()
  const [name, parent] = second.split(' ')
  expect(await pathText(ui)).toBe(['repo', parent, name].filter(Boolean).join('/'))
})

test('typing clears the lit result, and Enter opens the top row again', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  await step($, ui, 'down', 2)
  await nameType(ui, 'ab.')
  expect(await litRows(ui)).toEqual([])
  await ui.input({ key: 'explorer:name', text: 'ab.', kind: 'submit' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/ab.ts')
})

test('the lit result scrolls into view', async ($, on) => {
  ring(on)
  const files = Array.from({ length: 40 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }))
  const ui = await explorerRoot($, on, { '/repo': files })
  listed.out = files.map(f => f.name).join('\0')
  await nameOpen(ui, 'f')
  await step($, ui, 'down', 25)
  expect(await litRows(ui)).toEqual([expect.stringContaining('f24.ts')])
  expect((await nameRows(ui)).some(r => r.includes('f00.ts'))).toBe(false)
})

test('the wheel still scrolls the results past a lit one', async ($, on) => {
  ring(on)
  const files = Array.from({ length: 40 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }))
  const ui = await explorerRoot($, on, { '/repo': files })
  listed.out = files.map(f => f.name).join('\0')
  await nameOpen(ui, 'f')
  await step($, ui, 'down')
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 10, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 0, row: 6 } })
  await ui.redraw()
  expect((await nameRows(ui)).some(r => r.includes('f00.ts'))).toBe(false)
})

test('the stand-ins are drawn with the field, and a step with no results keeps it open', async ($, on) => {
  ring(on)
  const ui = await nameRoot($, on)
  const drawn = async () => [!!(await ui.find({ key: 'explorer:name:up' })), !!(await ui.find({ key: 'explorer:name:down' }))]
  expect(await drawn()).toEqual([false, false])
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect(await drawn()).toEqual([true, true])
  await step($, ui, 'down')
  expect(await ui.find({ key: 'explorer:name' })).toBeDefined()
  await nameType(ui, 'qqq')
  await step($, ui, 'down')
  expect(await litRows(ui)).toEqual([])
  expect(await ui.find({ key: 'explorer:name' })).toBeDefined()
})

test('the name search leaves the tree scroll where it was, after clearing the text or opening a result', async ($, on) => {
  const files = Array.from({ length: 40 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}.ts`, kind: 'file' as const }))
  const ui = await explorerRoot($, on, { '/repo': files })
  listed.out = files.map(f => f.name).join('\0')
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 10, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 0, row: 6 } })
  await ui.redraw()
  const scrolled = async () => [!!(await treeRow(ui, 'f00.ts')), !!(await treeRow(ui, 'f10.ts'))]
  const seen = [await scrolled()]
  await nameOpen(ui, 'f1')
  await nameType(ui, '')
  seen.push(await scrolled())
  // Opening a result and going back returns to the tree's scroll, not the results'.
  disk.set('/repo/f10.ts', { text: 'x', mtimeMs: 1 })
  await nameType(ui, 'f1')
  await ui.input({ key: 'explorer:name', text: 'f1', kind: 'submit' })
  await ui.redraw()
  await ui.press({ key: 'back' })
  await ui.redraw()
  seen.push(await scrolled())
  expect(seen).toEqual([[false, true], [false, true], [false, true]])
})

test('a move ends the name search', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  open({ path: '/repo/ab.ts' })
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:name' })).toBeUndefined()
  open({ path: '/repo', kind: 'folder' })
  await ui.redraw()
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect((await ui.find({ key: (await keyMatching(ui, /^explorer:name(:\d+)?$/))! }))?.props.value).toBe('')
})

test('a find longer than fits beside the label drops the label and keeps up to the room without it', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'abcdefghijklmnopqr')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'lines with ' })).toBeUndefined()
  await findText(ui, 'x'.repeat(200))
  await ui.redraw()
  expect((await ui.find({ key: await fieldKey(ui) }))?.props.value).toBe('x'.repeat(20))
})

test('at the length limit a key typed mid-text is refused, so the text stays whole', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'abcdefghijklmnopqrst')
  await findText(ui, 'aZbcdefghijklmnopqrst')
  await ui.redraw()
  expect((await ui.find({ key: await fieldKey(ui) }))?.props.value).toBe('abcdefghijklmnopqrst')
})

test('the header centre keeps 2 cells clear of the buttons on each side, for the path and the field', async ($, on) => {
  const ui = await explorer($, on, { path: `/repo/${'deep/'.repeat(20)}a.ts` }, lines(300))
  expect((await ui.find({ key: 'path' }))?.props.marginX).toBe(2)
  // 44 columns less the 8 the buttons take and 2 gaps of 2.
  expect((await pathText(ui)).length).toBeLessThanOrEqual(32)
  expect(await ui.find({ key: 'explorer:header-right' })).toBeDefined()
  await search(ui, 'x'.repeat(200))
  expect((await ui.find({ key: await fieldKey(ui) }))?.props.value).toBe('x'.repeat(20))
  // While typing, the field takes the hidden buttons' cells and places itself.
  expect((await ui.find({ key: 'path' }))?.props.justifyContent).toBe('flex-start')
  expect(await ui.find({ key: 'explorer:header-right' })).toBeUndefined()
})

test('in a wide pane the find field fills the header centre, with only the header gap beside it', async ($, on) => {
  await setup($, on)
  disk.set('/repo/a.ts', { text: lines(3), mtimeMs: 1 })
  open({ path: '/repo/a.ts' })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 70 }, requestId: 'margin' })
  await search(ui, 'x'.repeat(200))
  // 70 less the rail (4) and padding (2), the left buttons (5), the gaps (4) and the cursor and Enter mark (9).
  expect((await ui.find({ key: await fieldKey(ui) }))?.props.value).toBe('x'.repeat(46))
})

test('a pane narrowed under the typed find keeps the text and refuses only growth', async ($, on) => {
  await setup($, on)
  disk.set('/repo/a.ts', { text: lines(300), mtimeMs: 1 })
  open({ path: '/repo/a.ts' })
  const mountAt = (cols: number) => $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: cols }, requestId: 'margin' })
  const wide = await mountAt(60)
  await wide.press({ key: 'explorer:search' })
  await wide.redraw()
  await findText(wide, 'x'.repeat(200))
  await wide.redraw()
  const full = (await wide.find({ key: await fieldKey(wide) }))?.props.value
  expect(full.length).toBeGreaterThan(20)
  await wide.unmount()
  const narrow = await mountAt(36)
  await narrow.redraw()
  await findText(narrow, full + 'y')
  await narrow.redraw()
  expect((await narrow.find({ key: await fieldKey(narrow) }))?.props.value).toBe(full)
  await findText(narrow, full.slice(1))
  await submit(narrow, full.slice(1))
  expect((await narrow.find({ key: await fieldKey(narrow) }))?.props.value).toBe(full.slice(1))
})

test('a find field reopened after the find ended is drawn with a new key and empty', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await search(ui, 'state')
  const before = await fieldKey(ui)
  disk.set('/repo/b.ts', { text: 'x', mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  await ui.redraw()
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const after = await fieldKey(ui)
  expect(after).not.toBe(before)
  expect((await ui.find({ key: after }))?.props.value).toBe('')
})

test('a name field reopened after the search ended is drawn with a new key and empty', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'ab')
  const nameKey = () => keyMatching(ui, /^explorer:name(:\d+)?$/)
  const before = await nameKey()
  open({ path: '/repo/ab.ts' })
  await ui.redraw()
  open({ path: '/repo', kind: 'folder' })
  await ui.redraw()
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const after = await nameKey()
  expect(after).not.toBe(before)
  expect((await ui.find({ key: after }))?.props.value).toBe('')
})

test('a name longer than fits beside the label drops the label', async ($, on) => {
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'abcdefghijklmnopqr')
  expect(await ui.find({ type: 'Text', text: 'named ' })).toBeUndefined()
})

test('the name field asks the pane for Escape even with text', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).closeOnEscape), { value: { isPlaced: true } }) as any)
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const ui = await nameRoot($, on)
  await nameOpen(ui, 'abc')
  await clock.advance(0)
  expect(opens.at(-1)).toBe(true)
})

test('the name field asks for the keys before the name listing returns', async ($, on) => {
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).focus), { value: { isPlaced: true } }) as any)
  const ui = await nameRoot($, on)
  hold.names = []
  const pressed = ui.press({ key: 'explorer:search' })
  await waitFor(() => hold.names!.length > 0 && opens.length > 0)
  const early = [...opens]
  hold.names.forEach(go => go())
  await pressed
  expect(early).toEqual([true])
})

test('while the name listing loads, typed text shows listing…, not no match, and Enter keeps the field', async ($, on) => {
  const ui = await nameRoot($, on)
  hold.names = []
  const pressed = ui.press({ key: 'explorer:search' })
  await waitFor(() => hold.names!.length > 0)
  await ui.redraw()
  await nameType(ui, 'ab')
  expect(await ui.find({ type: 'Text', text: 'listing…' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'no match' })).toBeUndefined()
  await ui.input({ key: 'explorer:name', text: 'ab', kind: 'submit' })
  await ui.redraw()
  expect(await ui.find({ key: 'explorer:name' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'listing…' })).toBeDefined()
  hold.names.forEach(go => go())
  await pressed
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'listing…' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'no match' })).toBeUndefined()
})

test('a field with text keeps its text drawn after a tab switch and back', async ($, on) => {
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  await findText(ui, 'foo')
  await ui.redraw()
  await ui.press({ key: 'Overview' })
  await ui.redraw()
  await ui.press({ key: 'Explorer' })
  await ui.redraw()
  expect((await ui.find({ key: await fieldKey(ui) }))?.props.value).toBe('foo')
})

test('a find with no match keeps the view where it was', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts', line: 150 }, lines(300))
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  const from = (await barOf(ui, 'explorer:vbar')).from
  expect(from).toBeGreaterThan(0)
  await findText(ui, 'zzz')
  await clock.advance(150)
  await ui.redraw()
  expect((await barOf(ui, 'explorer:vbar')).from).toBe(from)
})

test('an empty ls-files answer falls back to the walk', async () => {
  const { $, on } = engine()
  on('process.run', () => ran(0, ''))
  on('fs.list', () => ({ value: [{ name: 'a.ts', kind: 'file', isLink: false }] }))
  expect(await listNames($, '/r')).toEqual([{ path: 'a.ts', kind: 'file' }])
})

test('opening a field unpins the menu card', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(3))
  await ui.press({ key: 'menu' })
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('none')
})

test('opening the name field unpins the menu card', async ($, on) => {
  const ui = await nameRoot($, on)
  await ui.press({ key: 'menu' })
  await ui.redraw()
  await ui.press({ key: 'explorer:search' })
  await ui.redraw()
  expect((await ui.find({ key: 'explorer:menu-card' }))?.props.display).toBe('none')
})
