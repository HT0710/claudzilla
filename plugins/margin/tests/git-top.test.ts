import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import Row from '../hooks/row'

// A process.run result with `stdout`.
const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
// Answers a git run with the first entry whose key is one of its arguments.
const git = (repo: Record<string, string>) => (argv: readonly string[]) =>
  argv[0] !== 'git' ? undefined : (Object.entries(repo).find(([command]) => argv.includes(command))?.[1] ?? '')
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
const quiet = (on: Parameters<TestBody>[1], fetched = 5 * MIN, basic = false, dir: Record<string, string> = {}, clock = false) => {
  if (!clock) on('clock.now', () => ({ value: NOW }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: dir[String((e as any).path).replace('/repo/.git/', '')] ?? '' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)
  on('fs.exists', (_, e) => ({ value: basic && String((e as any).path ?? '').endsWith('.claudzilla-basic-glyphs') }))
  const top = [...new Set(Object.keys(dir).map(path => path.split('/')[0]!))].map(name => ({ name, kind: name.includes('_') ? 'file' : 'dir', size: 1, mtimeMs: 0, isLink: false }))
  on('fs.list', () => ({ value: [{ name: 'FETCH_HEAD', kind: 'file', size: 1, mtimeMs: NOW - fetched, isLink: false }, ...top] }))
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
const wheel = ($: Parameters<TestBody>[0], by: number, row: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 24, contentRows: 24, origin: { kind: 'person' }, pointer: { column: 10, row } })

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
  expect(await ui.find({ type: 'Text', text: /^ fetched/ })).toBeDefined()
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
  // The card is 75% of the 67-column body: 50 columns, 24 of them taken around the URL.
  expect(shown.length).toBeLessThanOrEqual(50 - 26)
})

test('branch card: upstream sync and stash count', async ($, on) => {
  quiet(on)
  on('process.run', (_, e) => ran(git(repoOn('a', { status: '## a...origin/a [ahead 1]\n', stash: 'WIP on a: x\nWIP on b: y\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  await hover(ui, 'branch')
  expect((await ui.findAll({ type: 'Text', text: '↑1' })).some(t => t.props.color === '#d4b860')).toBe(true)
  expect(await ui.find({ type: 'Text', text: '1 on this branch' })).toBeDefined()
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
  const groups = find(await ui.drawn(), n => n.type === 'Box' && n.props?.gap === 2 && n.props?.flexShrink === 0)
  expect(modal).toBeDefined()
  expect(groups.length).toBeGreaterThan(1)
  // Every row's columns share their widths.
  const widths = groups.map(g => JSON.stringify(find(g.props?.children ?? g.children, n => n.type === 'Box' && n.props?.width !== undefined).map(n => n.props.width)))
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

test('rows behind an open modal fade to 50% and lose hover; the row that opened it stays, lit', async ($, on) => {
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
  // Behind: HUD.faint #4f5c68 at 50%; plain text a dark grey.
  expect((await ui.find({ type: 'Text', text: 'def5678' }))?.props.color).toBe('#282e34')
  expect((await ui.find({ type: 'Text', text: /^pushed one/ }))?.props.color).toBe('#282e34')
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
  expect((await ui.find({ type: 'Text', text: /^─{63}$/ }))?.props.color).toBe('#555555')
  expect(JSON.stringify((await ui.find({ key: 'divider' }))?.props)).toContain('"faded":true')
})

test('under a PR modal the branch row fades; the PR row keeps its colours on the lit row', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()])
  const ui = await openPr($)
  expect((await piece(ui, 'branch', '⎇ a'))?.props.color).toBe('#2f4b3c')
  expect((await piece(ui, 'pr', '#168'))?.props).toMatchObject({ color: 'claude', backgroundColor: '#0f1c28' })
})

test('under a stacked modal the modal fades too', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson({ statusCheckRollup: Array.from({ length: 6 }, (_, i) => checkRun(`k${i}`, 'SUCCESS')) })])
  const ui = await openPr($)
  await ui.press({ key: 'm:all:CHECKS' })
  // HUD.label #a396d2 at 50% in the modal; in full in the stacked modal's pinned title.
  const colours = (await ui.findAll({ type: 'Text', text: 'CHECKS' })).map(t => t.props.color)
  expect(colours).toContain('#524b69')
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
  // Label 1 + 10 columns, then the longest info, "2 commits · 2 files".
  const widths = find(card, n => n.type === 'Box' && n.props?.flexShrink === 0 && n.props?.width !== undefined).map(n => n.props.width)
  expect(widths.length).toBeGreaterThan(1)
  expect(new Set(widths)).toEqual(new Set([11 + '2 commits · 2 files'.length]))
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
  expect(await lead('rebase')).toEqual({ scope: 'line:0', color: '#555555' })
  expect(await lead('pr')).toEqual({ scope: 'line:1', color: '#555555' })
  // Under the last line the rule fades.
  const hovers = (node: unknown): object[] => {
    const el = node as { type?: string; hover?: { scope?: string }; children?: unknown[] }
    if (typeof node !== 'object' || !el) return []
    return [...(el.type === 'Text' && el.hover?.scope?.startsWith('line:') ? [el.hover] : []), ...(el.children ?? []).flatMap(hovers)]
  }
  expect(hovers(await ui.drawn())).toEqual([{ scope: 'line:2', color: '#555555' }])
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

test("a dimmed row keeps its hue: a theme key fades by the active custom theme's own colour", async ($, on) => {
  quiet(on, 5 * MIN, false, { ...rebaseDir(2), '/home/me/themes/mine.json': JSON.stringify({ name: 'mine', base: 'dark', overrides: { warning: '#d9a441' } }) })
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'custom:mine' }] }) as any)
  on('process.run', (_, e) => ran(git(conflictRepo())(e.argv) ?? ''))
  const ui = await mount($)
  // warning #d9a441 at 50%; a key the theme leaves to its base stays the grey.
  const pieces = ((await ui.find({ key: 'row:rebase' }))?.props.props as { left: { text: string; hover?: { color?: string } }[] }).left
  expect(pieces.find(p => p.text.startsWith('↺'))?.hover?.color).toBe('#6d5221')
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
  expect(await ui.find({ type: 'Text', text: /commit 0$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /f0\.ts/ })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: ` · by HT0710 · ${verb} 2h ago` })).toBeDefined()
    await ui.press({ key: 'm:x' })
  }
})

