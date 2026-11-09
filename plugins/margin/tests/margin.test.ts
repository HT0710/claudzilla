import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { AgentStatus, Register } from 'claude-code'
import type { Spawn, Step } from '../types'
import { fileKey } from '../hooks/git-data'

import { EMPTY_USED, dayLabel, gitWeb, gone, hang, inView, keepNewest, fileView, fileWindow, lastRowIds, litPrompt, nearestCommandId, nearestId, needles, ordered, parseSummary, parseTopics, pinHolds, readStamps, recordUse, resetUsed, stampPattern, useOf, zoneWindow } from '../hooks/register'

// A process.run result with `stdout`.
const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
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
// Stands for grep pulling this chat's lines from the prompt history.
const isHistoryGrep = (argv: readonly string[]) => argv.at(-1)?.endsWith('history.jsonl') ?? false

// The bottom bar's rule and labels, on top of the 20 rows the bodies were sized to.
const BAR_ROWS = 2
const props = {
  title: 'Panel',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 + BAR_ROWS },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: History, Git and Overview tabs show, Overview first`, async ($, on) => {
    on('clock.now', () => ({ value: 0 }))
    on('env.get', () => ({ value: '/home/me' }))
    on('session.id', () => ({ value: 'chat-1' }))
    on('fs.read', () => ({ value: '' }))
    const ui = await $.ui.mount({ plugin: 'margin', surface, component: 'Pane', props, requestId: 'margin' })
    expect(await ui.find({ key: 'Activity' })).toBeUndefined()
    expect(await ui.find({ key: 'Git' })).toBeDefined()
    expect(await ui.find({ key: 'History' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
  })
}

// Stands for git in the session's folder: each subcommand the test holds answers its text.
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
// An empty History.
const noHistory = (on: Parameters<TestBody>[1], now = () => 0) => {
  on('clock.now', () => ({ value: now() }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
}

test('Git tab shows the branch, changed files and last commits', async ($, on) => {
  noHistory(on)
  const repo = {
    status: '## main...origin/main [ahead 1, behind 2]\n M hooks/register.tsx\nA  new.ts\n?? notes.md\n',
    log: 'abc1234ffff abc1234 feat: add thing\nghi9012ffff ghi9012 chore(ci): tidy\njkl3456ffff jkl3456 wip: try\ndef5678ffff def5678 fix(core): old bug\n',
    diff: '80\t4\thooks/register.tsx\0' + '6\t2\tnew.ts\0',
    // Answers only the list that leaves out commits a remote has.
    '--remotes': 'abc1234ffff\nghi9012ffff\njkl3456ffff\n',
    '--count': '142\n',
  }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  // The name alone; diverged from its upstream, one mark: the counts are in the branch card.
  expect(await ui.find({ type: 'Text', text: '⎇ main', in: 'row:branch' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ↕', in: 'row:branch' })).toBeDefined()
  // A rule under the branch, as wide as the body.
  expect(await ui.find({ type: 'Text', text: new RegExp(`^─{${props.bodyColumns - 4}}$`) })).toBeDefined()
  // The file count faint, then the lines added and removed, summed.
  expect((await ui.find({ type: 'Text', text: '3 files' }))?.props.color).toBe('#4f5c68')
  expect(await ui.find({ type: 'Text', text: '+86' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '−6' })).toBeDefined()
  expect(await rowText(ui, /hooks\/register\.tsx/)).toBeDefined()
  expect(await rowText(ui, /notes\.md/)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'abc1234' })).toBeDefined()
  // Unpushed is ahead, gold as everywhere; the total faint.
  expect((await ui.find({ type: 'Text', text: '↑3' }))?.props.color).toBe('#d4b860')
  expect((await ui.find({ type: 'Text', text: /^ {2}142 total$/ }))?.props.color).toBe('#4f5c68')
  // Local bright, pushed dim.
  expect((await ui.find({ type: 'Text', text: /^add thing$/, in: 'row:c:abc1234ffff' }))?.props.color).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^old bug$/, in: 'row:c:def5678ffff' }))?.props.color).toBe('#4f5c68')
  // Each type its own color, pushed at 60%; a type outside the git rules stays gray.
  expect((await ui.find({ type: 'Text', text: /^feat$/, in: 'row:c:abc1234ffff' }))?.props.color).toBe('#98c379')
  expect((await ui.find({ type: 'Text', text: /^chore$/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#a396d2')
  expect((await ui.find({ type: 'Text', text: /^wip$/, in: 'row:c:jkl3456ffff' }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^fix$/, in: 'row:c:def5678ffff' }))?.props.color).toBe('#864146')
  // A local scope a light gray under its subject; its parentheses stay faint.
  expect((await ui.find({ type: 'Text', text: /^ci$/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#808286')
  expect((await ui.find({ type: 'Text', text: /^\($/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^\): $/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^core$/, in: 'row:c:def5678ffff' }))?.props.color).toBe('#4f5c68')
})

test('a remote on a known host gives its commit and branch pages; any other host none', () => {
  expect(gitWeb('git@github.com:o/r.git')?.commit('abc')).toBe('https://github.com/o/r/commit/abc')
  expect(gitWeb('https://github.com/o/r.git\n')?.branch('release/1.5')).toBe('https://github.com/o/r/tree/release/1.5')
  expect(gitWeb('ssh://git@gitlab.com:22/g/sub/r.git')?.commit('abc')).toBe('https://gitlab.com/g/sub/r/-/commit/abc')
  expect(gitWeb('https://user@gitlab.com/g/r')?.branch('main')).toBe('https://gitlab.com/g/r/-/tree/main')
  expect(gitWeb('https://codeberg.org/o/r.git')?.branch('a#b')).toBe('https://codeberg.org/o/r/src/branch/a%23b')
  expect(gitWeb('git@git.sr.ht:~u/r')?.commit('abc')).toBe('https://git.sr.ht/~u/r/commit/abc')
  expect(gitWeb('git@GitHub.com:123/r')?.commit('abc')).toBe('https://github.com/123/r/commit/abc')
  expect(gitWeb('https://github.com/o/r/')?.commit('abc')).toBe('https://github.com/o/r/commit/abc')
  expect(gitWeb('https://github.com:443/o/r.git/')?.commit('abc')).toBe('https://github.com/o/r/commit/abc')
  // A token in the remote never reaches the link.
  expect(gitWeb('https://me:tok@github.com/o/r.git')?.commit('abc')).toBe('https://github.com/o/r/commit/abc')
  expect(gitWeb('git@git.acme.com:o/r.git')).toBeUndefined()
  expect(gitWeb('file:///srv/r.git')).toBeUndefined()
  expect(gitWeb('/srv/r.git')).toBeUndefined()
  expect(gitWeb('')).toBeUndefined()
})

test('a commit subject with no Conventional Commits type shows whole', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: 'abc1234ffff abc1234 Merge branch x\n', '--remotes': 'abc1234ffff\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect((await ui.find({ type: 'Text', text: /^ Merge branch x$/ }))?.props.color).toBeUndefined()
})

test("a changed file shows git's two status letters: the index's dim, the worktree's bright", async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n M a.ts\nA  b.ts\nAM c.ts\n?? d.ts\nUU e.ts\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  const inRow = async (path: string, text: RegExp) => (await ui.findAll({ type: 'Text', text, in: `row:${fileKey(path)}` })).map(t => t.props.color)
  expect(await inRow('a.ts', /^M$/)).toEqual(['#e5c07b'])
  expect((await inRow('a.ts', /a\.ts$/)).at(-1)).toBeUndefined()
  // Staged, then edited again: the index's letter at 60%, the worktree's bright.
  expect([...(await inRow('c.ts', /^A$/)), ...(await inRow('c.ts', /^M$/))]).toEqual(['#5b7549', '#e5c07b'])
  // Wholly staged: its path faint too.
  expect(await inRow('b.ts', /^A$/)).toEqual(['#5b7549'])
  expect((await inRow('b.ts', /b\.ts$/)).at(-1)).toBe('#4f5c68')
  // Untracked and conflicted: both letters bright in one colour.
  expect(await inRow('d.ts', /^\?$/)).toEqual(['#56b6c2', '#56b6c2'])
  expect(await inRow('e.ts', /^U$/)).toEqual(['#e06c75', '#e06c75'])
})

test('Git tab redraws after a tool call changes the repo', async ($, on) => {
  noHistory(on)
  const repo = { status: '## main\n M a.ts\n', log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  Object.assign(repo, { status: '## main...origin/main [ahead 1]\n', log: 'fed4321ffff fed4321 second\nabc1234ffff abc1234 first\n' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -am second' })

  expect(await ui.find({ type: 'Text', text: '⎇ main', in: 'row:branch' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'fed4321' })).toBeDefined()
})

test('the narrowest pane keeps the Git headers on one row, dropping their counts from the right', async ($, on) => {
  noHistory(on)
  const repo = {
    status: '## main\n M a.ts\nA  b.ts\n?? c.md\n',
    log: 'abc1234ffff abc1234 feat: add thing\n',
    diff: '80\t4\ta.ts\0' + '64\t2\tb.ts\0',
    '--remotes': 'abc1234ffff\nghi9012ffff\njkl3456ffff\n',
    '--count': '142\n',
  }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 23 }, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  // 19 columns: "CHANGES 3 files" fits, the line counts after it do not; "COMMITS ↑3" fits, the total does not.
  expect(await ui.find({ type: 'Text', text: '3 files' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+144/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '↑3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /total/ })).toBeUndefined()
})

test('dragging the divider gives CHANGES more rows', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 20 body rows less 7 fixed: CHANGES takes up to half of 13, 7 rows: 6 files and the ↓ cue.
  expect(await rowText(ui, /file5\.ts/)).toBeDefined()
  expect(await rowText(ui, /file6\.ts/)).toBeUndefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })

  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(await rowText(ui, /file8\.ts/)).toBeUndefined()
})

test('a one-row CHANGES zone scrolls with no cues', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))
  const scroll = { offset: 0, bodyRows: 9 + BAR_ROWS }
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, scroll }, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 9 body rows less 7 fixed: COMMITS keeps 1, CHANGES the 1 left, on row 5.
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 100, bodyRows: 9 + BAR_ROWS, contentRows: 9 + BAR_ROWS, origin: { kind: 'person' }, pointer: { column: 0, row: 5 } })
  await ui.drawn()
  expect(await rowText(ui, /file9\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeUndefined()
})

test('the divider shows how far it is dragged, and resizes once let go', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeDefined()
  expect(await rowText(ui, /file7\.ts/)).toBeUndefined()

  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeUndefined()
})

test('a release the divider missed ends the drag at the next move', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  // No up came: the next move holds no button.
  await ui.pointer({ type: 'move', x: 0, y: 2, in: 'divider' })

  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeUndefined()
})

test('the divider lights its grip while the pointer is over it', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n M file0.ts\n', log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  const grip = async () => (await ui.find({ type: 'Text', text: '⇕', in: 'divider' }))?.props

  expect((await grip())?.inverse).toBeUndefined()
  // The guide's colors: the rule's at rest, its lit grip's under the pointer.
  expect((await grip())?.color).toBe('promptBorder')
  await ui.pointer({ type: 'enter', x: 0, y: 0, in: 'divider' })
  expect((await grip())?.inverse).toBe(true)
  expect((await grip())?.color).toBe('claude')
  await ui.pointer({ type: 'leave', x: 0, y: 0, in: 'divider' })
  expect(await grip()).toBeDefined()
  expect((await grip())?.inverse).toBeUndefined()

  // Lit through a drag; let go off the rule, a drag sends no leave, so the up ends it.
  await ui.resize({ columns: 36, rows: 1, in: 'divider' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  expect((await grip())?.inverse).toBe(true)
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'divider' })
  expect((await grip())?.inverse).toBeUndefined()
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect((await grip())?.inverse).toBe(true)
})

test('the wheel scrolls CHANGES and COMMITS each on its own, up to their ends; ↑ brings each back up', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const log = Array.from({ length: 30 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: `${log}\n` })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES end on row 11, 6 of COMMITS start on row 14; once scrolled, the ↑ cue
  // takes a zone's first row.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeUndefined()
  await wheel(5, 8)
  expect(await rowText(ui, /file3\.ts/)).toBeUndefined()
  expect(await rowText(ui, /file4\.ts/)).toBeDefined()
  expect(await rowText(ui, /file9\.ts/)).toBeDefined()
  expect(await rowText(ui, /commit 0$/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'commits:up' })).toBeUndefined()

  await wheel(100, 16)
  expect(await rowText(ui, /commit 24$/)).toBeUndefined()
  expect(await rowText(ui, /commit 25$/)).toBeDefined()
  expect(await rowText(ui, /commit 29$/)).toBeDefined()
  expect(await rowText(ui, /file4\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'commits:up' })).toBeDefined()

  await ui.press({ key: 'commits:up' })
  expect(await rowText(ui, /commit 0$/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'commits:up' })).toBeUndefined()
  expect(await rowText(ui, /file4\.ts/)).toBeDefined()
  await ui.press({ key: 'changes:up' })
  expect(await rowText(ui, /file0\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeUndefined()
})

// The Git modal's cues on a list zone: ── ↑ N more ── once scrolled, ↓ N more while rows remain below.
const cueText = async (ui: { find: (q: any) => Promise<any> }, zone: string) => ({
  up: !!(await ui.find({ type: 'Button', key: `${zone}:up` })),
  down: !!(await ui.find({ type: 'Button', key: `${zone}:down` })),
})
const wheelAt = ($: Parameters<TestBody>[0], by: number, row: number) =>
  $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

test('CHANGES shows the modal cues: ↑ N more once scrolled, ↓ N more turns the page', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 30 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES from row 4: 6 files and ↓ at the top.
  expect(await cueText(ui, 'changes')).toEqual({ up: false, down: true })
  expect(await ui.find({ type: 'Text', text: ' 24 more' })).toBeDefined()
  await wheelAt($, 5, 6)
  // ↑, 5 files, ↓.
  expect(await cueText(ui, 'changes')).toEqual({ up: true, down: true })
  expect(await ui.find({ type: 'Text', text: ' 5 more ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 20 more' })).toBeDefined()
  expect(await rowText(ui, /file9\.ts/)).toBeDefined()
  expect(await rowText(ui, /file10\.ts/)).toBeUndefined()
  expect(texts(await ui.find({ type: 'Button', key: 'changes:up' }))[0]?.props).toMatchObject({ bold: true, color: 'promptBorder' })
  await ui.press({ key: 'changes:down' })
  expect(await rowText(ui, /file9\.ts/)).toBeUndefined()
  expect(await rowText(ui, /file10\.ts/)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 10 more ' })).toBeDefined()
  await wheelAt($, 100, 6)
  expect(await cueText(ui, 'changes')).toEqual({ up: true, down: false })
  expect(await rowText(ui, /file29\.ts/)).toBeDefined()
  await ui.press({ key: 'changes:up' })
  expect(await rowText(ui, /file0\.ts/)).toBeDefined()
  expect(await cueText(ui, 'changes')).toEqual({ up: false, down: true })
})

test('COMMITS shows the modal cues; ↓ more counts nothing, as COMMITS reads in pages', async ($, on) => {
  noHistory(on)
  const log = Array.from({ length: 60 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: '## main\n', '--count': '60\n', log: `${log}\n` })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // A clean repo: 15 rows of COMMITS, 14 commits and ↓ at the top.
  expect(await cueText(ui, 'commits')).toEqual({ up: false, down: true })
  expect(await ui.find({ type: 'Text', text: ' more' })).toBeDefined()
  expect(await rowText(ui, /commit 13$/)).toBeDefined()
  expect(await rowText(ui, /commit 14$/)).toBeUndefined()
  await wheelAt($, 5, 10)
  expect(await cueText(ui, 'commits')).toEqual({ up: true, down: true })
  expect(await ui.find({ type: 'Text', text: ' 5 more ' })).toBeDefined()
  expect(await rowText(ui, /commit 17$/)).toBeDefined()
  expect(await rowText(ui, /commit 18$/)).toBeUndefined()
  await ui.press({ key: 'commits:down' })
  expect(await rowText(ui, /commit 17$/)).toBeUndefined()
  expect(await rowText(ui, /commit 18$/)).toBeDefined()
  await wheelAt($, 1000, 10)
  expect(await cueText(ui, 'commits')).toEqual({ up: true, down: false })
  expect(await rowText(ui, /commit 59$/)).toBeDefined()
  await ui.press({ key: 'commits:up' })
  expect(await rowText(ui, /commit 0$/)).toBeDefined()
  expect(await cueText(ui, 'commits')).toEqual({ up: false, down: true })
})

test('the wheel over the divider moves it: up gives CHANGES rows, down takes them, each side keeps 1', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const log = Array.from({ length: 30 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: `${log}\n` })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES end on row 11: the divider is row 12, then 14 once moved.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  await wheel(-2, 12)
  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(await rowText(ui, /file8\.ts/)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'commits:up' })).toBeUndefined()

  await wheel(100, 14)
  expect(await rowText(ui, /file0\.ts/)).toBeDefined()
  expect(await rowText(ui, /file1\.ts/)).toBeUndefined()
})

test('notches close together keep moving the divider once it leaves the pointer; after a pause the list scrolls', async ($, on) => {
  let now = 0
  noHistory(on, () => now)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'c0ffff c0 commit 0\n' })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // The divider starts on row 12; the pointer stays there as it moves down.
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 12 } })

  await wheel(-1)
  now = 300
  await wheel(-1)
  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(await rowText(ui, /file8\.ts/)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeUndefined()

  now = 2000
  await wheel(1)
  expect(await ui.find({ type: 'Button', key: 'changes:up' })).toBeDefined()
  expect(await rowText(ui, /file9\.ts/)).toBeUndefined()
})

test('COMMITS reads a page at a time as the wheel goes past it, down to the first commit', async ($, on) => {
  noHistory(on)
  const all = Array.from({ length: 250 }, (_, i) => `c${i}ffff c${i} commit ${i}\n`)
  const skips: number[] = []
  on('process.run', (_, e) => {
    if (!e.argv.includes('log')) return ran(git({ status: '## main\n', '--count': '250\n' })(e.argv) ?? '')
    // The commit cards' shortstat read: no counts.
    if (e.argv.includes('--shortstat')) return ran('')
    const skip = Number(e.argv.find(arg => arg.startsWith('--skip='))?.slice(7))
    skips.push(skip)
    return ran(asLog(all.slice(skip, skip + Number(e.argv.find(arg => /^-\d+$/.test(arg))!.slice(1))).join('')))
  })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // A clean repo: 15 rows of COMMITS, 13 between the cues once scrolled.
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  await wheel(150)
  expect(await rowText(ui, /commit 149$/)).toBeUndefined()
  expect(await rowText(ui, /commit 162$/)).toBeDefined()
  expect(await rowText(ui, /commit 163$/)).toBeUndefined()
  await wheel(1)
  await wheel(1000)
  expect(await rowText(ui, /commit 234$/)).toBeUndefined()
  expect(await rowText(ui, /commit 249$/)).toBeDefined()
  expect(skips).toEqual([0, 100, 200])
})

test('with no commit count, COMMITS still scrolls page by page to the first commit', async ($, on) => {
  noHistory(on)
  const all = Array.from({ length: 250 }, (_, i) => `c${i}ffff c${i} commit ${i}\n`)
  on('process.run', (_, e) => {
    if (!e.argv.includes('log')) return ran(git({ status: '## main\n' })(e.argv) ?? '')
    // The commit cards' shortstat read: no counts.
    if (e.argv.includes('--shortstat')) return ran('')
    const skip = Number(e.argv.find(arg => arg.startsWith('--skip='))?.slice(7))
    return ran(asLog(all.slice(skip, skip + Number(e.argv.find(arg => /^-\d+$/.test(arg))!.slice(1))).join('')))
  })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  // Each page's draw lands before the next tick: until then the wheel stops at the page drawn.
  for (const by of [150, 1000, 1000]) {
    await wheel(by)
    await ui.redraw()
  }
  expect(await rowText(ui, /commit 249$/)).toBeDefined()
})

test('a clean repo drops CHANGES and its divider: COMMITS takes their rows', async ($, on) => {
  noHistory(on)
  const log = Array.from({ length: 15 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: 'CHANGES' })).toBeUndefined()
  expect(await ui.find({ key: 'divider' })).toBeUndefined()
  // 20 body rows less the tabs, their rule, the branch, its rule and the COMMITS header: 15.
  expect(await rowText(ui, /commit 14$/)).toBeDefined()
})

test('the divider drags up to 1 row of CHANGES, and no further', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES; dragged 9 rows up, past its title.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: -9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↑6', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -9, button: 'left', in: 'divider' })

  expect(await rowText(ui, /file0\.ts/)).toBeDefined()
  expect(await rowText(ui, /file1\.ts/)).toBeUndefined()
})

test('the divider drags down to 1 row of COMMITS, and no further', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 15 }, (_, i) => ` M file${i}.ts`).join('\n')
  const log = Array.from({ length: 5 }, (_, i) => `abc123${i}ffff abc123${i} commit${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 13 free rows, 7 of CHANGES; dragged 9 rows down, past COMMITS' first row.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓5', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 9, button: 'left', in: 'divider' })

  expect(await rowText(ui, /file10\.ts/)).toBeDefined()
  expect(await rowText(ui, /file11\.ts/)).toBeUndefined()
  expect(await rowText(ui, /commit0/)).toBeDefined()
  expect(await rowText(ui, /commit1/)).toBeUndefined()
})

