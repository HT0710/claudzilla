// The Git tab's top section, read from git and gh output: no engine calls, so tests feed it text.
import type { Branch, Change, Check, CheckState, CommitView, Conflict, Counts, LogRow, Op, Pr, PrState, PrView, RebaseStep } from '../types'

// `git status --porcelain -b`'s first line: "## main...origin/main [ahead 1, behind 2]".
export const parseHead = (head: string) => {
  const line = head.replace(/^## /, '').replace(/^No commits yet on /, '')
  const detached = line.startsWith('HEAD (no branch)')
  const name = detached ? 'HEAD' : line.replace(/\.\.\.\S+.*$/, '').replace(/ \[.*\]$/, '')
  // Inside the brackets only: a branch may be named "go-ahead".
  const track = / \[(.*)\]$/.exec(line)?.[1] ?? ''
  const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0)
  const upstream: 'ok' | 'local' | 'gone' = track === 'gone' ? 'gone' : line.includes('...') ? 'ok' : 'local'
  return { name, ahead: count('ahead'), behind: count('behind'), upstream, detached }
}

// The one mark after the branch name, only when it needs you: pull, reconcile, or it was deleted on origin.
export const syncMark = (h: ReturnType<typeof parseHead>) =>
  h.upstream === 'gone' ? 'gone' : h.behind && h.ahead ? 'diverged' : h.behind ? 'behind' : undefined

// "5m", "2h", "3d": no space, so a column of ages stays narrow.
export const age = (ms: number, now: number) => {
  const min = Math.floor((now - ms) / 60e3)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

const BAD = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])
const SKIP = new Set(['SKIPPED', 'NEUTRAL'])

const runTime = (from?: string, to?: string) => {
  const s = Math.round((Date.parse(to ?? '') - Date.parse(from ?? '')) / 1000)
  if (!(s >= 0)) return ''
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const check = (c: any): Check => {
  if (c.__typename === 'StatusContext') {
    const state: CheckState = c.state === 'SUCCESS' ? 'ok' : BAD.has(c.state) ? 'bad' : 'run'
    return { state, name: c.context ?? '', time: state === 'run' ? 'running' : '' }
  }
  const state: CheckState = c.status !== 'COMPLETED' ? 'run' : BAD.has(c.conclusion) ? 'bad' : SKIP.has(c.conclusion) ? 'skip' : 'ok'
  const [, run, job] = /\/runs\/(\d+)\/job\/(\d+)/.exec(c.detailsUrl ?? '') ?? []
  const time = state === 'run' ? 'running' : state === 'skip' ? 'skipped' : runTime(c.startedAt, c.completedAt)
  return { state, name: c.name ?? '', time, ...(run && { run, job }) }
}

// `gh pr list --json ...`. A PR from a fork is dropped: `--head` cannot tell owners apart.
export const parsePrs = (json: string): Pr[] => {
  let rows: any[]
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => !r.isCrossRepository)
    .map(r => {
      const state: PrState = r.state === 'MERGED' ? 'merged' : r.state === 'CLOSED' ? 'closed' : r.isDraft ? 'draft' : 'open'
      const when = state === 'merged' ? r.mergedAt : state === 'closed' ? r.closedAt : r.createdAt
      return {
        n: r.number, title: r.title ?? '', state, head: r.headRefName ?? '', base: r.baseRefName ?? '', author: r.author?.login ?? '',
        at: Date.parse(when ?? '') || 0, additions: r.additions ?? 0, deletions: r.deletions ?? 0, files: r.changedFiles ?? 0,
        conflicting: r.mergeable === 'CONFLICTING', checks: (r.statusCheckRollup ?? []).map(check), url: r.url ?? '',
      }
    })
}

const RANK: Record<CheckState, number> = { bad: 0, run: 1, ok: 2, skip: 3 }
// Problems first, so a capped list never hides what needs you; gh's order within a state.
export const sortChecks = (checks: Check[]) => [...checks].sort((a, b) => RANK[a.state] - RANK[b.state])
export const worst = (checks: Check[]): CheckState => sortChecks(checks)[0]?.state ?? 'ok'

