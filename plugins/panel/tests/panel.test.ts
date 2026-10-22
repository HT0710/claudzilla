import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { AgentStatus, Register } from 'claude-code'
import type { Spawn, Step } from '../types'

import { branchLine, dayLabel, gitWeb, gone, hang, inView, keepNewest, fileView, fileWindow, lastRowIds, litPrompt, nearestCommandId, nearestId, needles, ordered, parseTopics, pinHolds, readStamps, stampPattern } from '../hooks/register'

// A process.run result with `stdout`.
const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
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
    const ui = await $.ui.mount({ plugin: 'panel', surface, component: 'Pane', props, requestId: 'panel' })
    expect(await ui.find({ key: 'Activity' })).toBeUndefined()
    expect(await ui.find({ key: 'Git' })).toBeDefined()
    expect(await ui.find({ key: 'History' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
  })
}

// Stands for git in the session's folder: each subcommand the test holds answers its text.
const git = (repo: Record<string, string>) => (argv: readonly string[]) =>
  argv[0] !== 'git' ? undefined : (Object.entries(repo).find(([command]) => argv.includes(command))?.[1] ?? '')
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
    diff: ' 1 file changed, 144 insertions(+), 6 deletions(-)\n',
    // Answers only the list that leaves out commits a remote has.
    '--remotes': 'abc1234ffff\nghi9012ffff\njkl3456ffff\n',
    '--count': '142\n',
  }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: '⎇ main ↑1 ↓2' })).toBeDefined()
  // A rule under the branch, as wide as the body.
  expect(await ui.find({ type: 'Text', text: new RegExp(`^─{${props.bodyColumns - 4}}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 changed' })).toBeDefined()
  // As the HUD statusline: tracked changes, untracked files, then lines added and removed.
  expect(await ui.find({ type: 'Text', text: '!2 ?1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  +144 -6' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hooks\/register\.tsx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /notes\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'abc1234' })).toBeDefined()
  // CHANGES' colors: local in the dirty count's yellow, total in the churn's green.
  expect((await ui.find({ type: 'Text', text: /^3 local$/ }))?.props.color).toBe('#8c7850')
  expect((await ui.find({ type: 'Text', text: /^ {2}142 total$/ }))?.props.color).toBe('#6e8c6e')
  // Local bright, pushed dim.
  expect((await ui.find({ type: 'Text', text: /^add thing$/ }))?.props.color).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^old bug$/ }))?.props.color).toBe('#4f5c68')
  // Each type its own color, pushed at 60%; a type outside the git rules stays gray.
  expect((await ui.find({ type: 'Text', text: /^ feat$/ }))?.props.color).toBe('#98c379')
  expect((await ui.find({ type: 'Text', text: /^ chore$/ }))?.props.color).toBe('#a396d2')
  expect((await ui.find({ type: 'Text', text: /^ wip$/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^ fix$/ }))?.props.color).toBe('#864146')
  // A local scope a light gray under its subject; its parentheses stay faint.
  expect((await ui.find({ type: 'Text', text: /^ci$/ }))?.props.color).toBe('#808286')
  expect((await ui.find({ type: 'Text', text: /^\($/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^\): $/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^core$/ }))?.props.color).toBe('#4f5c68')
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

test('Git tab links the pushed branch and pushed commits to their web pages, lit on hover', async ($, on) => {
  noHistory(on)
  const repo = {
    status: '## feat/x...origin/feat/x [ahead 1]\n',
    log: 'abc1234ffff abc1234 feat: local one\ndef5678ffff def5678 fix: pushed one\n',
    '--remotes': 'abc1234ffff\n',
    'get-url': 'git@github.com:o/r.git\n',
  }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  const links = await ui.findAll({ type: 'Link' })
  expect(links.map(link => link.props.href)).toEqual(['https://github.com/o/r/tree/feat/x', 'https://github.com/o/r/commit/def5678ffff'])
  // Not pushed: no page yet. Pushed: the id alone opens it.
  expect(links.some(link => /local one/.test(link.text ?? ''))).toBe(false)
  expect(links[1]?.text).toMatch(/def5678$/)
  // A Text's hover rides beside its props. The id heats its commit's group, lit as History lights a row; the
  // subject's Texts follow it, nested in a Text so they cannot heat it.
  type Drawn = { type?: string; hover?: { scope?: string; inverse?: boolean }; children?: unknown[] }
  const walk = (node: unknown, inText = false): { scope?: string; nested: boolean }[] => {
    const el = node as Drawn
    if (typeof node !== 'object' || !el) return []
    const own = el.type === 'Text' && el.hover?.inverse ? [{ scope: el.hover.scope, nested: inText }] : []
    return [...own, ...(el.children ?? []).flatMap(child => walk(child, inText || el.type === 'Text'))]
  }
  const lit = walk(await ui.drawn())
  expect(lit.filter(text => text.scope === 'branch')).toEqual([{ scope: 'branch', nested: false }])
  const commit = lit.filter(text => text.scope === 'commit:def5678')
  expect(commit[0]).toEqual({ scope: 'commit:def5678', nested: false })
  expect(commit.length).toBeGreaterThan(1)
  expect(commit.slice(1).every(text => text.nested)).toBe(true)
  expect(lit.some(text => text.scope === 'commit:abc1234')).toBe(false)
  // Lit across the body, as History's rows: the subject padded to its edge.
  expect((await ui.find({ type: 'Text', text: /^pushed one +$/ }))?.text.length).toBe(props.bodyColumns - 4 - 'def5678 fix: '.length)
})

// Each case: what git answers, then the links left. No guessed page: one that may not exist draws plain.
const unlinked: [string, Record<string, string>, string[]][] = [
  ['an unknown host', { status: '## main...origin/main\n', 'get-url': 'git@git.acme.com:o/r.git\n' }, []],
  ['a branch with no upstream', { status: '## main\n' }, ['https://github.com/o/r/commit/def5678ffff']],
  ['a branch gone from origin', { status: '## main...origin/main [gone]\n' }, ['https://github.com/o/r/commit/def5678ffff']],
  ['a branch tracking another remote', { status: '## main...upstream/main\n' }, ['https://github.com/o/r/commit/def5678ffff']],
  ['a failed local list', { status: '## main\n', '--remotes': 'fail' }, []],
]
for (const [what, answers, hrefs] of unlinked)
  test(`Git tab links only what surely has a page: ${what}`, async ($, on) => {
    noHistory(on)
    const repo = { log: 'def5678ffff def5678 fix: pushed\n', 'get-url': 'git@github.com:o/r.git\n', ...answers }
    on('process.run', (_, e) => {
      const out = git(repo)(e.argv) ?? ''
      return out === 'fail' ? { value: { ...ran('').value, exitCode: 128 } } : ran(out)
    })

    const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
    await ui.press({ key: 'Git' })

    expect((await ui.findAll({ type: 'Link' })).map(link => link.props.href)).toEqual(hrefs)
  })

test('a commit subject with no Conventional Commits type shows whole', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: 'abc1234ffff abc1234 Merge branch x\n', '--remotes': 'abc1234ffff\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect((await ui.find({ type: 'Text', text: /^ Merge branch x$/ }))?.props.color).toBeUndefined()
})

test('a changed file shows one status letter: bright while unstaged, dim once staged', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n M a.ts\nA  b.ts\nMM c.ts\n?? d.ts\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  // Unstaged changes, a file staged and edited again included: the worktree's letter, bright.
  expect((await ui.findAll({ type: 'Text', text: /^M$/ })).map(found => found.props.color)).toEqual(['#e5c07b', '#e5c07b'])
  expect((await ui.find({ type: 'Text', text: /a\.ts$/ }))?.props.color).toBeUndefined()
  // Wholly staged: the index's letter at 60%, its path faint.
  expect((await ui.find({ type: 'Text', text: /^A$/ }))?.props.color).toBe('#5b7549')
  expect((await ui.find({ type: 'Text', text: /b\.ts$/ }))?.props.color).toBe('#4f5c68')
  expect((await ui.find({ type: 'Text', text: /^\?$/ }))?.props.color).toBe('#56b6c2')
})

test('Git tab redraws after a tool call changes the repo', async ($, on) => {
  noHistory(on)
  const repo = { status: '## main\n M a.ts\n', log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  Object.assign(repo, { status: '## main...origin/main [ahead 1]\n', log: 'fed4321ffff fed4321 second\nabc1234ffff abc1234 first\n' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -am second' })

  expect(await ui.find({ type: 'Text', text: '⎇ main ↑1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'fed4321' })).toBeDefined()
})

test('the narrowest pane keeps the Git headers on one row, dropping their counts from the right', async ($, on) => {
  noHistory(on)
  const repo = {
    status: '## main\n M a.ts\nA  b.ts\n?? c.md\n',
    log: 'abc1234ffff abc1234 feat: add thing\n',
    diff: ' 1 file changed, 144 insertions(+), 6 deletions(-)\n',
    '--remotes': 'abc1234ffff\nghi9012ffff\njkl3456ffff\n',
    '--count': '142\n',
  }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 23 }, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  // 19 columns: "CHANGES !2 ?1" fits, the churn after it does not; "COMMITS 3 local" fits, the total does not.
  expect(await ui.find({ type: 'Text', text: '!2 ?1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+144/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '3 local' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /total/ })).toBeUndefined()
})

test('dragging the divider gives CHANGES more rows', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 20 body rows less 7 fixed: CHANGES takes up to half of 13, 7 rows.
  expect(await ui.find({ type: 'Text', text: /file6\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file7\.ts/ })).toBeUndefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })

  expect(await ui.find({ type: 'Text', text: /file8\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file9\.ts/ })).toBeUndefined()
})

test('a one-row CHANGES zone scrolls with no back-to-top line', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))
  const scroll = { offset: 0, bodyRows: 9 + BAR_ROWS }
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props: { ...props, scroll }, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 9 body rows less 7 fixed: COMMITS keeps 1, CHANGES the 1 left, on row 5.
  await $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by: 100, bodyRows: 9 + BAR_ROWS, contentRows: 9 + BAR_ROWS, origin: { kind: 'person' }, pointer: { column: 0, row: 5 } })
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /file9\.ts/ })).toBeDefined()
  expect(await ui.find({ key: 'top:changes' })).toBeUndefined()
})

test('the divider shows how far it is dragged, and resizes once let go', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file7\.ts/ })).toBeUndefined()

  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /file8\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeUndefined()
})

test('a release the divider missed ends the drag at the next move', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  const repo = { status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' }
  on('process.run', (_, e) => ran(git(repo)(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  // No up came: the next move holds no button.
  await ui.pointer({ type: 'move', x: 0, y: 2, in: 'divider' })

  expect(await ui.find({ type: 'Text', text: /file8\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↓2', in: 'divider' })).toBeUndefined()
})

test('the divider lights its grip while the pointer is over it', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n M file0.ts\n', log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES end on row 11, 6 of COMMITS start on row 14; once scrolled, the back-to-top
  // line takes a zone's first row.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  expect(await ui.find({ key: 'top:changes' })).toBeUndefined()
  await wheel(5, 8)
  expect(await ui.find({ type: 'Text', text: /file3\.ts/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /file4\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file9\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit 0$/ })).toBeDefined()
  expect((await ui.find({ key: 'top:changes' }))?.text).toBe('↑')
  // Dim as the divider's grip at rest, lit as it is under the pointer.
  const arrow = await ui.find({ type: 'Text', text: '↑' })
  expect(arrow?.props.color).toBe('promptBorder')
  // Hovered, its Button heats the scope and its Text takes the color: either alone leaves ↑ dim. A hover rides
  // beside the props, in the drawn tree.
  type Drawn = { type?: string; hover?: object; children?: unknown[] }
  const hovers = (node: unknown): object[] => {
    const el = node as Drawn
    if (typeof node !== 'object' || !el) return []
    return [...((el.type === 'Button' || el.type === 'Text') && el.hover ? [{ type: el.type, ...el.hover }] : []), ...(el.children ?? []).flatMap(hovers)]
  }
  expect(hovers(await ui.drawn())).toEqual(['Button', 'Text'].map(type => ({ type, scope: 'top:changes', color: 'claude' })))
  expect(await ui.find({ key: 'top:commits' })).toBeUndefined()

  await wheel(100, 16)
  expect(await ui.find({ type: 'Text', text: /commit 24$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /commit 25$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit 29$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file4\.ts/ })).toBeDefined()
  expect((await ui.find({ key: 'top:commits' }))?.text).toBe('↑')

  await ui.press({ key: 'top:commits' })
  expect(await ui.find({ type: 'Text', text: /commit 0$/ })).toBeDefined()
  expect(await ui.find({ key: 'top:commits' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /file4\.ts/ })).toBeDefined()
  await ui.press({ key: 'top:changes' })
  expect(await ui.find({ type: 'Text', text: /file0\.ts/ })).toBeDefined()
  expect(await ui.find({ key: 'top:changes' })).toBeUndefined()
})

test('COMMITS reads a page at a time as the wheel goes past it, down to the first commit', async ($, on) => {
  noHistory(on)
  const all = Array.from({ length: 250 }, (_, i) => `c${i}ffff c${i} commit ${i}\n`)
  const skips: number[] = []
  on('process.run', (_, e) => {
    if (!e.argv.includes('log')) return ran(git({ status: '## main\n', '--count': '250\n' })(e.argv) ?? '')
    const skip = Number(e.argv.find(arg => arg.startsWith('--skip='))?.slice(7))
    skips.push(skip)
    return ran(all.slice(skip, skip + Number(e.argv.find(arg => /^-\d+$/.test(arg))!.slice(1))).join(''))
  })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // A clean repo: 15 rows of COMMITS, 14 under the back-to-top line once scrolled.
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  await wheel(150)
  expect(await ui.find({ type: 'Text', text: /commit 149$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /commit 163$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit 164$/ })).toBeUndefined()
  await wheel(1)
  await wheel(1000)
  expect(await ui.find({ type: 'Text', text: /commit 234$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /commit 249$/ })).toBeDefined()
  expect(skips).toEqual([0, 100, 200])
})

test('with no commit count, COMMITS still scrolls page by page to the first commit', async ($, on) => {
  noHistory(on)
  const all = Array.from({ length: 250 }, (_, i) => `c${i}ffff c${i} commit ${i}\n`)
  on('process.run', (_, e) => {
    if (!e.argv.includes('log')) return ran(git({ status: '## main\n' })(e.argv) ?? '')
    const skip = Number(e.argv.find(arg => arg.startsWith('--skip='))?.slice(7))
    return ran(all.slice(skip, skip + Number(e.argv.find(arg => /^-\d+$/.test(arg))!.slice(1))).join(''))
  })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  // Each page's draw lands before the next tick: until then the wheel stops at the page drawn.
  for (const by of [150, 1000, 1000]) {
    await wheel(by)
    await ui.redraw()
  }
  expect(await ui.find({ type: 'Text', text: /commit 249$/ })).toBeDefined()
})

test('a clean repo drops CHANGES and its divider: COMMITS takes their rows', async ($, on) => {
  noHistory(on)
  const log = Array.from({ length: 15 }, (_, i) => `c${i}ffff c${i} commit ${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: '0 changed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CHANGES' })).toBeUndefined()
  expect(await ui.find({ key: 'divider' })).toBeUndefined()
  // 20 body rows less the tabs, their rule, the branch, its rule and the COMMITS header: 15.
  expect(await ui.find({ type: 'Text', text: /commit 14$/ })).toBeDefined()
})