test('a one-row CHANGES zone stays put dragged up, and grows dragged down', async ($, on) => {
  noHistory(on)
  const log = Array.from({ length: 15 }, (_, i) => `abc12${i}ffff abc12${i} commit${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: '## main\n M file0.ts\n', log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 1 row of CHANGES, 12 of COMMITS: 11 commits and the ↓ cue.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '⇕', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await rowText(ui, /commit10/)).toBeDefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 1, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓1', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'divider' })
  expect(await rowText(ui, /commit9/)).toBeDefined()
  expect(await rowText(ui, /commit10/)).toBeUndefined()
})

test('a click on the divider moves it to the top, and from the top to the bottom', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 15 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  // 13 free rows, 7 of CHANGES: clicked, 1; clicked again, 12.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await rowText(ui, /file0\.ts/)).toBeDefined()
  expect(await rowText(ui, /file1\.ts/)).toBeUndefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await rowText(ui, /file10\.ts/)).toBeDefined()
  expect(await rowText(ui, /file11\.ts/)).toBeUndefined()
})

test('a drag back to where it began moves the divider nowhere', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await rowText(ui, /file5\.ts/)).toBeDefined()
  expect(await rowText(ui, /file6\.ts/)).toBeUndefined()
})

test('Git tab reruns git after a tool call, not on every redraw', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  let runs = 0
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git' && e.argv.includes('status')) runs++
    return ran(git(repo)(e.argv) ?? '')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  const before = runs
  // A drag redraws the pane; the repo has not changed.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await rowText(ui, /file7\.ts/)).toBeDefined()
  expect(runs).toBe(before)

  await $.tool.call({ tool: 'Bash', command: 'touch x' })
  await ui.drawn()
  expect(runs).toBe(before + 1)
})

test('a read-only tool call leaves git unread', async ($, on) => {
  noHistory(on)
  let runs = 0
  on('process.run', (_, e) => {
    if (e.argv[0] === 'git' && e.argv.includes('status')) runs++
    return ran(git({ status: '## main\n' })(e.argv) ?? '')
  })
  on('tool.call', () => ({ result: {} }) as any)

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  const before = runs
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as any)
  await ui.drawn()

  expect(runs).toBe(before)
})

test('useOf names each kind and skips calls it does not know', () => {
  expect(useOf({ tool: 'Read', file_path: '/r/a/register.tsx' })).toEqual({ kind: 'files', name: 'register.tsx' })
  expect(useOf({ tool: 'Read', file_path: '/h/.claude/projects/-x/memory/use-branch.md' })).toEqual({ kind: 'memory', name: 'use-branch' })
  expect(useOf({ tool: 'Read', file_path: '/r/src/memory/notes.md' })).toEqual({ kind: 'files', name: 'notes.md' })
  expect(useOf({ tool: 'Read', file_path: '/r/src/memory/x.ts' })).toEqual({ kind: 'files', name: 'x.ts' })
  expect(useOf({ tool: 'WebFetch', url: 'https://code.claude.com/docs/x' })).toEqual({ kind: 'web', name: 'code.claude.com' })
  expect(useOf({ tool: 'Skill', skill: 'superpowers:brainstorming' })).toEqual({ kind: 'skills', name: 'superpowers:brainstorming' })
  expect(useOf({ tool: 'Read' })).toBeUndefined()
  expect(useOf({ tool: 'Bash', command: 'cat x' })).toBeUndefined()
  expect(useOf({ tool: 'mcp__margin__intent', wants: 'x' })).toBeUndefined()
})

test('a file read 5 times counts 5 and names it once', () => {
  let u = EMPTY_USED
  for (let i = 0; i < 5; i++) u = recordUse(u, { tool: 'Read', file_path: '/r/a.ts' })
  expect(u.kinds.files).toEqual({ main: 5, agents: 0, names: ['a.ts'], fromAgents: [] })
})

test('a subagent call counts as agents, not main', () => {
  const u = recordUse(EMPTY_USED, { tool: 'Read', file_path: '/r/a.ts', agentId: 'a1' })
  expect(u.kinds.files).toEqual({ main: 0, agents: 1, names: ['a.ts'], fromAgents: ['a.ts'] })
  expect(u.seen).toEqual(['a1'])
})

test('a mid-turn prompt keeps USED; a new prompt clears it', async ($, on) => {
  noHistory(on)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  on('tool.call', () => ({ result: 'ok' }) as any)
  let last: any
  on('state.set', (_, e, next) => {
    if (e.key === 'used') last = e.value
    return next(e)
  })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' } as any)
  expect(last.kinds.files.main).toBe(1)
  await $.prompt.submit({ text: 'also', wait: false, turnId: 't1', origin: { kind: 'composer' } } as any)
  expect(last.kinds.files.main).toBe(1)
  await $.prompt.submit({ text: 'new', wait: false, origin: { kind: 'composer' } } as any)
  expect(last.kinds).toEqual({})
})

test('a task notification or a slash command keeps USED', async ($, on) => {
  noHistory(on)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  on('tool.call', () => ({ result: 'ok' }) as any)
  let last: any
  on('state.set', (_, e, next) => {
    if (e.key === 'used') last = e.value
    return next(e)
  })
  await $.tool.call({ tool: 'Read', file_path: '/r/a.ts' } as any)
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } } as any)
  expect(last.kinds.files.main).toBe(1)
  await $.prompt.submit({ text: '/compact', wait: false, origin: { kind: 'composer' }, command: { name: 'compact', args: '' } } as any)
  expect(last.kinds.files.main).toBe(1)
  await $.prompt.submit({ text: 'meta', wait: false, isMeta: true, origin: { kind: 'composer' } } as any)
  expect(last.kinds.files.main).toBe(1)
})

test('a name Claude used stays out of fromAgents when an agent uses it after', () => {
  let u = recordUse(EMPTY_USED, { tool: 'Read', file_path: '/r/a.ts' })
  u = recordUse(u, { tool: 'Read', file_path: '/r/a.ts', agentId: 'a1' })
  expect(u.kinds.files!.fromAgents).toEqual([])
})

test('an agent met before the last prompt no longer counts', () => {
  let u = recordUse(EMPTY_USED, { tool: 'Read', file_path: '/r/a.ts', agentId: 'a1' })
  u = resetUsed(u)
  u = recordUse(u, { tool: 'Read', file_path: '/r/a.ts', agentId: 'a1' })
  expect(u.kinds.files).toBeUndefined()
})

test('a commit subject draws its control characters as spaces', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: 'abc1234ffff abc1234 feat: tab\there\x1bend\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(await rowText(ui, /tab here end$/)).toBeDefined()
})

test('Overview tab with nothing read yet shows a note', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test('top bar holds Overview, Decisions, History; bottom bar File, Tree, Git', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  const cells = (await ui.findAll({ type: 'Box' })).map(b => b.key).filter(key => key?.startsWith('tab:'))
  expect(cells).toEqual(['tab:Overview', 'tab:Decisions', 'tab:History', 'tab:File', 'tab:Tree', 'tab:Git'])
  // Each bar: body less margins and two separators, split three ways.
  expect((await ui.find({ key: 'tab:Git' }))?.props.width).toBe(Math.floor((props.bodyColumns - 4 - 6) / 3))
})

type TabNode = { type?: string; props?: { underline?: boolean; bold?: boolean; inverse?: boolean }; text?: string; children?: unknown[] }
const underlined = (node: unknown): TabNode[] => {
  const el = node as TabNode
  if (typeof node !== 'object' || !el) return []
  return [...(el.type === 'Text' && el.props?.underline ? [el] : []), ...(el.children ?? []).flatMap(underlined)]
}

test('tab titles underline their key letter', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  const letters = async (tab: string) => underlined(await ui.find({ key: `tab:${tab}` })).map(t => t.children?.[0])
  expect(await letters('Overview')).toEqual(['O'])
  expect(await letters('History')).toEqual(['H'])
  expect(await letters('File')).toEqual(['l'])
  expect(await letters('Git')).toEqual(['G'])
  expect(await letters('Decisions')).toEqual([])
  expect(await letters('Tree')).toEqual([])
})

test('the shown tab keeps its underline', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  const shown = await ui.find({ type: 'Text', text: /^\s*Overview\s*$/ })
  expect(shown?.props.bold && shown?.props.inverse).toBe(true)
  expect(underlined(shown).map(t => t.children?.[0])).toEqual(['O'])
})

test('a cut name shows no underline', async ($, on) => {
  noHistory(on)
  // 16 body columns: 6 for three slots, 2 each, so File is cut to Fi.
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 16 }, requestId: 'margin' })
  expect(underlined(await ui.find({ key: 'tab:File' }))).toEqual([])
})

test('in the narrowest dock a tab name is cut to its slot, never wrapped', async ($, on) => {
  noHistory(on)
  // 23 body columns: 13 for three slots, 4 + 4 + 5.
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 23 }, requestId: 'margin' })
  expect(await ui.find({ type: 'Text', text: /^Over$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Deci$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Histo$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Overview|Decisions|History/ })).toBeUndefined()
})

test('a tab not built yet is dim and says when it comes', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Tree' })
  // The same boxed note as an empty Overview, History or Git.
  expect(await ui.find({ type: 'Text', text: 'Coming in v1.8' })).toBeDefined()
  expect(await ui.find({ type: 'Box', borderStyle: 'round' } as any)).toBeDefined()
})

test("the bottom bar sits on the pane's last rows, whatever the tab holds", async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  // Overview with nothing read is short; the body Box still fills to the bar.
  expect((await ui.find({ key: 'body' }))?.props.height).toBe(props.scroll.bodyRows - 4) // top bar + rule, bottom rule + bar
})

test('the shown tab is lit across its cell and no button; another tab presses across its cell', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  // The body less its margins and the separators, split: 10 columns each.
  expect(await ui.find({ type: 'Button', key: 'History' })).toBeUndefined()
  const shown = await ui.find({ type: 'Text', text: /^\s*History\s*$/ })
  expect(shown?.text.length).toBe(10)
  expect(shown?.props.inverse).toBe(true)
  const other = await ui.find({ type: 'Button', key: 'Git' })
  expect(other?.text.length).toBe(10)
  // One color across it, so the focus inverts it as one block.
  const parts = (other?.children ?? []) as { type?: string; props?: { color?: string } }[]
  expect(new Set(parts.filter(part => part.type === 'Text').map(part => part.props?.color))).toEqual(new Set(['#456186']))
})

// Each write draws the pane: two per press could land out of order, and the terminal then
// dropped the next click.
test('a tab press writes only the tab when no notice is up', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n' })(e.argv) ?? ''))
  const keys: string[] = []
  on('state.set', (_, e, next) => {
    keys.push(e.key)
    return next(e)
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(keys).toEqual(['tab'])
})

test("a tab press switches even when the button's onPress is lost", async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n' })(e.argv) ?? ''))
  // Stands for the terminal losing onPress to a redraw that swaps the tree as the click lands.
  on('ui.press', (_, e) => ({ element: e.element }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: '⎇ main', in: 'row:branch' })).toBeDefined()
})

test('a slow pane draw finishes before a newer fast one', async () => {
  let open = () => {}
  const gate = new Promise<void>(resolve => (open = resolve))
  const finished: string[] = []

  const older = ordered(async () => {
    await gate
    return 'older'
  }).then(name => finished.push(name))
  const newer = ordered(async () => 'newer').then(name => finished.push(name))
  // The newer draw has settled by now when nothing holds it back.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  open()
  await Promise.all([older, newer])

  expect(finished).toEqual(['older', 'newer'])
})

// The engine drops a draw once a newer one starts, rejecting its git runs; only those are read again
// (no harness draw is dropped). A git that cannot start must not rerun on every draw.
test('a git that cannot start is run once per change, not on every draw', async ($, on) => {
  noHistory(on)
  let statusRuns = 0
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') return ran('')
    if (e.argv.includes('status')) statusRuns++
    return { deny: 'git: cannot start' }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  await ui.redraw()
  await ui.redraw()

  // Not "Not a git repository": git never answered (none on PATH, a surface that runs no command).
  expect(await ui.find({ type: 'Text', text: 'Not a git repository' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: "Git can't run here" })).toBeDefined()
  expect(statusRuns).toBe(1)
})

test('Git tab outside a repo says so', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) =>
    e.argv[0] === 'git' ? { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } } : ran(''),
  )

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: 'Not a git repository' })).toBeDefined()
})

test('a long branch row is cut to fit beside the fetch button, not wrapped', async ($, on) => {
  noHistory(on)
  const head = '## feature/a-really-long-branch-name-that-goes-on...origin/x [ahead 12, behind 3]'
  on('process.run', (_, e) => ran(git({ status: `${head}\n M a.ts\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  const branch = (await ui.findAll({ type: 'Text', text: /^⎇ /, in: 'row:branch' })).at(-1)?.text ?? ''
  expect(branch.endsWith('…')).toBe(true)
  // The body less its margins: the branch, its mark, a space at least, the fetch button.
  const fetch = (await ui.findAll({ type: 'Text', text: /^\uf46a /, in: 'row:fetch' })).at(-1)?.text ?? ''
  expect(branch.length + 2 + 1 + fetch.length).toBeLessThanOrEqual(props.bodyColumns - 4)
})

test("a conflict shows git's two letters, both red, whatever git pairs", async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\nAA both.ts\nUU c.ts\nDD d.ts\nUD e.ts\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  const letters = await Promise.all(['both.ts', 'c.ts', 'd.ts', 'e.ts'].map(async path => (await ui.findAll({ type: 'Text', text: /^[ADU]$/, in: `row:${fileKey(path)}` })).map(t => [t.text, t.props.color])))
  const red = (xy: string) => [...xy].map(l => [l, '#e06c75'])
  expect(letters).toEqual([red('AA'), red('UU'), red('DD'), red('UD')])
})