const isOpen = (pr: Pr) => pr.state === 'open' || pr.state === 'draft'
const newest = (a: Pr, b: Pr) => b.at - a.at
// This branch's open PRs, newest first; with none, the newest that ended, as a sign the branch is finished.
export const ownPrs = (prs: Pr[], branch: string) => {
  const mine = prs.filter(pr => pr.head === branch)
  const open = mine.filter(isOpen).sort(newest)
  return open.length ? open : mine.sort(newest).slice(0, 1)
}
export const incomingPrs = (prs: Pr[], branch: string) => prs.filter(pr => pr.base === branch && isOpen(pr)).sort(newest)

// `git stash list --format=%gs`: "WIP on feat/x: ..." or "On feat/x: ...".
export const stashCount = (list: string, branch: string) =>
  list.split('\n').filter(line => line.startsWith(`WIP on ${branch}:`) || line.startsWith(`On ${branch}:`)).length

// "pick <sha> # <subject>" lines of rebase-merge/done and git-rebase-todo; exec, break and comments have no sha.
const todoLines = (text: string) =>
  text.split('\n').flatMap(line => {
    const m = /^(\w+) ([0-9a-f]{7,40}) (?:# )?(.*)$/.exec(line)
    return m ? [{ cmd: m[1]!, sha: m[2]!.slice(0, 7), subject: m[3]! }] : []
  })

// `git diff --numstat`: a conflicted path prints a combined row first, so the last row per path wins.
const numstat = (text: string) => {
  const rows = new Map<string, Conflict>()
  for (const line of text.split('\n')) {
    const [add, del, path] = line.split('\t')
    if (path) rows.set(path, { path, additions: Number(add) || 0, deletions: Number(del) || 0 })
  }
  return rows
}

// The files git stopped on, with their line counts; once none is unmerged, the staged ones, which hold the fixes.
const conflicts = (unmerged: string, unstaged: string, cached: string) => {
  const paths = unmerged.split('\n').filter(Boolean)
  const counts = numstat(unstaged)
  if (paths.length) return { conflicts: paths.map(path => counts.get(path) ?? { path, additions: 0, deletions: 0 }), resolved: false }
  return { conflicts: [...numstat(cached).values()], resolved: true }
}

export const parseRebase = (f: { headName: string; onto: string; done: string; todo: string; numstat: string; cached: string; unmerged: string }): Extract<Op, { kind: 'rebase' }> => {
  const done = todoLines(f.done)
  const at = done.length - 1
  const edit = /^e(dit)?$/.test(done[at]?.cmd ?? '')
  const files = conflicts(f.unmerged, f.numstat, f.cached)
  const steps: RebaseStep[] = [
    ...done.map((s, i) => ({ sha: s.sha, subject: s.subject, mark: i === at ? ('stop' as const) : ('done' as const) })),
    ...todoLines(f.todo).map(s => ({ sha: s.sha, subject: s.subject, mark: 'todo' as const })),
  ]
  return {
    kind: 'rebase', head: f.headName.trim().replace(/^refs\/heads\//, ''), onto: f.onto.trim(), steps, at, edit,
    ...(edit ? { conflicts: [], resolved: false } : files),
  }
}

// `log`: `git log --format=%h%x09%s%x09%ct HEAD..MERGE_HEAD`.
export const parseMerge = (f: { msg: string; sha: string; log: string; numstat: string; cached: string; unmerged: string; head: string }): Extract<Op, { kind: 'merge' }> => ({
  kind: 'merge',
  head: f.head,
  from: /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(f.msg)?.[1] ?? f.sha.trim().slice(0, 7),
  sha: f.sha.trim().slice(0, 7),
  incoming: f.log.split('\n').filter(Boolean).map(line => {
    const [, subject = '', at = '0'] = line.split('\t')
    return { subject, at: Number(at) * 1000 }
  }),
  ...conflicts(f.unmerged, f.numstat, f.cached),
})

// `refs`: `git for-each-ref refs/heads --format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)`.
// A branch sits under its newest PR's base, else the default branch: git keeps no record of where it was made.
// `worktrees`: `git worktree list --porcelain`; its first entry is the main one, not a linked worktree.
export const branches = (refs: string, prs: Pr[], worktrees: string, defaultBranch: string): Branch[] => {
  const linked = new Set(
    worktrees
      .split('\n\n')
      .slice(1)
      .map(block => /^branch refs\/heads\/(.+)$/m.exec(block)?.[1])
      .filter(Boolean),
  )
  return refs
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name = '', upstream = '', track = '', unix = '0'] = line.split('\t')
      const pr = ownPrs(prs, name)[0]
      const count = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(track)?.[1] ?? 0)
      return {
        name,
        base: pr?.base ?? (name === defaultBranch ? undefined : defaultBranch),
        ahead: count('ahead'),
        behind: count('behind'),
        upstream: !upstream ? 'local' : track === '[gone]' ? 'gone' : 'ok',
        ...(pr && { pr }),
        worktree: linked.has(name),
        at: Number(unix) * 1000,
      }
    })
}

