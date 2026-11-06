import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import Row from '../hooks/row'
import Divider from '../hooks/divider'
import { fileKey } from '../hooks/git-data'

// A process.run result with `stdout`.
const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
// Text a row Client draws: its pieces are props, so the tree's Texts never hold them. Each side joined alone.
const rowText = async (ui: { drawn: () => Promise<unknown> }, text: RegExp) => {
  const sides: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const p = n.props?.props
    if (Array.isArray(p?.left)) sides.push(p.left.map((x: any) => x.text).join(''), p.right.map((x: any) => x.text).join(''))
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return sides.find(t => text.test(t))
}
// Answers a git run with the first entry whose key is one of its arguments.
// A log answer written as "full short subject" lines, turned into the log's real format: \x1f fields, author HT0710.
const asLog = (text: string) =>
  text.split('\n').map(line => (!line || line.includes('\x1f') ? line : [...line.split(' ').slice(0, 2), 'HT0710', '1790000000', '', line.split(' ').slice(2).join(' ')].join('\x1f'))).join('\n')
// A status answer written as porcelain lines, in -z form: NUL-ended records, a rename as "XY new\0old".
const asStatusZ = (text: string) =>
  text.includes('\0') ? text : text.split('\n').filter(Boolean).map(line => (line.includes(' -> ') ? `${line.slice(0, 3)}${line.slice(3).split(' -> ').reverse().join('\0')}` : line)).join('\0') + '\0'
const git = (repo: Record<string, string>) => (argv: readonly string[]) => {
  if (argv[0] !== 'git') return undefined
  const [command, answer = ''] = Object.entries(repo).find(([command]) => argv.includes(command)) ?? []
  // Only the COMMITS read takes the \x1f format; a rebase's own log reads its tab format as written.
  if (command === 'status' && argv.includes('-z')) return asStatusZ(answer)
  return command === 'log' && argv.some(arg => arg.includes('%x1f')) ? asLog(answer) : answer
}
const BAR_ROWS = 2
// 20 tab rows under the top bar and its rule, as margin.test.ts sizes the bodies.
const props = {
  title: 'Panel',
  isFocused: false,
  bodyColumns: 67,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 22 + BAR_ROWS },
  view: {},
}
const MIN = 60e3
const NOW = 1_800_000_000_000
// An empty History, the clock at NOW, FETCH_HEAD `fetched` ago.
// `dir`: the git dir's files; fs.read answers from it by path under /repo/.git.
// `clock`: a mock clock the test drives, which answers clock.now itself.
// `dir`: file text by path; null, a file that is gone, so its read fails.
const quiet = (on: Parameters<TestBody>[1], fetched = 5 * MIN, basic = false, dir: Record<string, string | null> = {}, clock = false) => {
  if (!clock) on('clock.now', () => ({ value: NOW }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => {
    const text = dir[String((e as any).path).replace('/repo/.git/', '')]
    if (text === null) throw new Error('ENOENT')
    return { value: text ?? '' }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)
  on('fs.exists', (_, e) => ({ value: basic && String((e as any).path ?? '').endsWith('.claudzilla-basic-glyphs') }))
  const top = () => [...new Set(Object.keys(dir).filter(path => dir[path] !== null).map(path => path.split('/')[0]!))].map(name => ({ name, kind: name.includes('_') ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false }))
  on('fs.list', () => ({ value: [{ name: 'FETCH_HEAD', kind: 'file', size: 1, mtimeMs: NOW - fetched, isLink: false }, ...top()] }))
}
const refs = (names: string[]) => names.map(name => `${name}\torigin/${name}\t\t1790000000`).join('\n') + '\n'
const forty = Array.from({ length: 40 }, (_, i) => `b${String(i + 1).padStart(2, '0')}`)
const repoOn = (branch: string, more: Record<string, string> = {}) => ({
  status: `## ${branch}...origin/${branch}\n`,
  log: 'abc1234ffff abc1234 first\n',
  '--absolute-git-dir': '/repo/.git\n/repo/.git\n',
  'get-url': 'git@github.com:o/r.git\n',
  'for-each-ref': refs(forty),
  ...more,
})
const mount = async ($: Parameters<TestBody>[0]) => {
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  return ui
}
type Ui = Awaited<ReturnType<typeof mount>>
// A top row is a row Client: a press is a down and up on it, a hover its pointer entering.
const tap = async (ui: Ui, row: string) => {
  await ui.resize({ columns: 30, rows: 1, in: `row:${row}` })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: `row:${row}` })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: `row:${row}` })
}
const hover = (ui: Ui, row: string) => ui.pointer({ type: 'enter', x: 0, y: 0, in: `row:${row}` })
// A top row's Text as its row Client draws it: the innermost match, not the row's whole line.
const piece = async (ui: Ui, row: string, text: string | RegExp) => (await ui.findAll({ type: 'Text', text, in: `row:${row}` })).at(-1)
// The first branch the modal lists: the branch row reads "⎇ b20", so a bare name is the modal's.
const firstListed = async (ui: Ui) => (await ui.findAll({ type: 'Text', text: /^b\d\d$/ }))[0]?.text
// Column 33: the pane's middle, inside a centred modal.
const wheel = ($: Parameters<TestBody>[0], by: number, row: number, column = 33) =>
  $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 24, contentRows: 24, origin: { kind: 'person' }, pointer: { column, row } })

test('branch row: name, one mark only when needed, no counts', async ($, on) => {
  quiet(on)
  const repo = repoOn('a', { status: '## a...origin/a [ahead 1, behind 2]\n' })
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, 'branch', '⎇ a')).toBeDefined()
  expect((await piece(ui, 'branch', ' ↕'))?.props.color).toBe('#b48ead')
  repo.status = '## a...origin/a [ahead 1]\n'
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(await piece(ui, 'branch', / [↓↕✗]$/)).toBeUndefined()
})

test('fetch button shows the fetch age, presses git fetch origin', async ($, on) => {
  quiet(on)
  const runs: string[] = []
  // The fetch waits on `release`, so the row is looked at mid-fetch from outside: the press's message is still in flight.
  let started = () => {}
  let release = () => {}
  const reached = new Promise<void>(r => (started = r))
  const gate = new Promise<void>(r => (release = r))
  on('process.run', async (_, e) => {
    runs.push(e.argv.join(' '))
    if (e.argv[1] === 'fetch') {
      started()
      await gate
    }
    return ran(git(repoOn('a'))(e.argv) ?? '')
  })
  const ui = await mount($)
  expect(await piece(ui, 'fetch', ' 5m')).toBeDefined()
  const pressed = tap(ui, 'fetch')
  await reached
  expect(await piece(ui, 'fetch', '◌ fetching')).toBeDefined()
  release()
  await pressed
  expect(runs).toContain('git fetch origin')
  expect(await piece(ui, 'fetch', '◌ fetching')).toBeUndefined()
})

test('a long branch name leaves room for "◌ fetching" while a fetch runs', async ($, on) => {
  quiet(on)
  const name = `feat/${'x'.repeat(80)}`
  let started = () => {}
  let release = () => {}
  const reached = new Promise<void>(r => (started = r))
  const gate = new Promise<void>(r => (release = r))
  on('process.run', async (_, e) => {
    if (e.argv[1] === 'fetch') {
      started()
      await gate
    }
    return ran(git(repoOn(name))(e.argv) ?? '')
  })
  const ui = await mount($)
  const pressed = tap(ui, 'fetch')
  await reached
  // "⎇ " and the name: the body less its padding (2 + 2), the fetch row's 10 columns and the 5 kept beside them.
  expect([...((await piece(ui, 'branch', /^⎇/))?.text ?? '')].length).toBeLessThanOrEqual(2 + 67 - 4 - 10 - 5)
  release()
  await pressed
})

test('a stale fetch age is warning-coloured', async ($, on) => {
  quiet(on, 60 * MIN)
  on('process.run', (_, e) => ran(git(repoOn('a'))(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, 'fetch', ' 1h'))?.props.color).toBe('warning')
})

test('fetch card: fetched time and remote', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('a'))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'fetch')
  // Labels as wide as the card's longest, "fetched", and 2 more.
  expect(await ui.find({ type: 'Text', text: /^fetched  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^remote   $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'git@github.com:o/r.git' })).toBeDefined()
})

test('fetch card holds to the card width: a long remote URL is cut in the middle', async ($, on) => {
  quiet(on)
  const url = `/home/me/${'very-long-folder/'.repeat(8)}origin.git`
  on('process.run', (_, e) => ran(git(repoOn('a', { 'get-url': `${url}\n` }))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'fetch')
  const shown = (await ui.findAll({ type: 'Text', text: /origin\.git$/ })).at(-1)?.text ?? ''
  expect(shown).toMatch(/^\/home\/me\/.*…\/origin\.git$/)
  // The card is 75% of the 67-column body: 50 columns, 21 of them taken around the URL:
  // Border and padding 4, the 9-column label, "origin  ".
  expect(shown.length).toBe(50 - 21)
})

test('branch card: upstream sync and stash count', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('a', { status: '## a...origin/a [ahead 1]\n', stash: 'WIP on a: x\nWIP on b: y\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'branch')
  expect((await ui.findAll({ type: 'Text', text: '↑1' })).some(t => t.props.color === '#d4b860')).toBe(true)
  expect(await ui.find({ type: 'Text', text: '1 on this branch' })).toBeDefined()
})

test('branch card, never pushed: local is the upstream value, normal text, with nothing at the far right', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('a', { status: '## a\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'branch')
  const { card, find } = await cardTexts(ui, 'branch')
  const own = (n: any) => [n.children ?? n.props?.children].flat().filter((c: unknown) => typeof c === 'string').join('')
  const row = find(card, n => n.type === 'Box' && n.props?.justifyContent === 'space-between')[0]
  const [left, right] = [row.children ?? row.props.children].flat()
  const local = find(left, n => n.type === 'Text' && own(n) === 'local')[0]
  expect(local).toBeDefined()
  expect(local.props?.color).toBeUndefined()
  expect(find(right, n => n.type === 'Text').map(own).join('').trim()).toBe('')
})

test('basic-glyphs mode swaps the fetch icon for ↻', async ($, on) => {
  quiet(on, 5 * MIN, true)
  on('process.run', (_, e) => ran(git(repoOn('a'))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, 'fetch', '↻ 5m')).toBeDefined()
})

test('branch modal columns: each as wide as its widest cell, 2 columns apart', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const modal = await ui.find({ type: 'Box', key: 'modal' })
  const groups = find(await ui.drawn(), n => n.type === 'Box' && n.props?.gap === 2)
  expect(modal).toBeDefined()
  // Every row's name and columns share their widths.
  const widths = groups.map(g => JSON.stringify(find(g.props?.children ?? g.children, n => n.type === 'Box' && n.props?.width !== undefined).map(n => n.props.width))).filter(w => w !== '[]')
  expect(widths.length).toBeGreaterThan(1)
  expect(new Set(widths).size).toBe(1)
})

test('pressing the branch opens the branch modal, centred on the current branch; ✕ closes it', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeDefined()
  expect(await firstListed(ui)).toBe('b14')
  // The current branch: bold, in the branch green, on the lit row.
  expect((await ui.find({ type: 'Text', text: /^b20$/ }))?.props).toMatchObject({ bold: true, color: '#5d9678' })
  await ui.press({ key: 'm:x' })
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeUndefined()
})

test('a tab press closes the modal and does nothing else in the Git tab', async ($, on) => {
  quiet(on)
  const runs: string[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    return ran(git(repoOn('b20'))(e.argv) ?? '')
  })
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'History' })
  await ui.press({ key: 'Git' })
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeUndefined()
  expect(runs).not.toContain('git fetch origin')
})

test('rows behind an open modal fade to the one dim colour and lose hover; the row that opened it stays, lit', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20', { log: 'def5678ffff def5678 fix: pushed one\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  // The opened row: its colour kept, inverted.
  expect((await piece(ui, 'branch', '⎇ b20'))?.props).toMatchObject({ color: '#5d9678', backgroundColor: '#0f1c28' })
  // Nothing behind presses or lights under the pointer but the opened row: the other rows faded.
  expect((await ui.find({ key: 'row:fetch' }))?.props.props).toMatchObject({ faded: true })
  expect((await ui.find({ key: 'row:branch' }))?.props.props).toMatchObject({ open: '#0f1c28' })
  // The pane's own rules, the body less one margin, stay as drawn: they frame the pane, not the tab.
  expect((await ui.find({ type: 'Text', text: /^─{65}$/ }))?.props.color).toBe('promptBorder')
  // Behind: faint and plain text alike in the one dim colour, so a faint row never goes darker than a plain one.
  const left = ((await ui.find({ key: 'row:c:def5678ffff' }))?.props.props as { left: { text: string; color?: string }[] }).left
  expect(left.find(p => p.text === 'fix')?.color).toBe('#3a424a')
  expect(left.find(p => /pushed one/.test(p.text))?.color).toBe('#3a424a')
  expect((await ui.findAll({ type: 'Text' })).filter(t => t.props.hover)).toEqual([])
  expect(await ui.findAll({ type: 'Link' })).toEqual([])
})

test('a press on the row that opened the modal closes it', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await tap(ui, 'branch')
  expect(await ui.find({ key: 'modal' })).toBeUndefined()
})