test('the divider drags up to 1 row of CHANGES, and no further', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 7 rows of CHANGES; dragged 9 rows up, past its title.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: -9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↑6', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -9, button: 'left', in: 'divider' })

  expect(await ui.find({ type: 'Text', text: /file0\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file1\.ts/ })).toBeUndefined()
})

test('the divider drags down to 1 row of COMMITS, and no further', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 15 }, (_, i) => ` M file${i}.ts`).join('\n')
  const log = Array.from({ length: 5 }, (_, i) => `abc123${i}ffff abc123${i} commit${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 13 free rows, 7 of CHANGES; dragged 9 rows down, past COMMITS' first row.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 9, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓5', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 9, button: 'left', in: 'divider' })

  expect(await ui.find({ type: 'Text', text: /file11\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file12\.ts/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /commit0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit1/ })).toBeUndefined()
})

test('a one-row CHANGES zone stays put dragged up, and grows dragged down', async ($, on) => {
  noHistory(on)
  const log = Array.from({ length: 15 }, (_, i) => `abc12${i}ffff abc12${i} commit${i}`).join('\n')
  on('process.run', (_, e) => ran(git({ status: '## main\n M file0.ts\n', log: `${log}\n` })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 1 row of CHANGES, 12 of COMMITS.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '⇕', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /commit11/ })).toBeDefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 1, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: '↓1', in: 'divider' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 1, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /commit10/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /commit11/ })).toBeUndefined()
})

test('a click on the divider moves it to the top, and from the top to the bottom', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 15 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  // 13 free rows, 7 of CHANGES: clicked, 1; clicked again, 12.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /file0\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file1\.ts/ })).toBeUndefined()

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /file11\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file12\.ts/ })).toBeUndefined()
})

test('a drag back to where it began moves the divider nowhere', async ($, on) => {
  noHistory(on)
  const files = Array.from({ length: 10 }, (_, i) => ` M file${i}.ts`).join('\n')
  on('process.run', (_, e) => ran(git({ status: `## main\n${files}\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /file6\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /file7\.ts/ })).toBeUndefined()
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  const before = runs
  // A drag redraws the pane; the repo has not changed.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'divider' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'divider' })
  expect(await ui.find({ type: 'Text', text: /file8\.ts/ })).toBeDefined()
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })
  const before = runs
  await $.tool.call({ tool: 'Read', file_path: '/x' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as any)
  await ui.drawn()

  expect(runs).toBe(before)
})

