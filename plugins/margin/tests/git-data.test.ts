import { expect, test } from 'claude-code/testing'
import type { Check, CheckState, Pr, PrState } from '../types'

import { age, branches, changeOf, cutMiddle, parseStatusZ, ownPrs, parseCommitView, parseHead, parseLog, parseNumstat, parseShortstat, parseMerge, parsePrView, parsePrs, parseRebase, sortChecks, stashCount, syncMark, treeRows, worktrees } from '../hooks/git-data'

// A gh pr list row with every field the parser reads.
const fixture = (over: Record<string, unknown> = {}) => ({
  number: 1, title: 'feat: x', state: 'OPEN', isDraft: false, headRefName: 'feat/x', baseRefName: 'main', isCrossRepository: false,
  author: { login: 'HT0710' }, createdAt: '2026-11-02T00:00:00Z', mergedAt: null, closedAt: null,
  additions: 1, deletions: 0, changedFiles: 1, mergeable: 'MERGEABLE', statusCheckRollup: [], url: 'https://github.com/o/r/pull/1',
  ...over,
})
const base: Pr = { n: 0, title: '', state: 'open', head: '', base: 'main', author: '', at: 0, additions: 0, deletions: 0, files: 0, conflicting: false, checks: [], url: '' }

test('HEAD line: name, sync and detached', () => {
  expect(parseHead('## feat/x...origin/feat/x [ahead 2, behind 1]')).toEqual({ name: 'feat/x', ahead: 2, behind: 1, upstream: 'ok', detached: false })
  expect(parseHead('## go-ahead')).toEqual({ name: 'go-ahead', ahead: 0, behind: 0, upstream: 'local', detached: false })
  expect(parseHead('## old...origin/old [gone]').upstream).toBe('gone')
  expect(parseHead('## HEAD (no branch)')).toMatchObject({ name: 'HEAD', detached: true })
})

test('the branch mark shows only when the branch needs you', () => {
  expect(syncMark(parseHead('## a...origin/a [ahead 2]'))).toBeUndefined()
  expect(syncMark(parseHead('## a...origin/a [behind 3]'))).toBe('behind')
  expect(syncMark(parseHead('## a...origin/a [ahead 2, behind 1]'))).toBe('diverged')
  expect(syncMark(parseHead('## a...origin/a [gone]'))).toBe('gone')
})

test('ages', () => {
  expect(age(0, 5 * 60e3)).toBe('5m')
  expect(age(0, 2 * 3600e3)).toBe('2h')
  expect(age(0, 3 * 86400e3)).toBe('3d')
})

test('gh checks map to four states with a run time', () => {
  const [pr] = parsePrs(JSON.stringify([fixture({ statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-11-02T06:38:40Z', completedAt: '2026-11-02T06:39:45Z', detailsUrl: 'https://github.com/o/r/actions/runs/41/job/125' },
    { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '', startedAt: '2026-11-02T06:38:40Z', detailsUrl: '' },
    { __typename: 'CheckRun', name: 'release', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: '' },
    { __typename: 'StatusContext', context: 'ci/x', state: 'SUCCESS' },
  ] })]))
  expect(pr!.checks.map(c => [c.state, c.name, c.time])).toEqual([['bad', 'test', '1m05s'], ['run', 'lint', 'running'], ['skip', 'release', 'skipped'], ['ok', 'ci/x', '']])
  expect(pr!.checks[0]).toMatchObject({ run: '41', job: '125' })
})

test('PR state, time and conflicts', () => {
  const prs = parsePrs(JSON.stringify([
    fixture({ number: 1, state: 'OPEN', isDraft: true, createdAt: '2026-11-02T00:00:00Z', mergeable: 'CONFLICTING' }),
    fixture({ number: 2, state: 'MERGED', mergedAt: '2026-11-02T01:00:00Z' }),
  ]))
  expect(prs.map(p => [p.n, p.state, p.at, p.conflicting])).toEqual([[1, 'draft', Date.parse('2026-11-02T00:00:00Z'), true], [2, 'merged', Date.parse('2026-11-02T01:00:00Z'), false]])
  expect(prs[0]).toMatchObject({ head: 'feat/x', base: 'main', author: 'HT0710', additions: 1, files: 1, url: 'https://github.com/o/r/pull/1' })
})