test('a renamed file shows its new name; paths come unescaped', async ($, on) => {
  noHistory(on)
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return ran(git({ status: '## main\nR  old-name.ts -> new-name.ts\n' })(e.argv) ?? '')
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: /new-name\.ts$/, in: `row:${fileKey('new-name.ts')}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /old-name/, in: `row:${fileKey('new-name.ts')}` })).toBeUndefined()
  expect(runs.find(argv => argv.includes('status'))).toContain('core.quotePath=false')
})

test('divider keeps half the side margin', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text.length).toBe(props.bodyColumns - 2)
})

test("History tab lists this chat's prompts, newest first, wherever the shell cd'd", async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = [
    JSON.stringify({ display: 'older\nprompt', timestamp: 1, project: '/proj', sessionId: 'chat-1' }),
    JSON.stringify({ display: 'other chat, same folder', timestamp: 2, project: '/proj', sessionId: 'chat-0' }),
    '{"display": "half writ',
    JSON.stringify({ display: 'newest prompt', timestamp: 3, project: '/proj', sessionId: 'chat-1' }),
  ].join('\n')
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.cwd', () => ({ value: '/proj/sub' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path === '/home/me/.claude/history.jsonl' ? history : '' }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('newest prompt')
  // "↻ " takes 2 columns; the jump button fills the rest of the row.
  expect((await ui.find({ key: 'jump:0' }))?.text.length).toBe(props.bodyColumns - 4 - 2)
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('older prompt')
  expect(await ui.find({ key: 'jump:2' })).toBeUndefined()
})

test('History reads the prompt history under CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = JSON.stringify({ display: 'from the moved folder', timestamp: 1, sessionId: 'chat-1' })
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path === '/cfg/history.jsonl' ? history : '' }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('from the moved folder')
})

test('a prompt holding a control character still lists, the character drawn as a space', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  // A paste of colored terminal output keeps its escape sequences.
  const history = JSON.stringify({ display: 'paste \x1b[31mred\x07', timestamp: 1, sessionId: 'chat-1' })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('paste [31mred')
})

test('History still lists prompts once the prompt history is too big to read whole', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const line = JSON.stringify({ display: 'found by grep', timestamp: 1, sessionId: 'chat-1' })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => {
    throw new Error('over 4 MiB')
  })
  on('process.run', (_, e) =>
    ran(e.argv.includes('/home/me/.claude/history.jsonl') && e.argv.includes('"sessionId":"chat-1"') ? `${line}\n` : ''),
  )

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('found by grep')
})

test('↻ puts the prompt, line breaks kept, back in the prompt box', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const filled: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'older\nprompt', timestamp: 1, sessionId: 'chat-1' }) }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  await ui.press({ key: 'reuse:0' })

  expect(filled).toEqual(['older\nprompt'])
})

test('jumping to a prompt the chat cannot find says so', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'from yesterday', timestamp: 1, sessionId: 'chat-1' }) }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  await ui.press({ key: 'jump:0' })

  expect(toasts).toEqual(["Can't jump: not found in the chat. ↻\u00a0reuses it."])
})

// The chat file's tail: a prompt, a reply calling a tool, its result, a system line, a line half written.
const chatTail = [
  JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'hi' } }),
  JSON.stringify({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'toolu_1' }] } }),
  JSON.stringify({ type: 'user', uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] } }),
  JSON.stringify({ type: 'file-history-snapshot', messageId: 'x' }),
  '{"type":"assistant","uuid":"a2',
].join('\n')

test("the chat's last row ids, newest first: a line's calls before its own id", () => {
  expect(lastRowIds(chatTail)).toEqual(['toolu_1', 'u2', 'a1', 'u1'])
})

test('⤓ latest reads the chat file\'s tail, and says so when no row of it scrolls', async ($, on) => {
  const toasts: string[] = []
  const runs: string[] = []
  noHistory(on)
  on('process.run', (_, e) => {
    runs.push(e.argv.join(' '))
    if (isHistoryGrep(e.argv)) return ran(JSON.stringify({ display: 'go', timestamp: 1, sessionId: 'chat-1' }))
    return ran(e.argv[0] === 'find' ? '/home/me/projects/p/chat-1.jsonl\n' : e.argv[0] === 'tail' ? chatTail : '')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const latest = await ui.find({ key: 'latest' })
  expect(latest?.text).toBe('⤓ latest')
  // Yellow, apart from rewind's green, the back-to-top line's blue and Compacted's darker yellow.
  expect((await ui.find({ type: 'Text', text: '⤓ latest' }))?.props.color).toBe('#a8995a')

  // The test surface cannot scroll the chat: every row is refused.
  await ui.press({ key: 'latest' })
  expect(runs).toContain('tail -c 4000000 /home/me/projects/p/chat-1.jsonl')
  expect(toasts).toEqual(["Can't scroll to the chat's end."])
})

test('a jump whose scroll fails says so', async ($, on) => {
  const toasts: string[] = []
  const at = '2026-10-10T10:00:00.000Z'
  const history = JSON.stringify({ display: 'go', timestamp: Date.parse(at), sessionId: 'chat-1' })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  // The chat file holds the prompt's row, so the jump tries to scroll; the test surface cannot.
  on('process.run', (_, e) =>
    ran(isHistoryGrep(e.argv) ? history : JSON.stringify({ type: 'user', uuid: 'go-row', timestamp: at, message: { content: 'go' } })),
  )
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'jump:0' }).catch(() => undefined)

  expect(toasts).toEqual(["Can't jump: not found in the chat. ↻ reuses it."])
})

test('a repeated prompt resolves to the transcript copy sent nearest its time', () => {
  const at = (iso: string) => Date.parse(iso)
  const transcript = [
    JSON.stringify({ type: 'user', uuid: 'early', timestamp: '2026-10-10T09:00:00Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'right', timestamp: '2026-10-10T10:00:01Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'late', timestamp: '2026-10-10T11:00:00Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'tool', timestamp: '2026-10-10T10:00:00Z', message: { content: [] } }),
    JSON.stringify({ type: 'assistant', uuid: 'reply', timestamp: '2026-10-10T10:00:00Z', message: { content: 'go' } }),
    '{"type": "user", "uu',
  ].join('\n')

  expect(nearestId(transcript, { display: 'go', timestamp: at('2026-10-10T10:00:00Z') })).toBe('right')
  expect(nearestId(transcript, { display: 'stop', timestamp: at('2026-10-10T10:00:00Z') })).toBeUndefined()
})

test('an empty History hides the rewind and latest buttons', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })

  expect(await ui.find({ type: 'Text', text: 'No prompts yet' })).toBeDefined()
  expect(await ui.find({ key: 'rewind' })).toBeUndefined()
  expect(await ui.find({ key: 'latest' })).toBeUndefined()
})

test('the rewind button opens the /rewind picker', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const ran: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'go', timestamp: 1, sessionId: 'chat-1' }) }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  await ui.press({ key: 'rewind' })

  expect(ran).toEqual(['rewind'])
})

test('day labels: today, then the date', () => {
  const now = new Date(2026, 9, 11, 1, 20)
  expect(dayLabel(new Date(2026, 9, 11, 0, 5).getTime(), now)).toBe('Today')
  expect(dayLabel(new Date(2026, 9, 10, 23, 41).getTime(), now)).toBe('Sat 10 Oct')
  expect(dayLabel(new Date(2026, 9, 9, 12, 0).getTime(), now)).toBe('Fri 9 Oct')
})

test('a day divider opens each day, once', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const day = 24 * 60 * 60 * 1000
  const history = [Date.now() - 3 * day, Date.now() - 3 * day + 1000, Date.now()]
    .map((timestamp, i) => JSON.stringify({ display: `p${i}`, timestamp, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Today' })).length).toBe(1)
  // "──── Today ────" spans the row exactly (side margins take 4 columns), label centered.
  const [left] = await ui.findAll({ type: 'Text', text: /^─+ $/ })
  const [right] = await ui.findAll({ type: 'Text', text: /^ ─+$/ })
  expect((left?.text.length ?? 0) + 'Today'.length + (right?.text.length ?? 0)).toBe(props.bodyColumns - 4)
  expect(Math.abs((left?.text.length ?? 0) - (right?.text.length ?? 0))).toBeLessThanOrEqual(1)
  expect(left?.props.color).toBe('#625a7e')
  expect((await ui.findAll({ type: 'Text', text: dayLabel(Date.now() - 3 * day, new Date()) })).length).toBe(1)
})

const asPrompts = (...texts: string[]) => texts.map((display, i) => ({ display, timestamp: i }))

test('gone runs: a middle run was rewound, a run reaching the oldest was compacted', () => {
  // Newest first, as the panel lists them.
  expect(gone(asPrompts('P6', 'P5', 'P4', 'P3', 'P2', 'P1'), ['P1', 'P2', 'P6'], ['P1', 'P2', 'P6'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: false },
    { isLive: false },
    { isLive: true },
    { isLive: true },
  ])
  expect(gone(asPrompts('P9', 'P8', 'P7', 'P1'), ['P8', 'P9'], ['P8', 'P9'], [], undefined, true).map(row => row.marker)).toEqual([
    undefined,
    undefined,
    'Compacted',
    undefined,
  ])
})

test('gone runs: an Esc-cancelled first prompt in a chat never compacted was rewound', () => {
  const chat = ['P2', 'P3', 'P4', 'P5']
  const prompts = asPrompts('P5', 'P4', 'P3', 'cancelled', 'P2', 'first')
  expect(gone(prompts, chat, chat, [], undefined, false).map(row => row.marker)).toEqual([
    undefined,
    undefined,
    undefined,
    'Rewound',
    undefined,
    'Rewound',
  ])
})

test('gone runs: a repeated prompt keeps its newest copies live', () => {
  expect(gone(asPrompts('go', 'x', 'go'), ['go', 'x'], ['go', 'x'])).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: false, marker: 'Compacted' },
  ])
})

test('gone runs: an empty read marks nothing rather than calling it all compacted', () => {
  expect(gone(asPrompts('a', 'b'), [], [])).toEqual([{ isLive: true }, { isLive: true }])
})

const MID_TURN = (text: string) => `The user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages`

test('gone runs: a mid-turn note keeps its prompt live while the model holds it', () => {
  expect(gone(asPrompts('A', 'B'), ['B'], ['B', MID_TURN('A')], ['A'], undefined, false)).toEqual([{ isLive: true }, { isLive: true }])
})

test('gone runs: a mid-turn note is not held live by a longer one that starts with it', () => {
  expect(gone(asPrompts('fix the bug', 'fix', 'B'), ['B'], ['B', MID_TURN('fix the bug')], ['fix', 'fix the bug'], undefined, false)).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
})

test('gone runs: a mid-turn prompt rewound out of the chat and sent again shows once', () => {
  // A typed mid-turn, its turn failed, /rewind, A sent again: the note outlives the rewind.
  expect(gone(asPrompts('A', '/rewind', 'A', 'B'), ['B', 'A'], ['B', 'A'], ['A'], undefined, false)).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
})

test('gone runs: a chat reloaded after a compaction, no prompt typed since, is compacted whole', () => {
  expect(gone(asPrompts('/compact', 'b', 'a'), ['summary', '<command-name>/compact</command-name>'], ['summary'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Compacted' },
    { isLive: false },
  ])
})

test('gone runs: compacted prompts stay live, the marker on the first one the model lost', () => {
  expect(gone(asPrompts('P4', 'P3', 'P2', 'P1'), ['P1', 'P2', 'P3', 'P4'], ['P3', 'P4'])).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true, marker: 'Compacted' },
    { isLive: true },
  ])
  // Right after /compact the model holds the summary alone: every prompt the chat shows was compacted.
  expect(gone(asPrompts('P2', 'P1'), ['P1', 'P2'], ['summary'])).toEqual([{ isLive: true, marker: 'Compacted' }, { isLive: true }])
})

test('gone runs: one Compacted marker, right under the newest /compact above it', () => {
  const prompts = asPrompts('/compact', '/margin', '/restart', 'go', '/compact', '/restart', 'old')
  expect(gone(prompts, ['go'], ['summary']).map(row => row.marker)).toEqual([
    undefined,
    'Compacted',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

test('gone runs: a slash command inside a run goes with it, at its edge stays live', () => {
  expect(gone(asPrompts('P4', 'P3', '/margin', 'P2', 'P1'), ['P1', 'P4'], ['P1', 'P4'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: false },
    { isLive: false },
    { isLive: true },
  ])
  // /compact under a rewound `hi`: the prompt before it is still in the chat.
  expect(gone(asPrompts('P3', 'hi', '/compact', 'P1'), ['P1', 'P3'], ['P1', 'P3'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
    { isLive: true },
  ])
})

test('gone runs: a prompt opening with a path is a prompt, not a slash command', () => {
  expect(gone(asPrompts('P2', '/home/me/notes.txt is broken', 'P1'), ['P1', 'P2'], ['P1', 'P2'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
})

test('the History tab draws Rewound above a rewound run, Compacted where the model lost the chat', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'kept', 'undone', 'latest']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 4 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [
            { role: 'user', content: [{ type: 'text', text: 'summary' }] },
            { role: 'user', content: [{ type: 'text', text: 'kept' }, { type: 'text', text: '<system-reminder>' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            { role: 'user', content: [{ type: 'text', text: 'latest' }] },
          ]
        : [
            { role: 'user', text: 'old', toolUses: [] },
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'assistant', text: 'ok', toolUses: [] },
            { role: 'user', text: 'latest', toolUses: [] },
          ],
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(1)
  expect((await ui.findAll({ type: 'Text', text: 'Compacted' })).length).toBe(1)
  // Still in the chat but compacted: dim.
  expect((await ui.find({ type: 'Text', text: /^old\s*$/ }))?.props.color).toBe('#4f5c68')
})

test('the History tab draws a cancelled first prompt Rewound when the chat file holds no compaction', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['cancelled', 'kept', 'latest']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 3 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    if (e.argv[0] === 'find') return ran('/home/me/.claude/projects/-proj/chat-1.jsonl\n')
    // grep -q finds no compact_boundary row.
    if (e.argv.includes('"subtype":"compact_boundary"')) return { value: { ...ran('').value, exitCode: 1 } }
    return ran('')
  })
  const chat = ['kept', 'latest']
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? chat.map(text => ({ role: 'user' as const, content: [{ type: 'text', text }] }))
        : chat.map(text => ({ role: 'user' as const, text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: 'Compacted' })).toBeUndefined()
})

test('gone runs: a paste matches though the chat wraps it in tags', () => {
  const chat = ['see\n\n \n\n<pasted_content id="1">\n~~~ pasted\n</pasted_content id="1">', 'kept']
  expect(gone(asPrompts('see\n\n ~~~ pasted', 'kept'), chat, chat)).toEqual([{ isLive: true }, { isLive: true }])
})

test('a paste kept as a placeholder shows its text and matches the chat', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = [
    JSON.stringify({ display: 'kept', timestamp: Date.now() - 3, sessionId: 'chat-1' }),
    JSON.stringify({
      display: '[Pasted text #1 +1 lines]',
      pastedContents: { 1: { id: 1, type: 'text', contentHash: 'abc' } },
      timestamp: Date.now() - 2,
      sessionId: 'chat-1',
    }),
    JSON.stringify({
      display: 'see [Pasted text #2]',
      pastedContents: { 2: { id: 2, type: 'text', content: 'short' } },
      timestamp: Date.now() - 1,
      sessionId: 'chat-1',
    }),
  ].join('\n')
  const chat = [
    'kept',
    '\n\n<pasted_content id="9">\nlong\npaste\n</pasted_content id="9">',
    'see \n\n<pasted_content id="8">\nshort\n</pasted_content id="8">',
  ]
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('paste-cache/abc.txt') ? 'long\npaste' : history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? chat.map(text => ({ role: 'user', content: [{ type: 'text', text }] }))
        : chat.map(text => ({ role: 'user', text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('see short')
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('long paste')
  expect(await ui.find({ type: 'Text', text: 'Rewound' })).toBeUndefined()
})

test('a ! shell command matches its bash-input row, its ! in the shell prompt color', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  // The oldest a ! command too: the model holds it as the chat does, so it marks no compaction.
  const history = ['! ls', 'kept', '! git status', 'next'].map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 4 + i, sessionId: 'chat-1' })).join('\n')
  const chat = ['<bash-input> ls</bash-input>', 'kept', '<bash-input> git status</bash-input>', 'next']
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? chat.map(text => ({ role: 'user', content: [{ type: 'text', text }] }))
        : chat.map(text => ({ role: 'user', text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect(await ui.find({ type: 'Text', text: 'Rewound' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Compacted' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '!' }))?.props.color).toBe('bashBorder')
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('! git status')
})

test('gone runs: a pasted /command is a prompt; a paste whose text is lost takes the run around it', () => {
  const pasted = { display: '/compact keep', typed: '[Pasted text #1]', timestamp: 1 }
  expect(gone([{ display: 'next', timestamp: 2 }, pasted, { display: 'first', timestamp: 0 }], ['first', 'next'], [])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
  const chat = ['first', 'next']
  expect(gone(asPrompts('next', '[Pasted text #1 +3 lines]', 'first'), chat, chat)).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
})

test('the search text finds a paste prompt: cut at the placeholder, a lone paste by its tag', () => {
  const hits = (typed: string, content: string) =>
    needles(typed).some(text => JSON.stringify({ type: 'user', message: { role: 'user', content } }).includes(text))
  expect(hits('see [Pasted text #1 +2 lines]', 'see \n\n<pasted_content id="1">\nx\n</pasted_content id="1">')).toBe(true)
  expect(hits('[Pasted text #1]', '\n\n<pasted_content id="1">\nx\n</pasted_content id="1">')).toBe(true)
})

test('a prompt sent mid-turn, remembered in the store, is not marked rewound', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', 'sent mid-turn', 'latest']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 3 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? []
        : [
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'user', text: 'latest', toolUses: [] },
          ],
  }))
  mock.store(on, { 'midTurn:chat-1': ['sent mid-turn'] })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(0)
})

test('a mid-turn note the model holds inside a tool result is not marked rewound', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', 'sent mid-turn']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    if (e.argv[0] === 'find') return ran('/home/me/.claude/projects/-proj/chat-1.jsonl\n')
    if (e.argv.includes('"subtype":"compact_boundary"')) return { value: { ...ran('').value, exitCode: 1 } }
    return ran('')
  })
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [
            { role: 'user' as const, content: [{ type: 'text', text: 'kept' }] },
            { role: 'user' as const, content: [{ type: 'tool_result', content: `done\n\n<system-reminder>\n${MID_TURN('sent mid-turn')}\n</system-reminder>` }] },
          ]
        : [{ role: 'user' as const, text: 'kept', toolUses: [] }],
  }))
  mock.store(on, { 'midTurn:chat-1': ['sent mid-turn'] })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(0)
})

test('a tool result reading as a compacted prompt does not hold it in the model', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [
            { role: 'user', content: [{ type: 'text', text: 'summary' }] },
            { role: 'user', content: [{ type: 'text', text: 'new' }] },
            { role: 'user', content: [{ type: 'tool_result', content: 'old' }] },
          ]
        : [
            { role: 'user', text: 'old', toolUses: [] },
            { role: 'user', text: 'new', toolUses: [] },
          ],
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Compacted' })).length).toBe(1)
})

test('/quit, /exit, /rewind, /margin, /resume and /clear are left out', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['/quit', 'kept', '/rewind', '/margin', '/resume', '/clear', '/exit', '/exited-not']
    .map((display, i) => JSON.stringify({ display, timestamp: i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('/exited-not')
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('kept')
  expect(await ui.find({ key: 'jump:2' })).toBeUndefined()
})

test("the search text finds a prompt's row in the chat file: escaped, pasted after, image beside", () => {
  const display = 'say "hi"\nthen go'
  const hits = (row: unknown) => needles(display).some(text => JSON.stringify(row).includes(text))
  const content = `${display}\n\n<pasted_content id="1">\nx\n</pasted_content id="1">`
  expect(hits({ type: 'user', message: { role: 'user', content } })).toBe(true)
  expect(hits({ type: 'user', message: { content: [{ type: 'text', text: display }, { type: 'image' }] } })).toBe(true)
  expect(hits({ display })).toBe(false)
})

test('a prompt sent with an image resolves to its row, text block beside the image', () => {
  const transcript = [
    JSON.stringify({ type: 'user', uuid: 'shot', timestamp: '2026-10-10T10:00:00Z', message: { content: [{ type: 'text', text: '[Image #1] look' }, { type: 'image' }] } }),
    JSON.stringify({ type: 'user', uuid: 'tool', timestamp: '2026-10-10T10:00:00Z', message: { content: [{ type: 'tool_result', content: '[Image #1] look' }] } }),
  ].join('\n')

  expect(nearestId(transcript, { display: '[Image #1] look', timestamp: Date.parse('2026-10-10T10:00:00Z') })).toBe('shot')
})

test('a ! shell command resolves to its bash-input row', () => {
  const row = { type: 'user', uuid: 'sh', timestamp: '2026-10-10T10:00:00Z', message: { role: 'user', content: '<bash-input> ls -a</bash-input>' } }
  expect(needles('! ls -a').some(text => JSON.stringify(row).includes(text))).toBe(true)
  expect(nearestId(JSON.stringify(row), { display: '! ls -a', timestamp: Date.parse('2026-10-10T10:00:00Z') })).toBe('sh')
})

test('a slash row stays dim until its output line is drawn in the chat', async ($, on) => {
  const clock = mock.clock(on)
  const history = ['kept', '/model']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'kept', toolUses: [] }] }))
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'Text' as const, children: ['Set model.'] }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const color = async () => (await ui.find({ type: 'Text', text: /^\/model\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const output = { command: 'model', args: '', text: 'Set model.', isErrored: false }
  await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'CommandOutput', props: output, requestId: 'cmd-1' })
  // The list redraws within 100 ms of the row drawing.
  await clock.advance(100)

  expect(await color()).toBe('claude')
})

test('a slash row is live once the chat holds its command row, drawn or not', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', '/compact keep']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  const command = '<command-name>/compact</command-name>\n  <command-message>compact</command-message>\n  <command-args>keep</command-args>'
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value: e.as === 'api' ? [] : ['kept', command].map(text => ({ role: 'user', text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.find({ type: 'Text', text: /^\/compact keep\s*$/ }))?.props.color).toBe('claude')
})

test('a stored mid-turn note the chat lost to a compaction is not held live', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'note', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 3 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  mock.store(on, { 'midTurn:chat-1': ['note'] })
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [{ role: 'user', content: [{ type: 'text', text: 'new' }] }]
        : [{ role: 'user', text: 'new', toolUses: [] }],
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Compacted' })).length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^note\s*$/ }))?.props.color).toBe('#4f5c68')
})

test('jumping to a prompt gone from the chat says so without searching', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const toasts: string[] = []
  const history = ['old', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'new', toolUses: [] }] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  await ui.press({ key: 'jump:1' })

  expect(toasts).toEqual(["Can't jump: rewound or compacted out of the chat. ↻\u00a0reuses it."])
})

test('a mid-turn prompt stays dim until its row is drawn in the chat', async ($, on) => {
  const clock = mock.clock(on)
  const history = ['kept', 'sent mid-turn']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'kept', toolUses: [] }] }))
  mock.store(on, { 'midTurn:chat-1': ['sent mid-turn'] })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['sent mid-turn'] }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const color = async () => (await ui.find({ type: 'Text', text: /^sent mid-turn\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const row = { text: 'sent mid-turn', origin: { kind: 'composer' as const }, isExpanded: false }
  await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', props: row, requestId: 'msg-1' })
  await clock.advance(100)

  expect(await color()).toBe('claude')
})

test('a slash command resolves to the output line of the run nearest its time', () => {
  const run = (uuid: string, at: string, name: string, args: string) => [
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid, timestamp: at, content: `<command-name>${name}</command-name>\n <command-message>x</command-message>\n <command-args>${args}</command-args>` }),
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid: `${uuid}-out`, parentUuid: uuid, timestamp: at, content: '<local-command-stdout>ok</local-command-stdout>' }),
  ]
  const transcript = [
    ...run('early', '2026-10-10T09:00:00Z', '/margin', ''),
    ...run('right', '2026-10-10T10:00:01Z', '/margin', ''),
    ...run('other', '2026-10-10T10:00:00Z', '/compact', 'keep this'),
  ].join('\n')
  const at = Date.parse('2026-10-10T10:00:00Z')

  expect(nearestCommandId(transcript, { display: '/margin', timestamp: at })).toBe('right-out')
  expect(nearestCommandId(transcript, { display: '/compact keep this', timestamp: at })).toBe('other-out')
  expect(nearestCommandId(transcript, { display: '/compact other', timestamp: at })).toBeUndefined()
})

test('a prompt sent mid-turn that landed as a normal message is not held dim', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', 'landed normally']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? []
        : [
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'user', text: 'landed normally', toolUses: [] },
          ],
  }))
  mock.store(on, { 'midTurn:chat-1': ['landed normally'] })

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.find({ type: 'Text', text: /^landed normally\s*$/ }))?.props.color).toBe('claude')
})

test('the count says 100+ when the chat holds more prompts than the list shows', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = Array.from({ length: 101 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: i, sessionId: 'chat-1' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history.join('\n') }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect(await ui.find({ type: 'Text', text: '100+ prompts' })).toBeDefined()
  expect(await ui.find({ key: 'jump:100' })).toBeUndefined()
})

test('the narrowest pane keeps both buttons and drops the count', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'only', timestamp: 1, sessionId: 'chat-1' }) }))
  // The narrowest the terminal lets the pane be dragged.
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 23 }, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect(await ui.find({ key: 'rewind' })).toBeDefined()
  expect(await ui.find({ key: 'latest' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /prompt/ })).toBeUndefined()
})

test('one prompt is counted without the plural s; " this session" only where it fits', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'only', timestamp: 1, sessionId: 'chat-1' }) }))

  // 40 columns hold only "1 prompt" (the 100+ test's); 60 hold " this session" too.
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 60 }, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect(await ui.find({ type: 'Text', text: '1 prompt this session' })).toBeDefined()
})

test('in view: one prompt, the newest whose turn is on screen', () => {
  // Newest first; the chat stamps a prompt's row ~0.1 s before history does.
  const prompts = [
    { display: 'c', timestamp: 30_000 },
    { display: 'b', timestamp: 20_000 },
    { display: 'a', timestamp: 10_000 },
  ]
  expect(inView(prompts, [])).toBe(0)
  expect(inView(prompts, [25_000, 26_000])).toBe(1)
  expect(inView(prompts, [29_900, 31_000])).toBe(0)
  // Several shown: the newest of them.
  expect(inView(prompts, [15_000, 25_000])).toBe(1)
  expect(inView(prompts, [5_000])).toBe(-1)
})

test('the stamp search finds a row by uuid either way round, a tool call by its id', () => {
  // Shapes from a real chat file: a user row, a command's output row, an assistant tool call.
  const lines = [
    '{"parentUuid":"p","type":"user","uuid":"u-1","timestamp":"2026-10-10T10:00:00.000Z","userType":"external"}',
    '{"type":"system","subtype":"local_command","content":"ok","level":"info","timestamp":"2026-10-10T10:00:01.000Z","uuid":"c-1","isMeta":false}',
    '{"message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash"}]},"uuid":"a-1","timestamp":"2026-10-10T10:00:02.000Z"}',
  ]
  // grep -o prints what the pattern matched on each line.
  const pattern = new RegExp(stampPattern(['u-1', 'c-1', 'toolu_1']))
  const printed = lines.map(line => line.match(pattern)?.[0] ?? '').join('\n')

  expect(readStamps(printed)).toEqual(
    new Map([
      ['u-1', Date.parse('2026-10-10T10:00:00.000Z')],
      ['c-1', Date.parse('2026-10-10T10:00:01.000Z')],
      ['toolu_1', Date.parse('2026-10-10T10:00:02.000Z')],
    ]),
  )
})

test('History lights the prompt whose turn is on screen, not the newest', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const runs: (readonly string[])[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'a', toolUses: [] }, { role: 'user', text: 'b', toolUses: [] }, { role: 'user', text: 'c', toolUses: [] }] }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    runs.push(e.argv)
    const at = new Date(start + 15_000).toISOString()
    return { value: { exitCode: 0, stdout: `"uuid":"row-1","timestamp":"${at}"\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: "a reply in b's turn", origin: { kind: 'composer' as const }, isExpanded: false }
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('b')).toBe('claude')
  expect(await color('c')).toBeUndefined()
  expect(runs.some(argv => argv.join(' ').includes('row-1'))).toBe(true)

  // Scrolled away, nothing on screen is known: the newest lights again.
  await row.redraw({ ...reply, onScreen: null })
  await clock.advance(100)
  expect(await color('c')).toBe('claude')
})