test('the rules behind an open modal fade too, the ⇕ divider included', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20', { status: '## b20...origin/b20\n M a.ts\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  // The rule under the top rows spans the body, 67 less its 2-column margins.
  expect((await ui.find({ type: 'Text', text: /^─{63}$/ }))?.props.color).toBe('#3a424a')
  expect(JSON.stringify((await ui.find({ key: 'divider' }))?.props)).toContain('"faded":true')
})

test('a back-to-top line behind an open modal fades and takes no click', async ($, on) => {
  quiet(on)
  const files = Array.from({ length: 30 }, (_, i) => ` M f${i}.ts\n`).join('')
  on('process.run', (_, e) => ran(git(repoOn('b20', { status: `## b20...origin/b20\n${files}` }))(e.argv) ?? ''))
  const ui = await mount($)
  await wheel($, 5, 6)
  expect(await ui.find({ type: 'Text', text: /f0\.ts/ })).toBeUndefined()
  await tap(ui, 'branch')
  expect(JSON.stringify((await ui.find({ key: 'top:changes' }))?.props)).toContain('"faded":true')
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'top:changes' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'top:changes' })
  expect(await ui.find({ type: 'Text', text: /f0\.ts/ })).toBeUndefined()
})

test('under a PR modal the branch row fades; the PR row keeps its colours on the lit row', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()])
  const ui = await openPr($)
  expect((await piece(ui, 'branch', '⎇ a'))?.props.color).toBe('#3a424a')
  expect((await piece(ui, 'pr', '#168'))?.props).toMatchObject({ color: 'claude', backgroundColor: '#0f1c28' })
})

test('under a stacked modal the modal fades too', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 6 }, (_, i) => checkRun(`k${i}`, 'SUCCESS')) })])
  const ui = await openPr($)
  await ui.press({ key: 'm:all:CHECKS' })
  // HUD.label #a396d2 dimmed in the modal; in full in the stacked modal's pinned title.
  const colours = (await ui.findAll({ type: 'Text', text: 'CHECKS' })).map(t => t.props.color)
  expect(colours).toContain('#3a424a')
  expect(colours).toContain('#a396d2')
})

test('the wheel inside the modal scrolls its list one row a tick; outside it does nothing', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await wheel($, 1, 10)
  expect(await firstListed(ui)).toBe('b15')
  await wheel($, 1, 0)
  expect(await firstListed(ui)).toBe('b15')
  await wheel($, 1, 10, 1)
  expect(await firstListed(ui)).toBe('b15')
})

test('cues: ↓ N more at the bottom; once scrolled the divider reads ↑ N more', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b01'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Button', key: 'm:up' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 27 more' })).toBeDefined()
  await wheel($, 1, 10)
  expect(await ui.find({ type: 'Button', key: 'm:up' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 1 more ' })).toBeDefined()
})

test('↓ turns the page; ↑ goes back to the top', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b01'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'm:down' })
  expect(await firstListed(ui)).toBe('b14')
  await ui.press({ key: 'm:up' })
  expect(await firstListed(ui)).toBe('b01')
})

test('a narrow body still gives the modal 1-column insets', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b01'))(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 20 }, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await tap(ui, 'branch')
  const box = await ui.find({ type: 'Box', key: 'modal' })
  // Placed in the body, inside its 2-column margin.
  expect(Number(box?.props.left) + 2).toBe(1)
  expect(box?.props.width).toBe(18)
})

test("a shrunk list clamps the modal's offset", async ($, on) => {
  quiet(on)
  const repo = repoOn('b01')
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'm:down' })
  await ui.press({ key: 'm:down' })
  expect(await firstListed(ui)).toBe('b27')
  repo['for-each-ref'] = refs(forty.slice(0, 20))
  await $.tool.call({ tool: 'Bash', command: 'git branch -D x' })
  expect(await firstListed(ui)).toBe('b07')
  expect(await ui.find({ type: 'Text', text: 'b20' })).toBeDefined()
})

test('a tool call keeps the open modal and its offset', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await wheel($, 1, 10)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await firstListed(ui)).toBe('b15')
})

const treeRepo = (current: string) => repoOn(current, {
  'for-each-ref': ['main\torigin/main\t\t1790000000', 'feat/a\torigin/feat/a\t\t1790000000', 'fix/b\t\t\t1790000000', 'wip/c\t\t\t1790000000'].join('\n') + '\n',
  worktree: 'worktree /r\nbranch refs/heads/main\n\nworktree /r-b\nbranch refs/heads/fix/b\n',
  'symbolic-ref': 'origin/main\n',
})

test('branch modal: base and prefix views, the chosen one plain', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(treeRepo('feat/a'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Text', text: '├─ ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'm:by:base' })).toBeUndefined()
  await ui.press({ key: 'm:by:prefix' })
  expect(await ui.find({ type: 'Button', key: 'm:by:base' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^wip\/$/ })).toBeDefined()
})

test('prefixes take their type colour; others faint', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(treeRepo('main'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect((await ui.find({ type: 'Text', text: /^feat\/$/ }))?.props.color).toBe('#98c379')
  expect((await ui.find({ type: 'Text', text: /^fix\/$/ }))?.props.color).toBe('#e06c75')
  expect((await ui.find({ type: 'Text', text: /^wip\/$/ }))?.props.color).toBe('#4f5c68')
})

test('a worktree branch gets ⧉', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(treeRepo('main'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Text', text: ' ⧉' })).toBeDefined()
})

// /home/me/repo on feat/a, the main one; /home/me/repo-b on fix/b, /tmp/w detached, /home/me/repo-c gone.
const TREES = [
  'worktree /home/me/repo\nHEAD abc\nbranch refs/heads/feat/a',
  'worktree /home/me/repo-b\nHEAD def\nbranch refs/heads/fix/b',
  'worktree /tmp/w\nHEAD 0123456789abcdef\ndetached',
  'worktree /home/me/repo-c\nHEAD fed\nbranch refs/heads/wip\nprunable gitdir file points to non-existent location',
].join('\n\n') + '\n'
// `here`: the worktree this session runs in, on its branch.
// `asked`: the status runs in other worktrees. `more`: this repo's answers over repoOn's.
const withTrees = (on: Parameters<TestBody>[1], list: string, dirty: Record<string, string> = {}, here = '/home/me/repo', branch = 'feat/a', asked: string[] = [], more: Record<string, string> = {}) =>
  on('process.run', (_, e) => {
    const at = e.argv.indexOf('-C')
    if (at >= 0) {
      asked.push(e.argv.join(' '))
      return ran(dirty[e.argv[at + 1]!] ?? '')
    }
    return ran(git(repoOn(branch, {
      '--absolute-git-dir': `${here}/.git\n/home/me/repo/.git\n${here}\n`,
      'for-each-ref': 'feat/a\torigin/feat/a\t\t1790000000\nfix/b\torigin/fix/b\t[ahead 2]\t1790000000\nwip\t\t\t1790000000\n',
      worktree: list,
      'symbolic-ref': 'origin/main\n',
      ...more,
    }))(e.argv) ?? '')
  })
const worktreeView = async (ui: Ui) => {
  await tap(ui, 'branch')
  await ui.press({ key: 'm:by:worktrees' })
}

test('status runs in each other worktree only while the worktrees view shows, not this one or a gone one', async ($, on) => {
  quiet(on)
  const asked: string[] = []
  withTrees(on, TREES, {}, undefined, undefined, asked)
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(asked).toEqual([])
  await ui.press({ key: 'm:by:worktrees' })
  expect(asked).toEqual(['git --no-optional-locks -C /home/me/repo-b status --porcelain', 'git --no-optional-locks -C /tmp/w status --porcelain'])
})

test('base view: columns follow the widest name, not the far right', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(treeRepo('main'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  // The widest: `├─ fix/b ⧉`. Every branch row's name column matches it.
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.width === 10).length).toBe(4)
})

test('the branch modal narrows to its content, far from the pane edges', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(treeRepo('main'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  const modal = await ui.find({ type: 'Box', key: 'modal' })
  expect(modal?.props.width).toBeLessThan(props.bodyColumns * 0.7)
  expect(Math.abs(modal!.props.left + 1 + modal!.props.width / 2 - props.bodyColumns / 2)).toBeLessThanOrEqual(2)
})

test('prefix view: a long heading stays whole, the modal widening to it', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('main', { 'for-each-ref': 'main\t\t\t1790000000\naverylongprefixname/x\t\t\t1790000000\n', worktree: 'worktree /r\nbranch refs/heads/main\n', 'symbolic-ref': 'origin/main\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'm:by:prefix' })
  expect(await ui.find({ type: 'Text', text: 'averylongprefixname/' })).toBeDefined()
})

test('from a linked worktree, status skips the main one', async ($, on) => {
  quiet(on)
  const asked: string[] = []
  withTrees(on, TREES, {}, '/home/me/repo-b', 'fix/b', asked)
  const ui = await mount($)
  await worktreeView(ui)
  expect(asked).toEqual(['git --no-optional-locks -C /tmp/w status --porcelain'])
})

test('worktrees view: the lit row counts its own changes', async ($, on) => {
  quiet(on)
  withTrees(on, TREES, {}, '/home/me/repo-b', 'fix/b', [], { status: '## fix/b...origin/fix/b\n M x\n?? y\n' })
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: '2 changed' })).toBeDefined()
})

test('worktrees view: sync and changes keep their own columns', async ($, on) => {
  quiet(on)
  withTrees(on, TREES, { '/home/me/repo-b': ' M x\n' })
  const ui = await mount($)
  await worktreeView(ui)
  // Each row's second cell as wide as `1 changed`, also the row with none.
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.width === 9 && box.props.justifyContent === 'flex-end').length).toBe(3)
})

test('worktrees view: sync and changes follow the widest name, not the far right', async ($, on) => {
  quiet(on)
  withTrees(on, TREES)
  const ui = await mount($)
  await worktreeView(ui)
  // The widest: the detached `0123456 /tmp/w`. Every row's name column matches it.
  expect((await ui.findAll({ type: 'Box' })).filter(box => box.props.width === 14).length).toBe(3)
})

test('a detached worktree under home, not beside the main one, reads from ~', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.replace('/tmp/w', '/home/me/w/x').replace('worktree /home/me/repo\n', 'worktree /home/me/d/repo\n'), {}, '/home/me/d/repo')
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: ' ~/w/x' })).toBeDefined()
})

test('a main worktree at the root folder gives no ../ paths', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.replace('worktree /home/me/repo\n', 'worktree /repo\n'), {}, '/repo')
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: ' /tmp/w' })).toBeDefined()
})

test('a failed worktree list draws no mark and no worktrees view', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => (e.argv.includes('worktree') ? ran('', 1) : ran(git(repoOn('a'))(e.argv) ?? '')))
  const ui = await mount($)
  expect(await piece(ui, 'branch', ' ⧉')).toBeUndefined()
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Button', key: 'm:by:worktrees' })).toBeUndefined()
})

test('the worktrees view falls back to base once the linked worktree is gone', async ($, on) => {
  quiet(on)
  let list = TREES
  on('process.run', (_, e) => ran(git(repoOn('feat/a', { '--absolute-git-dir': '/home/me/repo/.git\n/home/me/repo/.git\n/home/me/repo\n', worktree: list, 'for-each-ref': 'feat/a\torigin/feat/a\t\t1790000000\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await worktreeView(ui)
  list = TREES.split('\n\n')[0]!
  await $.tool.call({ tool: 'Bash', command: 'true' })
  expect(await ui.find({ type: 'Button', key: 'm:by:worktrees' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'm:by:base' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'm:by:prefix' })).toBeDefined()
})

test('in a linked worktree the branch name takes a faint ⧉', async ($, on) => {
  quiet(on)
  withTrees(on, TREES, {}, '/home/me/repo-b', 'fix/b')
  const ui = await mount($)
  expect((await piece(ui, 'branch', ' ⧉'))?.props.color).toBe('#4f5c68')
})

test('the main worktree draws no ⧉ on the branch row, and no worktree row', async ($, on) => {
  quiet(on)
  withTrees(on, TREES)
  const ui = await mount($)
  expect(await piece(ui, 'branch', ' ⧉')).toBeUndefined()
  expect(await ui.find({ key: 'row:worktrees' })).toBeUndefined()
})

test('no linked worktree: the branch modal has no worktrees view', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.split('\n\n')[0]!)
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Button', key: 'm:by:worktrees' })).toBeUndefined()
})

test('worktrees view: linked only, this one lit, a path only when detached, sync and changes, gone', async ($, on) => {
  quiet(on)
  withTrees(on, TREES, { '/tmp/w': ' M x\n M y\n?? z\n' }, '/home/me/repo-b', 'fix/b')
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: /⧉ worktrees/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'feat/a' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'fix/b' }))?.props).toMatchObject({ color: '#5d9678', bold: true })
  expect(await ui.find({ type: 'Text', text: /\.\.\/repo/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text', text: '↑2' })).at(-1)?.props.color).toBe('#d4b860')
  expect(await ui.find({ type: 'Text', text: '3 changed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0123456' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' /tmp/w' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'gone' })).toBeDefined()
})

test('a detached path too long for the modal loses its start, keeping its last folder', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.replace('/tmp/w', '/home/me/a-very-long-folder-name-for-this-worktree-that-runs-past-the-modal-edge'))
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: /^ …[\w-]*-past-the-modal-edge$/ })).toBeDefined()
})