test('cross-repository PRs are dropped; bad JSON gives none', () => {
  expect(parsePrs(JSON.stringify([fixture({ isCrossRepository: true })]))).toEqual([])
  expect(parsePrs('not json')).toEqual([])
})

test('checks sort failed, running, passed, skipped', () => {
  const c = (state: CheckState, name: string): Check => ({ state, name, time: '' })
  expect(sortChecks([c('ok', 'a'), c('skip', 'b'), c('run', 'c'), c('bad', 'd'), c('ok', 'e')]).map(x => x.name)).toEqual(['d', 'c', 'a', 'e', 'b'])
})

test('own PRs: open first, else the newest ended one', () => {
  const p = (n: number, state: PrState, at: number): Pr => ({ ...base, n, state, at, head: 'feat/x' })
  expect(ownPrs([p(1, 'merged', 5), p(2, 'closed', 9)], 'feat/x').map(x => x.n)).toEqual([2])
  expect(ownPrs([p(1, 'merged', 5), p(3, 'open', 1), p(4, 'draft', 2)], 'feat/x').map(x => x.n)).toEqual([4, 3])
  expect(ownPrs([], 'feat/x')).toEqual([])
})

test('stashes on this branch', () => {
  expect(stashCount('WIP on feat/x: abc msg\nOn feat/x: mine\nWIP on main: def\n', 'feat/x')).toBe(2)
})

// Captured from git 2.x on 2026-11-02: an interactive rebase of three commits onto release/1.7.
const HEAD_NAME = 'refs/heads/feat/x\n'
const ONTO = '5e7dbcbb8a85c012da009d6523d686489df6d25f\n'
const ONE = 'edit 0fdeb40b376e9b92da0373dcca03f5a92cbfc87b # feat(x): one\n'
const TWO = 'pick fa24b8c2ed64c78d08a1d945090c1ff0e3df3562 # feat(x): two\n'
const THREE = 'pick 16d77eae9ea6fe20267414c89994256bd2fa74b8 # docs(x): three\n'

test('a conflict stop: steps marked done, stop, todo; head from head-name', () => {
  const op = parseRebase({ headName: HEAD_NAME, onto: ONTO, done: ONE + TWO, todo: THREE, numstat: '0\t0\tf.txt\n4\t0\tf.txt\n', cached: '', unmerged: 'f.txt\n' })
  expect(op).toMatchObject({ kind: 'rebase', head: 'feat/x', onto: '5e7dbcbb8a85c012da009d6523d686489df6d25f', at: 1, edit: false, resolved: false })
  expect(op.steps).toEqual([
    { sha: '0fdeb40', subject: 'feat(x): one', mark: 'done' },
    { sha: 'fa24b8c', subject: 'feat(x): two', mark: 'stop' },
    { sha: '16d77ea', subject: 'docs(x): three', mark: 'todo' },
  ])
  expect(op.conflicts).toEqual([{ path: 'f.txt', additions: 4, deletions: 0 }])
})

test('an edit stop is marked edit, with no conflicts', () => {
  const op = parseRebase({ headName: HEAD_NAME, onto: ONTO, done: ONE, todo: TWO + THREE, numstat: '', cached: '', unmerged: '' })
  expect(op).toMatchObject({ at: 0, edit: true, conflicts: [], resolved: false })
})

test('resolved conflicts read as resolved, from the staged files', () => {
  const op = parseRebase({ headName: HEAD_NAME, onto: ONTO, done: ONE + TWO, todo: THREE, numstat: '', cached: '1\t1\tf.txt\n', unmerged: '' })
  expect(op).toMatchObject({ resolved: true, conflicts: [{ path: 'f.txt', additions: 1, deletions: 1 }] })
})