test('History rereads at most once a second while the chat scrolls', async ($, on) => {
  const history = JSON.stringify({ display: 'a', timestamp: 1, sessionId: 'chat-1' })
  let greps = 0
  const clock = mock.clock(on, { now: 2_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) greps++
    return ran(isHistoryGrep(e.argv) ? history : '')
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const before = greps
  // A row coming on screen redraws the pane.
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  await clock.advance(100)
  expect(greps).toBe(before)

  await clock.advance(1_000)
  await row.redraw({ ...reply, onScreen: { first: 1, last: 3, of: 3 } })
  await clock.advance(100)
  expect(greps).toBe(before + 1)
  await row.redraw({ ...reply, onScreen: null })
})

test('chat moves redraw the panel once, 100 ms later', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const clock = mock.clock(on, { now: 1_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) =>
    ran(isHistoryGrep(e.argv) ? history : `"uuid":"b-row","timestamp":"${new Date(start + 15_000).toISOString()}"\n`),
  )
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color
  expect(await color('b')).toBe('claude')

  // Two moves inside 100 ms: nothing redraws until the one redraw for both.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })
  await row.redraw({ ...reply, onScreen: null })
  expect(await color('b')).toBe('claude')
  await clock.advance(100)
  expect(await color('c')).toBe('claude')
})

test('History shows a prompt as soon as it is sent, inside the second', async ($, on) => {
  let history = JSON.stringify({ display: 'first', timestamp: 1, sessionId: 'chat-1' })
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('first')
  history += `\n${JSON.stringify({ display: 'second', timestamp: 2, sessionId: 'chat-1' })}`
  await $.prompt.submit({ text: 'second', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('second')
})

test('the History list shows the modal cues: ↑ N more under the header once scrolled, ↓ N more turns the page', async ($, on) => {
  const start = Date.now() - 120_000
  const history = Array.from({ length: 60 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: start + i * 1000, sessionId: 'chat-1' })).join('\n')
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  // The day line and 60 prompts in 17 rows: 16 and ↓ at the top.
  expect(await cueText(ui, 'history')).toEqual({ up: false, down: true })
  expect(await ui.find({ type: 'Text', text: ' 45 more' })).toBeDefined()
  await ui.press({ key: 'history:down' })
  // ↑, 15 rows from the 17th line (prompt 16, key jump:15), ↓.
  expect(await cueText(ui, 'history')).toEqual({ up: true, down: true })
  expect(await ui.find({ type: 'Text', text: ' 16 more ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 30 more' })).toBeDefined()
  expect(await ui.find({ key: 'jump:14' })).toBeUndefined()
  expect(await ui.find({ key: 'jump:15' })).toBeDefined()
  expect(await ui.find({ key: 'jump:30' })).toBeUndefined()
  // The header stays on the body's first row.
  expect(await ui.find({ key: 'rewind' })).toBeDefined()
  await wheelAt($, 1000, 10)
  expect(await cueText(ui, 'history')).toEqual({ up: true, down: false })
  await ui.press({ key: 'history:up' })
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
  expect(await cueText(ui, 'history')).toEqual({ up: false, down: true })
})

test('the wheel scrolls the History list under a fixed header, up to its end; ↑ or a new prompt brings it back up', async ($, on) => {
  const start = Date.now() - 60_000
  let history = Array.from({ length: 30 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: start + i * 1000, sessionId: 'chat-1' })).join('\n')
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  // The day line and 30 prompts in 17 rows under the tabs, their rule and the header; the cues take
  // one each.
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  expect(await ui.find({ type: 'Button', key: 'history:up' })).toBeUndefined()
  await wheel(5)
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeUndefined()
  expect(await ui.find({ key: 'jump:3' })).toBeUndefined()
  expect((await ui.find({ key: 'jump:4' }))?.text).toContain('p25')
  expect(await ui.find({ key: 'jump:20' })).toBeUndefined()
  expect(await ui.find({ key: 'rewind' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'history:up' })).toBeDefined()

  await wheel(100)
  expect(await ui.find({ key: 'jump:13' })).toBeUndefined()
  expect((await ui.find({ key: 'jump:29' }))?.text).toContain('p0')

  await ui.press({ key: 'history:up' })
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'history:up' })).toBeUndefined()

  await wheel(3)
  history += `\n${JSON.stringify({ display: 'new', timestamp: start + 40_000, sessionId: 'chat-1' })}`
  await $.prompt.submit({ text: 'new', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('new')
})

test('after a long jump, rows left on the old screen no longer stretch the lit range', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const stamped: Record<string, number> = { 'old-1': start + 5_000, 'new-1': start + 25_000, 'new-2': start + 26_000 }
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = Object.entries(stamped)
      .filter(([id]) => e.argv.join(' ').includes(id))
      .map(([id, at]) => `"uuid":"${id}","timestamp":"${new Date(at).toISOString()}"\n`)
      .join('')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const mount = (requestId: string) =>
    $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  // On screen in a's turn; the jump never reports it gone.
  const old = await mount('old-1')
  now += 5_000
  const fresh = [await mount('new-1'), await mount('new-2')]
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  expect(await color('a')).toBeUndefined()
  for (const row of [old, ...fresh]) await row.redraw({ ...reply, onScreen: null })
})

test('a moved row the chat file does not hold (a tool group) leaves the highlight where it is', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = e.argv.join(' ').includes('b-row') ? `"uuid":"b-row","timestamp":"${new Date(start + 15_000).toISOString()}"\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const mount = (requestId: string) =>
    $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  const rows = [await mount('b-row')]
  now += 5_000
  rows.push(await mount('collapse-1'))
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('b')).toBe('claude')
  expect(await color('c')).toBeUndefined()
  for (const row of rows) await row.redraw({ ...reply, onScreen: null })
})

// Three prompts 10 s apart; `stamped` says when the chat file wrote each row (by uuid or tool call id).
const inViewSetup = (on: Parameters<TestBody>[1], stamped: (start: number) => Record<string, number>) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: (readonly string[])[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = Object.entries(stamped(start))
      .filter(([id]) => e.argv.join(' ').includes(id))
      .map(([id, at]) => (id.startsWith('toolu_') ? `"id":"${id}","name":"Bash"},"uuid":"x","timestamp":"` : `"uuid":"${id}","timestamp":"`) + `${new Date(at).toISOString()}"\n`)
      .join('')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stand for the engine's own drawing of the rows.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'Text' as const, children: ['tools'] }))
  // `advance` moves the clock, firing the History redraw a move leaves pending.
  return { runs, advance: (ms: number) => clock.advance(ms) }
}
const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }

test('a tool group at the bottom of the screen lights its turn, found by its first call', async ($, on) => {
  inViewSetup(on, start => ({ 'b-row': start + 15_000, toolu_c1: start + 25_000 }))
  const top = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 4, last: 9, of: 10 } } })
  const call = { tool_use_id: 'toolu_c1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const group = { calls: [call], isActive: false, isExpanded: false }
  const tools = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'ToolGroup', requestId: 'collapsed-toolu_c1',
    props: { ...group, onScreen: { first: 0, last: 0, of: 2 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  await top.redraw({ ...reply, onScreen: null })
  await tools.redraw({ ...group, onScreen: null })
})

test('a row still on screen counts when it redraws without moving', async ($, on) => {
  const clock = inViewSetup(on, start => ({ 'b-top': start + 15_000, 'c-mid': start + 25_000 }))
  const mount = (requestId: string, first: number) =>
    $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const mid = await mount('c-mid', 0)
  const top = await mount('b-top', 3)
  await clock.advance(5_000)
  // A scroll tick: only the top row moves; the middle one redraws as it was.
  await top.redraw({ ...reply, onScreen: { first: 4, last: 9, of: 10 } })
  // The redraw it sets off makes the middle row say where it is again.
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  for (const row of [top, mid]) await row.redraw({ ...reply, onScreen: null })
})

test('a row is looked up in the chat file once, not on every redraw', async ($, on) => {
  const setup = inViewSetup(on, start => ({ 'b-once': start + 15_000 }))
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'b-once',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const renders = setup.runs.filter(isHistoryGrep).length
  await setup.advance(5_000)
  // A real move: the pane redraws.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })
  await setup.advance(100)

  expect(setup.runs.filter(isHistoryGrep).length).toBeGreaterThan(renders)
  expect(setup.runs.filter(argv => argv.join(' ').includes('b-once')).length).toBe(1)
  await row.redraw({ ...reply, onScreen: null })
})

test('a row the chat file does not hold yet is looked for at most once a second', async ($, on) => {
  // Mid-turn: the reply streaming in is on screen before the chat file holds it.
  const setup = inViewSetup(on, start => ({ 'b-row': start + 15_000 }))
  const mount = (requestId: string, first: number) =>
    $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const streaming = await mount('not-yet', 0)
  const row = await mount('b-row', 3)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const looks = () => setup.runs.filter(argv => argv.join(' ').includes('not-yet')).length
  const first = looks()

  await row.redraw({ ...reply, onScreen: { first: 4, last: 9, of: 10 } })
  await setup.advance(100)
  expect(looks()).toBe(first)

  await setup.advance(1_000)
  await row.redraw({ ...reply, onScreen: { first: 3, last: 9, of: 10 } })
  await setup.advance(100)
  expect(looks()).toBe(first + 1)
  for (const one of [streaming, row]) await one.redraw({ ...reply, onScreen: null })
})

test('a row growing below the screen, as a reply streams in, redraws nothing', async ($, on) => {
  const setup = inViewSetup(on, start => ({ 'c-grow': start + 25_000 }))
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'c-grow',
    props: { ...reply, onScreen: { first: 0, last: 9, of: 10 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const renders = setup.runs.filter(isHistoryGrep).length
  await setup.advance(5_000)
  await row.redraw({ ...reply, onScreen: { first: 0, last: 9, of: 30 } })
  await setup.advance(100)

  expect(setup.runs.filter(isHistoryGrep).length).toBe(renders)
  await row.redraw({ ...reply, onScreen: null })
})

test('rows a jump left behind without a word are forgotten past a cap, oldest first', () => {
  const rows = new Map<string, number>()
  for (const id of ['a', 'b', 'c']) keepNewest(rows, id, 0, 2)
  expect([...rows.keys()]).toEqual(['b', 'c'])
  // A row reporting again is the newest.
  keepNewest(rows, 'b', 1, 2)
  keepNewest(rows, 'd', 0, 2)
  expect([...rows]).toEqual([['b', 1], ['d', 0]])
})

test('a clicked prompt stays lit until a move after its jump settles', () => {
  const prompts = [
    { display: 'c', timestamp: 30_000 },
    { display: 'b', timestamp: 20_000 },
    { display: 'a', timestamp: 10_000 },
  ]
  // Pinned to a, though b's turn is in view.
  expect(litPrompt(prompts, [25_000], { timestamp: 10_000 })).toBe(2)
  // A pin to a prompt the list no longer holds, or none: the one in view.
  expect(litPrompt(prompts, [25_000], { timestamp: 5 })).toBe(1)
  expect(litPrompt(prompts, [25_000])).toBe(1)
  expect(pinHolds({ after: 1_300 }, 1_300)).toBe(true)
  expect(pinHolds({ after: 1_300 }, 1_301)).toBe(false)
  expect(pinHolds(undefined, 0)).toBe(false)
})

test('a jump that finds nothing drops its pin: the turn on screen stays lit', async ($, on) => {
  inViewSetup(on, start => ({ 'b-stay': start + 15_000 }))
  on('ui.toast', () => ({ value: undefined }))
  const row = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'UserMessage', requestId: 'b-stay',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color
  await ui.press({ key: 'jump:2' })
  // A move inside the settle: a pin left behind would still hold.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })

  expect(await color('b')).toBe('claude')
  expect(await color('a')).toBeUndefined()
  await row.redraw({ ...reply, onScreen: null })
})

test('the chat file is found by session id, whatever its folder is named', async ($, on) => {
  // A root over 200 characters gets a cut, hashed folder name; /cd moves the root.
  const file = '/home/me/.claude/projects/-a-root-cut-at-200-1x2y3z/chat-find.jsonl'
  const greps: (readonly string[])[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-find' }))
  on('session.root', () => ({ value: '/somewhere/else' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(JSON.stringify({ display: 'go', timestamp: 1, sessionId: 'chat-find' }))
    if (e.argv[0] === 'find') return ran(`${file}\n`)
    greps.push(e.argv)
    return ran('')
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'jump:0' })

  expect(greps.at(-1)?.at(-1)).toBe(file)
})

test('gone runs: a capped chat read leaves prompts older than it live and unmarked', () => {
  // The read holds only the newest 4096 entries: P1 fell outside it, not out of the chat.
  expect(gone(asPrompts('P3', 'P2', 'P1'), ['P2', 'P3'], ['P2', 'P3'], [], { chat: true, model: true })).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
  // A capped model read draws no Compacted line where it ends.
  expect(gone(asPrompts('P3', 'P2', 'P1'), ['P1', 'P2', 'P3'], ['P3'], [], { chat: false, model: true })).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
})

test('a prompt older than the newest 4096 chat entries is not drawn as gone', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  const filler = Array.from({ length: 4095 }, () => ({ role: 'assistant' as const, text: 'ok', toolUses: [] }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value: e.as === 'api' ? [] : [...filler, { role: 'user' as const, text: 'new', toolUses: [] }],
  }))

  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ type: 'Text', text: /^old\s*$/ }))?.props.color).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Compacted' })).toBeUndefined()
})