test('a commit subject draws its control characters as spaces', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n', log: 'abc1234ffff abc1234 feat: tab\there\x1bend\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: 'tab here end' })).toBeDefined()
})

test('Overview tab with nothing read yet shows a note', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  expect(await ui.find({ type: 'Text', text: 'Nothing here yet' })).toBeDefined()
})

test('top bar holds Overview, Decisions, History; bottom bar File, Tree, Git', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const cells = (await ui.findAll({ type: 'Box' })).map(b => b.key).filter(key => key?.startsWith('tab:'))
  expect(cells).toEqual(['tab:Overview', 'tab:Decisions', 'tab:History', 'tab:File', 'tab:Tree', 'tab:Git'])
  // Each bar: body less margins and two separators, split three ways.
  expect((await ui.find({ key: 'tab:Git' }))?.props.width).toBe(Math.floor((props.bodyColumns - 4 - 6) / 3))
})

test('a tab not built yet is dim and says when it comes', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Tree' })
  // The same boxed note as an empty Overview, History or Git.
  expect(await ui.find({ type: 'Text', text: 'Coming in v1.8' })).toBeDefined()
  expect(await ui.find({ type: 'Box', borderStyle: 'round' } as any)).toBeDefined()
})

test("the bottom bar sits on the pane's last rows, whatever the tab holds", async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  // Overview with nothing read is short; the body Box still fills to the bar.
  expect((await ui.find({ key: 'body' }))?.props.height).toBe(props.scroll.bodyRows - 4) // top bar + rule, bottom rule + bar
})