test('in a narrow pane a long branch name is cut and a detached path dropped, the far right kept', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.replace('fix/b', 'fix/a-branch-name-much-too-long-for-a-narrow-modal'), { '/home/me/repo-b': ' M x\n' })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 30 }, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: /^a-.*…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' /tmp/w' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '1 changed' })).toBeDefined()
})

test('the base and prefix switch re-centres on the current branch', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'm:down' })
  await ui.press({ key: 'm:by:prefix' })
  expect(await firstListed(ui)).toBe('b14')
})

const HOUR = 3600e3
const iso = (ms: number) => new Date(ms).toISOString()
// A gh pr list row; checks: test passed, lint running, release skipped.
const prJson = (over: Record<string, unknown> = {}) => ({
  number: 168, title: 'feat(margin): Git PR section', state: 'OPEN', isDraft: false, headRefName: 'a', baseRefName: 'release/1.7', isCrossRepository: false,
  author: { login: 'HT0710' }, createdAt: iso(NOW - 2 * HOUR), mergedAt: null, closedAt: null, additions: 160, deletions: 8, changedFiles: 2,
  mergeable: 'MERGEABLE', url: 'https://github.com/o/r/pull/168',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: iso(NOW - HOUR), completedAt: iso(NOW - HOUR + 65e3), detailsUrl: '' },
    { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '', detailsUrl: '' },
    { __typename: 'CheckRun', name: 'release', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: '' },
  ],
  ...over,
})
// git answers from `repo`; gh pr list with `prs`, or fails.
const withGh = (on: Parameters<TestBody>[1], repo: Record<string, string>, prs: unknown[] | 'fail') =>
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return prs === 'fail' ? ran('', 1) : ran(JSON.stringify(prs))
    return ran(git(repo)(e.argv) ?? '')
  })

test('open PR row: number, base, CI word and pill', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a'), [prJson()])
  const ui = await mount($)
  expect((await piece(ui, 'pr', '#168'))?.props.color).toBe('claude')
  expect((await piece(ui, 'pr', ' into '))?.props.color).toBe('#4f5c68')
  expect((await piece(ui, 'pr', '◌ CI running'))?.props.color).toBe('claude')
  expect((await piece(ui, 'pr', 'open'))?.props.backgroundColor).toBe('#1d3a2a')
  expect(await piece(ui, 'pr', ' ')).toBeDefined()
})

test('behind base shows ! in warning; conflicting shows ✗', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a', { 'HEAD..origin/release/1.7': '3\n' }), [prJson()])
  const ui = await mount($)
  expect((await piece(ui, 'pr', ' !'))?.props.color).toBe('warning')
})

test('a conflicting PR shows ✗ after its base', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a'), [prJson({ mergeable: 'CONFLICTING' })])
  const ui = await mount($)
  expect((await piece(ui, 'pr', ' ✗'))?.props.color).toBe('#e06c75')
})

test('a merged PR row is dimmed with only its pill', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a', { 'HEAD..origin/release/1.7': '3\n' }), [prJson({ state: 'MERGED', mergedAt: iso(NOW - 2 * HOUR) })])
  const ui = await mount($)
  expect((await piece(ui, 'pr', '#168'))?.props.dimColor).toBe(true)
  expect(await piece(ui, 'pr', /CI /)).toBeUndefined()
  expect(await piece(ui, 'pr', 'merged')).toBeDefined()
  // Behind its base no longer matters once merged.
  expect(await piece(ui, 'pr', ' !')).toBeUndefined()
})

test('no PR, no row; the rule follows the branch row', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a'), [prJson({ headRefName: 'other' })])
  const ui = await mount($)
  expect(await ui.find({ key: 'row:pr' })).toBeUndefined()
})

test('a failing gh leaves no PR row and no toast', async ($, on) => {
  quiet(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as any).text))
    return {} as any
  })
  withGh(on, repoOn('a'), 'fail')
  const ui = await mount($)
  expect(await ui.find({ key: 'row:pr' })).toBeUndefined()
  expect(toasts).toEqual([])
})

test('PR card, open: base, checks with the check that needs attention, changes', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a', { 'origin/release/1.7..HEAD': '2\n' }), [prJson()])
  const ui = await mount($)
  await hover(ui, 'pr')
  expect(await ui.find({ type: 'Text', text: '✓ up to date' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 1 of 3 passed' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: 'lint' })).map(t => t.props.color)).toContain('claude')
  expect(await ui.find({ type: 'Text', text: '2 commits · 2 files' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+160' })).toBeDefined()
})

test('a card is as wide as its widest row, up to 75%, placed by its item: left, right, or centred for a whole row', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  withPr(on, conflictRepo(), [prJson({ headRefName: 'feat/x', title: `feat(x): ${'a long title '.repeat(10)}` })])
  const ui = await mount($)
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const drawn = await ui.drawn()
  const card = (key: string) => find(drawn, n => n.hover?.scope === `card:${key}` && n.props?.position === 'absolute')[0]?.props
  const [branch, fetch, rebase, pr] = ['branch', 'fetch', 'rebase', 'pr'].map(card)
  expect(branch.left).toBe(0)
  expect(fetch.right).toBe(0)
  // The PR card's long title takes the cap; the rebase card's short rows keep it narrower. Both centred alike.
  expect(rebase.width).toBeLessThan(pr.width)
  expect(Math.abs(rebase.left + rebase.width / 2 - (pr.left + pr.width / 2))).toBeLessThanOrEqual(1)
  expect(branch.width).toBeLessThanOrEqual(pr.width)
})

test("a card's far-right texts all start past its longest info", async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a', { 'origin/release/1.7..HEAD': '2\n' }), [prJson()])
  const ui = await mount($)
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const card = find(await ui.drawn(), n => n.hover?.scope === 'card:pr' && n.props?.position === 'absolute')[0]
  // Label 1 in + "changes" and 2 more, then the longest info, "2 commits · 2 files".
  const widths = find(card, n => n.type === 'Box' && n.props?.flexShrink === 0 && n.props?.width !== undefined).map(n => n.props.width)
  expect(widths.length).toBeGreaterThan(1)
  expect(new Set(widths)).toEqual(new Set([10 + '2 commits · 2 files'.length]))
})

test("every card draws hidden till hover; the left row's card, and any over the same rows, waits for a row's enter", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  quiet(on, 5 * MIN, false, rebaseDir(2), true)
  withPr(on, conflictRepo(), [prJson({ headRefName: 'feat/x' })])
  const ui = await mount($)
  const drawn = async () => ({
    branch: !!(await ui.find({ type: 'Text', text: /upstream/ })),
    rebase: !!(await ui.find({ type: 'Text', text: '2 of 3' })),
    pr: !!(await ui.find({ type: 'Text', text: /^ checks/ })),
  })
  expect(await drawn()).toEqual({ branch: true, rebase: true, pr: true })
  // Off the branch row, as onto its card: once the leave lands, its card and the two over the same rows go.
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'row:branch' })
  await clock.advance(30)
  expect(await drawn()).toEqual({ branch: false, rebase: false, pr: false })
  // The PR row lies under the branch card: entered, its own card draws, the others stay out.
  await hover(ui, 'pr')
  expect(await drawn()).toEqual({ branch: false, rebase: false, pr: true })
  await hover(ui, 'branch')
  expect(await drawn()).toEqual({ branch: true, rebase: true, pr: true })
})

test('a leave the next row\'s enter follows in time drops no card, as a draw between the two would flicker', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  quiet(on, 5 * MIN, false, rebaseDir(2), true)
  withPr(on, conflictRepo(), [prJson({ headRefName: 'feat/x' })])
  const ui = await mount($)
  const rebaseCard = async () => !!(await ui.find({ type: 'Text', text: '2 of 3' }))
  await hover(ui, 'branch')
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'row:branch' })
  expect(await rebaseCard()).toBe(true)
  await clock.advance(10)
  await hover(ui, 'rebase')
  await clock.advance(30)
  expect(await rebaseCard()).toBe(true)
})

test("the divider's dimmed rule and grip sit in a Text, so pointing at the divider never heats the dim group", async () => {
  const tag = (name: string) => Object.assign((props: object) => ({ type: name, props }), { tag: name })
  const surface = { elements: { Box: tag('Box'), Text: tag('Text') }, onPointer: () => {}, columns: 40 }
  const tree = Divider({ split: 3, min: 1, max: 5, line: 'line:4' }, surface as any)
  // Each Text with the dim hover, and whether a Text holds it.
  const dims: boolean[] = []
  const walk = (node: any, inText: boolean) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(n => walk(n, inText))
    const name = typeof node.type === 'function' ? node.type.tag : node.type
    if (node.props?.hover?.scope === 'line:4') dims.push(inText)
    walk(node.props?.children, inText || name === 'Text')
  }
  walk(tree, false)
  expect(dims.length).toBe(3)
  expect(dims.every(Boolean)).toBe(true)
})

test("a row Client's right pieces sit in a Text, as its left ones do, so the line above's dim never heats from them", async () => {
  // Tags each element whether the JSX runtime calls it or keeps it as the node's type.
  const tag = (name: string) => Object.assign((props: object) => ({ type: name, props }), { tag: name })
  const surface = { elements: { Box: tag('Box'), Text: tag('Text') }, onPointer: () => {} }
  const tree = Row({ left: [{ text: 'left' }], right: [{ text: 'right' }], line: 'line:1' }, surface as any)
  // The element tags from the root down to the Text holding `text`.
  const path = (node: any, text: string, up: string[] = []): string[] | undefined => {
    if (!node || typeof node !== 'object') return undefined
    if (Array.isArray(node)) return node.map(child => path(child, text, up)).find(Boolean)
    const name = typeof node.type === 'function' ? node.type.tag : node.type
    const kids = node.props?.children
    if (kids === text || (Array.isArray(kids) && kids.includes(text))) return [...up, name]
    return path(kids, text, [...up, name])
  }
  for (const side of ['left', 'right']) expect(path(tree, side)!.filter(name => name === 'Text').length).toBe(2)
})

test('the fetch row, an action, inverts under the pointer as a button does; a row that opens a modal lights', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  const pieces = async (key: string) => ((await ui.find({ key: `row:${key}` }))?.props.props as { left: { hover?: object }[]; right: { hover?: object }[] })
  const fetch = await pieces('fetch')
  expect([...fetch.left, ...fetch.right].every(p => JSON.stringify(p.hover) === JSON.stringify({ scope: 'card:fetch', inverse: true }))).toBe(true)
  // Its group lights nothing else: no lit background on the row.
  const groups = (node: any): object[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(groups)
    : [...(node.hover?.scope === 'card:fetch' && node.type === 'Box' ? [node.hover] : []), ...groups([node.props?.children, node.children])]
  expect((await groups(await ui.drawn())).some(h => 'backgroundColor' in h)).toBe(false)
  expect((await pieces('branch')).left.some(p => p.hover)).toBe(false)
})

test('a card hangs one row below its row: a step down lands on the next row, not on the card', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()])
  const ui = await mount($)
  const top = async (key: string) => {
    const find = (node: any): any =>
      !node || typeof node !== 'object' ? undefined
      : Array.isArray(node) ? node.map(find).find(Boolean)
      : node.props?.position === 'absolute' && node.hover?.scope === `card:${key}` ? node : find([node.props?.children, node.children])
    return find(await ui.drawn())?.props.top
  }
  // The branch row, then the PR row: each card one row below its row.
  expect(await top('branch')).toBe(2)
  expect(await top('pr')).toBe(3)
})

test('the line below a hovered row fades in the engine: each row heats its line, the next line carries the fade', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  withPr(on, conflictRepo(), [prJson({ headRefName: 'feat/x' })])
  const ui = await mount($)
  type Row = { line?: string; left: { text: string; hover?: object }[] }
  const row = async (key: string) => (await ui.find({ key: `row:${key}` }))?.props.props as Row
  const lead = async (key: string) => (await row(key)).left.find(p => p.text.trim())?.hover
  expect(await Promise.all(['branch', 'fetch', 'rebase', 'pr'].map(async key => (await row(key)).line))).toEqual(['line:0', 'line:0', 'line:1', 'line:2'])
  expect(await lead('branch')).toBeUndefined()
  expect(await lead('rebase')).toEqual({ scope: 'line:0', color: '#3a424a' })
  expect(await lead('pr')).toEqual({ scope: 'line:1', color: '#3a424a' })
  // Under the last line the rule fades.
  const hovers = (node: unknown): object[] => {
    const el = node as { type?: string; hover?: { scope?: string }; children?: unknown[] }
    if (typeof node !== 'object' || !el) return []
    return [...(el.type === 'Text' && el.hover?.scope?.startsWith('line:') ? [el.hover] : []), ...(el.children ?? []).flatMap(hovers)]
  }
  expect(hovers(await ui.drawn())).toEqual([{ scope: 'line:2', color: '#3a424a' }])
})

test('a press opens the modal from a hovered row; once it closes no row stays dimmed', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  withPr(on, conflictRepo(), [prJson({ headRefName: 'feat/x' })])
  const ui = await mount($)
  const colour = async (row: string) => ((await ui.find({ key: `row:${row}` }))?.props.props as { left: { text: string; color?: string }[] } | undefined)?.left.find(p => p.text.trim())?.color
  const rest = await colour('rebase')
  await hover(ui, 'branch')
  await tap(ui, 'branch')
  await ui.press({ key: 'm:x' })
  expect(await ui.find({ key: 'modal' })).toBeUndefined()
  expect(await colour('rebase')).toBe(rest)
})