test('a merge reads the branch from MERGE_MSG and its incoming commits', () => {
  const op = parseMerge({ msg: "Merge branch 'release/1.7' into feat/x\n\n# Conflicts:\n", sha: '5e7dbcbb8a85c012da009d6523d686489df6d25f\n', log: '5e7dbcb\tfix: upper b\t1793603824\n', numstat: '0\t0\tf.txt\n4\t0\tf.txt\n', cached: '', unmerged: 'f.txt\n', head: 'feat/x' })
  expect(op).toEqual({ kind: 'merge', head: 'feat/x', from: 'release/1.7', sha: '5e7dbcb', incoming: [{ subject: 'fix: upper b', at: 1793603824000 }], conflicts: [{ path: 'f.txt', additions: 4, deletions: 0 }], resolved: false })
})

test('detached HEAD with no op files reads as detached only', () => {
  expect(parseHead('## HEAD (no branch)').detached).toBe(true)
})

const REFS = [
  'main\torigin/main\t\t1790000000',
  'release/1.7\torigin/release/1.7\t\t1790000000',
  'feat/a\torigin/feat/a\t[ahead 2, behind 1]\t1790000000',
  'fix/b\t\t\t1790000000',
  'feat/old\torigin/feat/old\t[gone]\t1790000000',
  'wip\t\t\t1790000000',
].join('\n')
const PRS: Pr[] = [
  { ...base, n: 5, head: 'feat/a', base: 'release/1.7', state: 'open', at: 2 },
  { ...base, n: 3, head: 'release/1.7', base: 'main', state: 'open', at: 1 },
  { ...base, n: 2, head: 'feat/old', base: 'release/1.7', state: 'merged', at: 1 },
]
const WORKTREES = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r-b\nHEAD def\nbranch refs/heads/fix/b\n'

test("a branch's base is its newest PR's base, else the default branch; the default branch has none", () => {
  const list = branches(REFS, PRS, WORKTREES, 'main')
  expect(list.map(b => [b.name, b.base])).toEqual([['main', undefined], ['release/1.7', 'main'], ['feat/a', 'release/1.7'], ['fix/b', 'main'], ['feat/old', 'release/1.7'], ['wip', 'main']])
  expect(list[2]).toMatchObject({ ahead: 2, behind: 1, upstream: 'ok', at: 1790000000000 })
  expect(list.map(b => b.upstream)).toEqual(['ok', 'ok', 'ok', 'local', 'gone', 'local'])
})

test('a linked worktree marks its branch; the main one does not', () => {
  expect(branches(REFS, PRS, WORKTREES, 'main').filter(b => b.worktree).map(b => b.name)).toEqual(['fix/b'])
})

test('worktrees: main first, then branch, detached id or gone folder', () => {
  const list = `${WORKTREES}\nworktree /r-c\nHEAD 0123456789abcdef\ndetached\n\nworktree /r-d\nHEAD fed\nbranch refs/heads/feat/d\nprunable gitdir file points to non-existent location\n`
  expect(worktrees(list)).toEqual([
    { path: '/r', branch: 'main', head: 'abc', gone: false },
    { path: '/r-b', branch: 'fix/b', head: 'def', gone: false },
    { path: '/r-c', branch: undefined, head: '0123456789abcdef', gone: false },
    { path: '/r-d', branch: 'feat/d', head: 'fed', gone: true },
  ])
  expect(worktrees('')).toEqual([])
})

test('base view nests with ├─ └─ │ guides; merged hidden until shown', () => {
  const rows = (showMerged: boolean) => treeRows(branches(REFS, PRS, WORKTREES, 'main'), 'base', showMerged).map(r => r.guide + r.label)
  expect(rows(false)).toEqual(['main', '├─ release/1.7', '│  └─ feat/a', '├─ fix/b', '└─ wip'])
  expect(rows(true)).toEqual(['main', '├─ release/1.7', '│  ├─ feat/a', '│  └─ feat/old', '├─ fix/b', '└─ wip'])
})