test('a new session drops all but the newest 50 sessions of mid-turn notes', async ($, on) => {
  const keys = ['other', ...Array.from({ length: 60 }, (_, i) => `midTurn:s${i}`)]
  const deleted: string[] = []
  on('store.keys', () => ({ value: keys }))
  on('store.delete', (_, e) => {
    deleted.push(e.key)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })

  // Keys come back in the order they were first set: the oldest sessions go.
  expect(deleted).toEqual(Array.from({ length: 10 }, (_, i) => `midTurn:s${i}`))
})

test('/margin runs at once, even while Claude is working', async ($, on) => {
  const registered: { name: string; immediate?: true }[] = []
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })

  expect(registered.find(command => command.name === 'margin')?.immediate).toBe(true)
})

const INTENT = 'mcp__margin__intent'
const REPORT = { wants: 'a third tab', take: { stance: 'concern', label: 'clear', why: 'small and scoped' }, steps: [{ text: 'spec', status: 'in_progress' }, { text: 'plan', status: 'pending' }] }
// History empty, the pane mounted on the Overview tab.
const intentPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], now?: () => number) => {
  noHistory(on, now)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  on('turn.complete', (_, e) => ({ text: e.answer }) as any)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  return ui
}
const turnEnd = ($: Parameters<TestBody>[0], agentId?: string, reason = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't1', reason, category: null, explanation: null, agentId } as any)

test('a tab taller than the body is cut at the bottom bar: the pane does not scroll', async ($, on) => {
  const ui = await intentPane($, on)
  const steps = Array.from({ length: 30 }, (_, i) => ({ text: `step ${i}`, status: 'pending' }))
  await $.tool.call({ tool: INTENT, ...REPORT, steps } as any)
  await ui.drawn()
  const body = await ui.find({ key: 'body' })
  expect(body?.props.height).toBe(props.scroll.bodyRows - 4)
  expect(body?.props.overflow).toBe('hidden')
})

test("Claude's intent report draws on the Overview tab", async ($, on) => {
  const ui = await intentPane($, on)
  expect(await $.tool.call({ tool: INTENT, ...REPORT } as any)).toMatchObject({ result: 'ok' })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0/2 steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'clear' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^STEPS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ASK$/ })).toBeDefined()
  // No TOPICS read yet: no divider to tie the report to a topic.
  expect(await ui.find({ key: 'now' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^spec$/ })).toBeDefined()
})

test("a subagent's intent report is answered but not drawn", async ($, on) => {
  const ui = await intentPane($, on)
  expect(await $.tool.call({ tool: INTENT, ...REPORT, agentId: 'a1' } as any)).toMatchObject({ result: 'ok' })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test("a main turn's end marks the report ended; a subagent's does not", async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($, 'a1')
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^✓ done / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeDefined()
  // Claude skips a report only to close its last steps: the answer closes them all.
  expect(await ui.find({ type: 'Text', text: /^✓ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^○ $/ })).toBeUndefined()
})

test('a main turn that ends on a background agent waits on it, the steps kept open', async ($, on) => {
  let status = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sleep', type: 'general-purpose', status }] }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await colorOf(ui, '◌ waiting on 1 agent')).toBe('planMode')
  expect(await ui.find({ type: 'Text', text: '0/2 steps' })).toBeDefined()
  status = 'completed'
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeDefined()
})

test("an answer closes the steps past agents the turn does not wait on: a subagent's, a plugin's, a teammate, an idle one", async ($, on) => {
  const agent = { description: 'sleep', type: 'general-purpose', status: 'running' }
  const agents = [
    { ...agent, id: 'a1', parentId: 'a0' },
    { ...agent, id: 'a2', spawnedBy: 'ballot' },
    { ...agent, id: 'a3', teammateId: 'ann@team' },
    { ...agent, id: 'a4', status: 'idle' },
  ]
  on('agent.list', () => ({ value: agents }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeDefined()
})

test('an agent already running at the prompt holds that prompt\'s answer open too', async ($, on) => {
  let status = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sleep', type: 'general-purpose', status }] }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'meanwhile', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '◌ waiting on 1 agent' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0/2 steps' })).toBeDefined()
  status = 'completed'
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeDefined()
})

test("waiting counts the agents; an agent's result or a new prompt is work again", async ($, on) => {
  const agent = { description: 'sleep', type: 'general-purpose', status: 'running' }
  on('agent.list', () => ({ value: [{ ...agent, id: 'a1' }, { ...agent, id: 'a2' }] }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '◌ waiting on 2 agents' })).toBeDefined()
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  await turnEnd($)
  await $.prompt.submit({ text: 'meanwhile', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^◌ / })).toBeUndefined()
})

test('a turn with no report that ends on an agent waits on it too, then is done', async ($, on) => {
  let status = 'running'
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sleep', type: 'general-purpose', status }] }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'sleep in the background', wait: false, origin: { kind: 'composer' } })
  await turnEnd($)
  await ui.drawn()
  expect(await colorOf(ui, '◌ waiting on 1 agent')).toBe('planMode')
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } })
  status = 'completed'
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^✓ done / })).toBeDefined()
})

test("waiting after an answered report shows none of that report's steps", async ($, on) => {
  let agents: unknown[] = []
  on('agent.list', () => ({ value: agents }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await $.prompt.submit({ text: 'sleep in the background', wait: false, origin: { kind: 'composer' } })
  agents = [{ id: 'a1', description: 'sleep', type: 'general-purpose', status: 'running' }]
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '◌ waiting on 1 agent' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
})

test('a now ping while waiting on agents is work again', async ($, on) => {
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'sleep', type: 'general-purpose', status: 'running' }] }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await $.tool.call({ tool: INTENT, now: 2 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
})

test('done shows the time the turn ended, not the time of the report', async ($, on) => {
  let at = 1_000_000
  const ui = await intentPane($, on, () => at)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  at = 4_600_000
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: `✓ done ${new Date(4_600_000).toTimeString().slice(0, 5)}` })).toBeDefined()
})

test('an interrupted turn keeps the steps as Claude left them', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($, undefined, 'aborted')
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^■ stopped / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
})

test('/clear empties the report', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.session.end({ reason: 'clear', sessionId: 'chat-1' } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test("the next prompt dims an answered report, not a stopped one", async ($, on) => {
  mock.clock(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($, undefined, 'aborted')
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^■ stopped / })).toBeDefined()
  await turnEnd($)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeDefined()
  for (const text of ['a third tab', /^clear$/, /^! $/, /^spec$/]) expect(await colorOf(ui, text)).toBe('#4f5c68')
})

test("a dimmed report waits for Claude's next one: a ping leaves it, a turn without a report drops it", async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: INTENT, now: 2 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeDefined()
  expect(await colorOf(ui, /^✓ $/)).toBe('#4f5c68')
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^✓ done / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeUndefined()
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: INTENT, ...REPORT, wants: 'a fourth tab' } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
  expect(await colorOf(ui, 'a fourth tab')).toBeUndefined()
})

test('a prompt shows working until Claude reports', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeDefined()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '0/2 steps' })).toBeDefined()
})

test('a turn that ends without a report shows done', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^✓ done / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
})

test('a turn interrupted before a report shows nothing', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await turnEnd($, undefined, 'aborted')
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test("a background task's result carries the report on: kept, its ping moves the steps", async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } })
  await $.tool.call({ tool: INTENT, now: 2 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1/2 steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
})

// The tools the panel registers, and the rule the intent tool's description carries.
const registered = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  const tools: string[] = []
  const described: string[] = []
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    tools.push(e.name)
    described.push(e.description)
    return { value: { tool: `mcp__margin__${e.name}` } } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
  return { tools, rule: described[0] }
}

test('the intent tool and its rule are in place by default', async ($, on) => {
  const { tools, rule } = await registered($, on)
  expect(tools).toEqual(['intent'])
  expect(rule).toContain(`Call the \`${INTENT}\` tool`)
})

test('intent off: no tool, no rule', { options: { intent: false } }, async ($, on) => {
  const { tools, rule } = await registered($, on)
  expect(tools).toEqual([])
  expect(rule).toBeUndefined()
})

test('intent off: a prompt shows no planning…, and its end no done', { options: { intent: false } }, async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await intentPane($, on)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'planning…' })).toBeUndefined()
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^✓ done/ })).toBeUndefined()
})

test("the intent tool's chat rows draw nothing", async ($, on) => {
  for (const component of ['ToolUse', 'ToolResult'] as const) {
    const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component, props: { tool_use_id: 'u1', tool: INTENT, input: REPORT, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }, requestId: 'u1' } as any)
    expect(await ui.find({ type: 'Text' })).toBeUndefined()
  }
})


test('parseTopics: every bullet line, no cap', () => {
  expect(parseTopics('Here you go:\n- Intent tab\n• model choice\n* shipping\n- a\n- b')).toEqual(['Intent tab', 'model choice', 'shipping', 'a', 'b'])
  expect(parseTopics('no bullets')).toEqual([])
})