test('a dimmed row takes the one dim colour, a theme key too', async ($, on) => {
  quiet(on, 5 * MIN, false, { ...rebaseDir(2), '/home/me/themes/mine.json': JSON.stringify({ name: 'mine', base: 'dark', overrides: { warning: '#d9a441' } }) })
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'custom:mine' }] }) as any)
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  const pieces = ((await ui.find({ key: 'row:rebase' }))?.props.props as { left: { text: string; hover?: { color?: string } }[] }).left
  expect(pieces.find(p => p.text.startsWith('↺'))?.hover?.color).toBe('#3a424a')
})

test('behind a modal a pill halves its background and caps; its word takes the dim colour', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a'), [prJson()])
  const ui = await mount($)
  await tap(ui, 'branch')
  // The open pill #1d3a2a at half.
  const pieces = ((await ui.find({ key: 'row:pr' }))?.props.props as { right: { text: string; color?: string; backgroundColor?: string }[] }).right
  expect(pieces.find(p => p.text === 'open')).toMatchObject({ color: '#3a424a', backgroundColor: '#0f1d15' })
  expect(pieces.find(p => p.text === '\ue0b6')?.color).toBe('#0f1d15')
})

test('PR card, merged: merged into base with its age, then changes', async ($, on) => {
  quiet(on)
  withGh(on, repoOn('a'), [prJson({ state: 'MERGED', mergedAt: iso(NOW - 2 * HOUR) })])
  const ui = await mount($)
  await hover(ui, 'pr')
  expect(await ui.find({ type: 'Text', text: '2h ago' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /up to date/ })).toBeUndefined()
})

test('basic-glyphs mode drops the PR icon', async ($, on) => {
  quiet(on, 5 * MIN, true)
  withGh(on, repoOn('a'), [prJson()])
  const ui = await mount($)
  expect(await piece(ui, 'pr', '#168')).toBeDefined()
  expect(await piece(ui, 'pr', ' ')).toBeUndefined()
})

test('COMMITS still scrolls under a taller top section', async ($, on) => {
  quiet(on)
  const log = Array.from({ length: 30 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  const files = Array.from({ length: 3 }, (_, i) => ` M f${i}.ts`).join('\n')
  withGh(on, repoOn('a', { status: `## a...origin/a\n${files}\n`, log: `${log}\n`, '--count': '30\n' }), [prJson()])
  const ui = await mount($)
  // Tabs, rule, branch, PR, rule, CHANGES header, 3 files, divider, COMMITS header: the first commit is pane row 11.
  await wheel($, 1, 11)
  expect(await rowText(ui, /commit 0$/)).toBeUndefined()
  expect(await rowText(ui, /f0\.ts/)).toBeDefined()
})

test('merged branches hidden until shown; the last row counts them', async ($, on) => {
  quiet(on)
  withGh(on, treeRepo('main'), [prJson({ headRefName: 'feat/a', baseRefName: 'main', state: 'MERGED', mergedAt: iso(NOW - HOUR) })])
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Text', text: '1 merged hidden' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeUndefined()
  await ui.press({ key: 'm:merged' })
  expect(await ui.find({ type: 'Text', text: '1 merged' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeDefined()
})

test('shown merged branches stay shown when the branch modal opens again', async ($, on) => {
  quiet(on)
  withGh(on, treeRepo('main'), [prJson({ headRefName: 'feat/a', baseRefName: 'main', state: 'MERGED', mergedAt: iso(NOW - HOUR) })])
  const ui = await mount($)
  await tap(ui, 'branch')
  await ui.press({ key: 'm:merged' })
  await ui.press({ key: 'm:x' })
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeUndefined()
  await tap(ui, 'branch')
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 merged' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 merged hidden' })).toBeUndefined()
})

const LONG = 'Adds a PR row under the branch: its number, base and CI state, with the checks on hover. The row reads its data from one gh call on a timer, off the draw path, because with checks the call takes about six seconds. Merged and closed PRs stay as a dimmed row.'
const viewJson = (over: Record<string, unknown> = {}) => ({
  body: 'Short body.',
  commits: [{ messageHeadline: 'feat(margin): PR section', committedDate: iso(NOW - 2 * HOUR) }, { messageHeadline: 'test(margin): PR rows', committedDate: iso(NOW - HOUR) }],
  files: [{ path: 'plugins/margin/hooks/register.tsx', additions: 120, deletions: 8, changeType: 'MODIFIED' }, { path: 'plugins/margin/tests/pr.test.ts', additions: 40, deletions: 0, changeType: 'ADDED' }],
  ...over,
})
const checkRun = (name: string, conclusion: string) => ({ __typename: 'CheckRun', name, status: conclusion ? 'COMPLETED' : 'IN_PROGRESS', conclusion, startedAt: iso(NOW - HOUR), completedAt: conclusion ? iso(NOW - HOUR + 65e3) : undefined, detailsUrl: '' })
// gh pr list answers `prs`, gh pr view `view`; git from `repo`.
const withPr = (on: Parameters<TestBody>[1], repo: Record<string, string>, prs: unknown[], view: unknown = viewJson()) =>
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ran(JSON.stringify(prs))
    if (e.argv[0] === 'gh' && e.argv[2] === 'view') return ran(JSON.stringify(view))
    return ran(git(repo)(e.argv) ?? '')
  })
const openPr = async ($: Parameters<TestBody>[0]) => {
  const ui = await mount($)
  await tap(ui, 'pr')
  return ui
}

test('PR modal: title, meta row with the verb by state, divider', async ($, on) => {
  quiet(on)
  const prs = [prJson()]
  withPr(on, repoOn('a'), prs)
  const ui = await mount($)
  for (const [over, verb] of [[{}, 'opened'], [{ isDraft: true }, 'drafted'], [{ state: 'MERGED', mergedAt: iso(NOW - 2 * HOUR) }, 'merged'], [{ state: 'CLOSED', closedAt: iso(NOW - 2 * HOUR) }, 'closed']] as const) {
    prs[0] = prJson(over)
    // Picking the tab again reads gh again.
    await ui.press({ key: 'History' })
    await ui.press({ key: 'Git' })
    await tap(ui, 'pr')
    // "#n by author", the verb and age faint at the far right.
    expect((await ui.find({ type: 'Text', text: /^ by $/ }))?.props.color).toBe('#4f5c68')
    expect((await ui.find({ type: 'Text', text: /^HT0710$/ }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${verb} 2h ago$`) }))?.props.color).toBe('#4f5c68')
    await ui.press({ key: 'm:x' })
  }
})

test('a base conflict adds the conflicts row', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a', { 'merge-tree': 'abc123\nplugins/margin/hooks/register.tsx\nGUIDE.md\n\nCONFLICT (content)\n' }), [prJson({ mergeable: 'CONFLICTING' })])
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: ' conflicts in register.tsx, GUIDE.md' })).toBeDefined()
})

test('description: Markdown drawn as rows, numbers in the claude colour, 3 rows, then show all', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()], viewJson({ body: `## Intro\n\nTook 6 s, see \`a.ts\`.\n\n${LONG}` }))
  const ui = await openPr($)
  expect((await ui.find({ type: 'Text', text: /^Intro$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^6$/ }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: /^a\.ts$/ }))?.props.color).toBe('permission')
  // Heading, blank row, the first paragraph: the second paragraph waits for show all.
  expect(await ui.find({ type: 'Text', text: /dimmed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'm:all:DESCRIPTION' })).toBeDefined()
})

test('checks failed first; heading N of M passed', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: [checkRun('a-ok', 'SUCCESS'), checkRun('b-run', ''), checkRun('c-bad', 'FAILURE')] })])
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: '1 of 3 passed' })).toBeDefined()
  const names = (await ui.findAll({ type: 'Text', text: /^ [a-c]-(ok|run|bad)$/ })).map(t => t.text.trim())
  expect(names).toEqual(['c-bad', 'b-run', 'a-ok'])
})

test('commits heading N total; files heading N total +a −d; paths cut in the middle', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()], viewJson({ files: [{ path: 'plugins/margin/hooks/a-really-long-folder-name/register.tsx', additions: 1, deletions: 0, changeType: 'MODIFIED' }] }))
  const ui = await openPr($)
  // FILES sits below the window: scroll the modal to its end.
  await wheel($, 20, 10)
  expect(await ui.find({ type: 'Text', text: 'COMMITS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 total' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 total  ' })).toBeDefined()
  expect(await rowText(ui, /…\/register\.tsx$/)).toBeDefined()
})

test('PR modal: a FILES row opens the file in the File tab', async ($, on) => {
  quiet(on, 5 * MIN, false, { '/repo/b.ts': 'pr file text' })
  withPr(on, repoOn('a'), [prJson()], viewJson({ files: [{ path: 'b.ts', additions: 1, deletions: 0, changeType: 'MODIFIED' }] }))
  const ui = await openPr($)
  // FILES sits below the window: scroll the modal to its end.
  await wheel($, 20, 10)
  await tap(ui, `mf:${fileKey('b.ts')}`)
  expect(await ui.find({ type: 'Text', text: '/repo/b.ts' })).toBeDefined()
})

test('4 checks show whole; 5 show 3 and show all', async ($, on) => {
  quiet(on)
  const prs = [prJson()]
  withPr(on, repoOn('a'), prs)
  const ui = await mount($)
  for (const n of [4, 5]) {
    prs[0] = prJson({ statusCheckRollup: Array.from({ length: n }, (_, i) => checkRun(`k${i}`, 'SUCCESS')) })
    await ui.press({ key: 'History' })
    await ui.press({ key: 'Git' })
    await tap(ui, 'pr')
    expect((await ui.findAll({ type: 'Text', text: /^ k\d$/ })).length).toBe(n === 4 ? 4 : 3)
    expect(!!(await ui.find({ type: 'Button', key: 'm:all:CHECKS' }))).toBe(n === 5)
    await ui.press({ key: 'm:x' })
  }
})

test('show all takes the accent, as the branch modal\'s show does', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 6 }, (_, i) => checkRun(`k${i}`, 'SUCCESS')) })])
  const ui = await openPr($)
  expect((await ui.findAll({ type: 'Text', text: 'show all' })).at(-1)?.props.color).toBe('claude')
})

test('show all opens a stacked modal: actions and ✕, divider, pinned title with its count', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 6 }, (_, i) => checkRun(`k${i}`, i ? 'SUCCESS' : 'FAILURE')) })])
  const ui = await openPr($)
  await ui.press({ key: 'm:all:CHECKS' })
  expect(await ui.find({ type: 'Box', key: 'stack' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 's:x' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '5 of 6 passed' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^ k\d$/ })).length).toBeGreaterThanOrEqual(6)
})

test("under a stacked modal the modal's buttons do not press", async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 6 }, (_, i) => checkRun(`k${i}`, 'SUCCESS')) })])
  const ui = await openPr($)
  await ui.press({ key: 'm:all:CHECKS' })
  expect(await ui.find({ type: 'Button', key: 'm:copy' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 's:x' })).toBeDefined()
})

test('the wheel scrolls the stacked modal when over it', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 30 }, (_, i) => checkRun(`k${String(i).padStart(2, '0')}`, 'SUCCESS')) })])
  const ui = await openPr($)
  await ui.press({ key: 'm:all:CHECKS' })
  // k00 shows twice, in the modal's capped list and the stacked modal's top row, until the wheel moves the latter.
  // A row's wrapping Text matches too: count the k00 Texts themselves.
  const k00 = async () => (await ui.findAll({ type: 'Text', text: ' k00' })).filter(t => !t.props.wrap).length
  expect(await k00()).toBe(2)
  await wheel($, 1, 12)
  expect(await k00()).toBe(1)
})

test('a merged PR shows no running checks', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ state: 'MERGED', mergedAt: iso(NOW - HOUR) })])
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: '◌' })).toBeUndefined()
})

const failedRun = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: iso(NOW - HOUR), completedAt: iso(NOW - HOUR + 65e3), detailsUrl: 'https://github.com/o/r/actions/runs/41/job/125' }

test("PR modal actions take the mockup's button accent", async ($, on) => {
  quiet(on)
  const failing = { ...checkRun('build', 'FAILURE'), detailsUrl: 'https://github.com/o/r/actions/runs/11/job/22' }
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: [failing] })])
  const ui = await openPr($)
  for (const text of ['\uf408 github', '\uf44c copy', '\uebc0 rerun']) expect((await ui.find({ type: 'Text', text }))?.props.color).toBe('claude')
})

test('github opens the PR page; copy copies the PR URL', async ($, on) => {
  quiet(on)
  let copied = ''
  on('ui.copy', (_, e) => {
    copied = (e as any).text
    return { value: {} } as any
  })
  withPr(on, repoOn('a'), [prJson()])
  const ui = await openPr($)
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/o/r/pull/168')
  await ui.press({ key: 'm:copy' })
  expect(copied).toBe('https://github.com/o/r/pull/168')
})