test('a base conflict adds the conflicts row', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a', { 'merge-tree': 'abc123\nplugins/margin/hooks/register.tsx\nGUIDE.md\n\nCONFLICT (content)\n' }), [prJson({ mergeable: 'CONFLICTING' })])
  const ui = await openPr($)
  expect(await ui.find({ type: 'Text', text: ' conflicts in register.tsx, GUIDE.md' })).toBeDefined()
})

test('description: first row 2 in, the rest 1 in, 3 rows, … on the last, then show all', async ($, on) => {
  quiet(on)
  withPr(on, repoOn('a'), [prJson()], viewJson({ body: LONG }))
  const ui = await openPr($)
  const rows = (await ui.findAll({ type: 'Text', text: /^ +\S/ })).map(t => t.text).filter(t => LONG.includes(t.trim().replace(/…$/, '')) && t.trim().length > 10)
  expect(rows.length).toBe(3)
  expect(rows[0]).toMatch(/^ {2}Adds/)
  expect(rows[1]).toMatch(/^ \S/)
  expect(rows[2]).toMatch(/…$/)
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
  expect(await ui.find({ type: 'Text', text: /…\/register\.tsx$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: ' · step 2 of 3' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: '✓' })).at(-1)?.props.color).toBe('#5d9678')
  expect(await ui.find({ type: 'Text', text: 'CONFLICTS' })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: ' U' })).at(-1)?.props.color).toBe('#e06c75')
})

test('merge modal: title, incoming count, incoming commits', async ($, on) => {
  quiet(on, 5 * MIN, false, { MERGE_HEAD: '5e7dbcbb8a85c012da009d6523d686489df6d25f\n', MERGE_MSG: "Merge branch 'release/1.7' into feat/x\n" })
  on('process.run', (_, e) => ran(git(conflictRepo({ status: '## feat/x\nUU f.txt\n', log: '5e7dbcb\tfix: upper b\t1793603824\n' }))(e.argv) ?? ''))
  const ui = await mount($)
  expect(await piece(ui, 'rebase', 'merging ')).toBeDefined()
  await tap(ui, 'rebase')
  expect(await ui.find({ type: 'Text', text: "Merge branch 'release/1.7' into feat/x" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · 1 incoming commit' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: '  HT0710 · from feat/t' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: ' · by HT0710 · opened 2h ago' })).toBeDefined()
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