const TOPICS = '- Intent tab for the panel\n- shipping the branch'
// This chat's prompts in the history file, Opus answering `reply(n)`, the pane open.
// The hosts a TOPICS read needs, the pane open; `asks` records each Opus request.
const overviewHosts = (on: Parameters<TestBody>[1], reply: (n: number) => unknown = () => ({ isAnswered: true, text: TOPICS, usage: {} }), typed = ['add an intent tab', 'ship it'], isPlaced = true) => {
  const clock = mock.clock(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const lines = typed.map((display, i) => JSON.stringify({ display, timestamp: i + 1, sessionId: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? lines.join('\n') : ''))
  const pane = { isOpen: true }
  on('ui.panes', () => ({ value: pane.isOpen ? [{ id: 'margin', isPlaced }] : [] }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__margin__${e.name}` } }) as any)
  const asks: { model: string; prompt: string }[] = []
  on('model.complete', (_, e) => {
    const value = reply(asks.push(e as any))
    return (value instanceof Promise ? value.then(answer => ({ value: answer })) : { value }) as any
  })
  return { clock, asks, pane }
}
// Mounted on History, so a test picks Overview when its read should start.
const overviewPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], reply?: (n: number) => unknown, typed?: string[]) => {
  const { clock, asks } = overviewHosts(on, reply, typed)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  return { ui, clock, asks }
}
const send = ($: Parameters<TestBody>[0], text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

test('a session starting with the pane open reads TOPICS on the default tab', async ($, on) => {
  const { clock, asks } = overviewHosts(on)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await $.session.start({ source: 'startup', cwd: '/home/me' } as any)
  await clock.settle()
  await ui.drawn()
  expect(asks).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'shipping the branch' })).toBeDefined()
})

// The session's own open places the pane: a read before it found none and never ran.
test('a session opening the pane itself reads TOPICS', async ($, on) => {
  const { clock, asks, pane } = overviewHosts(on)
  pane.isOpen = false
  on('ui.open', () => {
    pane.isOpen = true
    return { value: { isPlaced: true } } as any
  })
  // Live, the start's timers fire while it waits on the engine.
  on('store.get', async () => (await clock.settle(), { value: undefined }))
  await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await $.session.start({ source: 'resume', cwd: '/home/me', surface: 'terminal', isInteractive: true } as any)
  await clock.settle()
  expect(pane.isOpen).toBe(true)
  expect(asks).toHaveLength(1)
})

// Opened at start on a narrow terminal, the pane waits undrawn: nobody sees TOPICS, so no Opus request.
test('a pane waiting for room reads no TOPICS', async ($, on) => {
  const { clock, asks } = overviewHosts(on, undefined, undefined, false)
  await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await $.session.start({ source: 'startup', cwd: '/home/me' } as any)
  await send($, 'ship it')
  await clock.settle()
  expect(asks).toHaveLength(0)
})

test('TOPICS: Opus groups the prompts into topics, drawn newest first', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await ui.drawn()
  expect(asks).toHaveLength(1)
  expect(asks[0]!.model).toBe('opus')
  expect((asks[0] as any).maxTokens).toBeGreaterThanOrEqual(2000)
  expect(asks[0]!.prompt.indexOf('add an intent tab')).toBeLessThan(asks[0]!.prompt.indexOf('ship it'))
  expect(await ui.find({ type: 'Text', text: 'TOPICS' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Intent tab for the panel' })).toBeDefined()
  // The newest topic is the current one, drawn first.
  expect((await ui.findAll({ type: 'Text', text: /^(Intent tab for the panel|shipping the branch)$/ })).map(found => found.props.text ?? found.text)).toEqual(['shipping the branch', 'Intent tab for the panel'])
  expect((await ui.find({ type: 'Text', text: 'shipping the branch' }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: 'Intent tab for the panel' }))?.props.color).toBe('#808286')
})

test('a report under TOPICS sits below their divider', async ($, on) => {
  const { ui, clock } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '⇕', in: 'now' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
})

test('TOPICS re-reads after a prompt only while the Overview tab shows', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on)
  await send($, 'next thing')
  await clock.settle()
  expect(asks).toHaveLength(0)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks).toHaveLength(1)
  await send($, 'another thing')
  await clock.settle()
  expect(asks).toHaveLength(2)
  await $.prompt.submit({ text: '/compact', wait: false, origin: { kind: 'composer' }, command: { name: 'compact', args: '' } } as any)
  await clock.settle()
  expect(asks).toHaveLength(2)
  await $.prompt.submit({ text: '<task-notification>', wait: false, origin: { kind: 'task-notification' } })
  await clock.settle()
  expect(asks).toHaveLength(2)
})

test('TOPICS reads a prompt that starts with a path, not a command', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on, undefined, ['/tmp/shot.png why is this cut', '/compact'])
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks[0]!.prompt).toContain('/tmp/shot.png why is this cut')
  expect(asks[0]!.prompt).not.toContain('/compact')
})

test('a failed TOPICS read keeps the topics and says why', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => (n === 1 ? { isAnswered: true, text: TOPICS, usage: {} } : { isAnswered: false, reason: 'api-error', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: "couldn't read: api-error" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Intent tab for the panel' })).toBeDefined()
})

test('/clear empties TOPICS', async ($, on) => {
  const { ui, clock } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'chat-1' } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test('a reload with the Overview tab open reads TOPICS without waiting for a prompt', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on, () => new Promise(() => undefined))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks).toHaveLength(1)
  await $.session.start({ source: 'startup', cwd: '/home/me' } as any)
  await clock.settle()
  expect(asks).toHaveLength(2)
})

test('TOPICS asks for the user\'s language', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks[0]!.prompt).toContain('language the user writes in')
})

test('parseSummary: the first "> " line, or none', () => {
  expect(parseSummary('> Built the tab, then shipped it.\n- a\n> later')).toBe('Built the tab, then shipped it.')
  expect(parseSummary('- a\n- b')).toBeUndefined()
  // An empty summary line never takes the next line.
  expect(parseSummary('> \n- a')).toBeUndefined()
  expect(parseSummary('>\n- a')).toBeUndefined()
})

const SUMMED = `> Built the intent tab, then shipped it.\n${TOPICS}`

test('SESSION: the summary from the TOPICS read draws in its own section above TOPICS', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on, () => ({ isAnswered: true, text: SUMMED, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await ui.drawn()
  expect(asks).toHaveLength(1)
  expect(asks[0]!.prompt).toContain('"> "')
  expect((await ui.findAll({ type: 'Text', text: /^(SESSION|TOPICS)$/ })).map(found => found.props.text ?? found.text)).toEqual(['SESSION', 'TOPICS'])
  expect((await ui.find({ type: 'Text', text: 'Built the intent tab, then shipped it.' }))?.props.color).toBe('#808286')
  expect(await ui.find({ type: 'Box', key: 'sessionRule' })).toBeDefined()
  // The summary line is no topic.
  expect(await ui.find({ type: 'Text', text: '2 topics' })).toBeDefined()
})

test('SESSION keeps its wording: later reads send the current summary back', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on, () => ({ isAnswered: true, text: SUMMED, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks[0]!.prompt).not.toContain('Current session line')
  await send($, 'next thing')
  await clock.settle()
  expect(asks[1]!.prompt).toContain('Current session line')
  expect(asks[1]!.prompt).toContain('> Built the intent tab, then shipped it.')
})

test('a read with no summary line keeps the last summary; no summary yet, no SESSION', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? TOPICS : n === 2 ? SUMMED : TOPICS, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'SESSION' })).toBeUndefined()
  await send($, 'next thing')
  await clock.settle()
  await send($, 'another thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Built the intent tab, then shipped it.' })).toBeDefined()
})

test('SESSION pushes the TOPICS zone down: the wheel finds TOPICS under it', async ($, on) => {
  const text = `> One line on the session.\n${Array.from({ length: 12 }, (_, i) => `- topic ${i}`).join('\n')}`
  const { ui, clock } = await overviewPane($, on, () => ({ isAnswered: true, text, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })
  // SESSION's header, line and rule on rows 2 to 4, TOPICS' header on 5: its 6 rows are 6 to 11, the divider 12.
  const count = async () => (await ui.findAll({ type: 'Text', text: /^topic \d+$/ })).length
  const before = await count()
  await wheel(-2, 12)
  expect(await count()).toBe(before + 2)
  await wheel(2, 12)
  expect(await ui.find({ type: 'Text', text: 'topic 11' })).toBeDefined()
  await wheel(3, 10)
  expect(await ui.find({ type: 'Text', text: 'topic 11' })).toBeUndefined()
})

test('TOPICS keeps its wording: later reads see the current topics', async ($, on) => {
  const { ui, clock, asks } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  expect(asks[0]!.prompt).not.toContain('word for word')
  await send($, 'next thing')
  await clock.settle()
  expect(asks[1]!.prompt).toContain('word for word')
  // No cap: the ask never limits how many topics.
  expect(asks[1]!.prompt).not.toMatch(/1-4|with 4 already/)
  expect(asks[1]!.prompt).toContain('- Intent tab for the panel\n- shipping the branch')
  expect(asks[1]!.prompt).toContain('all but the last stay as they are')
})

// Later reads: Opus sends back only the last topic, or it and a new one; the code keeps the rest.
test('TOPICS: a one-line reply rewords the last topic and keeps the rest', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? TOPICS : '- shipping and merging', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Intent tab for the panel' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'shipping and merging' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'shipping the branch' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '2 topics' })).toBeDefined()
})

test('TOPICS: a two-line reply keeps the last topic and adds a new one', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? TOPICS : '- shipping the branch\n- TOPICS latest only', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '3 topics' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'TOPICS latest only' }))?.props.color).toBe('claude')
})

test('TOPICS: a reply echoing kept topics adds no copies', async ($, on) => {
  const { ui, clock } = await overviewPane($, on)
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2 topics' })).toBeDefined()
})

test('TOPICS: an echoed list with an earlier topic reworded is refused, not added as copies', async ($, on) => {
  const three = '- Intent tab for the panel\n- model choice\n- shipping the branch'
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? three : '- Intent tab for the panel.\n- model choice\n- shipping the branch', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: "couldn't read: dropped topics" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Intent tab for the panel.' })).toBeUndefined()
})

test('TOPICS: a reply naming its new topic twice adds it once', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? TOPICS : '- review fixes\n- review fixes', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2 topics' })).toBeDefined()
})

test('TOPICS: a later reply with more than two topics is refused and the list stays', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? TOPICS : '- a\n- b\n- c', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: "couldn't read: dropped topics" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'shipping the branch' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^a$/ })).toBeUndefined()
})

test('TOPICS at the cap: the merge read still sends back the whole list', async ($, on) => {
  const full = Array.from({ length: 30 }, (_, i) => `- topic ${i}`).join('\n')
  const { ui, clock, asks } = await overviewPane($, on, n => ({ isAnswered: true, text: n === 1 ? full : '- merged early work\n- topic 26\n- topic 27\n- topic 28\n- topic 29', usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(asks[1]!.prompt).toContain('combine the most closely related')
  // At the cap, "at most 30" already holds: Opus sent all 30 back unmerged (replayed 2026-11-09).
  expect(asks[1]!.prompt).toContain('at most 20 lines')
  expect(asks[1]!.prompt).not.toContain('all but the last stay as they are')
  expect(await ui.find({ type: 'Text', text: '5 topics' })).toBeDefined()
})

test('TOPICS at the cap: a merge reply past 20 lines is refused', async ($, on) => {
  const full = Array.from({ length: 30 }, (_, i) => `- topic ${i}`).join('\n')
  const { ui, clock } = await overviewPane($, on, () => ({ isAnswered: true, text: full, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await send($, 'next thing')
  await clock.settle()
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: "couldn't read: dropped topics" })).toBeDefined()
})

test('a rule from the text column sets TAKE and STEPS apart', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [] } as any)
  await ui.drawn()
  expect(await ui.find({ key: 'rule:TAKE' })).toBeDefined()
  // No steps, no STEPS block, no rule for it.
  expect(await ui.find({ key: 'rule:STEPS' })).toBeUndefined()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await ui.find({ key: 'rule:STEPS' })).toBeDefined()
})

const colorOf = async (ui: { find: (q: any) => Promise<any> }, text: string | RegExp) => (await ui.find({ type: 'Text', text }))?.props.color
test('the status row is colored by state: working, done, stopped', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await colorOf(ui, '● working')).toBe('claude')
  await turnEnd($, undefined, 'aborted')
  await ui.drawn()
  expect(await colorOf(ui, /^■ stopped /)).toBe('#8c7850')
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await colorOf(ui, /^✓ done /)).toBe('#5d9678')
})

test("a step's mark is colored apart from its text", async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'spec', status: 'completed' }, { text: 'plan', status: 'in_progress' }, { text: 'ship', status: 'pending' }] } as any)
  await ui.drawn()
  expect(await colorOf(ui, /^✓ $/)).toBe('#5d9678')
  expect(await colorOf(ui, /^spec$/)).toBe('#808286')
  expect(await colorOf(ui, /^● $/)).toBe('claude')
  expect(await colorOf(ui, /^plan$/)).toBe('claude')
  expect(await colorOf(ui, /^○ $/)).toBe('#4f5c68')
})

// 20 body rows: the status row, its rule, ASK, TAKE's rule, TAKE and STEPS' rule leave 12 for steps.
test('steps past the body end in the ↓ N more cue; steps that fit get none', async ($, on) => {
  const ui = await intentPane($, on)
  const steps = Array.from({ length: 25 }, (_, i) => ({ text: `step ${i + 1}`, status: 'pending' }))
  await $.tool.call({ tool: INTENT, ...REPORT, steps } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'step 11' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'step 12' })).toBeUndefined()
  expect(await colorOf(ui, ' 14 more')).toBe('#4f5c68')
  expect(await ui.find({ type: 'Button', key: 'steps:down' })).toBeDefined()
  // An ASK wrapping to 3 rows at the 29-column text width takes 2 of them.
  await $.tool.call({ tool: INTENT, ...REPORT, wants: Array(7).fill('abcdefghi').join(' '), steps } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'step 9' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'step 10' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: ' 16 more' })).toBeDefined()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Button', key: 'steps:down' })).toBeUndefined()
})

test('USED lists each kind used this turn under STEPS', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/hooks/register.tsx' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'caveman:cavecrew' } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^USED/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /register\.tsx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /caveman:cavecrew/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^web/ })).toBeUndefined()
})

test('agent calls show as a dim +N', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts', agentId: 'a1' } as any)
  await ui.drawn()
  expect(await colorOf(ui, /\+1/)).toBe('#4f5c68')
})

test('a name only agents used is dim; one Claude used too is not', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts', agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts', agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts' } as any)
  await ui.drawn()
  expect(await colorOf(ui, /a\.ts/)).toBe('#4f5c68')
  expect(await colorOf(ui, /b\.ts/)).not.toBe('#4f5c68')
})

test("Claude's names come before names only agents used", async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/b.ts' } as any)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts', agentId: 'a1' } as any)
  const text: string[] = []
  const walk = (n: any) => {
    if (typeof n === 'string') return text.push(n)
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  const all = text.join('')
  expect(all.indexOf('b.ts')).toBeGreaterThan(-1)
  expect(all.indexOf('b.ts')).toBeLessThan(all.indexOf('a.ts'))
})

test('a turn with only the intent report draws no USED', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^USED/ })).toBeUndefined()
})

test('a long URL is cut, not wrapped, in a 40-column pane', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  const before = (await ui.find({ key: 'report' }))?.children?.length
  await $.tool.call({ tool: 'WebSearch', query: 'https://example.com/' + 'a'.repeat(80) } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /…$/ })).toBeDefined()
  expect((await ui.find({ key: 'report' }))?.children?.length).toBe((before ?? 0) + 2)
})

test('USED hides when STEPS would keep fewer than 3 rows', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  noHistory(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, scroll: { offset: 0, bodyRows: 11 + BAR_ROWS } }, requestId: 'margin' })
  const steps = Array.from({ length: 30 }, (_, i) => ({ text: `step ${i + 1}`, status: 'pending' }))
  await $.tool.call({ tool: INTENT, ...REPORT, steps } as any)
  await ui.drawn()
  const rows = async () => (await ui.find({ type: 'Button', key: 'steps:down' }))?.props
  const before = await rows()
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^USED/ })).toBeUndefined()
  expect(await rows()).toEqual(before)
})

// 14 body rows: STEPS gets 6, from row 6, under the tabs, their rule, ASK, TAKE's rule, TAKE and STEPS' rule,
// over the footer's rule and status row.
const stepsPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], doing: number) => {
  noHistory(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  on('ui.scroll', () => ({}) as any)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props: { ...props, scroll: { offset: 0, bodyRows: 14 + BAR_ROWS } }, requestId: 'margin' })
  const steps = Array.from({ length: 12 }, (_, i) => ({ text: `step ${i + 1}`, status: i < doing - 1 ? 'completed' : i === doing - 1 ? 'in_progress' : 'pending' }))
  await $.tool.call({ tool: INTENT, ...REPORT, steps } as any)
  await ui.drawn()
  const wheel = (by: number, row = 6) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 14 + BAR_ROWS, contentRows: 14 + BAR_ROWS, origin: { kind: 'person' }, pointer: { column: 0, row } })
  const shown = async (n: number) => (await ui.find({ type: 'Text', text: `step ${n}` })) !== undefined
  return { ui, wheel, shown }
}

test('USED takes rows from STEPS: the wheel hits the shorter zone, not the USED rows', async ($, on) => {
  on('tool.call', () => ({ result: {} }) as any)
  const { ui, wheel, shown } = await stepsPane($, on, 9)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' } as any)
  await ui.drawn()
  // 6 rows less USED's 2: ↑, steps 7 to 9, ↓.
  expect(await shown(9)).toBe(true)
  expect(await shown(6)).toBe(false)
  await wheel(-2, 10)
  expect(await shown(9)).toBe(true)
  await wheel(-2, 6)
  expect(await shown(9)).toBe(false)
})

test('STEPS follow the step in progress; the wheel over them stops that until the next prompt', async ($, on) => {
  const { ui, wheel, shown } = await stepsPane($, on, 9)
  // Scrolled just enough to show step 9 last: ↑, steps 6 to 9, ↓.
  expect(await shown(9)).toBe(true)
  expect(await shown(5)).toBe(false)
  expect(await shown(10)).toBe(false)
  expect(await ui.find({ type: 'Text', text: ' 5 more ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 3 more' })).toBeDefined()

  await wheel(-2)
  expect(await shown(4)).toBe(true)
  expect(await shown(9)).toBe(false)
  await $.tool.call({ tool: INTENT, now: 11 } as any)
  await ui.drawn()
  expect(await shown(4)).toBe(true)
  expect(await shown(11)).toBe(false)

  await send($, 'next thing')
  await $.tool.call({ tool: INTENT, now: 11 } as any)
  await ui.drawn()
  expect(await shown(11)).toBe(true)
  expect(await shown(4)).toBe(false)
})

test('STEPS keep their window when the run ends; the next prompt starts at the top', async ($, on) => {
  const { ui, shown } = await stepsPane($, on, 10)
  expect(await shown(10)).toBe(true)
  await $.tool.call({ tool: INTENT, ...REPORT, steps: Array.from({ length: 12 }, (_, i) => ({ text: `step ${i + 1}`, status: 'completed' })) } as any)
  await ui.drawn()
  expect(await shown(10)).toBe(true)
  expect(await shown(2)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'steps:up' })).toBeDefined()

  await send($, 'next thing')
  await ui.drawn()
  expect(await shown(2)).toBe(true)
  expect(await shown(10)).toBe(false)
})

test('a zone with negative room shows no rows', () => {
  expect(zoneWindow(10, 0, -4)).toMatchObject({ top: 0, shown: 0 })
  expect(zoneWindow(10, 0, 0)).toMatchObject({ top: 0, shown: 0 })
})

test("STEPS follow to the last row of the step in progress: its agents show", async ($, on) => {
  const ui = await intentPane($, on)
  const steps = Array.from({ length: 14 }, (_, i) => ({ text: `step ${i + 1}`, status: i < 9 ? 'completed' : i === 9 ? 'in_progress' : 'pending', ...(i === 9 && { agents: ['agent a', 'agent b'] }) }))
  await $.tool.call({ tool: INTENT, ...REPORT, steps } as any)
  await ui.drawn()
  expect(await ui.find({ key: 'agent:9:0' })).toBeDefined()
  expect(await ui.find({ key: 'agent:9:1' })).toBeDefined()
})

test('a step taller than the zone keeps its first row in view when followed', async ($, on) => {
  const ui = await intentPane($, on)
  const steps = Array.from({ length: 8 }, (_, i) => ({ text: `step ${i + 1}`, status: i < 6 ? 'completed' : i === 6 ? 'in_progress' : 'pending', ...(i === 6 && { agents: ['a', 'b', 'c'] }) }))
  await $.tool.call({ tool: INTENT, ...REPORT, wants: Array(15).fill('abcdefghi').join(' '), steps } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'step 7' })).toBeDefined()
})

test('a press on a STEPS cue stops following; the wheel keeps within the steps', async ($, on) => {
  const { ui, wheel, shown } = await stepsPane($, on, 9)
  await ui.press({ key: 'steps:up' })
  expect(await shown(1)).toBe(true)
  expect(await shown(9)).toBe(false)
  await $.tool.call({ tool: INTENT, now: 10 } as any)
  await ui.drawn()
  expect(await shown(1)).toBe(true)
  expect(await shown(10)).toBe(false)

  // Past the end: ↑ and the last 5, no ↓.
  await wheel(100)
  expect(await shown(8)).toBe(true)
  expect(await shown(7)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'steps:down' })).toBeUndefined()
  // Back past the top: no ↑.
  await wheel(-100)
  expect(await shown(1)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'steps:up' })).toBeUndefined()
  // Over ASK, not STEPS: the engine's own scroll, the steps stay.
  await wheel(3, 4)
  expect(await shown(1)).toBe(true)
})

const THREE = { ...REPORT, steps: [{ text: 'spec', status: 'in_progress' }, { text: 'plan', status: 'pending' }, { text: 'ship', status: 'pending' }] }
test('a now ping marks the steps before it done and its own in progress', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...THREE } as any)
  expect(await $.tool.call({ tool: INTENT, now: 2 } as any)).toMatchObject({ result: 'ok' })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '1/3 steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ $/ })).toBeDefined()
  await $.tool.call({ tool: INTENT, now: 3 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2/3 steps' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ $/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
  // The report's own words stay.
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
})

// 12 one-line topics and a report: 20 body rows less 6 fixed, TOPICS takes up to half of 14, 7 rows.
const twelveTopics = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  const text = Array.from({ length: 12 }, (_, i) => `- topic ${i}`).join('\n')
  const { ui, clock } = await overviewPane($, on, () => ({ isAnswered: true, text, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  return ui
}
const topicShown = async (ui: { find: (q: any) => Promise<any> }, n: number) => (await ui.find({ type: 'Text', text: `topic ${n}` })) !== undefined

test('dragging the TOPICS divider gives TOPICS more rows', async ($, on) => {
  const ui = await twelveTopics($, on)
  // Newest first: topics 11 down to 6, then the ↓ cue.
  expect(await topicShown(ui, 6)).toBe(true)
  expect(await topicShown(ui, 5)).toBe(false)

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'now' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'now' })

  expect(await topicShown(ui, 4)).toBe(true)
  expect(await topicShown(ui, 3)).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
})

test('the TOPICS divider keeps 1 row of TOPICS above it and ASK and TAKE whole below', async ($, on) => {
  const ui = await twelveTopics($, on)
  // 14 free rows, 7 of TOPICS: up to 1 of them, down to the report's 3 rows of ASK, TAKE's rule and TAKE.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: -9, button: 'left', in: 'now' })
  expect(await ui.find({ type: 'Text', text: '↑6', in: 'now' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -9, button: 'left', in: 'now' })
  expect(await topicShown(ui, 11)).toBe(true)
  expect(await topicShown(ui, 10)).toBe(false)

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: 20, button: 'left', in: 'now' })
  expect(await ui.find({ type: 'Text', text: '↓10', in: 'now' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 20, button: 'left', in: 'now' })
  expect(await topicShown(ui, 2)).toBe(true)
})

test("the TOPICS divider goes down only as far as TAKE's last row over the footer", async ($, on) => {
  const ui = await twelveTopics($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, wants: 'one two three four five six seven eight' } as any)
  await ui.drawn()
  // 18 body rows: the TOPICS header, the divider, 2 of ASK, TAKE's rule, TAKE and the footer's 2 leave 10.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: 20, button: 'left', in: 'now' })
  expect(await ui.find({ type: 'Text', text: '↓3', in: 'now' })).toBeDefined()
})

test('a report past the footer is cut at the bottom, never squeezed', async ($, on) => {
  const ui = await twelveTopics($, on)
  const report = await ui.find({ type: 'Box', key: 'report' })
  expect(report?.props.flexShrink).toBe(0)
})

test('the wheel over TOPICS scrolls them under a divider that stays put; ↑ brings them back up', async ($, on) => {
  const ui = await twelveTopics($, on)
  // TOPICS starts on row 3, under the tabs, their rule and the header; once scrolled, the ↑ cue takes its
  // first row.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  expect(await ui.find({ type: 'Button', key: 'topics:up' })).toBeUndefined()
  await wheel(3, 4)
  expect(await topicShown(ui, 9)).toBe(false)
  expect(await topicShown(ui, 8)).toBe(true)
  expect(await topicShown(ui, 4)).toBe(true)
  expect(await topicShown(ui, 3)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'topics:up' })).toBeDefined()

  // To the oldest and no further.
  await wheel(100, 4)
  expect(await topicShown(ui, 0)).toBe(true)
  expect(await topicShown(ui, 5)).toBe(true)
  expect(await topicShown(ui, 6)).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()

  await ui.press({ key: 'topics:up' })
  expect(await topicShown(ui, 11)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'topics:up' })).toBeUndefined()
})

test('TOPICS show the modal cues: ↑ N more once scrolled, ↓ N more turns the page', async ($, on) => {
  const ui = await twelveTopics($, on)
  // 7 rows: 6 topics and ↓ at the top.
  expect(await cueText(ui, 'topics')).toEqual({ up: false, down: true })
  expect(await ui.find({ type: 'Text', text: ' 6 more' })).toBeDefined()
  expect(await topicShown(ui, 6)).toBe(true)
  expect(await topicShown(ui, 5)).toBe(false)
  await wheelAt($, 3, 4)
  // ↑, topics 8 down to 4, ↓.
  expect(await cueText(ui, 'topics')).toEqual({ up: true, down: true })
  expect(await ui.find({ type: 'Text', text: ' 3 more ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 4 more' })).toBeDefined()
  expect(await topicShown(ui, 9)).toBe(false)
  expect(await topicShown(ui, 4)).toBe(true)
  expect(await topicShown(ui, 3)).toBe(false)
  await ui.press({ key: 'topics:up' })
  expect(await topicShown(ui, 11)).toBe(true)
  await ui.press({ key: 'topics:down' })
  // The page from topic 5, the oldest 6: the end, so no ↓.
  expect(await cueText(ui, 'topics')).toEqual({ up: true, down: false })
  expect(await ui.find({ type: 'Text', text: ' 6 more ' })).toBeDefined()
  expect(await topicShown(ui, 6)).toBe(false)
  expect(await topicShown(ui, 0)).toBe(true)
})

test('the wheel over the TOPICS divider moves it, keeping 1 row on either side', async ($, on) => {
  const ui = await twelveTopics($, on)
  // 7 rows of TOPICS from row 3: the divider is row 10, then 13 once moved.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  await wheel(-2, 10)
  expect(await topicShown(ui, 4)).toBe(true)
  expect(await topicShown(ui, 3)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'topics:up' })).toBeUndefined()
  // Off the pointer now, a notch right after still moves it.
  await wheel(-1, 10)
  expect(await topicShown(ui, 3)).toBe(true)
  expect(await ui.find({ type: 'Button', key: 'topics:up' })).toBeUndefined()

  await wheel(100, 13)
  expect(await topicShown(ui, 11)).toBe(true)
  expect(await topicShown(ui, 10)).toBe(false)
})

test('the status row is the footer, under TOPICS and the report, with or without topics', async ($, on) => {
  const ui = await twelveTopics($, on)
  const order = async () => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
  let all = await order()
  expect(all.indexOf('topic 6')).toBeLessThan(all.indexOf('a third tab'))
  expect(all.indexOf('plan')).toBeLessThan(all.indexOf('● working'))
  expect(await ui.find({ type: 'Box', key: 'footer' })).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 'chat-1' } as any)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  all = await order()
  expect(all.includes('TOPICS')).toBe(false)
  expect(all.indexOf('plan')).toBeLessThan(all.indexOf('● working'))
})

test('a report missing ASK or TAKE keeps the last ones', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: INTENT, steps: THREE.steps } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'clear' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0/3 steps' })).toBeDefined()
})

test('TAKE shows a stance mark, the label and the why', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, take: { stance: 'against', label: 'data loss', why: 'x' } } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'TAKE' })).toBeDefined()
  expect(await colorOf(ui, /^✗ $/)).toBe('#e06c75')
  expect(await ui.find({ type: 'Text', text: 'data loss' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ': x' })).toBeDefined()
})

test('TAKE without a why has no colon', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, take: { stance: 'concern', label: 'risky' } } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'risky' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^: / })).toBeUndefined()
})

test('a report without a take, or with an invalid one, keeps the last take', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, take: { stance: 'unsure', label: 'needs repro' } } as any)
  await $.tool.call({ tool: INTENT, wants: 'again', steps: [] } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'needs repro' })).toBeDefined()
  await $.tool.call({ tool: INTENT, wants: 'again', take: { stance: 'happy', label: 'yay' }, steps: [] } as any)
  await $.tool.call({ tool: INTENT, wants: 'again', take: { stance: 'fine', label: '' }, steps: [] } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'needs repro' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'yay' })).toBeUndefined()
})

test('a TAKE label past 16 characters is cut', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, take: { stance: 'fine', label: 'abcdefghijklmnopqrst' } } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'abcdefghijklmno…' })).toBeDefined()
})

test('a now ping with no report this turn is ignored', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, now: 2 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
  await $.tool.call({ tool: INTENT, ...THREE } as any)
  await turnEnd($)
  await $.tool.call({ tool: INTENT, now: 1 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '3/3 steps' })).toBeDefined()
})

test('the rule asks for a now ping only on a new step', async ($, on) => {
  const { rule } = await registered($, on)
  expect(rule).toContain('{"now": n}')
  expect(rule).toContain('starts a new step, and only then')
})

test('the rule asks for the report in the user\'s language', async ($, on) => {
  const { rule } = await registered($, on)
  expect(rule).toContain('language the user writes in')
})

test('with a report, updating… takes the step count\'s place until TOPICS are read; TOPICS counts them', async ($, on) => {
  let answer: (value: unknown) => void = () => undefined
  const { ui, clock } = await overviewPane($, on, n => (n === 1 ? { isAnswered: true, text: TOPICS, usage: {} } : n === 2 ? new Promise(resolve => (answer = resolve)) : new Promise(() => undefined)))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await send($, 'next thing')
  await clock.advance(0)
  await ui.drawn()
  const right = async () => (await ui.findAll({ type: 'Text', text: /^(reading…|updating…|0\/2 steps|\d+ topics|couldn't read.*)$/ })).map(found => found.props.text ?? found.text)
  // Topics already shown: the read updates them.
  expect(await right()).toEqual(['2 topics', 'updating…'])
  answer({ isAnswered: false, reason: 'api-error', usage: {} })
  await clock.settle()
  await ui.drawn()
  // A failed read keeps the steps in place and says so on the TOPICS header.
  expect(await right()).toEqual(["couldn't read: api-error", '0/2 steps'])
  // The next read: its state on the status row, the count back on the header.
  await send($, 'another thing')
  await clock.advance(0)
  await ui.drawn()
  expect(await right()).toEqual(['2 topics', 'updating…'])
})

test('the first TOPICS read, with none shown yet, says reading…', async ($, on) => {
  const { ui, clock } = await overviewPane($, on, () => new Promise(() => undefined))
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.press({ key: 'Overview' })
  await clock.advance(0)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'reading…' })).toBeDefined()
})

test('a now ping after an interrupt picks the stopped report back up', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...THREE } as any)
  await turnEnd($, undefined, 'aborted')
  await $.tool.call({ tool: INTENT, now: 2 } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '● working' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1/3 steps' })).toBeDefined()
})

test('TOPICS scrolled to the end still shows the oldest topic, though it wraps past the zone', async ($, on) => {
  const text = `- ${'x'.repeat(100)}\n- topic 1`
  const { ui, clock } = await overviewPane($, on, () => ({ isAnswered: true, text, usage: {} }))
  await ui.press({ key: 'Overview' })
  await clock.settle()
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await ui.drawn()
  // 4 rows (3 for the long topic, 1 for topic 1), dragged up to 1.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: -3, button: 'left', in: 'now' })
  await ui.pointer({ type: 'up', x: 0, y: -3, button: 'left', in: 'now' })
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 100, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 3 } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^x+$/ })).toBeDefined()
})

test('the wheel finds TOPICS by the row drawn, once the engine scrolled the Overview', async ($, on) => {
  // The engine's own scroll, past what TOPICS take.
  on('ui.scroll', () => ({}) as any)
  const ui = await twelveTopics($, on)
  // The pane drawn with the window `offset` rows down, then a wheel tick on its `row`.
  const wheel = async (offset: number, row: number) => {
    await ui.redraw({ ...props, scroll: { offset, bodyRows: 20 } })
    await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: offset + 3, by: 3, bodyRows: 20, contentRows: 30, origin: { kind: 'person' }, pointer: { column: 0, row } })
  }
  // Row 6 of the window, 10 rows down: the report, not TOPICS.
  await wheel(10, 6)
  expect(await topicShown(ui, 11)).toBe(true)
  // Row 3 of the window, 3 rows down: TOPICS' fourth row.
  await wheel(3, 3)
  expect(await topicShown(ui, 11)).toBe(false)
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

test('traces the pane draw', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('process.run', () => ran(''))
  const rows = sink(on, 'margin')
  await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await $.session.end({ reason: 'other' })
  expect(rows().find(r => r.event === 'pane.draw')?.data).toMatchObject({ tab: 'Overview', zones: 'empty' })
})

test('scrolling the History list alone writes no new pane.draw entry', async ($, on) => {
  const start = Date.now() - 60_000
  const history = Array.from({ length: 30 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: start + i * 1000, sessionId: 's1' })).join('\n')
  on('clock.now', () => ({ value: 0 }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  const rows = sink(on, 'margin')
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const draws = async () => {
    await $.session.end({ reason: 'other' })
    return rows().filter(r => r.event === 'pane.draw' && r.data.tab === 'History')
  }
  const before = (await draws()).length
  expect(before).toBeGreaterThan(0)
  for (const by of [2, 3]) await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })
  expect(await ui.find({ type: 'Button', key: 'history:up' })).toBeDefined()
  const after = await draws()
  expect(after.length).toBe(before)
})

const S = (text: string, status: Step['status'], agents?: string[]): Step => ({ text, status, agents })
const sp = (id: string, description: string, step: string, turn: number, status: AgentStatus = 'running'): Spawn => ({ id, description, step, turn, status })

test('hang: listed agents go under their step; unspawned are planned', () => {
  const rows = hang([S('a', 'completed', ['Read x']), S('b', 'in_progress', ['Draw y', 'Draw z'])], [sp('1', 'read X ', 'a', 2, 'completed'), sp('2', 'Draw y', 'b', 2)], 2)
  expect(rows).toEqual([[{ id: '1', description: 'read X ', status: 'completed' }], [{ id: '2', description: 'Draw y', status: 'running' }, { description: 'Draw z', status: 'planned' }]])
})

test('hang: one listed entry per agent; a repeated description lists twice', () => {
  const rows = hang([S('a', 'in_progress', ['Review', 'Review'])], [sp('1', 'Review', 'a', 1), sp('2', 'Review', 'a', 1, 'completed')], 1)
  expect(rows[0].map(r => r.status)).toEqual(['running', 'completed'])
})

test('hang: an unlisted agent falls back to its step by text, else the step in progress, else the last', () => {
  const steps = [S('renamed', 'completed'), S('now', 'in_progress'), S('later', 'pending')]
  expect(hang(steps, [sp('1', 'x', 'now', 1)], 1)[1]).toHaveLength(1)
  expect(hang(steps, [sp('1', 'x', 'gone', 1)], 1)[1]).toHaveLength(1)
  expect(hang([S('a', 'completed'), S('b', 'completed')], [sp('1', 'x', 'gone', 1)], 1)[1]).toHaveLength(1)
})

test("hang: an earlier turn's finished agent never fills a listed entry; a working one does", () => {
  const steps = [S('a', 'in_progress', ['Review bugs'])]
  expect(hang(steps, [sp('1', 'Review bugs', 'a', 1, 'completed')], 2)[0]).toEqual([{ description: 'Review bugs', status: 'planned' }])
  expect(hang(steps, [sp('1', 'Review bugs', 'a', 1)], 2)[0][0].status).toBe('running')
  expect(hang([S('a', 'in_progress')], [sp('1', 'old', 'a', 1)], 2)[0]).toEqual([])
})

test("hang: an agent spawned before this turn's report hangs under its in-progress step", () => {
  expect(hang([S('b', 'in_progress')], [sp('1', 'x', 'old step', 3)], 3)[0]).toHaveLength(1)
})

const AGENTS_REPORT = { ...REPORT, steps: [{ text: 'spec', status: 'in_progress', agents: ['Read code'] }, { text: 'plan', status: 'pending', agents: ['Check API'] }] }
// Core's spawn answers ids a1, a2, ...; the list answers each id's status from `status`.
const agentsPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], status: Record<string, string>, extra: Record<string, object> = {}) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'm', agentId: `a${++n}` }) as any)
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, description: id, type: 'Explore', status: s, ...extra[id] })) }) as any)
  return intentPane($, on)
}
const spawn = ($: Parameters<TestBody>[0], description: string, extra = {}) => $.agent.spawn({ prompt: 'p', description, ...extra } as any)
// An agent row: its whole text, then its glyph's and description's colors, however deep its Texts sit.
const texts = (node: any): any[] => (node?.type === 'Text' ? [node] : (node?.children ?? []).flatMap(texts))
const agentRow = async (ui: { find: (q: any) => Promise<any> }, step: number, n: number) => {
  const row = await ui.find({ key: `agent:${step}:${n}` })
  return row && { text: row.text as string, glyph: texts(row)[1]?.props?.color, color: texts(row)[2]?.props?.color }
}

test('a listed agent shows planned, then live under its step', async ($, on) => {
  const status = { a1: 'running' }
  const ui = await agentsPane($, on, status)
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await ui.drawn()
  expect(await agentRow(ui, 0, 0)).toEqual({ text: '└ ○ Read code', glyph: '#4f5c68', color: '#4f5c68' })
  expect((await agentRow(ui, 1, 0))?.text).toBe('└ ○ Check API')
  await spawn($, 'Read code')
  await ui.drawn()
  expect(await agentRow(ui, 0, 0)).toEqual({ text: '└ ◌ Read code', glyph: 'claude', color: undefined })
  status.a1 = 'failed'
  await turnEnd($, 'a1')
  await ui.drawn()
  expect((await agentRow(ui, 0, 0))?.text).toBe('└ ✗ Read code')
})

test('each agent status draws its glyph and color, in the order Claude listed them', async ($, on) => {
  const ui = await agentsPane($, on, { a1: 'completed', a2: 'pending', a3: 'killed', a4: 'failed', a5: 'running' })
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'spec', status: 'in_progress', agents: ['c', 'p', 'k', 'f', 'r'] }] } as any)
  for (const one of ['c', 'p', 'k', 'f', 'r']) await spawn($, one)
  await ui.press({ key: 'more:0' })
  await ui.drawn()
  const rows = await Promise.all([0, 1, 2, 3, 4].map(n => agentRow(ui, 0, n)))
  expect(rows).toEqual([
    { text: '├ ✓ c', glyph: '#5d9678', color: '#808286' },
    { text: '├ ◌ p', glyph: '#4f5c68', color: '#4f5c68' },
    { text: '├ ■ k', glyph: '#8c7850', color: '#808286' },
    { text: '├ ✗ f', glyph: '#e06c75', color: '#808286' },
    { text: '├ ◌ r', glyph: 'claude', color: undefined },
  ])
})

test('an unlisted agent hangs under the step in progress at spawn, and stays there across a redraft', async ($, on) => {
  const ui = await agentsPane($, on, { a1: 'running' })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await spawn($, 'extra')
  await ui.drawn()
  expect((await agentRow(ui, 0, 0))?.text).toBe('└ ◌ extra')
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'plan', status: 'pending' }, { text: 'spec', status: 'in_progress' }] } as any)
  await ui.drawn()
  expect((await agentRow(ui, 1, 0))?.text).toBe('└ ◌ extra')
  // Its step renamed away: the step now in progress takes it.
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'plan', status: 'completed' }, { text: 'spec, take 2', status: 'in_progress' }] } as any)
  await ui.drawn()
  expect((await agentRow(ui, 1, 0))?.text).toBe('└ ◌ extra')
})

test("a new turn's report drops last turn's unlisted agents; a still-running one is counted, not drawn", async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await agentsPane($, on, { a1: 'completed', a2: 'running' })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await spawn($, 'zzold')
  await spawn($, 'zzbg')
  await turnEnd($)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'zzold' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'zzbg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '◌ waiting on 1 agent' })).toBeDefined()
})

test('agents a subagent, a plugin or a team started get no row', async ($, on) => {
  const ui = await agentsPane($, on, { a1: 'running', a2: 'running', a3: 'running' }, { a3: { spawnedBy: 'other' } })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await spawn($, 'nested', { parentAgentId: 'x' })
  await spawn($, 'mate', { isTeammate: true })
  await spawn($, 'plugin')
  await ui.drawn()
  expect(await ui.find({ key: 'agent:0:0' })).toBeUndefined()
})

test('an answer closes the steps but agent rows keep their own marks', async ($, on) => {
  const ui = await agentsPane($, on, { a1: 'killed' })
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await spawn($, 'Read code')
  await turnEnd($)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: '2/2 steps' })).toBeDefined()
  expect(await agentRow(ui, 0, 0)).toEqual({ text: '└ ■ Read code', glyph: '#8c7850', color: '#808286' })
})

test('a long agent description is fitted to the pane', async ($, on) => {
  const ui = await agentsPane($, on, { a1: 'running' })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await spawn($, 'x'.repeat(80))
  await ui.drawn()
  expect((await agentRow(ui, 0, 0))?.text).toBe(`└ ◌ ${'x'.repeat(24)}…`)
})

test("a dimmed report dims its agent rows", async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await agentsPane($, on, { a1: 'completed' })
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await spawn($, 'Read code')
  await turnEnd($)
  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()
  expect(await agentRow(ui, 0, 0)).toEqual({ text: '└ ✓ Read code', glyph: '#4f5c68', color: '#4f5c68' })
})

// Step 'spec' lists 5 agents (b1–b4 spawned, b5 not); 'plan' lists 4 none spawned.
const crowded = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  const ui = await agentsPane($, on, { a1: 'completed', a2: 'completed', a3: 'running', a4: 'failed' })
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'spec', status: 'in_progress', agents: ['b1', 'b2', 'b3', 'b4', 'b5'] }, { text: 'plan', status: 'pending', agents: ['c1', 'c2', 'c3', 'c4'] }] } as any)
  for (const one of ['b1', 'b2', 'b3', 'b4']) await spawn($, one)
  await ui.drawn()
  return ui
}
const textOf = async (ui: { find: (q: any) => Promise<any> }, key: string) => (await ui.find({ key }))?.text as string | undefined

test('a step with 5 agents shows the first 3 in order, then a count of the rest', async ($, on) => {
  const ui = await crowded($, on)
  expect(await Promise.all([0, 1, 2, 3].map(n => agentRow(ui, 0, n).then(row => row?.text)))).toEqual(['├ ✓ b1', '├ ✓ b2', '├ ◌ b3', undefined])
  expect(await textOf(ui, 'more:0')).toBe('└ … 2 more  1 ✗ 1 ○')
  expect(await textOf(ui, 'more:1')).toBe('└ … 1 more  1 ○')
})

test('pressing more shows every agent of that step, less folds them, one step open at a time', async ($, on) => {
  const ui = await crowded($, on)
  await ui.press({ key: 'more:0' })
  await ui.drawn()
  expect((await agentRow(ui, 0, 4))?.text).toBe('├ ○ b5')
  expect(await textOf(ui, 'less')).toBe('└ … less')
  await ui.press({ key: 'more:1' })
  await ui.drawn()
  expect(await textOf(ui, 'more:0')).toBeDefined()
  expect((await agentRow(ui, 1, 3))?.text).toBe('├ ○ c4')
  await ui.press({ key: 'less' })
  await ui.drawn()
  expect(await textOf(ui, 'less')).toBeUndefined()
  expect(await textOf(ui, 'more:1')).toBeDefined()
})

test("Claude's next full report folds an open step", async ($, on) => {
  const ui = await crowded($, on)
  await ui.press({ key: 'more:0' })
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [{ text: 'spec', status: 'in_progress', agents: ['b1', 'b2', 'b3', 'b4', 'b5'] }] } as any)
  await ui.drawn()
  expect(await textOf(ui, 'more:0')).toBe('└ … 2 more  1 ✗ 1 ○')
})

test('a prompt typed mid-turn keeps the turn: agents spawned after it still hang', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await agentsPane($, on, { a1: 'running' })
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.prompt.submit({ text: 'also this', wait: false, turnId: 't1', origin: { kind: 'composer' } } as any)
  await spawn($, 'late')
  await ui.drawn()
  expect((await agentRow(ui, 0, 0))?.text).toBe('└ ◌ late')
})

test("a workflow's agents get no row: the list never names them, so they would stick at not started", async ($, on) => {
  const ui = await agentsPane($, on, {})
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await spawn($, 'wf', { workflow: { runId: 'r1', agentIndex: 0 } })
  await ui.drawn()
  expect(await ui.find({ key: 'agent:0:0' })).toBeUndefined()
})

test("clicking a live agent row opens its transcript, its whole row lit while in view; clicking it again goes back", async ($, on) => {
  const views: (string | undefined)[] = []
  on('ui.view', (_, e) => {
    views.push(e.agentId)
    return { value: {} }
  })
  const ui = await agentsPane($, on, { a1: 'running' })
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await spawn($, 'Read code')
  await ui.drawn()
  // The planned 'Check API' has no agent to open.
  expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('view:')).map(one => one.key)).toEqual(['view:a1'])
  await ui.press({ key: 'view:a1' })
  await ui.redraw({ ...props, view: { agentId: 'a1' } })
  // Lit as the shown tab is: the whole row, padded to the pane's edge.
  const lit = (await ui.find({ key: 'agent:0:0' })).text as string
  expect(lit).toBe(`└ ◌ Read code${' '.repeat(40 - 4 - 7 - 13)}`)
  expect((await ui.find({ type: 'Text', text: /^└ ◌ Read code/ }))?.props).toMatchObject({ bold: true, inverse: true, color: 'claude' })
  await ui.press({ key: 'view:a1' })
  expect(views).toEqual(['a1', undefined])
})

test('an agent the engine will not show says why', async ($, on) => {
  const toasts: string[] = []
  on('ui.view', () => ({ value: { deny: 'no such agent' } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await agentsPane($, on, { a1: 'completed' })
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await spawn($, 'Read code')
  await ui.drawn()
  await ui.press({ key: 'view:a1' })
  expect(toasts).toEqual(['no such agent'])
})

test("in an agent's transcript, its step's row goes back to the main conversation", async ($, on) => {
  const views: (string | undefined)[] = []
  on('ui.view', (_, e) => {
    views.push(e.agentId)
    return { value: {} }
  })
  const ui = await agentsPane($, on, { a1: 'running' })
  await $.tool.call({ tool: INTENT, ...AGENTS_REPORT } as any)
  await spawn($, 'Read code')
  await ui.drawn()
  expect(await ui.find({ key: 'main' })).toBeUndefined()
  await ui.redraw({ ...props, view: { agentId: 'a1' } })
  // Only the step the viewed agent hangs under.
  expect((await ui.find({ key: 'main' }))?.text).toBe('● spec')
  await ui.press({ key: 'main' })
  expect(views).toEqual([undefined])
})

// The store a session keeps across sessions, `/margin` and the pane's opens and closes, each open placed or waiting; `opened`, `closed` and `registered` record the calls.
const openHost = (on: Parameters<TestBody>[1], store: Record<string, unknown> = {}, isPlaced = true) => {
  const seen = { opened: [] as unknown[], closed: [] as unknown[], registered: [] as [string, unknown][], clock: mock.clock(on) }
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.get', (_, e) => ({ value: store[e.key] }) as any)
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', (_, e) => {
    seen.registered.push([e.name, e.immediate])
    return { value: { command: e.name } }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__margin__${e.name}` } }) as any)
  on('ui.open', (_, e) => {
    seen.opened.push(e)
    return { value: { isPlaced } } as any
  })
  on('ui.panes', () => ({ value: seen.opened.length > seen.closed.length ? [{ id: 'margin', isPlaced }] : [] }) as any)
  on('ui.close', (_, e) => {
    seen.closed.push(e)
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return seen
}
const startHere = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const toggle = ($: Parameters<TestBody>[0]) => $.command.run({ command: 'margin', args: '', origin: { kind: 'composer' } } as any)

test('first session opens the pane', async ($, on) => {
  const seen = openHost(on)
  await $.session.start(startHere)
  expect(seen.opened).toHaveLength(1)
})

test('a session after the pane was closed leaves it closed', async ($, on) => {
  const seen = openHost(on, { open: false })
  await $.session.start(startHere)
  expect(seen.opened).toHaveLength(0)
})

test('a non-interactive session never opens the pane', async ($, on) => {
  const seen = openHost(on)
  await $.session.start({ ...startHere, isInteractive: false })
  expect(seen.opened).toHaveLength(0)
})

test('/margin remembers whether it left the pane open', async ($, on) => {
  const store: Record<string, unknown> = {}
  openHost(on, store)
  await $.session.start(startHere)
  await toggle($)
  expect(store.open).toBe(false)
  await toggle($)
  expect(store.open).toBe(true)
})

// No test raises a person's close; another plugin's close takes the same path.
const closer = { name: 'closer', register: (on => { on('command.run', { command: 'close-panel' }, async $ => (await $.ui.close({ id: 'margin' }), {})) }) as Register }
test('closing the pane any way but an unload is remembered', { plugins: [closer] }, async ($, on) => {
  const store: Record<string, unknown> = {}
  openHost(on, store)
  await $.session.start(startHere)
  await $.command.run({ command: 'close-panel', args: '', origin: { kind: 'composer' } } as any)
  expect(store.open).toBe(false)
})

test('/margin shows a pane waiting for room, not closes it', async ($, on) => {
  const store: Record<string, unknown> = {}
  const seen = openHost(on, store, false)
  await $.session.start(startHere)
  await toggle($)
  expect(seen.closed).toHaveLength(0)
  expect(store.open).toBe(true)
})

// The shown tab as the plugin leaves it: the test's `$` cannot read an atom, so `tab` is answered here.
const shownTab = (on: Parameters<TestBody>[1], initial?: string) => {
  const shown = { tab: initial, version: 1 }
  on('state.get', (_$, e, next) => (e.key === 'tab' && shown.tab !== undefined ? { value: { value: shown.tab, version: shown.version } } : next(e)) as any)
  on('state.set', (_$, e, next) => {
    if (e.key !== 'tab') return next(e)
    shown.tab = e.value as string
    return { value: { isSet: true, version: ++shown.version } } as any
  })
  return shown
}
const tabKey = ($: Parameters<TestBody>[0], name: string) => $.command.run({ command: `margin-${name}`, args: '', origin: { kind: 'composer' } } as any)

test('session start registers the four tab commands', async ($, on) => {
  const seen = openHost(on)
  await $.session.start(startHere)
  for (const name of ['overview', 'history', 'file', 'git']) expect(seen.registered).toContainEqual([`margin-${name}`, true])
})

test('tab commands are hidden', async ($, on) => {
  openHost(on)
  on('command.describe', (_, e) => ({ description: e.description, isHidden: e.isHidden }))
  const describe = (command: string) => $.command.describe({ command, description: '', isHidden: false, immediate: true, provider: { plugin: 'margin', tier: 'user' } } as any)
  expect((await describe('margin-git')).isHidden).toBe(true)
  expect((await describe('margin')).isHidden).toBe(false)
})

test('tab key on a closed pane opens it on that tab', async ($, on) => {
  const store: Record<string, unknown> = { open: false }
  const seen = openHost(on, store)
  const shown = shownTab(on)
  await $.session.start(startHere)
  await tabKey($, 'git')
  expect(seen.opened).toHaveLength(1)
  expect(shown.tab).toBe('Git')
  expect(store.open).toBe(true)
})

test('tab key on another tab switches, no close', async ($, on) => {
  const seen = openHost(on)
  const shown = shownTab(on, 'Overview')
  await $.session.start(startHere)
  await tabKey($, 'history')
  expect(seen.closed).toHaveLength(0)
  expect(shown.tab).toBe('History')
})

test('tab key on its own tab closes the pane', async ($, on) => {
  const store: Record<string, unknown> = {}
  const seen = openHost(on, store)
  shownTab(on, 'Git')
  await $.session.start(startHere)
  await tabKey($, 'git')
  expect(seen.closed).toHaveLength(1)
  expect(store.open).toBe(false)
})

test('tab key on a pane waiting for room opens it', async ($, on) => {
  const seen = openHost(on, {}, false)
  const shown = shownTab(on)
  await $.session.start(startHere)
  const before = seen.opened.length
  await tabKey($, 'file')
  expect(seen.closed).toHaveLength(0)
  expect(seen.opened.length).toBeGreaterThan(before)
  expect(shown.tab).toBe('File')
})

test('alt+o on an open pane with a stale tab closes it', async ($, on) => {
  const seen = openHost(on)
  shownTab(on, 'Nope')
  await $.session.start(startHere)
  await tabKey($, 'overview')
  expect(seen.closed).toHaveLength(1)
})

test('alt+o on a closed pane reads TOPICS once', async ($, on) => {
  const { clock } = openHost(on, { open: false })
  shownTab(on, 'History')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const lines = ['add an intent tab'].map((display, i) => JSON.stringify({ display, timestamp: i + 1, sessionId: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? lines.join('\n') : ''))
  let asks = 0
  on('model.complete', () => ((asks += 1), { value: { isAnswered: true, text: TOPICS, usage: {} } }) as any)
  await $.session.start(startHere)
  await clock.settle()
  await tabKey($, 'overview')
  await clock.settle()
  expect(asks).toBe(1)
})

// The File tab's rows: the body less its header row.
const windowRows = props.scroll.bodyRows - 2 - BAR_ROWS - 2 // header row + its rule
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
// The File tab as `$.margin.show` leaves it: the test's `$` carries no plugin noun, and a hook in a test module that
// calls one is refused ("its hooks module does not call it (host rule; the scan lists no calls)"), so the two
// values `show` writes are answered on read. An empty text stands for a file it could not show.
const fileTab = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], file: ReturnType<typeof fileView> | undefined) => {
  noHistory(on)
  on('state.get', (_$, e, next) => {
    const value = e.key === 'tab' ? 'File' : e.key === 'file' ? file : undefined
    return (value === undefined ? next(e) : { value: { value, version: 1 } }) as any
  })
  return $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
}

test('the File header is the path from the working directory, or from ~, with a rule under it', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  const ui = await fileTab($, on, fileView('/repo/src/a.ts', 65, lines(200)))
  // As Git's branch row: the path in the action color, the line faint on the right.
  expect(await colorOf(ui, 'src/a.ts')).toBe('#5d9678')
  expect(await colorOf(ui, 'line 65')).toBe('#4f5c68')
  expect(await ui.find({ type: 'Text', text: new RegExp(`^─{${props.bodyColumns - 4}}$`) })).toBeDefined()
})