test('rerun shows only with a failed check and runs gh run rerun <run> --failed', async ($, on) => {
  quiet(on)
  const runs: string[] = []
  const prs = [prJson()]
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ran(JSON.stringify(prs))
    if (e.argv[0] === 'gh' && e.argv[2] === 'view') return ran(JSON.stringify(viewJson()))
    return ran(git(repoOn('a'))(e.argv) ?? '')
  })
  const ui = await openPr($)
  expect(await ui.find({ type: 'Button', key: 'm:rerun' })).toBeUndefined()
  await ui.press({ key: 'm:x' })
  prs[0] = prJson({ statusCheckRollup: [failedRun] })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'Git' })
  await tap(ui, 'pr')
  await ui.press({ key: 'm:rerun' })
  expect(runs).toContain('gh run rerun 41 --failed')
})

test('a failed check adds its last log lines under its row, faint and red-edged, before the next check', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ran(JSON.stringify([prJson({ statusCheckRollup: [failedRun, ...Array.from({ length: 4 }, (_, i) => checkRun(`k${i}`, 'SUCCESS'))] })]))
    if (e.argv[0] === 'gh' && e.argv[2] === 'view' && e.argv[1] === 'pr') return ran(JSON.stringify(viewJson()))
    if (e.argv[0] === 'gh' && e.argv[1] === 'run') return ran('test\tRun\t2026-11-02T06:39:40.1Z one\ntest\tRun\t2026-11-02T06:39:41.1Z FAIL tests/hooks.test.sh\ntest\tRun\t2026-11-02T06:39:42.1Z   expected: deny  got: allow\n\n')
    return ran(git(repoOn('a'))(e.argv) ?? '')
  })
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: /last lines/ })).toBeUndefined()
  const texts = (await ui.findAll({ type: 'Text' })).filter(t => !t.props.wrap)
  const at = (text: string) => texts.findIndex(t => t.text === text)
  expect(at(' test')).toBeGreaterThan(-1)
  expect(at('FAIL tests/hooks.test.sh')).toBeGreaterThan(at(' test'))
  expect(at('  expected: deny  got: allow')).toBeGreaterThan(at('FAIL tests/hooks.test.sh'))
  // Then the next check, its space and mark first: the log sits inside the capped list, before its show all.
  expect(at(' k0')).toBe(at('  expected: deny  got: allow') + 3)
  expect(texts[at('FAIL tests/hooks.test.sh')]?.props.color).toBe('#4f5c68')
  expect(texts[at('FAIL tests/hooks.test.sh') - 1]?.text).toBe('▎')
})

// Captured from git 2.x on 2026-11-02, as git-data.test.ts holds them.
const STEPS = ['edit 0fdeb40b376e9b92da0373dcca03f5a92cbfc87b # feat(x): one', 'pick fa24b8c2ed64c78d08a1d945090c1ff0e3df3562 # feat(x): two', 'pick 16d77eae9ea6fe20267414c89994256bd2fa74b8 # docs(x): three']
const rebaseDir = (doneN: number) => ({
  'rebase-merge/head-name': 'refs/heads/feat/x\n',
  'rebase-merge/onto': '5e7dbcbb8a85c012da009d6523d686489df6d25f\n',
  'rebase-merge/done': STEPS.slice(0, doneN).join('\n') + '\n',
  'rebase-merge/git-rebase-todo': STEPS.slice(doneN).join('\n') + '\n',
})
// A conflict stop on step 2: one unmerged file, onto release/1.7.
const conflictRepo = (more: Record<string, string> = {}) => repoOn('x', {
  status: '## HEAD (no branch)\nUU f.txt\n',
  '--diff-filter=U': 'f.txt\n',
  '--cached': '',
  '--numstat': '0\t0\tf.txt\n4\t0\tf.txt\n',
  '--points-at': 'release/1.7\n',
  ...more,
})

test("mid-rebase the branch card reads the branch's upstream from its own ref, as git status names no branch", async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo({ 'for-each-ref': 'feat/x\torigin/feat/x\t[ahead 2]\t1790000000\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'branch')
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const card = find(await ui.drawn(), n => n.hover?.scope === 'card:branch' && n.props?.position === 'absolute')[0]
  const texts = find(card, n => n.type === 'Text').flatMap(n => [n.children ?? []].flat()).filter(t => typeof t === 'string')
  expect(texts).toContain('origin')
  expect(texts).toContain('↑2')
  expect(texts).not.toContain('local')
})

test('a count in normal text draws its numbers in the claude colour; IDs and faint counts keep theirs', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const card = find(await ui.drawn(), n => n.hover?.scope === 'card:rebase' && n.props?.position === 'absolute')[0]
  const colour = (text: string) => find(card, n => n.type === 'Text' && [n.children ?? []].flat().includes(text)).at(-1)?.props?.color
  // "2 of 3": both numbers lit, the word left plain; the sha at the right stays faint.
  expect(colour('2')).toBe('claude')
  expect(colour('3')).toBe('claude')
  expect(colour(' of ')).toBeUndefined()
  expect(colour('fa24b8c')).toBe('#4f5c68')
})

test('rebase row: ↺ rebasing onto release/1.7, ✗ 1 conflict', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, 'rebase', '↺ '))?.props.color).toBe('warning')
  expect(await piece(ui, 'rebase', 'rebasing ')).toBeDefined()
  expect(await piece(ui, 'rebase', 'release/1.7')).toBeDefined()
  expect((await piece(ui, 'rebase', '✗ 1 conflict'))?.props.color).toBe('#e06c75')
})

test('the branch name comes from head-name during a rebase', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, 'branch', '⎇ feat/x')).toBeDefined()
})

test('an edit stop reads edit and its commit; resolved reads ✓ ready', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(1))
  const repo = conflictRepo({ '--diff-filter=U': '', '--numstat': '' })
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, 'rebase', 'edit'))?.props.color).toBe('warning')
  expect(await piece(ui, 'rebase', ' 0fdeb40')).toBeDefined()
})

test('detached HEAD without a rebase has no rebase row', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('x', { status: '## HEAD (no branch)\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await ui.find({ key: 'row:rebase' })).toBeUndefined()
  expect(await piece(ui, 'branch', '⎇ HEAD')).toBeDefined()
})

test('rebase card: step n of N with sha; conflict files joined; +a −d for one', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'rebase')
  expect(await ui.find({ type: 'Text', text: '2 of 3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'fa24b8c' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'f.txt' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+4' })).toBeDefined()
})

test('rebase modal: title, meta, COMMITS from one before the stop with marks, CONFLICTS', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  expect((await ui.find({ type: 'Text', text: /^step 2 of 3$/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.findAll({ type: 'Text', text: '✓' })).at(-1)?.props.color).toBe('#5d9678')
  expect(await ui.find({ type: 'Text', text: 'CONFLICTS' })).toBeDefined()
  expect(((await ui.find({ key: `row:mf:${fileKey('f.txt')}` }))?.props.props as { left: { text: string; color?: string }[] }).left[0]).toEqual({ text: ' U', color: '#e06c75' })
})

test('rebase modal: a CONFLICTS row opens the file to fix', async ($, on) => {
  quiet(on, 5 * MIN, false, { ...rebaseDir(2), '/repo/f.txt': 'conflict text' })
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  await tap(ui, `mf:${fileKey('f.txt')}`)
  expect(await ui.find({ type: 'Text', text: '/repo/f.txt' })).toBeDefined()
})

test('merge modal: title, incoming count, incoming commits', async ($, on) => {
  quiet(on, 5 * MIN, false, { MERGE_HEAD: '5e7dbcbb8a85c012da009d6523d686489df6d25f\n', MERGE_MSG: "Merge branch 'release/1.7' into feat/x\n" })
  on('process.run', (_, e) => ran(git(conflictRepo({ status: '## feat/x\nUU f.txt\n', log: '5e7dbcb\tfix: upper b\t1793603824\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, 'rebase', 'merging ')).toBeDefined()
  await tap(ui, 'rebase')
  expect(await ui.find({ type: 'Text', text: "Merge branch 'release/1.7' into feat/x" })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^1 incoming commit$/ }))?.props.color).toBe('#4f5c68')
  expect(await ui.find({ type: 'Button', key: 'm:commit' })).toBeDefined()
})

test("actions take the mockup's button colours: continue success once nothing blocks it, abort error, skip the accent", async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(1))
  on('process.run', (_, e) => ran(git(conflictRepo({ '--diff-filter=U': '', '--numstat': '' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  expect((await ui.find({ type: 'Text', text: '\ueacf continue' }))?.props.color).toBe('success')
  expect((await ui.find({ type: 'Text', text: '\uf468 abort' }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: '\uead6 skip' }))?.props.color).toBe('claude')
})

test('a blocked continue takes the accent, as it would fail', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  expect((await ui.find({ type: 'Text', text: '\ueacf continue' }))?.props.color).toBe('claude')
})

test('continue runs git rebase --continue with no editor', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2))
  const runs: string[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    return ran(git(conflictRepo())(e.argv) ?? '')
  })
  const ui = await mount($)
  await tap(ui, 'rebase')
  await ui.press({ key: 'm:continue' })
  expect(runs).toContain('git -c core.editor=true rebase --continue')
  // Closed after an action: a rebase that ended must not open it again at the next one.
  expect(await ui.find({ type: 'Box', key: 'modal' })).toBeUndefined()
})

const many = (n: number, over: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => prJson({ number: 180 + i, title: `feat(topic): change ${i}`, ...over(i) }))

test('two open PRs out of this branch: ↗ 2 PRs out with the worst CI', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ number: 171, baseRefName: 'main', statusCheckRollup: [failedRun] }), prJson()])
  const ui = await mount($)
  expect((await piece(ui, 'prs', '↗ '))?.props.color).toBe('claude')
  expect(await piece(ui, 'prs', '2 PRs ')).toBeDefined()
  expect(await piece(ui, 'prs', 'out')).toBeDefined()
  expect((await piece(ui, 'prs', '✗ 1 failing'))?.props.color).toBe('#e06c75')
  expect(await ui.find({ key: 'row:pr' })).toBeUndefined()
})

test('on a base branch with PRs in: ↘ N PRs into main', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('main'), many(2, () => ({ headRefName: 'feat/t', baseRefName: 'main' })))
  const ui = await mount($)
  expect(await piece(ui, 'prs', '↘ ')).toBeDefined()
  expect(await piece(ui, 'prs', 'into ')).toBeDefined()
  expect((await piece(ui, 'prs', '◌ 2 running'))?.props.color).toBe('claude')
})

test('summary card caps at 8 rows with … N more', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('main'), many(10, () => ({ headRefName: 'feat/t', baseRefName: 'main' })))
  const ui = await mount($)
  await hover(ui, 'prs')
  expect(await ui.find({ type: 'Text', text: ' … 3 more' })).toBeDefined()
})

test('summary modal: two rows per PR, dividers between, capped, github action', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('main'), many(5, () => ({ headRefName: 'feat/t', baseRefName: 'main' })))
  const ui = await mount($)
  await tap(ui, 'prs')
  expect((await ui.findAll({ type: 'Button', text: /#18\d/ })).length).toBe(3)
  expect((await ui.find({ type: 'Text', text: /^ {2}HT0710$/ }))?.props.color).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^ from $/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://github.com/o/r/pulls')
  await ui.press({ key: 'm:all:5 PRs' })
  expect((await ui.findAll({ type: 'Button', text: /#18\d/ })).length).toBeGreaterThan(3)
})

test('a PR in the summary modal opens its stacked modal: title, meta, CHECKS, rerun when failed', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('main'), many(2, i => ({ headRefName: 'feat/t', baseRefName: 'main', statusCheckRollup: i ? [] : [failedRun] })))
  const ui = await mount($)
  await tap(ui, 'prs')
  await ui.press({ key: 'm:pr:180' })
  expect(await ui.find({ type: 'Box', key: 'stack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ by $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^opened 2h ago$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0 of 1 passed' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 's:rerun' })).toBeDefined()
})

test("behind a stacked modal a row's words stay together: a dropped Button leaves one Text", async ($, on) => {
  quiet(on)
  withPr(on, repoOn('main'), many(2, () => ({ headRefName: 'feat/t', baseRefName: 'main' })))
  const ui = await mount($)
  await tap(ui, 'prs')
  await ui.press({ key: 'm:pr:180' })
  const kids = (node: any) => [node?.props?.children, node?.children].flat(Infinity).filter(Boolean)
  const find = (node: any, hit: (n: any) => boolean): any =>
    !node || typeof node !== 'object' ? undefined
    : Array.isArray(node) ? node.map(n => find(n, hit)).find(Boolean)
    : hit(node) ? node : find(kids(node), hit)
  const modal = find(await ui.drawn(), n => (n.props?.key ?? n.key) === 'modal')
  // The faded summary modal's #180 row: its Button's several Texts held in one Text.
  const row = find(modal, n => n.props?.justifyContent === 'space-between' && JSON.stringify(n).includes('" #180 "'))
  expect(kids(row).filter((c: any) => c?.type === 'Text')).toHaveLength(1)
  expect(await ui.find({ type: 'Button', key: 'm:pr:180' })).toBeUndefined()
})

test('in a linked worktree the fetch age is the newer FETCH_HEAD of its own and the shared git dir', async ($, on) => {
  quiet(on, 90 * MIN)
  on('process.run', (_, e) => ran(git(repoOn('a', { '--absolute-git-dir': '/repo/.git/worktrees/w\n/repo/.git\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  // quiet's fs.list answers both dirs with a FETCH_HEAD 90 minutes old; the shared one decides when newer.
  expect(await piece(ui, 'fetch', '\uf46a 1h')).toBeDefined()
})

test('in the pane default 40 columns each top row holds one row, its right side kept', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a', { 'HEAD..origin/release/1.7': '3\n' }), [prJson()])
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 40 }, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  for (const key of ['row:branch', 'row:pr']) expect((await ui.find({ key }))?.props).toMatchObject({ height: 1 })
})

test("a hover card row holds one row: its info kept, the far-right text cut", async ($, on) => {
  quiet(on)
  const failing = 'build (ubuntu-latest, node 22) with a long job name'
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: [checkRun(failing, 'FAILURE'), checkRun('ok', 'SUCCESS')] })])
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 40 }, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await hover(ui, 'pr')
  // The kv row holding the failed check's name, found in the drawn tree.
  const texts = (node: any): string =>
    node == null || typeof node !== 'object' ? String(node ?? '') : Array.isArray(node) ? node.map(texts).join('') : texts([node.props?.children, node.children])
  const rows: any[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.type === 'Box' && node.props?.justifyContent === 'space-between' && texts(node).includes(failing)) rows.push(node)
    walk(node.props?.children)
    walk(node.children)
  }
  walk(await ui.drawn())
  expect(rows.at(-1)?.props).toMatchObject({ height: 1, overflow: 'hidden' })
  expect(rows.at(-1)?.children.at(-1)?.props.wrap).toBe('truncate-end')
})

test("another repo's PRs never show: gh's list is kept with the remote it came from", async ($, on) => {
  quiet(on)
  const repo = repoOn('a')
  let ghFails = false
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ghFails ? ran('', 1) : ran(JSON.stringify([prJson()]))
    return ran(git(repo)(e.argv) ?? '')
  })
  const ui = await mount($)
  expect(await ui.find({ key: 'row:pr' })).toBeDefined()
  // A shell cd into a repo where gh cannot answer: the old list must not match its branch.
  repo['get-url'] = 'git@github.com:o/other.git\n'
  ghFails = true
  await ui.press({ key: 'History' })
  await ui.press({ key: 'Git' })
  expect(await ui.find({ key: 'row:pr' })).toBeUndefined()
})