export type TreeRow = { guide: string; label: string; branch?: Branch; heading?: string }

// The branch modal's rows: each branch under its base with tree guides, or grouped by prefix, unprefixed last.
// A branch whose base is hidden or not local starts its own tree.
export const treeRows = (list: Branch[], by: 'base' | 'prefix', showMerged: boolean): TreeRow[] => {
  const shown = list.filter(b => showMerged || b.pr?.state !== 'merged')
  const names = new Set(shown.map(b => b.name))
  const rows: TreeRow[] = []
  if (by === 'base') {
    const walk = (parent: string, pre: string) =>
      shown
        .filter(b => b.base === parent)
        .forEach((b, i, all) => {
          const last = i === all.length - 1
          rows.push({ guide: pre + (last ? '└─ ' : '├─ '), label: b.name, branch: b })
          walk(b.name, pre + (last ? '   ' : '│  '))
        })
    shown
      .filter(b => !b.base || !names.has(b.base))
      .forEach(b => {
        rows.push({ guide: '', label: b.name, branch: b })
        walk(b.name, '')
      })
    return rows
  }
  const groups = new Map<string, Branch[]>()
  for (const b of shown) {
    const key = b.name.includes('/') ? b.name.slice(0, b.name.indexOf('/') + 1) : ''
    groups.set(key, [...(groups.get(key) ?? []), b])
  }
  ;[...groups.entries()]
    .sort(([a], [b]) => Number(a === '') - Number(b === '') || a.localeCompare(b))
    .forEach(([key, bs]) => {
      if (!key) return bs.forEach(b => rows.push({ guide: '', label: b.name, branch: b }))
      rows.push({ guide: '', label: key, heading: key })
      bs.forEach((b, i) => rows.push({ guide: i === bs.length - 1 ? '└─ ' : '├─ ', label: b.name.slice(key.length), branch: b }))
    })
  return rows
}