test('a long File header keeps its line and cuts the path from the left', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  const ui = await fileTab($, on, fileView(`/repo/${'deep/'.repeat(20)}a.ts`, 65, lines(200)))
  const head = await ui.find({ type: 'Text', text: /^….*\/a\.ts$/ })
  expect(String(head?.text)).toHaveLength(props.bodyColumns - 4 - 'line 65'.length - 1)
  expect(await ui.find({ type: 'Text', text: 'line 65' })).toBeDefined()
})

test('a File header outside the working directory starts from ~', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  // noHistory's env.get answers /home/me.
  const ui = await fileTab($, on, fileView('/home/me/notes.md', 3, lines(20)))
  expect(await ui.find({ type: 'Text', text: '~/notes.md' })).toBeDefined()
})

test('the File tab shows the file at the line, marked, with the path in its header', async ($, on) => {
  const ui = await fileTab($, on, fileView('/repo/a.ts', 65, lines(200)))
  expect(await ui.find({ type: 'Text', text: 'line 65' })).toBeDefined()
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.path).toBe('/repo/a.ts')
  expect(code?.props.source).toContain('line 65')
  // A long line must not wrap: the window is exactly its rows, the mark stays on its line.
  expect(code?.props.wrap).toBe('truncate-end')
  // Clicked line in the middle.
  const above = 65 - (code?.props.startLine as number)
  expect(above).toBe(Math.floor(windowRows / 2))
  expect((code?.props.source as string).split('\n')).toHaveLength(windowRows)
  const mark = await ui.find({ type: 'Text', text: /▶/ })
  expect(String(mark?.text).split('\n').indexOf('▶')).toBe(above)
})