test('a cherry-pick in progress uses the same row with its own verb, and aborts as a cherry-pick', async ($, on) => {
  quiet(on, 5 * MIN, false, { CHERRY_PICK_HEAD: '5e7dbcbb8a85c012da009d6523d686489df6d25f\n', MERGE_MSG: 'fix: upper b\n' })
  const runs: string[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    return ran(git(conflictRepo({ status: '## feat/x\nUU f.txt\n', log: '5e7dbcb\tfix: upper b\t1793603824\n' }))(e.argv) ?? '')
  })
  const ui = await mount($)
  expect(await piece(ui, 'rebase', 'cherry-picking ')).toBeDefined()
  await tap(ui, 'rebase')
  expect(await ui.find({ type: 'Text', text: 'fix: upper b' })).toBeDefined()
  await ui.press({ key: 'm:abort' })
  await ui.press({ key: 'm:abort' })
  expect(runs).toContain('git -c core.editor=true cherry-pick --abort')
})

test('while a modal is open the pane takes Escape; once it closes, Escape is as before', async ($, on) => {
  quiet(on)
  const opens: unknown[] = []
  on('ui.open', (_, e) => {
    opens.push((e as any).closeOnEscape)
    return { value: { isPlaced: true } } as any
  })
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(opens.at(-1)).toBe(true)
  await ui.press({ key: 'm:x' })
  expect(opens.at(-1)).toBeUndefined()
  expect(opens.length).toBe(2)
})

test('CHANGES header: N files faint, summed line counts', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('b', { status: '## b...origin/b\n M a.ts\n?? d/e.ts\n', diff: '2\t1\ta.ts\0' }))(e.argv) ?? ''))
  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: '2 files' }))?.props.color).toBe('#4f5c68')
  expect(await ui.find({ type: 'Text', text: '+2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^!/ })).toBeUndefined()
})

// CHANGES rows: a repo on b with these status lines and this numstat -z answer.
const changesRepo = (lines: string, diff = '', more: Record<string, string> = {}) => repoOn('b', { status: `## b...origin/b\n${lines}`, diff, ...more })

test('file row: letter, middle-cut path, counts at right', async ($, on) => {
  quiet(on)
  const path = `plugins/margin/${'deep/'.repeat(10)}register.tsx`
  on('process.run', (_, e) => ran(git(changesRepo(` M ${path}\n`, `80\t4\t${path}\0`))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: /…\/register\.tsx$/, in: `row:${fileKey(path)}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+80', in: `row:${fileKey(path)}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−4', in: `row:${fileKey(path)}` })).toBeDefined()
})

test('staged row: dim letter and faint path', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo('M  GUIDE.md\n', '3\t1\tGUIDE.md\0'))(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, fileKey('GUIDE.md'), /GUIDE\.md$/))?.props.color).toBe('#4f5c68')
})

test('binary file shows bin faint', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M logo.png\n', '-\t-\tlogo.png\0'))(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, fileKey('logo.png'), 'bin'))?.props.color).toBe('#4f5c68')
})

test('untracked file counts its lines; over 1 MiB shows none', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) =>
    e.argv[0] === 'find' ? ran('  8 120 /repo/new.ts\n') : ran(git(changesRepo('?? new.ts\n?? big.ts\n', '', { '--absolute-git-dir': '/repo/.git\n/repo/.git\n/repo\n' }))(e.argv) ?? ''),
  )
  const ui = await mount($)
  expect(await piece(ui, fileKey('new.ts'), '+8')).toBeDefined()
  expect(await piece(ui, fileKey('big.ts'), /^\+/)).toBeUndefined()
})

test('file click opens the path from the top level', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M a.ts\n', '', { '--absolute-git-dir': '/repo/.git\n/repo/.git\n/repo\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, fileKey('a.ts'))
  // The File tab's header: the path from the top level, not from the session's folder.
  expect(await ui.find({ type: 'Text', text: '/repo/a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CHANGES' })).toBeUndefined()
})

test('deleted row neither presses nor lights; its card still shows', async ($, on) => {
  quiet(on, 5 * MIN, false, { '/repo/old.ts': 'gone text' })
  on('process.run', (_, e) => ran(git(changesRepo('D  old.ts\n', '0\t9\told.ts\0', { '--absolute-git-dir': '/repo/.git\n/repo/.git\n/repo\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, fileKey('old.ts'))
  expect(await ui.find({ type: 'Text', text: /gone text/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'CHANGES' })).toBeDefined()
  const box = (await ui.drawn()) as unknown
  expect(JSON.stringify(box)).not.toMatch(new RegExp(`"scope":"card:${fileKey('old.ts')}","backgroundColor"`))
  await hover(ui, fileKey('old.ts'))
  expect((await cardTexts(ui, fileKey('old.ts'))).texts).toEqual(expect.arrayContaining(['status  ', 'deleted', 'staged']))
})

// The drawn texts of a row's card, each Text's own string.
const cardTexts = async (ui: Ui, key: string) => {
  const find = (node: any, test: (n: any) => boolean): any[] =>
    !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(n => find(n, test))
    : [...(test(node) ? [node] : []), ...find([node.props?.children, node.children], test)]
  const card = find(await ui.drawn(), n => n.hover?.scope === `card:${key}` && n.props?.position === 'absolute')[0]
  const own = (n: any) => [n.children ?? n.props?.children].flat().filter((c: unknown) => typeof c === 'string').join('')
  return { card, find, texts: find(card, n => n.type === 'Text').map(own).filter(Boolean) }
}

test('a file card: status, the change word, one pill per true stage', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo('MM both.ts\nA  index.ts\n M tree.ts\n', '2\t1\tboth.ts\0'))(e.argv) ?? ''))
  const ui = await mount($)
  const words = async (key: string) => {
    await hover(ui, fileKey(key))
    return (await cardTexts(ui, fileKey(key))).texts.filter(t => /[a-z]/.test(t))
  }
  expect(await words('both.ts')).toEqual(['status  ', 'modified', 'staged', 'not staged'])
  // The row shows the line counts; the card does not repeat them.
  expect((await cardTexts(ui, fileKey('both.ts'))).texts.filter(t => /^[+−]\d/.test(t))).toEqual([])
  expect(await words('index.ts')).toEqual(['status  ', 'added', 'staged'])
  expect(await words('tree.ts')).toEqual(['status  ', 'modified', 'not staged'])
})

test('a stage pill takes the green and grey of the PR pills', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo('MM both.ts\n'))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, fileKey('both.ts'))
  const { card, find } = await cardTexts(ui, fileKey('both.ts'))
  const word = (text: string) => find(card, n => n.type === 'Text' && [n.children ?? n.props?.children].flat().includes(text))[0]?.props
  expect(word('staged')).toMatchObject({ backgroundColor: '#1d3a2a', color: 'success' })
  expect(word('not staged')).toMatchObject({ backgroundColor: '#2a2e33', color: '#808286' })
})

test('a status pill takes its letter colour; an untracked or conflict file has no stage pill', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M m.ts\nA  a.ts\nD  d.ts\nR  o.ts -> r.ts\n?? u.ts\nUU c.ts\n'))(e.argv) ?? ''))
  const ui = await mount($)
  const pills: [string, string, string, string][] = [
    ['m.ts', 'modified', '#3a3220', '#e5c07b'], ['a.ts', 'added', '#1d3a2a', '#98c379'], ['d.ts', 'deleted', '#3a2030', '#e06c75'],
    ['r.ts', 'renamed', '#1c2f44', '#61afef'], ['u.ts', 'untracked', '#173538', '#56b6c2'], ['c.ts', 'conflict', '#3a2030', '#e06c75'],
  ]
  for (const [key, word, backgroundColor, color] of pills) {
    await hover(ui, fileKey(key))
    const { card, find, texts } = await cardTexts(ui, fileKey(key))
    expect(find(card, n => n.type === 'Text' && [n.children ?? n.props?.children].flat().includes(word))[0]?.props).toMatchObject({ backgroundColor, color })
    if (word === 'untracked' || word === 'conflict') expect(texts.filter(t => /[a-z]/.test(t))).toEqual(['status  ', word])
  }
})

test('rename row shows the new name and its counts; its card has no old path', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo('R  docs/git.md -> docs/git-tab.md\n', '2\t2\t\0docs/git.md\0docs/git-tab.md\0'))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, fileKey('docs/git-tab.md'), /docs\/git-tab\.md$/)).toBeDefined()
  expect(await piece(ui, fileKey('docs/git-tab.md'), '+2')).toBeDefined()
  await hover(ui, fileKey('docs/git-tab.md'))
  expect((await cardTexts(ui, fileKey('docs/git-tab.md'))).texts.filter(t => /[a-z]/.test(t))).toEqual(['status  ', 'renamed', 'staged'])
})

test('card follows the row after a scroll', async ($, on) => {
  quiet(on)
  const files = Array.from({ length: 30 }, (_, i) => ` M f${String(i).padStart(2, '0')}.ts`).join('\n')
  on('process.run', (_, e) => ran(git(changesRepo(`${files}\n`))(e.argv) ?? ''))
  const ui = await mount($)
  await wheel($, 5, 5)
  await hover(ui, fileKey('f05.ts'))
  expect(await ui.find({ type: 'Text', text: 'not staged' })).toBeDefined()
  expect(await rowText(ui, /f05\.ts$/)).toBeDefined()
})

// COMMITS rows: \x1f log lines, the unpushed list and, for the card, a shortstat answer.
const logLine = (full: string, subject: string, decor = '', ct = 1799999880) => [full, full.slice(0, 7), 'HT0710', String(ct), decor, subject].join('\x1f')
const commitsRepo = (lines: string[], unpushed: string[], stat = '') => (argv: readonly string[]) =>
  argv.includes('--shortstat') ? stat : git(repoOn('b', { log: `${lines.join('\n')}\n`, '--remotes': unpushed.map(sha => `${sha}\n`).join(''), '--count': '154\n' }))(argv)
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

test('COMMITS header: ↑N in gold, N total faint', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one'), logLine(B, 'fix: two')], [A, B])(e.argv) ?? ''))
  const ui = await mount($)
  expect((await ui.find({ type: 'Text', text: '↑2' }))?.props.color).toBe('#d4b860')
  expect((await ui.find({ type: 'Text', text: /^ {2}154 total$/ }))?.props.color).toBe('#4f5c68')
  expect(await ui.find({ type: 'Text', text: /local/ })).toBeUndefined()
})

test('commit row: subject coloured by type, age faint at right, no sha', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one')], [A])(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, `c:${A}`, 'feat'))?.props.color).toBe('#98c379')
  expect((await piece(ui, `c:${A}`, '2m'))?.props.color).toBe('#4f5c68')
  expect(await piece(ui, `c:${A}`, /aaaaaaa/)).toBeUndefined()
})

test('pushed row faint, unpushed bright', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: local one'), logLine(B, 'fix: pushed one')], [A])(e.argv) ?? ''))
  const ui = await mount($)
  expect((await piece(ui, `c:${A}`, /local one/))?.props.color).toBeUndefined()
  expect((await piece(ui, `c:${B}`, /pushed one/))?.props.color).toBe('#4f5c68')
  expect(await ui.findAll({ type: 'Link' })).toEqual([])
})