test('the shown tab is lit across its cell and no button; another tab presses across its cell', async ($, on) => {
  noHistory(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(keys).toEqual(['tab'])
})

test("a tab press switches even when the button's onPress is lost", async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\n' })(e.argv) ?? ''))
  // Stands for the terminal losing onPress to a redraw that swaps the tree as the click lands.
  on('ui.press', (_, e) => ({ element: e.element }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: '⎇ main' })).toBeDefined()
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: 'Not a git repository' })).toBeDefined()
})

test('branch line: no upstream, behind only, upstream gone', () => {
  expect(branchLine('## feat/x')).toBe('feat/x')
  expect(branchLine('## main...origin/main [behind 3]')).toBe('main ↓3')
  expect(branchLine('## main...origin/main [gone]')).toBe('main gone')
  // Only the tracking part is rewritten, not a branch named like it.
  expect(branchLine('## feat/go-ahead...origin/feat/go-ahead [ahead 1]')).toBe('feat/go-ahead ↑1')
  expect(branchLine('## fix/fall-behind...origin/fix/fall-behind [behind 2]')).toBe('fix/fall-behind ↓2')
})

test('a long branch row is cut to fit beside its count, not wrapped', async ($, on) => {
  noHistory(on)
  const head = '## feature/a-really-long-branch-name-that-goes-on...origin/x [ahead 12, behind 3]'
  on('process.run', (_, e) => ran(git({ status: `${head}\n M a.ts\n`, log: 'abc1234ffff abc1234 first\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  const branch = (await ui.find({ type: 'Text', text: /^⎇ / }))?.text ?? ''
  expect(branch.endsWith('…')).toBe(true)
  // The body less its margins: the branch, a space at least, "1 changed".
  expect(branch.length + 1 + '1 changed'.length).toBeLessThanOrEqual(props.bodyColumns - 4)
})

test('a conflict shows U, whatever git pairs it with', async ($, on) => {
  noHistory(on)
  on('process.run', (_, e) => ran(git({ status: '## main\nAA both.ts\nUU c.ts\nDD d.ts\nUD e.ts\n' })(e.argv) ?? ''))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect((await ui.findAll({ type: 'Text', text: /^U$/ })).map(found => found.props.color)).toEqual(['#e06c75', '#e06c75', '#e06c75', '#e06c75'])
})

test('a renamed file shows its new name; paths come unescaped', async ($, on) => {
  noHistory(on)
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return ran(git({ status: '## main\nR  old-name.ts -> new-name.ts\n' })(e.argv) ?? '')
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'Git' })

  expect(await ui.find({ type: 'Text', text: /new-name\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /old-name/ })).toBeUndefined()
  expect(runs.find(argv => argv.includes('status'))).toContain('core.quotePath=false')
})

test('divider keeps half the side margin', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Today' })).length).toBe(1)
  // "──── Today ────" spans the row exactly (side margins take 4 columns), label centered.
  const [left] = await ui.findAll({ type: 'Text', text: /^─+ $/ })
  const [right] = await ui.findAll({ type: 'Text', text: /^ ─+$/ })
  expect((left?.text.length ?? 0) + 'Today'.length + (right?.text.length ?? 0)).toBe(props.bodyColumns - 4)
  expect(Math.abs((left?.text.length ?? 0) - (right?.text.length ?? 0))).toBeLessThanOrEqual(1)
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
  const prompts = asPrompts('/compact', '/panel', '/restart', 'go', '/compact', '/restart', 'old')
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
  expect(gone(asPrompts('P4', 'P3', '/panel', 'P2', 'P1'), ['P1', 'P4'], ['P1', 'P4'])).toEqual([
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(0)
})

test('/quit, /exit, /rewind, /panel, /resume and /clear are left out', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['/quit', 'kept', '/rewind', '/panel', '/resume', '/clear', '/exit', '/exited-not']
    .map((display, i) => JSON.stringify({ display, timestamp: i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const color = async () => (await ui.find({ type: 'Text', text: /^\/model\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const output = { command: 'model', args: '', text: 'Set model.', isErrored: false }
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'CommandOutput', props: output, requestId: 'cmd-1' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const color = async () => (await ui.find({ type: 'Text', text: /^sent mid-turn\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const row = { text: 'sent mid-turn', origin: { kind: 'composer' as const }, isExpanded: false }
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', props: row, requestId: 'msg-1' })
  await clock.advance(100)

  expect(await color()).toBe('claude')
})

test('a slash command resolves to the output line of the run nearest its time', () => {
  const run = (uuid: string, at: string, name: string, args: string) => [
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid, timestamp: at, content: `<command-name>${name}</command-name>\n <command-message>x</command-message>\n <command-args>${args}</command-args>` }),
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid: `${uuid}-out`, parentUuid: uuid, timestamp: at, content: '<local-command-stdout>ok</local-command-stdout>' }),
  ]
  const transcript = [
    ...run('early', '2026-10-10T09:00:00Z', '/panel', ''),
    ...run('right', '2026-10-10T10:00:01Z', '/panel', ''),
    ...run('other', '2026-10-10T10:00:00Z', '/compact', 'keep this'),
  ].join('\n')
  const at = Date.parse('2026-10-10T10:00:00Z')

  expect(nearestCommandId(transcript, { display: '/panel', timestamp: at })).toBe('right-out')
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 23 }, requestId: 'panel' })
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props: { ...props, bodyColumns: 60 }, requestId: 'panel' })
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
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  const before = greps
  // A row coming on screen redraws the pane.
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
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
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('first')
  history += `\n${JSON.stringify({ display: 'second', timestamp: 2, sessionId: 'chat-1' })}`
  await $.prompt.submit({ text: 'second', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('second')
})

test('the wheel scrolls the History list under a fixed header, up to its end; ↑ or a new prompt brings it back up', async ($, on) => {
  const start = Date.now() - 60_000
  let history = Array.from({ length: 30 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: start + i * 1000, sessionId: 'chat-1' })).join('\n')
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  // The day line and 30 prompts; 17 rows show under the tabs, their rule and the header, 16 once
  // scrolled: the back-to-top line takes one.
  const wheel = (by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })

  expect(await ui.find({ key: 'top' })).toBeUndefined()
  await wheel(5)
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeUndefined()
  expect(await ui.find({ key: 'jump:3' })).toBeUndefined()
  expect((await ui.find({ key: 'jump:4' }))?.text).toContain('p25')
  expect(await ui.find({ key: 'jump:20' })).toBeUndefined()
  expect(await ui.find({ key: 'rewind' })).toBeDefined()
  // Only the symbol is the button: hover lights it alone.
  expect((await ui.find({ key: 'top' }))?.text).toBe('↑')

  await wheel(100)
  expect(await ui.find({ key: 'jump:13' })).toBeUndefined()
  expect((await ui.find({ key: 'jump:29' }))?.text).toContain('p0')

  await ui.press({ key: 'top' })
  expect(await ui.find({ type: 'Text', text: 'Today' })).toBeDefined()
  expect(await ui.find({ key: 'top' })).toBeUndefined()

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
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  // On screen in a's turn; the jump never reports it gone.
  const old = await mount('old-1')
  now += 5_000
  const fresh = [await mount('new-1'), await mount('new-2')]
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  const rows = [await mount('b-row')]
  now += 5_000
  rows.push(await mount('collapse-1'))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const top = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 4, last: 9, of: 10 } } })
  const call = { tool_use_id: 'toolu_c1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const group = { calls: [call], isActive: false, isExpanded: false }
  const tools = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'ToolGroup', requestId: 'collapsed-toolu_c1',
    props: { ...group, onScreen: { first: 0, last: 0, of: 2 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const mid = await mount('c-mid', 0)
  const top = await mount('b-top', 3)
  await clock.advance(5_000)
  // A scroll tick: only the top row moves; the middle one redraws as it was.
  await top.redraw({ ...reply, onScreen: { first: 4, last: 9, of: 10 } })
  // The redraw it sets off makes the middle row say where it is again.
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  for (const row of [top, mid]) await row.redraw({ ...reply, onScreen: null })
})

test('a row is looked up in the chat file once, not on every redraw', async ($, on) => {
  const setup = inViewSetup(on, start => ({ 'b-once': start + 15_000 }))
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-once',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const streaming = await mount('not-yet', 0)
  const row = await mount('b-row', 3)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'c-grow',
    props: { ...reply, onScreen: { first: 0, last: 9, of: 10 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-stay',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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

test('/panel runs at once, even while Claude is working', async ($, on) => {
  const registered: { name: string; immediate?: true }[] = []
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })

  expect(registered.find(command => command.name === 'panel')?.immediate).toBe(true)
})

const INTENT = 'mcp__panel__intent'
const REPORT = { wants: 'a third tab', plan: 'write the spec', steps: [{ text: 'spec', status: 'in_progress' }, { text: 'plan', status: 'pending' }] }
// History empty, the pane mounted on the Overview tab.
const intentPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], now?: () => number) => {
  noHistory(on, now)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  on('turn.complete', (_, e) => ({ text: e.answer }) as any)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  expect(await ui.find({ type: 'Text', text: 'write the spec' })).toBeDefined()
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
    { ...agent, id: 'a2', spawnedBy: 'picks' },
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
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
  for (const text of ['a third tab', 'write the spec', /^✓ $/, /^spec$/]) expect(await colorOf(ui, text)).toBe('#4f5c68')
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
    return { value: { tool: `mcp__panel__${e.name}` } } as any
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
    const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component, props: { tool_use_id: 'u1', tool: INTENT, input: REPORT, isRunning: false, isErrored: false, isInterrupted: false, output: 'ok' }, requestId: 'u1' } as any)
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
const overviewHosts = (on: Parameters<TestBody>[1], reply: (n: number) => unknown = () => ({ isAnswered: true, text: TOPICS, usage: {} }), typed = ['add an intent tab', 'ship it']) => {
  const clock = mock.clock(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const lines = typed.map((display, i) => JSON.stringify({ display, timestamp: i + 1, sessionId: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? lines.join('\n') : ''))
  on('ui.panes', () => ({ value: [{ id: 'panel' }] }) as any)
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__panel__${e.name}` } }) as any)
  const asks: { model: string; prompt: string }[] = []
  on('model.complete', (_, e) => {
    const value = reply(asks.push(e as any))
    return (value instanceof Promise ? value.then(answer => ({ value: answer })) : { value }) as any
  })
  return { clock, asks }
}
// Mounted on History, so a test picks Overview when its read should start.
const overviewPane = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], reply?: (n: number) => unknown, typed?: string[]) => {
  const { clock, asks } = overviewHosts(on, reply, typed)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  return { ui, clock, asks }
}
const send = ($: Parameters<TestBody>[0], text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

test('a session starting with the pane open reads TOPICS on the default tab', async ($, on) => {
  const { clock, asks } = overviewHosts(on)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await $.session.start({ source: 'startup', cwd: '/home/me' } as any)
  await clock.settle()
  await ui.drawn()
  expect(asks).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'shipping the branch' })).toBeDefined()
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
})

test('a rule from the text column sets PLAN and STEPS apart', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT, steps: [] } as any)
  await ui.drawn()
  expect(await ui.find({ key: 'rule:PLAN' })).toBeDefined()
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
  // Newest first: topics 11 down to 5.
  expect(await topicShown(ui, 5)).toBe(true)
  expect(await topicShown(ui, 4)).toBe(false)

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: 2, button: 'left', in: 'now' })
  await ui.pointer({ type: 'up', x: 0, y: 2, button: 'left', in: 'now' })

  expect(await topicShown(ui, 3)).toBe(true)
  expect(await topicShown(ui, 2)).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
})

test('the TOPICS divider keeps 1 row on either side', async ($, on) => {
  const ui = await twelveTopics($, on)
  // 14 free rows, 7 of TOPICS: up to 1 of them, down to 1 left for the report.
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: -9, button: 'left', in: 'now' })
  expect(await ui.find({ type: 'Text', text: '↑6', in: 'now' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: -9, button: 'left', in: 'now' })
  expect(await topicShown(ui, 11)).toBe(true)
  expect(await topicShown(ui, 10)).toBe(false)

  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'now' })
  await ui.pointer({ type: 'move', x: 0, y: 20, button: 'left', in: 'now' })
  expect(await ui.find({ type: 'Text', text: '↓12', in: 'now' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 20, button: 'left', in: 'now' })
  expect(await topicShown(ui, 0)).toBe(true)
})

test('the wheel over TOPICS scrolls them under a divider that stays put; ↑ brings them back up', async ($, on) => {
  const ui = await twelveTopics($, on)
  // TOPICS starts on row 5, under the tabs, their rule, the status row, its rule and the header; once
  // scrolled, the back-to-top line takes its first row.
  const wheel = (by: number, row: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row } })

  expect(await ui.find({ key: 'top:topics' })).toBeUndefined()
  await wheel(3, 6)
  expect(await topicShown(ui, 9)).toBe(false)
  expect(await topicShown(ui, 8)).toBe(true)
  expect(await topicShown(ui, 3)).toBe(true)
  expect(await topicShown(ui, 2)).toBe(false)
  expect((await ui.find({ key: 'top:topics' }))?.text).toBe('↑')

  // To the oldest and no further.
  await wheel(100, 6)
  expect(await topicShown(ui, 0)).toBe(true)
  expect(await topicShown(ui, 5)).toBe(true)
  expect(await topicShown(ui, 6)).toBe(false)
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()

  await ui.press({ key: 'top:topics' })
  expect(await topicShown(ui, 11)).toBe(true)
  expect(await ui.find({ key: 'top:topics' })).toBeUndefined()
})

test('a report missing ASK or PLAN keeps the last ones', async ($, on) => {
  const ui = await intentPane($, on)
  await $.tool.call({ tool: INTENT, ...REPORT } as any)
  await $.tool.call({ tool: INTENT, steps: THREE.steps } as any)
  await ui.drawn()
  expect(await ui.find({ type: 'Text', text: 'a third tab' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'write the spec' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0/3 steps' })).toBeDefined()
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

test('the rule asks for a now ping with every later tool message', async ($, on) => {
  const { rule } = await registered($, on)
  expect(rule).toContain('{"now": n}')
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
  expect(await right()).toEqual(['updating…', '2 topics'])
  answer({ isAnswered: false, reason: 'api-error', usage: {} })
  await clock.settle()
  await ui.drawn()
  // A failed read keeps the steps in place and says so on the TOPICS header.
  expect(await right()).toEqual(['0/2 steps', "couldn't read: api-error"])
  // The next read: its state on the status row, the count back on the header.
  await send($, 'another thing')
  await clock.advance(0)
  await ui.drawn()
  expect(await right()).toEqual(['updating…', '2 topics'])
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
  await $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by: 100, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 5 } })
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
    await $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: offset + 3, by: 3, bodyRows: 20, contentRows: 30, origin: { kind: 'person' }, pointer: { column: 0, row } })
  }
  // Row 6 of the window, 10 rows down: the report, not TOPICS.
  await wheel(10, 6)
  expect(await topicShown(ui, 11)).toBe(true)
  // Row 3 of the window, 3 rows down: TOPICS' second row.
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
  const rows = sink(on, 'panel')
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await $.session.end({ reason: 'other' })
  expect(rows().find(r => r.event === 'pane.draw')?.data).toMatchObject({ tab: 'Overview', zones: 'empty' })
})

test('scrolling the History list alone writes no new pane.draw entry', async ($, on) => {
  const start = Date.now() - 60_000
  const history = Array.from({ length: 30 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: start + i * 1000, sessionId: 's1' })).join('\n')
  on('clock.now', () => ({ value: 0 }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  const rows = sink(on, 'panel')
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.redraw()
  const draws = async () => {
    await $.session.end({ reason: 'other' })
    return rows().filter(r => r.event === 'pane.draw' && r.data.tab === 'History')
  }
  const before = (await draws()).length
  expect(before).toBeGreaterThan(0)
  for (const by of [2, 3]) await $.ui.scroll({ component: 'Pane', requestId: 'panel', offset: 0, by, bodyRows: 20, contentRows: 20, origin: { kind: 'person' }, pointer: { column: 0, row: 10 } })
  expect(await ui.find({ key: 'top' })).toBeDefined()
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

// The store a session keeps across sessions, `/panel` and the pane's opens and closes, each open placed or waiting; `opened` and `closed` record the calls.
const openHost = (on: Parameters<TestBody>[1], store: Record<string, unknown> = {}, isPlaced = true) => {
  const seen = { opened: [] as unknown[], closed: [] as unknown[] }
  mock.clock(on)
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('store.get', (_, e) => ({ value: store[e.key] }) as any)
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__panel__${e.name}` } }) as any)
  on('ui.open', (_, e) => {
    seen.opened.push(e)
    return { value: { isPlaced } } as any
  })
  on('ui.panes', () => ({ value: seen.opened.length > seen.closed.length ? [{ id: 'panel', isPlaced }] : [] }) as any)
  on('ui.close', (_, e) => {
    seen.closed.push(e)
    return { value: undefined } as any
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return seen
}
const startHere = { cwd: '/proj', surface: 'terminal' as const, isInteractive: true }
const toggle = ($: Parameters<TestBody>[0]) => $.command.run({ command: 'panel', args: '', origin: { kind: 'composer' } } as any)

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

test('/panel remembers whether it left the pane open', async ($, on) => {
  const store: Record<string, unknown> = {}
  openHost(on, store)
  await $.session.start(startHere)
  await toggle($)
  expect(store.open).toBe(false)
  await toggle($)
  expect(store.open).toBe(true)
})

// No test raises a person's close; another plugin's close takes the same path.
const closer = { name: 'closer', register: (on => { on('command.run', { command: 'close-panel' }, async $ => (await $.ui.close({ id: 'panel' }), {})) }) as Register }
test('closing the pane any way but an unload is remembered', { plugins: [closer] }, async ($, on) => {
  const store: Record<string, unknown> = {}
  openHost(on, store)
  await $.session.start(startHere)
  await $.command.run({ command: 'close-panel', args: '', origin: { kind: 'composer' } } as any)
  expect(store.open).toBe(false)
})

test('/panel shows a pane waiting for room, not closes it', async ($, on) => {
  const store: Record<string, unknown> = {}
  const seen = openHost(on, store, false)
  await $.session.start(startHere)
  await toggle($)
  expect(seen.closed).toHaveLength(0)
  expect(store.open).toBe(true)
})

// The File tab's rows: the body less its header row.
const windowRows = props.scroll.bodyRows - 2 - BAR_ROWS - 2 // header row + its rule
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
// The File tab as `$.panel.show` leaves it: the test's `$` carries no plugin noun, and a hook in a test module that
// calls one is refused ("its hooks module does not call it (host rule; the scan lists no calls)"), so the two
// values `show` writes are answered on read. An empty text stands for a file it could not show.
const fileTab = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], file: ReturnType<typeof fileView> | undefined) => {
  noHistory(on)
  on('state.get', (_$, e, next) => {
    const value = e.key === 'tab' ? 'File' : e.key === 'file' ? file : undefined
    return (value === undefined ? next(e) : { value: { value, version: 1 } }) as any
  })
  return $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
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