test('a line deep in a large file still shows marked in the middle', async ($, on) => {
  const ui = await fileTab($, on, fileView('/repo/a.ts', 4000, lines(5000)))
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toContain('line 4000\n')
  const above = 4000 - (code?.props.startLine as number)
  expect(above).toBe(Math.floor(windowRows / 2))
  const mark = await ui.find({ type: 'Text', text: /▶/ })
  expect(String(mark?.text).split('\n').indexOf('▶')).toBe(above)
})

test('a line past the end shows the last lines', async ($, on) => {
  const ui = await fileTab($, on, fileView('/repo/a.ts', 9999, lines(10)))
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toMatch(/line 10$/)
  expect(code?.props.startLine).toBe(1)
})

test('the File tab before any click says how to open one', async ($, on) => {
  const ui = await fileTab($, on, undefined)
  expect(await ui.find({ type: 'Text', text: 'No file open' })).toBeDefined()
})

test('a file that cannot be shown says so in the File tab', async ($, on) => {
  const ui = await fileTab($, on, fileView('/repo/a.ts', 3, undefined))
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/repo/a.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
})

test('a file holding ESC or a form feed still shows, the control characters as spaces', async ($, on) => {
  const ui = await fileTab($, on, fileView('/repo/a.log', 2, 'one\n\x1b[31mred\x1b[0m\n\fpage\tend\n'))
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('one\n [31mred [0m\n page\tend')
})

test('fileView keeps a bounded slice, each line cut, and maps a failed or binary read to empty text', () => {
  expect(fileView('/a', 5, undefined).text).toBe('')
  expect(fileView('/a', 5, 'ab\0cd').text).toBe('')
  const big = fileView('/a', 4000, lines(5000))
  expect(big.first).toBe(3800)
  expect(big.text.split('\n')).toHaveLength(401)
  expect(fileView('/a', 1, lines(5000)).first).toBe(1)
  expect(fileView('/a', 9999, lines(5000)).first).toBe(4600)
  const long = fileView('/a', 1, `${'x'.repeat(100000)}\nshort\n`)
  expect(long.text.split('\n').map(one => one.length)).toEqual([500, 5])
  expect(fileView('/a', 1, 'a\r\nb\r\n').text).toBe('a\nb')
})

test('fileWindow puts the clicked line in the middle, clamped to the slice', () => {
  const view = fileView('/a', 4000, lines(5000))!
  const at = fileWindow(view, 17)
  expect(at.lines).toHaveLength(17)
  expect(at.first + at.mark).toBe(4000)
  expect(at.mark).toBe(8)
  const top = fileWindow(fileView('/a', 1, lines(50))!, 17)
  expect([top.first, top.mark]).toEqual([1, 0])
  const end = fileWindow(fileView('/a', 50, lines(50))!, 17)
  expect([end.first, end.mark]).toEqual([34, 16])
})

// History and claudzilla.json answers from /home/me, a session.start host; the returned array gathers the toasts.
const paletteHost = (on: Parameters<TestBody>[1], config: string, history = '') => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path === '/home/me/claudzilla.json' ? config : history }))
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}
const paletteStart = ($: Parameters<TestBody>[0]) => $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
const GIT_REPO = {
  status: '## main...origin/main [ahead 1, behind 2]\n M hooks/register.tsx\nA  new.ts\n?? notes.md\n',
  log: 'abc1234ffff abc1234 feat: add thing\nghi9012ffff ghi9012 chore(ci): tidy\njkl3456ffff jkl3456 wip: try\ndef5678ffff def5678 fix(core): old bug\n',
  diff: '80\t4\thooks/register.tsx\0' + '6\t2\tnew.ts\0',
  '--remotes': 'abc1234ffff\nghi9012ffff\njkl3456ffff\n',
  '--count': '142\n',
}
const paletteGitTab = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) => {
  on('process.run', (_, e) => ran(git(GIT_REPO)(e.argv) ?? ''))
  await paletteStart($)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'Git' })
  return ui
}

test('a palette recolours the Git tab; chore follows shared.label', async ($, on) => {
  const config = { palette: { shared: { faint: '#112233', label: '#445566' }, margin: { ahead: '#778899', types: { feat: '#aabbcc' } } } }
  const toasts = paletteHost(on, JSON.stringify(config))
  const ui = await paletteGitTab($, on)
  expect((await ui.find({ type: 'Text', text: '3 files' }))?.props.color).toBe('#112233')
  expect((await ui.find({ type: 'Text', text: '↑3' }))?.props.color).toBe('#778899')
  expect((await ui.find({ type: 'Text', text: /^feat$/, in: 'row:c:abc1234ffff' }))?.props.color).toBe('#aabbcc')
  expect((await ui.find({ type: 'Text', text: /^chore$/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#445566')
  expect(toasts).toEqual([])
})

test('a palette label dims the History day line at 60%', async ($, on) => {
  const day = 24 * 60 * 60 * 1000
  const history = [Date.now() - 3 * day, Date.now()].map((timestamp, i) => JSON.stringify({ display: `p${i}`, timestamp, sessionId: 'chat-1' })).join('\n')
  paletteHost(on, JSON.stringify({ palette: { shared: { label: '#ffffff' } } }), history)
  await paletteStart($)
  const ui = await $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: 'Today' }))?.props.color).toBe('#ffffff')
  const [left] = await ui.findAll({ type: 'Text', text: /^─+ $/ })
  expect(left?.props.color).toBe('#999999')
})

test('bad palette entries: one toast names each, defaults kept', async ($, on) => {
  const config = { palette: { shared: { lable: '#112233' }, margin: { label: '#112233', ahead: 'gold' }, hud: { rampHot: '#ffaa5' } } }
  const toasts = paletteHost(on, JSON.stringify(config))
  const ui = await paletteGitTab($, on)
  expect(toasts).toEqual(['claudzilla.json: ignored palette.shared.lable, palette.margin.label, palette.margin.ahead, palette.hud.rampHot'])
  expect((await ui.find({ type: 'Text', text: '↑3' }))?.props.color).toBe('#d4b860')
  expect((await ui.find({ type: 'Text', text: /^chore$/, in: 'row:c:ghi9012ffff' }))?.props.color).toBe('#a396d2')
})

test('an ignored key with control characters shows in the toast without them', async ($, on) => {
  const toasts = paletteHost(on, JSON.stringify({ palette: { shared: { 'bad\u001b[31mkey': '#112233' } } }))
  await paletteStart($)
  expect(toasts).toEqual(['claudzilla.json: ignored palette.shared.bad[31mkey'])
})

test('more than 5 ignored paths: toast names 5, then +N more, cut by code point', async ($, on) => {
  const long = '😀'.repeat(30)
  const toasts = paletteHost(on, JSON.stringify({ palette: { shared: { a: 1, b: 1, c: 1, d: 1, [long]: 1, f: 1, g: 1 } } }))
  await paletteStart($)
  const p = 'palette.shared.'
  expect(toasts).toEqual([`claudzilla.json: ignored ${p}a, ${p}b, ${p}c, ${p}d, ${p}${'😀'.repeat(24)}… +2 more`])
})

test('no palette key: no toast', async ($, on) => {
  const toasts = paletteHost(on, '{}')
  await paletteStart($)
  expect(toasts).toEqual([])
})

test('a broken claudzilla.json: no toast', async ($, on) => {
  const toasts = paletteHost(on, '{ nope')
  await paletteStart($)
  expect(toasts).toEqual([])
})