test('commit card: commit, refs, changes', async ($, on) => {
  quiet(on)
  const stat = `\x1e${A}\n\n 2 files changed, 80 insertions(+), 4 deletions(-)\n`
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one', 'HEAD -> refs/heads/feat/x, refs/remotes/origin/feat/x, tag: refs/tags/v1.6.0')], [], stat)(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, `c:${A}`)
  expect((await ui.find({ type: 'Text', text: /^aaaaaaa$/ }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: /^ by $/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^HT0710$/ }))?.props.color).toBeUndefined()
  // No title row repeating the subject; labels at the card edge.
  const { texts } = await cardTexts(ui, `c:${A}`)
  expect(texts.some(t => t.includes('one'))).toBe(false)
  expect(texts).toContain('commit   ')
  // Refs as the branch modal draws names: a type prefix in its colour, the rest plain, a remote's name faint.
  expect((await ui.findAll({ type: 'Text', text: /^feat\/$/ })).map(t => t.props.color)).toEqual(['#98c379', '#98c379'])
  expect((await ui.findAll({ type: 'Text', text: /^x$/ })).map(t => t.props.color)).toEqual([undefined, undefined])
  expect((await ui.find({ type: 'Text', text: /^origin\/$/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^v1\.6\.0$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^2$/ }))?.props.color).toBe('claude')
  expect(await ui.find({ type: 'Text', text: '+80' })).toBeDefined()
})

test('commit card: long refs share the info column, cut with … at its end, so the counts stay whole', async ($, on) => {
  quiet(on)
  const stat = `\x1e${A}\n\n 5 files changed, 105 insertions(+), 23 deletions(-)\n`
  const branch = 'feat/a-rather-long-branch-name-here'
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one', `HEAD -> refs/heads/${branch}`)], [A], stat)(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, `c:${A}`)
  const { card, find } = await cardTexts(ui, `c:${A}`)
  const lefts = find(card, n => n.type === 'Box' && n.props?.flexShrink === 0)
  // The card takes the 75% cap of the 67-column body, 50 columns: 46 inside, less the 9-column label, the 2-column
  // gap and "+105 −23" leaves 26 for the info column, every row the same, refs included.
  expect(card.props.width).toBe(50)
  expect(lefts.map(n => n.props.width)).toEqual([36, 36, 36])
  expect(lefts.every(n => n.children?.[0]?.props?.wrap === 'truncate-end' || n.props?.children?.props?.wrap === 'truncate-end')).toBe(true)
  expect(await ui.find({ type: 'Text', text: '+105' })).toBeDefined()
})

test('commit card: the current branch in refs takes the action colour, bold, as in the branch modal', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one', 'HEAD -> refs/heads/b')], [A])(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, `c:${A}`)
  const { card, find } = await cardTexts(ui, `c:${A}`)
  const current = find(card, n => n.type === 'Text' && [n.children ?? n.props?.children].flat().join('') === 'b')[0]
  expect(current?.props.color).toBe('#5d9678')
  expect(current?.props.bold).toBe(true)
})

test('commit card: no refs row when none', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one')], [A])(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, `c:${A}`)
  expect(await ui.find({ type: 'Text', text: /commit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refs/ })).toBeUndefined()
})

// The commit modal's reads: the message, then its files by name-status and by numstat, all -z.
const showRepo = (unpushed: string[], message = 'feat: one\n', nameStatus = 'M\0a.ts\0', numstat = '5\t1\ta.ts\0', decor = '') => (argv: readonly string[]) =>
  argv.includes('show') ? (argv.includes('--name-status') ? nameStatus : argv.includes('--numstat') ? numstat : message) : commitsRepo([logLine(A, 'feat: one', decor)], unpushed)(argv)

test('pressing a commit opens its modal: title, sha by author with the age at the far right, refs', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([A], undefined, undefined, undefined, 'refs/remotes/origin/feat/x, tag: refs/tags/v1.6.0')(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await ui.find({ key: 'modal' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ aaaaaaa$/ }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: /^ by $/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^HT0710$/ }))?.props.color).toBeUndefined()
  // The age in its own far-right box, as FILES puts its counts.
  const age = await ui.find({ type: 'Text', text: /^2m ago$/ })
  expect(age?.props.color).toBe('#4f5c68')
  expect(await ui.find({ type: 'Text', text: /·/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text', text: /^v1\.6\.0$/ })).some(t => t.props.color === 'warning')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /^origin\/$/ })).some(t => t.props.color === '#4f5c68')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /^feat\/$/ })).some(t => t.props.color === '#98c379')).toBe(true)
})

test('commit modal: DESCRIPTION from the body; none without a body', async ($, on) => {
  quiet(on)
  let message = 'feat: one\n\nWhy it moved.\n'
  on('process.run', (_, e) => ran(showRepo([A], message)(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await ui.find({ type: 'Text', text: 'DESCRIPTION' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Why it moved/ })).toBeDefined()
  await tap(ui, `c:${A}`)
  message = 'feat: one\n'
  await tap(ui, `c:${A}`)
  expect(await ui.find({ type: 'Text', text: 'DESCRIPTION' })).toBeUndefined()
})

test('commit modal: FILES with N total and counts, middle-cut paths', async ($, on) => {
  quiet(on)
  const long = `plugins/margin/${'deep/'.repeat(12)}register.tsx`
  on('process.run', (_, e) => ran(showRepo([A], undefined, `M\0${long}\0A\0b.ts\0`, `5\t1\t${long}\0` + '8\t0\tb.ts\0')(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await ui.find({ type: 'Text', text: 'FILES' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 total  ' })).toBeDefined()
  expect(await rowText(ui, /…\/register\.tsx$/)).toBeDefined()
  expect(await rowText(ui, /^\+8$/)).toBeDefined()
})

test('commit modal: a file row lights under the pointer and opens the file in the File tab', async ($, on) => {
  quiet(on, 5 * MIN, false, { '/repo/a.ts': 'file text' })
  on('process.run', (_, e) => ran(showRepo([A])(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  // Each lit row its own keyed Box, so only the row under the pointer lights, not every row in the modal.
  const lit: any[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.hover?.backgroundColor === '#0f1c28' && !n.hover.scope) lit.push(n)
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  expect(lit.map(n => n.props?.key)).toEqual(['m:row:a.ts'])
  // A column, as a CHANGES row's Box: the Client stretches across, so its counts end at the far right.
  expect(lit[0].props.flexDirection).toBe('column')
  // A row Client, as a CHANGES row: it lights, where a Button would invert.
  expect(String((await ui.find({ key: `row:mf:${fileKey('a.ts')}` }))?.props.module)).toMatch(/row\.tsx$/)
  expect(await ui.find({ type: 'Button', key: 'm:file:a.ts' })).toBeUndefined()
  await tap(ui, `mf:${fileKey('a.ts')}`)
  // The File tab's header: the path from the top level.
  expect(await ui.find({ type: 'Text', text: '/repo/a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'COMMITS' })).toBeUndefined()
})

test('commit modal: a deleted file row neither lights nor opens', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([A], undefined, 'D\0old.ts\0', '0\t9\told.ts\0')(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await ui.find({ key: `row:mf:${fileKey('old.ts')}` })).toBeUndefined()
})

test('a file row whose file left the working tree toasts instead of opening an empty File tab', async ($, on) => {
  quiet(on, 5 * MIN, false, { '/repo/gone.ts': null })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as any).text))
    return { value: undefined }
  })
  on('process.run', (_, e) => ran(showRepo([A], undefined, 'M\0gone.ts\0', '1\t0\tgone.ts\0')(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  await tap(ui, `mf:${fileKey('gone.ts')}`)
  expect(toasts).toEqual(['Not in the working tree: gone.ts'])
  expect(await ui.find({ key: 'modal' })).toBeDefined()
})

test('a modal file row with one side 0 gives the path the columns the absent side would take', async ($, on) => {
  quiet(on)
  const path = (name: string) => `plugins/margin/${'deep/'.repeat(12)}${name}.tsx`
  on('process.run', (_, e) => ran(showRepo([A], undefined, `A\0${path('one')}\0M\0${path('two')}\0`, `8\t0\t${path('one')}\0` + `8\t1\t${path('two')}\0`)(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  const cut = async (name: string) => (await rowText(ui, new RegExp(`…/${name}\\.tsx$`))) ?? ''
  // "+8" against "+8 −1": 3 columns more for the path.
  expect((await cut('one')).length - (await cut('two')).length).toBe(3)
})

test('show all FILES: the stacked rows light and open; the modal under them stays dark', async ($, on) => {
  quiet(on)
  // 5 files: the modal shows 3 and show all, as it caps any list.
  const names = ['f0.ts', 'f1.ts', 'f2.ts', 'f3.ts', 'f4.ts']
  on('process.run', (_, e) => ran(showRepo([A], undefined, names.map(n => `M\0${n}\0`).join(''), names.map(n => `1\t0\t${n}\0`).join(''))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  // show all sits below the window: scroll the modal to its end.
  await wheel($, 20, 10)
  await ui.press({ key: 'm:all:FILES' })
  expect(await ui.find({ key: `row:sf:${fileKey('f4.ts')}` })).toBeDefined()
  expect(JSON.stringify(await ui.drawn()).split('"hover":{"backgroundColor":"#0f1c28"}').length - 1).toBe(5)
})

test('copy copies the full sha', async ($, on) => {
  quiet(on)
  let copied = ''
  on('ui.copy', (_, e) => {
    copied = (e as any).text
    return { value: {} } as any
  })
  on('process.run', (_, e) => ran(showRepo([A])(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  await ui.press({ key: 'm:copy' })
  expect(copied).toBe(A)
})

test('pushed commit has github linking to its page', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([])(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual([`https://github.com/o/r/commit/${A}`])
})

test('no remote: no github action', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([A])(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await ui.findAll({ type: 'Link' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: ' copy' })).toBeDefined()
})

// The commit modal links only a page that surely exists: a known host, and a commit some remote has.
const pages: [string, Record<string, string>, boolean][] = [
  ['an unknown host', { 'get-url': 'git@git.acme.com:o/r.git\n' }, false],
  ['a branch with no upstream', { status: '## b\n' }, true],
  ['a branch gone from origin', { status: '## b...origin/b [gone]\n' }, true],
  ['a failed unpushed list', { '--remotes': 'fail' }, false],
]
for (const [what, answers, linked] of pages)
  test(`commit modal links only what surely has a page: ${what}`, async ($, on) => {
    quiet(on)
    on('process.run', (_, e) => {
      const out = e.argv.includes('show') ? showRepo([])(e.argv) : git(repoOn('b', { log: `${logLine(A, 'feat: one')}\n`, ...answers }))(e.argv)
      return out === 'fail' ? { value: { ...ran('').value, exitCode: 128 } } : ran(out ?? '')
    })
    const ui = await mount($)
    await tap(ui, `c:${A}`)
    expect((await ui.findAll({ type: 'Link' })).length).toBe(linked ? 1 : 0)
  })

test('a press on the open commit row closes the modal', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([A])(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect((await ui.find({ key: `row:c:${A}` }))?.props.props).toMatchObject({ open: '#0f1c28' })
  await tap(ui, `c:${A}`)
  expect(await ui.find({ key: 'modal' })).toBeUndefined()
})

// A row Client's props: its pieces and the line group it heats.
type RowProps = { line?: string; left: { text: string; hover?: { scope?: string; color?: string }; under?: { scope?: string; color?: string } }[] }
const rowProps = async (ui: Ui, key: string) => (await ui.find({ key: `row:${key}` }))?.props.props as RowProps | undefined

test('hovering the last CHANGES row dims the ⇕ divider', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M a.ts\n M b.ts\n M c.ts\n'))(e.argv) ?? ''))
  const ui = await mount($)
  const last = (await rowProps(ui, fileKey('c.ts')))?.line
  expect(last).toMatch(/^line:\d+$/)
  expect(((await ui.find({ key: 'divider' }))?.props.props as { line?: string }).line).toBe(last)
})

test('with empty CHANGES rows under the last file, the ⇕ divider stays out of its dim', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M a.ts\n M b.ts\n M c.ts\n'))(e.argv) ?? ''))
  const ui = await mount($)
  // Dragged 2 rows down: 2 empty rows sit between c.ts and the divider.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(((await ui.find({ key: 'divider' }))?.props.props as { split: number; line?: string }).split).toBe(5)
  expect(((await ui.find({ key: 'divider' }))?.props.props as { line?: string }).line).toBeUndefined()
})

test('the next file row carries the faded hover of the row above', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(changesRepo(' M a.ts\n M b.ts\n'))(e.argv) ?? ''))
  const ui = await mount($)
  const above = (await rowProps(ui, fileKey('a.ts')))?.line
  const below = await rowProps(ui, fileKey('b.ts'))
  expect(below?.left.every(p => p.hover?.scope === above && p.hover?.color === '#3a424a')).toBe(true)
})

test('a card that would pass the pane bottom opens upward, and the line above dims', async ($, on) => {
  quiet(on)
  const shas = Array.from({ length: 40 }, (_, i) => String(i).padStart(2, '0').repeat(20))
  on('process.run', (_, e) => ran(commitsRepo(shas.map((sha, i) => logLine(sha, `fix: commit ${i}`)), [])(e.argv) ?? ''))
  const ui = await mount($)
  const tree = await ui.drawn()
  const drawn = JSON.stringify(tree)
  // A card's top: the absolute Box revealed by its row's card group.
  const topOf = (sha: string) => {
    const walk = (node: any): number | undefined => {
      if (!node || typeof node !== 'object') return undefined
      const style = { ...node, ...node.props }
      if (style.hover?.scope === `card:c:${sha}` && style.position === 'absolute') return style.top
      for (const child of [...(node.children ?? []), ...[node.props?.children].flat()]) {
        const found = walk(child)
        if (found !== undefined) return found
      }
      return undefined
    }
    return walk(tree) ?? NaN
  }
  const rows = shas.filter(sha => drawn.includes(`"row:c:${sha}"`))
  const [first, prev, last] = [rows[0]!, rows.at(-2)!, rows.at(-1)!]
  // The first row's card hangs down, one row below it; the last row's, 1 row tall plus its border, ends one row
  // above its row.
  const lastAt = topOf(first) - 2 + rows.length - 1
  expect(topOf(last)).toBe(lastAt - 1 - 3)
  // The row above the last one fades in the last row's group.
  const lastLine = (await rowProps(ui, `c:${last}`))?.line
  expect((await rowProps(ui, `c:${prev}`))?.left.every(p => p.under?.scope === lastLine)).toBe(true)
})

test('commit card: no −0 when nothing was removed', async ($, on) => {
  quiet(on)
  const stat = `\x1e${A}\n\n 1 file changed, 3 insertions(+)\n`
  on('process.run', (_, e) => ran(commitsRepo([logLine(A, 'feat: one')], [], stat)(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, `c:${A}`)
  expect(await ui.find({ type: 'Text', text: '+3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−0' })).toBeUndefined()
})

test('a path with a space or a tab: unquoted, counted, opened, drawn as spaces', async ($, on) => {
  quiet(on)
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return ran(git(changesRepo(' M a b.ts\n M c\td.ts\n', '2\t1\ta b.ts\0', { '--absolute-git-dir': '/repo/.git\n/repo/.git\n/repo\n' }))(e.argv) ?? '')
  })
  const ui = await mount($)
  expect(runs.find(argv => argv.includes('status'))).toContain('-z')
  expect(await piece(ui, fileKey('a b.ts'), /^ a b\.ts$/)).toBeDefined()
  expect(await piece(ui, fileKey('a b.ts'), '+2')).toBeDefined()
  expect(await piece(ui, fileKey('c\td.ts'), /^ c d\.ts$/)).toBeDefined()
  await tap(ui, fileKey('a b.ts'))
  expect(await ui.find({ type: 'Text', text: '/repo/a b.ts' })).toBeDefined()
})

test('untracked counts read only files up to 1 MiB, found by size first', async ($, on) => {
  quiet(on)
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return ran(git(changesRepo('?? new.ts\n'))(e.argv) ?? '')
  })
  await mount($)
  const count = runs.find(argv => argv.includes('-l'))
  expect(count?.slice(0, 1)).toEqual(['find'])
  // find rounds sizes up to whole KiB: under 1025k is 1 MiB or less.
  expect(count).toContain('-1025k')
  expect(count).toContain('-type')
})

test('a SHA-256 commit row keeps its hover scopes within 64 characters', async ($, on) => {
  quiet(on)
  const long = 'e'.repeat(64)
  on('process.run', (_, e) => ran(commitsRepo([logLine(long, 'feat: one')], [])(e.argv) ?? ''))
  const ui = await mount($)
  expect(await ui.find({ type: 'Text', text: 'COMMITS' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/"scope":"[^"]{65,}"/)
})

test('a committed file name with a control character draws as a space in the commit modal', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(showRepo([A], undefined, 'A\0a\tb.ts\0', '1\t0\ta\tb.ts\0')(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, `c:${A}`)
  expect(await rowText(ui, / a b\.ts$/)).toBeDefined()
})

test('a failed check log with colour codes draws as plain text', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ran(JSON.stringify([prJson({ statusCheckRollup: [failedRun] })]))
    if (e.argv[0] === 'gh' && e.argv[2] === 'view' && e.argv[1] === 'pr') return ran(JSON.stringify(viewJson()))
    if (e.argv[0] === 'gh' && e.argv[1] === 'run') return ran('test\tRun\t2026-11-02T06:39:42.1Z \x1b[31mFAIL\x1b[0m a\x07b\n')
    return ran(git(repoOn('a'))(e.argv) ?? '')
  })
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: 'FAIL a b' })).toBeDefined()
})

test('a conflict file name with a control character draws as a space in the PR modal', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a', { 'merge-tree': 'abc\na\x1bb.ts\n\nInfo\n' }), [prJson({ mergeable: 'CONFLICTING' })])
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: ' conflicts in a b.ts' })).toBeDefined()
})

// A rebase stop with a real repo: the first press arms, the second runs.
const armed = (on: Parameters<TestBody>[1], runs: string[]) => {
  quiet(on, 5 * MIN, false, rebaseDir(1))
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    return ran(git(conflictRepo({ '--diff-filter=U': '', '--numstat': '' }))(e.argv) ?? '')
  })
}

test('rebase abort runs only on a second press, and its label asks in red first', async ($, on) => {
  const runs: string[] = []
  armed(on, runs)
  const ui = await mount($)
  await tap(ui, 'rebase')
  await ui.press({ key: 'm:abort' })
  expect(runs.filter(r => r.includes('--abort'))).toEqual([])
  expect((await ui.find({ type: 'Text', text: ' abort?' }))?.props.color).toBe('error')
  await ui.press({ key: 'm:abort' })
  expect(runs.filter(r => r.includes('--abort')).length).toBe(1)
})

test('rebase skip asks first too; a press on abort moves the ask, and neither runs', async ($, on) => {
  const runs: string[] = []
  armed(on, runs)
  const ui = await mount($)
  await tap(ui, 'rebase')
  await ui.press({ key: 'm:skip' })
  expect((await ui.find({ type: 'Text', text: ' skip?' }))?.props.color).toBe('error')
  await ui.press({ key: 'm:abort' })
  expect(await ui.find({ type: 'Text', text: ' skip?' })).toBeUndefined()
  expect(runs.filter(r => / rebase --(abort|skip)/.test(r))).toEqual([])
})

test('continue still runs on one press', async ($, on) => {
  const runs: string[] = []
  armed(on, runs)
  const ui = await mount($)
  await tap(ui, 'rebase')
  await ui.press({ key: 'm:continue' })
  expect(runs).toContain('git -c core.editor=true rebase --continue')
})

test('presses landing while a rebase action runs start no second git run', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(1))
  const runs: string[] = []
  let release = () => {}
  on('process.run', async (_, e) => {
    if (e.argv.includes('--continue')) {
      runs.push(e.argv.join(' '))
      await new Promise<void>(done => (release = done))
    }
    return ran(git(conflictRepo({ '--diff-filter=U': '', '--numstat': '' }))(e.argv) ?? '')
  })
  const ui = await mount($)
  await tap(ui, 'rebase')
  const presses = [ui.press({ key: 'm:continue' }), ui.press({ key: 'm:continue' })]
  await ui.drawn()
  release()
  await Promise.allSettled(presses)
  expect(runs.length).toBe(1)
})