const CHANGE: Record<string, string> = { MODIFIED: 'M', ADDED: 'A', DELETED: 'D', RENAMED: 'R', COPIED: 'C' }
// `gh pr view <n> --json body,commits,files`; anything else reads as none.
export const parsePrView = (json: string): PrView | undefined => {
  try {
    const v = JSON.parse(json)
    return {
      body: v.body ?? '',
      commits: (v.commits ?? []).map((c: any) => ({ subject: c.messageHeadline ?? '', at: Date.parse(c.committedDate ?? '') || 0 })),
      files: (v.files ?? []).map((f: any) => ({ path: f.path ?? '', status: CHANGE[f.changeType] ?? 'M', additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
    }
  } catch {
    return undefined
  }
}

// A path that does not fit loses its middle, so the file name stays: plugins/…/register.tsx.
export const cutMiddle = (path: string, room: number) => {
  if (path.length <= room) return path
  const tail = path.slice(path.lastIndexOf('/'))
  return `${path.slice(0, Math.max(1, room - tail.length - 1))}…${tail}`.slice(-room)
}

const WORD: Record<string, Change['word']> = { M: 'modified', T: 'modified', A: 'added', C: 'added', D: 'deleted', R: 'renamed', U: 'conflict', '?': 'untracked' }
// One `status --porcelain -z` record, a rename's old path beside it. A conflict is U whatever git pairs it with (UU,
// AA, DD, UD...); else the worktree's letter while it has unstaged changes, bright, else the index letter, staged,
// dim. A rename shows its new name.
export const changeOf = (line: string, from?: string): Change => {
  const xy = line.slice(0, 2)
  const path = line.slice(3)
  const conflict = xy.includes('U') || xy === 'AA' || xy === 'DD'
  const untracked = xy === '??'
  const staged = !conflict && !untracked && line[1] === ' '
  const letter = conflict ? 'U' : untracked ? '?' : staged ? line[0]! : line[1]!
  const stage = conflict || untracked ? undefined : staged ? 'staged' : line[0] === ' ' ? 'not staged' : 'staged + not staged'
  return { path, ...(from !== undefined && { from }), letter, dim: staged, word: WORD[letter] ?? 'modified', stage }
}

// `git diff --numstat -z -M`: "a\td\tpath\0", or for a rename "a\td\t\0old\0new\0"; a binary file counts "-".
// `status --porcelain -b -z`: the branch head, then each change; -z leaves paths unquoted, and a rename's old path
// is the next record.
export const parseStatusZ = (z: string): { head?: string; changes: Change[] } => {
  const records = z.split('\0')
  const head = records[0]?.startsWith('## ') ? records.shift() : undefined
  const changes: Change[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!
    if (record.length < 4) continue
    changes.push(/[RC]/.test(record[0]!) ? changeOf(record, records[++i]) : changeOf(record))
  }
  return { head, changes }
}

export const parseNumstat = (z: string) => {
  const out = new Map<string, Counts>()
  const parts = z.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const [add, del, path] = parts[i]!.split('\t')
    if (del === undefined) continue
    const name = path || (i += 2, parts[i])
    if (name) out.set(name, add === '-' ? 'bin' : { add: Number(add), del: Number(del) })
  }
  return out
}

export const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%s'
export const parseLog = (stdout: string): LogRow[] =>
  stdout.split('\n').filter(Boolean).map(line => {
    const [full = '', short = '', author = '', ct = '', decor = '', ...subject] = line.split('\x1f')
    // Full names (--decorate=full) tell a local branch from a remote one: refs/heads/<b>, refs/remotes/<r>/<b>.
    const names = decor ? decor.split(', ').map(name => name.replace(/^HEAD -> /, '')).filter(name => name !== 'HEAD' && !name.endsWith('/HEAD')) : []
    return {
      full, short, author, at: Number(ct) * 1000,
      refs: names.flatMap(name => {
        if (name.startsWith('refs/heads/')) return [{ remote: '', branch: name.slice(11) }]
        const [, remote = '', branch = ''] = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(name) ?? []
        return remote ? [{ remote, branch }] : []
      }),
      tags: names.filter(name => name.startsWith('tag: refs/tags/')).map(name => name.slice(15)),
      subject: subject.join('\x1f'),
    }
  })

// `git log --shortstat --format=%x1e%H`: per commit, its file count and line counts.
export const parseShortstat = (stdout: string) => {
  const out = new Map<string, { files: number; add: number; del: number }>()
  for (const chunk of stdout.split('\x1e').filter(Boolean)) {
    const [sha = '', ...rest] = chunk.split('\n')
    const text = rest.join(' ')
    const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0)
    out.set(sha.trim(), { files: num(/(\d+) files? changed/), add: num(/(\d+) insertions?/), del: num(/(\d+) deletions?/) })
  }
  return out
}

// `git show -s --format=%B`, `--name-status -z -M` and `--numstat -z -M` of one commit: the body after the subject,
// and each file with its status letter and line counts.
export const parseCommitView = (message: string, nameStatusZ: string, numstatZ: string): CommitView => {
  const counts = parseNumstat(numstatZ)
  const files: CommitView['files'] = []
  const parts = nameStatusZ.split('\0')
  for (let i = 0; i < parts.length - 1; i++) {
    const status = parts[i]![0]!
    const path = /[RC]/.test(status) ? (i += 2, parts[i]!) : parts[++i]!
    const c = counts.get(path)
    files.push({ path, status, additions: c && c !== 'bin' ? c.add : 0, deletions: c && c !== 'bin' ? c.del : 0 })
  }
  return { body: message.split('\n').slice(1).join('\n').trim(), files }
}

// A CHANGES row's key: the engine takes hover scopes of at most 64 characters, so a long path goes by its FNV-1a hash.
export const fileKey = (path: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193)
  return `f:${(h >>> 0).toString(16).padStart(8, '0')}`
}