test('prefix view groups by the part before /, unprefixed branches last', () => {
  const rows = treeRows(branches(REFS, PRS, WORKTREES, 'main'), 'prefix', false)
  expect(rows.map(r => r.guide + r.label)).toEqual(['feat/', '└─ a', 'fix/', '└─ b', 'release/', '└─ 1.7', 'main', 'wip'])
  expect(rows[0]).toMatchObject({ heading: 'feat/' })
  expect(rows[1]?.branch?.name).toBe('feat/a')
})

test('a PR view: body, commit subjects with times, files with status letters', () => {
  const view = parsePrView(JSON.stringify({
    body: 'Why: x',
    commits: [{ messageHeadline: 'fix(a): b', committedDate: '2026-11-02T06:36:54Z' }],
    files: [{ path: 'GUIDE.md', additions: 1, deletions: 2, changeType: 'MODIFIED' }, { path: 'n.ts', additions: 3, deletions: 0, changeType: 'ADDED' }],
  }))
  expect(view).toEqual({
    body: 'Why: x',
    commits: [{ subject: 'fix(a): b', at: Date.parse('2026-11-02T06:36:54Z') }],
    files: [{ path: 'GUIDE.md', status: 'M', additions: 1, deletions: 2 }, { path: 'n.ts', status: 'A', additions: 3, deletions: 0 }],
  })
  expect(parsePrView('nope')).toBeUndefined()
})

test('a path that does not fit loses its middle, keeping the file name', () => {
  expect(cutMiddle('plugins/margin/hooks/register.tsx', 40)).toBe('plugins/margin/hooks/register.tsx')
  expect(cutMiddle('plugins/margin/hooks/register.tsx', 22)).toBe('plugins/…/register.tsx')
  expect(cutMiddle('plugins/margin/hooks/register.tsx', 22).length).toBe(22)
})

test('changeOf: conflict, staged, unstaged, both, untracked, rename', () => {
  expect(changeOf('UU conflict.ts')).toMatchObject({ letter: 'U', word: 'conflict', stage: [], dim: false })
  expect(changeOf('M  GUIDE.md')).toMatchObject({ letter: 'M', stage: ['staged'], dim: true })
  expect(changeOf(' M a.ts')).toMatchObject({ letter: 'M', stage: ['not staged'], dim: false })
  expect(changeOf('MM a.ts')).toMatchObject({ letter: 'M', stage: ['staged', 'not staged'], dim: false })
  expect(changeOf('?? new file.ts')).toMatchObject({ letter: '?', word: 'untracked', path: 'new file.ts', stage: [] })
  expect(changeOf('R  docs/git-tab.md')).toMatchObject({ letter: 'R', word: 'renamed', path: 'docs/git-tab.md', stage: ['staged'] })
  expect(changeOf('AM a.ts')).toMatchObject({ letter: 'M', word: 'modified', stage: ['staged', 'not staged'] })
  expect(changeOf('RM a.ts')).toMatchObject({ letter: 'M', word: 'modified', stage: ['staged', 'not staged'] })
  expect(changeOf(' D a.ts')).toMatchObject({ letter: 'D', word: 'deleted', stage: ['not staged'] })
  expect(changeOf('AD a.ts')).toMatchObject({ letter: 'D', word: 'deleted', stage: ['staged', 'not staged'] })
})

test('parseNumstat: rename and space', () => {
  const m = parseNumstat('3\t1\tGUIDE.md\0' + '2\t2\t\0docs/git.md\0docs/git tab.md\0' + '-\t-\tlogo.png\0')
  expect(m.get('docs/git tab.md')).toEqual({ add: 2, del: 2 })
  expect(m.get('logo.png')).toBe('bin')
  expect(m.get('GUIDE.md')).toEqual({ add: 3, del: 1 })
})

test('parseLog: full ref names split into local and remote branches and tags, HEAD dropped', () => {
  const decor = 'HEAD -> refs/heads/feat/x, refs/remotes/origin/feat/x, tag: refs/tags/v1.6.0, refs/stash'
  const [row] = parseLog(['f'.repeat(40), 'fffffff', 'HT0710', '1790000000', decor, 'feat(margin): PR section'].join('\x1f') + '\n')
  expect(row).toEqual({ full: 'f'.repeat(40), short: 'fffffff', author: 'HT0710', at: 1790000000000, refs: [{ remote: '', branch: 'feat/x' }, { remote: 'origin', branch: 'feat/x' }], tags: ['v1.6.0'], subject: 'feat(margin): PR section' })
})