test('a rebase that ended outside the modal closes it, so the next stop opens nothing', async ($, on) => {
  const dir: Record<string, string | null> = { ...rebaseDir(1) }
  quiet(on, 5 * MIN, false, dir, true)
  const clock = mock.clock(on, { now: NOW })
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const repo: Record<string, string> = conflictRepo()
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  for (const name of Object.keys(dir)) dir[name] = null
  await $.tool.call({ tool: 'Bash', command: 'git rebase --abort' })
  await ui.drawn()
  await clock.advance(1)
  for (const [name, text] of Object.entries(rebaseDir(1))) dir[name] = text
  await $.tool.call({ tool: 'Bash', command: 'git rebase main' })
  expect(await ui.find({ key: 'm:abort' })).toBeUndefined()
})

test('the PR modal closes when the branch moves to another PR, rather than show it empty', async ($, on) => {
  quiet(on)
  const repo = repoOn('a')
  withPr(on, repo, [prJson(), prJson({ number: 170, headRefName: 'b' })])
  const ui = await openPr($)
  expect(await ui.find({ key: 'm:copy' })).toBeDefined()
  repo.status = '## b...origin/b\n'
  await $.tool.call({ tool: 'Bash', command: 'git switch b' })
  await ui.drawn()
  expect(await ui.find({ key: 'm:copy' })).toBeUndefined()
})

test('a tab key closes an open modal, so the next Escape is not spent on it', async ($, on) => {
  quiet(on)
  const opens: unknown[] = []
  on('ui.open', (_, e) => (opens.push((e as any).closeOnEscape), { value: { isPlaced: true } }) as any)
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  on('process.run', (_, e) => ran(git(repoOn('b20'))(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'branch')
  expect(opens.at(-1)).toBe(true)
  await $.command.run({ command: 'margin-history', args: '', origin: { kind: 'composer' } } as any)
  expect(opens.at(-1)).toBeUndefined()
})

test('opening a file from a modal closes the modal', async ($, on) => {
  quiet(on, 5 * MIN, false, { '/repo/b.ts': 'pr file text' })
  withPr(on, repoOn('a'), [prJson()], viewJson({ files: [{ path: 'b.ts', additions: 1, deletions: 0, changeType: 'MODIFIED' }] }))
  const ui = await openPr($)
  await wheel($, 20, 10)
  await tap(ui, `mf:${fileKey('b.ts')}`)
  await ui.press({ key: 'Git' })
  expect(await ui.find({ key: 'm:copy' })).toBeUndefined()
})

test('a click on a faded divider posts nothing and grabs nothing', () => {
  const tag = (name: string) => Object.assign((props: object) => ({ type: name, props }), { tag: name })
  let pointer = (_: any) => {}
  const posts: unknown[] = []
  const surface: any = { elements: { Box: tag('Box'), Text: tag('Text') }, onPointer: (f: typeof pointer) => (pointer = f), columns: 40, post: (m: unknown) => posts.push(m), setState: (s: unknown) => (surface.state = s) }
  Divider({ split: 3, min: 1, max: 5, faded: true }, surface)
  pointer({ type: 'down', x: 0, y: 0, button: 'left' })
  pointer({ type: 'up', x: 0, y: 0, button: 'left' })
  expect(posts).toEqual([])
  expect(surface.state?.grabbed).toBeUndefined()
})

test('a worktree path with a control character draws as a space', async ($, on) => {
  quiet(on)
  withTrees(on, TREES.replace('/tmp/w', '/tmp/w\x1bx'))
  const ui = await mount($)
  await worktreeView(ui)
  expect(await ui.find({ type: 'Text', text: ' /tmp/w x' })).toBeDefined()
})

test('a stacked section that goes closes with it, so the next one opens nothing', async ($, on) => {
  quiet(on, 5 * MIN, false, rebaseDir(2), true)
  const clock = mock.clock(on, { now: NOW })
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }) as any)
  const names = ['a', 'b', 'c', 'd', 'e'].map(n => `${n}.txt`)
  const numstat = names.map(name => `4\t0\t${name}\n`).join('')
  const repo: Record<string, string> = conflictRepo({ '--diff-filter=U': `${names.join('\n')}\n`, '--numstat': numstat })
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await mount($)
  await tap(ui, 'rebase')
  await wheel($, 20, 10)
  await ui.press({ key: 'm:all:CONFLICTS' })
  expect(await ui.find({ key: 's:x' })).toBeDefined()
  Object.assign(repo, { '--diff-filter=U': '', '--cached': numstat })
  await $.tool.call({ tool: 'Bash', command: 'git add .' })
  await ui.drawn()
  await clock.advance(1)
  Object.assign(repo, { '--diff-filter=U': `${names.join('\n')}\n`, '--cached': '' })
  await $.tool.call({ tool: 'Bash', command: 'git checkout -m .' })
  await ui.drawn()
  expect(await ui.find({ key: 's:x' })).toBeUndefined()
})

test('an ask holds only for its step: when the rebase moves on, skip asks again', async ($, on) => {
  const dir: Record<string, string | null> = { ...rebaseDir(2) }
  quiet(on, 5 * MIN, false, dir)
  const runs: string[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    return ran(git(conflictRepo())(e.argv) ?? '')
  })
  const ui = await mount($)
  await tap(ui, 'rebase')
  await ui.press({ key: 'm:skip' })
  Object.assign(dir, rebaseDir(3))
  await $.tool.call({ tool: 'Bash', command: 'git rebase --continue' })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: ' skip?' })).toBeUndefined()
  await ui.press({ key: 'm:skip' })
  expect(runs.filter(r => r.includes('rebase --skip'))).toEqual([])
})

test('a failed git read leaves an open modal alone', async ($, on) => {
  quiet(on, 5 * MIN, false, {}, true)
  const clock = mock.clock(on, { now: NOW })
  let failing = false
  const repo = repoOn('a')
  on('process.run', (_, e) => {
    if (failing && e.argv.includes('status')) return ran('', 1)
    if (e.argv[0] === 'gh' && e.argv[2] === 'list') return ran(JSON.stringify([prJson()]))
    if (e.argv[0] === 'gh' && e.argv[2] === 'view') return ran(JSON.stringify(viewJson()))
    return ran(git(repo)(e.argv) ?? '')
  })
  const ui = await openPr($)
  failing = true
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await ui.drawn()
  await clock.advance(1)
  failing = false
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await ui.drawn()
  expect(await ui.find({ key: 'm:copy' })).toBeDefined()
})