test('parseShortstat: merge counted against first parent', () => {
  const out = '\x1eaaa\n\n 2 files changed, 80 insertions(+), 4 deletions(-)\n\x1ebbb\n\n 1 file changed, 3 deletions(-)\n'
  expect(parseShortstat(out).get('aaa')).toEqual({ files: 2, add: 80, del: 4 })
  expect(parseShortstat(out).get('bbb')).toEqual({ files: 1, add: 0, del: 3 })
})

test('parseCommitView: body, files with status and counts', () => {
  const v = parseCommitView('feat: x\n\nWhy it moved.\n', 'M\0a.ts\0R100\0b.md\0c.md\0', '5\t1\ta.ts\0' + '0\t0\t\0b.md\0c.md\0')
  expect(v).toEqual({ body: 'Why it moved.', files: [{ path: 'a.ts', status: 'M', additions: 5, deletions: 1 }, { path: 'c.md', status: 'R', additions: 0, deletions: 0 }] })
})

test('parseLog: a remote HEAD is no ref', () => {
  const [row] = parseLog(['c'.repeat(40), 'ccccccc', 'HT0710', '1790000000', 'refs/remotes/origin/HEAD, refs/remotes/origin/main, refs/heads/main', 'feat: x'].join('\x1f') + '\n')
  expect(row?.refs).toEqual([{ remote: 'origin', branch: 'main' }, { remote: '', branch: 'main' }])
})

test('parseStatusZ: head, then changes; a rename skips the old path in the next record; spaces stay unquoted', () => {
  const { head, changes } = parseStatusZ('## b...origin/b\0 M a b.ts\0R  new name.md\0old name.md\0?? x.ts\0')
  expect(head).toBe('## b...origin/b')
  expect(changes.map(c => [c.letter, c.path])).toEqual([['M', 'a b.ts'], ['R', 'new name.md'], ['?', 'x.ts']])
})

test('control characters in a check name, a rebase subject and a merge subject read as spaces', () => {
  const pr = parsePrs(JSON.stringify([{ number: 1, title: '', state: 'OPEN', headRefName: 'a', baseRefName: 'b', author: { login: 'x' }, statusCheckRollup: [{ __typename: 'CheckRun', name: 'te\x1bst', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'StatusContext', context: 'ci\x07x', state: 'SUCCESS' }] }]))[0]!
  expect(pr.checks.map(c => c.name)).toEqual(['te st', 'ci x'])
  const op = parseRebase({ headName: 'refs/heads/x\n', onto: 'a\n', done: 'pick abc1234 # do\x1bne\n', todo: 'pick def5678 # to\x1bdo\n', numstat: '', cached: '', unmerged: '' })
  expect(op.steps.map(s => s.subject)).toEqual(['do ne', 'to do'])
  const merge = parseMerge({ msg: '', sha: 'abc1234\n', log: 'abc1234\tin\x1bcoming\t1\n', numstat: '', cached: '', unmerged: '', head: 'x' })
  expect(merge.incoming[0]!.subject).toBe('in coming')
})

test('a control character in an author reads as a space', () => {
  expect(parseLog('abc\x1fa\x1fHT\x1b0710\x1f1\x1f\x1fsub\n')[0]!.author).toBe('HT 0710')
})

test('a conflict on an edit step reads as a conflict, not an edit stop', () => {
  const op = parseRebase({ headName: HEAD_NAME, onto: ONTO, done: ONE, todo: TWO, numstat: '0\t0\tf.txt\n4\t0\tf.txt\n', cached: '', unmerged: 'f.txt\n' })
  expect(op).toMatchObject({ edit: false, resolved: false })
  expect(op.conflicts.length).toBe(1)
})
