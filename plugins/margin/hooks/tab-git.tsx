import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Check, CheckState, CommitView, Counts, FileView, Gh, LogRow, Modal, ModalKey, Op, Pr, PrState, PrView, Stage, Word } from '../types'
import { LOG_FORMAT, age, ago, branches, cutMiddle, fileKey, incomingPrs, ownPrs, parseHead, parseLog, parseMerge, parseNumstat, parseRebase, parseShortstat, parseStatusZ, printable, sortChecks, stashCount, syncMark, treeRows, worktrees, worst } from './git-data'
import { AHEAD, BAR_ROWS, BEHIND, DIMMED, HUD, LIT, PAD, PILL_BG, PILL_CAPS, SCOPE, STATUS, TYPES, capped, card as kitCard, clock, configDir, contentFrame, cues, dayName, dim, drawLayer as kitDrawLayer, emptyNote, fade, fadeBg, fileView, fit, heading as kitHeading, kv as kitKv, line as kitLine, modalFrame, modalZone, nudge, readTheme, row as kitRow, rowHover, stackFrame, textLength, toPieces, zoneWindow } from './kit'
import type { Frame, Layer, LayerCtx, Piece, RowCtx, TabCtx, TabDraw, Zone } from './kit'
import { mdRows } from './markdown'

const submitted = atom({ plugin: 'margin', key: 'submitted' } as const, 0)
const toolCalls = atom({ plugin: 'margin', key: 'toolCalls' } as const, 0)
const rowPointer = atom({ plugin: 'margin', key: 'rowPointer' } as const, { left: null, at: null } as { left: string | null; at: string | null })
const split = atom({ plugin: 'margin', key: 'split' } as const, -1)
// The first row each Git zone shows, as the wheel moved it.
const scrolled = atom({ plugin: 'margin', key: 'scrolled' } as const, { changes: 0, commits: 0 })
// What the File tab shows: the last one, the whole text.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as FileView)
const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)
// While `git fetch origin` runs from the branch row.
const fetching = atom({ plugin: 'margin', key: 'fetching' } as const, false)
// The branch modal's tree: by the branch each was made from, or by prefix; merged branches shown or not.
const branchView = atom({ plugin: 'margin', key: 'branchView' } as const, { by: 'base' as 'base' | 'prefix' | 'worktrees', showMerged: false })
const gh = atom({ plugin: 'margin', key: 'gh' } as const, { at: 0, remote: '', prs: [] } as Gh)
const prViews = atom({ plugin: 'margin', key: 'prViews' } as const, {} as Record<number, PrView>)
const commitViews = atom({ plugin: 'margin', key: 'commitViews' } as const, {} as Record<string, { row: LogRow; view?: CommitView }>)

// COMMITS reads this many at a time, the next page once scrolled past: git walks every commit it
// skips (210 ms at 100k), so a read per wheel tick would lag.
const PAGE = 100
// While a rebase or merge action runs: a press in that time starts no second one.
let gitActing = false
// Each host's commit and branch page paths, as its router writes them (Codeberg's: Gitea's). A host not
// listed gets no links: a guessed path would open a wrong page.
const WEB_PATHS: Record<string, { commit: string; branch: string }> = {
  'github.com': { commit: 'commit', branch: 'tree' },
  'gitlab.com': { commit: '-/commit', branch: '-/tree' },
  'codeberg.org': { commit: 'commit', branch: 'src/branch' },
  'git.sr.ht': { commit: 'commit', branch: 'tree' },
}
// A remote's web pages: "git@github.com:o/r.git", "https://user@host/o/r", "ssh://git@host:22/o/r".
export const gitWeb = (remote: string) => {
  const url = remote.trim()
  const [, host = '', path = ''] =
    /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url) ?? /^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/.exec(url) ?? []
  const paths = WEB_PATHS[host.toLowerCase()]
  if (!paths) return undefined
  const base = `https://${host.toLowerCase()}/${path}`
  return {
    commit: (sha: string) => `${base}/${paths.commit}/${sha}`,
    // Slashes kept: "release/1.5" is one branch.
    branch: (name: string) => `${base}/${paths.branch}/${name.split('/').map(encodeURIComponent).join('/')}`,
  }
}
// The Git tab's reads, in the session's folder, which follows a shell `cd`. No optional locks: a
// status run beside the model's own git command must not hold index.lock.
function readGit($: EngineInterface) {
  return Promise.all([
    // quotePath off: a non-ASCII path reads as itself, not octal escapes.
    // Untracked folders file by file: each row opens a file.
    $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain', '-b', '-z', '--untracked-files=all']).catch(() => undefined),
    // Staged and unstaged lines together, a rename under its new name.
    $.process.run(['git', '--no-optional-locks', 'diff', 'HEAD', '--numstat', '-z', '-M']).catch(() => undefined),
    // Local only: commits no remote has.
    $.process.run(['git', 'rev-list', 'HEAD', '--not', '--remotes']).catch(() => undefined),
    $.process.run(['git', 'rev-list', '--count', 'HEAD']).catch(() => undefined),
    $.process.run(['git', 'remote', 'get-url', 'origin']).catch(() => undefined),
    // The git dir's files, and the shared one's in a linked worktree: the newer FETCH_HEAD is the last fetch.
    $.process
      .run(['git', 'rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', '--show-toplevel'])
      .then(async run => {
        if (run.exitCode) return undefined
        // No top level in the answer: the files sit beside .git.
        const [dir = '', common = dir, root = dir.replace(/\/\.git(\/.*)?$/, '')] = run.stdout.trim().split('\n')
        const [files, shared] = await Promise.all([dir, common].map(one => $.fs.list(one).catch(() => [])))
        const fetched = [...files!, ...(common === dir ? [] : shared!)].filter(one => one.name === 'FETCH_HEAD').map(one => one.mtimeMs)
        return { dir, root, files: files!, fetchedAt: fetched.length ? Math.max(...fetched) : undefined }
      })
      .catch(() => undefined),
    $.process.run(['git', 'stash', 'list', '--format=%gs']).catch(() => undefined),
    $.process.run(['git', 'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)']).catch(() => undefined),
    $.process.run(['git', 'worktree', 'list', '--porcelain']).catch(() => undefined),
  ])
}
// Kept until a tool call or a prompt may have changed the repo, or the tab is picked again: a chat
// scroll or a drag redraws the pane many times a second. `signal`: the draw that started the runs.
let gitRead: { key: string; signal: AbortSignal; runs: ReturnType<typeof readGit> } | undefined
// One page of COMMITS from its first, with a page more: a window of up to PAGE rows starting in the
// page fits whole. Kept as gitRead is, per page.
function readLog($: EngineInterface, page: number) {
  return $.process.run(['git', 'log', '--decorate=full', `--skip=${page * PAGE}`, `-${2 * PAGE}`, `--format=${LOG_FORMAT}`]).catch(() => undefined)
}
let logRead: { key: string; signal: AbortSignal; run: ReturnType<typeof readLog> } | undefined
// The commit card's file and line counts, per commit, read for the rows drawn only: a commit's never change.
// A merge counts against its first parent.
type Stat = { files: number; add: number; del: number }
const stats = new Map<string, Stat>()
async function readStats($: EngineInterface, shas: string[]) {
  const missing = shas.filter(sha => !stats.has(sha))
  if (missing.length) {
    const run = await $.process.run(['git', 'log', '--no-walk', '--shortstat', '--diff-merges=first-parent', '--format=%x1e%H', ...missing]).catch(() => undefined)
    if (run?.exitCode === 0) for (const [sha, one] of parseShortstat(run.stdout)) stats.set(sha, one)
  }
  return stats
}
// Untracked files' line counts, as `wc -l -c` gives them: only the rows drawn, and none for a file over 1 MiB.
const WC_MAX = 1 << 20
let wcRead: { key: string; run: Promise<Map<string, Counts>> } | undefined
// find picks regular files up to 1 MiB before wc reads any: a huge file or a link to a device is never read.
function readWc($: EngineInterface, root: string, paths: string[]) {
  return $.process
    .run(['find', ...paths.map(path => `${root}/${path}`), '-maxdepth', '0', '-type', 'f', '-size', `-${WC_MAX / 1024 + 1}k`, '-exec', 'wc', '-l', '-c', '--', '{}', '+'])
    .then(run => {
      const out = new Map<string, Counts>()
      for (const line of run.stdout.split('\n')) {
        // Full paths only: wc's own "total" line names none.
        const [, lines, path] = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line) ?? []
        if (path?.startsWith(`${root}/`) && paths.includes(path.slice(root.length + 1))) out.set(path.slice(root.length + 1), { add: Number(lines), del: 0 })
      }
      return out
    })
    .catch(() => new Map<string, Counts>())
}
// The branch modal's own read, kept as gitRead is: the default branch.
let branchRead: { key: string; signal: AbortSignal; run: Promise<{ exitCode: number; stdout: string } | undefined> } | undefined
// Each other linked worktree's count of uncommitted files, by path, kept as gitRead is; read only while the worktrees view
// shows, as a status per worktree would hold back every draw.
let treeRead: { key: string; signal: AbortSignal } | undefined
// Each linked worktree's uncommitted files, null when its status failed.
const treeStatus = new Map<string, number | null>()
// The shown PR's local reads, kept per repo change and base: behind and ahead of the base, conflicting files.
let prRead: { key: string; signal: AbortSignal; run: Promise<({ stdout: string } | undefined)[]> } | undefined
// The rebase or merge in progress, kept as gitRead is.
let opRead: { key: string; signal: AbortSignal; run: Promise<Op | undefined> } | undefined
// Whether install.sh chose basic glyphs: read once a session.
let basicGlyphs: Promise<boolean> | undefined
// A commit row's key: hover scopes take at most 64 characters, so a SHA-256 id goes by its first 40.
const commitKey = (sha: string) => `c:${sha.slice(0, 40)}`
// A rebase or merge in progress, from the git dir's files; none otherwise.
async function readOp($: EngineInterface, dir: string, names: string[], branch: string): Promise<Op | undefined> {
  const rebasing = names.includes('rebase-merge')
  // A cherry-pick or revert stops as a merge does, on one commit.
  const verb = names.includes('CHERRY_PICK_HEAD') ? 'cherry-pick' : names.includes('REVERT_HEAD') ? 'revert' : undefined
  if (!rebasing && !verb && !names.includes('MERGE_HEAD')) return undefined
  const file = (name: string) => $.fs.read(`${dir}/${name}`).then(String, () => '')
  const git = (...argv: string[]) => $.process.run(['git', ...argv]).then(run => run.stdout, () => '')
  const [numstat, cached, unmerged] = await Promise.all([git('diff', '--numstat', '-z'), git('diff', '--cached', '--numstat', '-z'), git('diff', '--name-only', '--diff-filter=U', '-z')])
  if (rebasing) {
    const [headName, onto, done, todo] = await Promise.all(['head-name', 'onto', 'done', 'git-rebase-todo'].map(name => file(`rebase-merge/${name}`)))
    const op = parseRebase({ headName, onto, done, todo, numstat, cached, unmerged })
    // The base by name: a local branch at onto first, else a remote one, else its short id.
    const at = (await git('branch', '-a', '--points-at', op.onto, '--format=%(refname:short)')).split('\n').filter(name => name && !name.startsWith('('))
    return { ...op, onto: at.find(name => !name.startsWith('origin/')) ?? at[0] ?? op.onto.slice(0, 7) }
  }
  const at = verb === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : verb === 'revert' ? 'REVERT_HEAD' : 'MERGE_HEAD'
  const [msg, sha, log] = await Promise.all([file('MERGE_MSG'), file(at), git('log', '--format=%h%x09%s%x09%ct', ...(verb ? ['-1', at] : ['HEAD..MERGE_HEAD']))])
  const op = parseMerge({ msg, sha, log, numstat, cached, unmerged, head: branch })
  return verb ? { ...op, verb, from: op.sha } : op
}
// For `pick`: an importer cannot assign these.
export function resetGitReads() {
  gitRead = logRead = opRead = prRead = wcRead = branchRead = treeRead = undefined
}

export type GitCtx = TabCtx & {
  readGh: () => Promise<void>
  readCommitView: (sha: string) => Promise<void>
  readPrView: (n: number, failed?: { name: string; job: string }) => Promise<void>
  rerunFailed: (runs: string[]) => Promise<void>
}

export async function draw($: EngineInterface, ctx: GitCtx): Promise<TabDraw> {
  const { Box, Button, Code, Link, Text } = ctx.el
  const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
  const { props } = ctx
  const drawn: Zone[] = []
  const key = `${await $.session.id()}:${await read($, submitted)}:${await read($, toolCalls)}`
  if (gitRead?.key !== key) gitRead = { key, signal: ctx.signal, runs: readGit($) }
  let runs = await gitRead.runs
  // A draw dropped mid-read (a newer one began, the pane closed) takes the git runs still going down
  // with it: any of them unanswered, the draw on screen reads again.
  if (runs.some(run => !run) && gitRead.signal.aborted && !ctx.signal.aborted) {
    gitRead = { key, signal: ctx.signal, runs: readGit($) }
    runs = await gitRead.runs
  }
  const [status, diff, unpushed, count, remote, gitDir, stash, refs, worktreeRun] = runs
  const now = await $.clock.now()
  await readTheme($)
  const basic = await (basicGlyphs ??= configDir($)
    .then(dir => $.fs.exists(`${dir}/.claudzilla-basic-glyphs`))
    .catch(() => false))
  const open = await read($, modal)
  const isFetching = await read($, fetching)
  const web = remote?.exitCode === 0 ? gitWeb(remote.stdout) : undefined
  const local = unpushed?.exitCode === 0 ? new Set(unpushed.stdout.split('\n').filter(Boolean)) : undefined
  const total = count?.exitCode === 0 ? count.stdout.trim() : ''
  const { head, changes } = status?.exitCode === 0 ? parseStatusZ(status.stdout) : { head: undefined, changes: [] }
  const files = changes
  const counts = diff?.exitCode === 0 ? parseNumstat(diff.stdout) : new Map<string, Counts>()
  const summed = changes.reduce((n, c) => {
    const one = counts.get(c.path)
    return one && one !== 'bin' ? { add: n.add + one.add, del: n.del + one.del } : n
  }, { add: 0, del: 0 })
  // As gitRead: a run a dropped draw took down is read again by the live one.
  const dropped = (cached?: { key: string; signal: AbortSignal }, at = key) => cached?.key !== at || (cached.signal.aborted && !ctx.signal.aborted)
  if (dropped(opRead))
    opRead = { key, signal: ctx.signal, run: head && gitDir ? readOp($, gitDir.dir, gitDir.files.map(one => one.name), parseHead(head).name) : Promise.resolve(undefined) }
  const op = await opRead.run
  // During a rebase git has no current branch: its name comes from head-name.
  const branchName = op?.head || parseHead(head ?? '').name
  const blocked = !!op && op.conflicts.length > 0 && !op.resolved
  const ghNow = await read($, gh)
  const prs = remote?.exitCode === 0 && ghNow.remote === remote.stdout.trim() ? ghNow.prs : []
  // This branch's PR: one open, else the newest that ended. Two or more open share a summary row.
  const own = head ? ownPrs(prs, branchName) : []
  const incoming = head ? incomingPrs(prs, branchName) : []
  const isOpen = (one?: Pr) => one?.state === 'open' || one?.state === 'draft'
  // Two or more open PRs out of this branch, or, on a branch with none open, the PRs coming into it: one summary row.
  const summary = own.length > 1 ? { out: true, list: own } : !isOpen(own[0]) && incoming.length ? { out: false, list: incoming } : undefined
  const pr = !summary && own.length === 1 ? own[0] : undefined
  // Every worktree, the main one first. In a linked one the branch name takes ⧉.
  const worktreeList = worktreeRun?.exitCode === 0 ? worktreeRun.stdout : ''
  const trees = worktrees(worktreeList)
  const linked = trees.findIndex(t => t.path === gitDir?.root) > 0
  const prKey = pr && `${key}:${pr.base}:${pr.conflicting}`
  if (prKey && dropped(prRead, prKey))
    prRead = {
      key: prKey,
      signal: ctx.signal,
      run: Promise.all([
        $.process.run(['git', 'rev-list', '--count', `HEAD..origin/${pr.base}`]).catch(() => undefined),
        $.process.run(['git', 'rev-list', '--count', `origin/${pr.base}..HEAD`]).catch(() => undefined),
        // Exits 1 on a conflict, the files still listed: the tree id, then each name, then an empty record.
        pr.conflicting ? $.process.run(['git', 'merge-tree', '--write-tree', '--name-only', '-z', 'HEAD', `origin/${pr.base}`]).catch(() => undefined) : Promise.resolve(undefined),
      ]),
    }
  const [behindRun, aheadRun, treeRun] = pr ? await prRead!.run : []
  const behind = Number(behindRun?.stdout.trim()) || 0
  const prCommits = Number(aheadRun?.stdout.trim()) || 0
  // Rows behind an open modal: dim, with no hover, card or link. A modal with nothing to show is not open.
  const dimmed = !!open && (open.key === 'branch' || (open.key === 'pr' && !!pr && pr.n === open.n) || (open.key === 'rebase' && !!op) || (open.key === 'prs' && !!summary) || (open.key === 'commit' && !!open.sha))
  // Its subject gone, it closes: left open, it would swallow the next Escape and come back with the next subject.
  // A failed read says nothing about the subject.
  if (open && !dimmed && !ctx.signal.aborted && status?.exitCode === 0 && gitDir && (open.key === 'rebase' || remote?.exitCode === 0))
    $.clock.after(0, () => ctx.setModal(m => (m?.key === open.key ? null : m)))
  // The row that opened the modal: a commit's is keyed by its sha.
  const openRow = open?.key === 'commit' ? commitKey(open.sha ?? '') : open?.key
  const conflictFiles = treeRun ? treeRun.stdout.split('\0\0')[0]!.split('\0').slice(1).filter(Boolean).map(printable) : []
  // The body less 3 columns: a path gets room + 1 after its status letter and a space; a commit's
  // subject room + 2 less its hash.
  const room = props.bodyColumns - 2 * PAD - 3
  const bodyRule = '─'.repeat(room + 3)
  // A header's counts, each only where it fits after its 7-letter title and a space: the
  // narrowest pane drops them from the right.
  const fits = (...counts: string[]) => 8 + counts.join('').length <= room + 3
  const aheadCount = local?.size ? `↑${local.size}` : ''
  const totalCount = total ? `${aheadCount ? '  ' : ''}${total} total` : ''
  // The branch row, the rebase row and the PR row; the rows above CHANGES grow with them.
  const topRows = 1 + (op ? 1 : 0) + (pr || summary ? 1 : 0)
  // Rows left once the tabs, their rule, the branch, the rule under it, both headers and the
  // divider are drawn. CHANGES takes what it needs up to half, or what the divider was dragged
  // to; COMMITS the rest. Dragged, each side keeps 1 row, COMMITS first in a short pane.
  const free = props.scroll.bodyRows - BAR_ROWS - 6 - topRows
  const dragged = await read($, split)
  const changesMax = Math.max(0, free - 1)
  const changesMin = Math.min(1, changesMax)
  const changesRows = dragged >= 0 ? Math.max(changesMin, Math.min(dragged, changesMax)) : Math.min(files.length, Math.ceil(free / 2), changesMax)
  // With no changes, no CHANGES header or divider: COMMITS takes their rows too.
  const commitsRows = Math.max(1, files.length ? free - changesRows : free + 2)
  // Clamped here too: a list shrinks, or the divider grows its zone, after the wheel moved it.
  const top = await read($, scrolled)
  const changesW = zoneWindow(files.length, top.changes, changesRows)
  // With no total, clamped once the pages read count the commits.
  const commitsFrom = total ? zoneWindow(Number(total), top.commits, commitsRows).top : top.commits
  const page = Math.floor(commitsFrom / PAGE)
  const logKey = `${key}:${page}`
  if (head && logRead?.key !== logKey) logRead = { key: logKey, signal: ctx.signal, run: readLog($, page) }
  let log = head ? await logRead!.run : undefined
  // As the runs above: a read a dropped draw took down with it is read again.
  if (head && !log && logRead!.signal.aborted && !ctx.signal.aborted) {
    logRead = { key: logKey, signal: ctx.signal, run: readLog($, page) }
    log = await logRead.run
  }
  // An empty repo's log fails: no commits to list.
  const commits = log?.exitCode === 0 ? parseLog(log.stdout) : []
  const commitsN = Number(total) || page * PAGE + commits.length
  const commitsW = zoneWindow(commitsN, commitsFrom, commitsRows)
  // CHANGES' rows end under its last file: the tabs, their rule, the branch, its rule and the header.
  if (head) {
    const commitsAt = files.length && changesRows ? 4 + topRows + changesRows : 0
    const changesEnd = zoneWindow(files.length, Infinity, changesRows).top
    const commitsEnd = zoneWindow(commitsN, Infinity, commitsRows).top
    const divider = { rows: changesRows, min: changesMin, max: changesMax }
    if (commitsAt > 0)
      drawn.push(
        {
          tab: 'Git', kind: 'list', from: -Infinity, to: commitsAt, offset: 0,
          wheel: by => update($, scrolled, top => ({ ...top, changes: Math.max(0, Math.min(top.changes + by, changesEnd)) })),
        },
        { tab: 'Git', kind: 'divider', from: commitsAt, to: commitsAt + 1, offset: 0, hold: 'git', wheel: by => update($, split, rows => nudge(rows, divider, -by)) },
      )
    drawn.push({
      tab: 'Git', kind: 'list', from: commitsAt || -Infinity, to: Infinity, offset: 0, fallback: true,
      wheel: by => update($, scrolled, top => ({ ...top, commits: Math.max(0, Math.min(top.commits + by, commitsEnd)) })),
    })
  }
  const trace = {
    zones: !head ? (status ? 'not a repo' : 'no git answer') : !files.length ? 'commits only' : changesRows ? 'changes+commits' : 'changes hidden: no rows',
    changes: files.length, changesRows, commits: commits.length, commitsRows, total: Number(total) || 0,
  }
  // Mid-rebase git status names no branch: the branch's own ref gives its upstream and track, as status would.
  const ref = op ? (refs?.stdout ?? '').split('\n').map(line => line.split('\t')).find(([name]) => name === branchName) : undefined
  const headLine = ref?.[1] ? `## ${branchName}...${ref[1]}${ref[2] ? ` ${ref[2]}` : ''}` : (head ?? '')
  const hd = { ...parseHead(headLine), name: branchName }
  // The upstream by its remote alone, unless its branch name differs from this one.
  const tracked = /\.\.\.(\S+)/.exec(headLine)?.[1]
  const upstreamName = tracked && (tracked.slice(tracked.indexOf('/') + 1) === hd.name ? tracked.split('/')[0]! : tracked)
  const MARKS = { behind: ['↓', BEHIND], diverged: ['↕', BEHIND], gone: ['✗', HUD.faint] } as const
  const mark = syncMark(hd)
  const stashes = stashCount(stash?.stdout ?? '', hd.name)
  const remoteUrl = remote?.exitCode === 0 ? remote.stdout.trim() : ''
  const fetchedAt = gitDir?.fetchedAt
  const stale = fetchedAt === undefined || now - fetchedAt >= 60 * 60e3
  const fetchLabel = `${basic ? '↻' : '\uf46a'} ${fetchedAt === undefined ? 'never' : age(fetchedAt, now)}`
  // The fetch row's width as drawn: while a fetch runs it reads "◌ fetching".
  const fetchWidth = isFetching ? 10 : [...fetchLabel].length
  const branchLabel = `⎇ ${fit(hd.name, props.bodyColumns - 2 * PAD - fetchWidth - 5 - (linked ? 2 : 0))}`
  const fetchedText = fetchedAt === undefined ? 'never' : `${clock(fetchedAt)} ${new Date(fetchedAt).toDateString() === new Date(now).toDateString() ? 'today' : dayName(new Date(fetchedAt))}`
  const fetchNow = async () => {
    await update($, fetching, () => true)
    const run = await $.process.run(['git', 'fetch', 'origin']).catch(() => undefined)
    await update($, fetching, () => false)
    if (run?.exitCode !== 0) $.ui.toast(`git fetch failed: ${(run?.stderr ?? '').split('\n')[0]}`)
    // As a tool call that may change the repo: the tab reads git again.
    await update($, toolCalls, n => n + 1)
    await ctx.readGh()
  }
  const openModal = async (key: ModalKey, row?: LogRow) => {
    if (row) await update($, commitViews, all => ({ ...all, [row.full]: { ...all[row.full], row } }))
    await ctx.setModal(() => ({ key, top: key === 'branch' ? -1 : 0, ...(row && { sha: row.full }), ...(key === 'pr' && { n: pr?.n }) }))
    if (row) await ctx.readCommitView(row.full)
    const failed = pr?.checks.find(c => c.state === 'bad' && c.job)
    if (key === 'pr' && pr) await ctx.readPrView(pr.n, failed && { name: failed.name, job: failed.job! })
  }
  // Behind a modal only the row that opened it presses, and closes it.
  // The COMMITS rows drawn, and the tab row the first of them sits on: under CHANGES, its divider and the COMMITS
  // header, past the top cue once scrolled.
  const shownCommits = commits.slice(Math.max(0, commitsW.top - page * PAGE), commitsW.top - page * PAGE + commitsW.shown)
  const commitsAt0 = topRows + 2 + (files.length ? changesRows + 2 : 0) + (commitsW.above ? 1 : 0)
  const commitStats = shownCommits.length ? await readStats($, shownCommits.map(c => c.full)) : stats
  // The CHANGES rows drawn: a deleted file has nothing to open, so no act; untracked ones count their lines.
  const shownChanges = changes.slice(changesW.top, changesW.top + changesW.shown)
  const changesCues = cues(ctx.el, 'changes', room + 3, changesW, to => update($, scrolled, top => ({ ...top, changes: to })))
  const commitsCues = cues(ctx.el, 'commits', room + 3, commitsW, to => update($, scrolled, top => ({ ...top, commits: to })), false)
  const root = gitDir?.root ?? ''
  const untrackedShown = shownChanges.filter(c => c.xy === '??').map(c => c.path)
  const wcKey = `${key}:${untrackedShown.join('\0')}`
  if (untrackedShown.length && wcRead?.key !== wcKey) wcRead = { key: wcKey, run: readWc($, root, untrackedShown) }
  const lineCounts = untrackedShown.length ? await wcRead!.run : new Map<string, Counts>()
  // As the File tab's show: the file read whole, the tab switched. `path`: from the repo's top. A file no longer
  // in the working tree, as a commit's may be, says so instead of opening empty.
  const openFile = async (path: string) => {
    const text = await $.fs.read(`${root}/${path}`).then(String, () => undefined)
    if (text === undefined) return void $.ui.toast(`Not in the working tree: ${printable(path)}`)
    await update($, file, () => fileView(`${root}/${path}`, 1, text))
    await ctx.pick('File')
  }
  rowHover.acts = dimmed
    ? { [openRow!]: () => ctx.setModal(() => null) }
    : {
        branch: () => openModal('branch'), fetch: () => !isFetching && fetchNow(), rebase: () => openModal('rebase'), pr: () => openModal('pr'), prs: () => openModal('prs'),
        ...Object.fromEntries(shownChanges.filter(c => !c.words.includes('deleted')).map(c => [fileKey(c.path), () => openFile(c.path)])),
        ...Object.fromEntries(shownCommits.map(c => [commitKey(c.full), () => openModal('commit', c)])),
      }
  // A top row: a row Client where the surface draws one, else a Button whose card shows on hover. `width`: a row
  // sharing its line, held to its text.
  // An action row (fetch runs, opens nothing) inverts under the pointer, as a button does; a row that opens a
  // modal lights.
  const act = (key: string) => key === 'fetch' && !dimmed
  const piecesOf = (key: string, node: any[]) =>
    act(key) ? toPieces(node).map(x => ({ ...x, hover: { scope: `card:${key}`, inverse: true } })) : dimOn(key, toPieces(node))
  const topRow = (key: string, left: any[], right: any[], width?: number) => kitRow(rc, key, left, right, { pieces: piecesOf, line: lineOf(key), act: act(key), width })
  // A row's hover card, drawn last so it paints over the rows under it, and shown while its row's scope is
  // hovered. `row`: the row it hangs under, counted from the tab's top.
  const cards: JSX.Element[] = []
  const pointer = await read($, rowPointer)
  // While a card shows, the line between its row and the card dims, still live to the pointer: the next top row
  // line, or the rule under the last. Branch and fetch share a line.
  const topLines = [['branch', 'fetch'], ...(op ? [['rebase']] : []), ...(pr ? [['pr']] : summary ? [['prs']] : [])]
  // The CHANGES and COMMITS rows drawn, each a line of its own: its tab row and its card's rows. A card that would
  // pass the tab's bottom opens upward, so the line above it dims instead of the line below.
  // A file card's status pills: one row when all fit, else the change words then the stage pills, each packed into as
  // many rows as the pane needs, so a stage pill never reads as one word's. A row: the 8-column label, each pill its
  // word and 2 caps, a space between, and the card's border and padding. A pill too wide for any row gets its own.
  const pillRows = (c: (typeof shownChanges)[number]) => {
    const fitsRow = (row: (Stage | Word)[]) => 8 + row.reduce((n, s) => n + s.length + 3, -1) + 4 <= props.bodyColumns - 4
    const pack = (pills: (Stage | Word)[]) =>
      pills.reduce<(Stage | Word)[][]>((rows, w) => {
        const last = rows.at(-1)
        if (last && fitsRow([...last, w])) last.push(w)
        else rows.push([w])
        return rows
      }, [])
    const all = [...c.words, ...c.stage]
    return fitsRow(all) ? [all] : [...pack(c.words), ...pack(c.stage)]
  }
  const lower = [
    ...shownChanges.map((c, i) => ({ key: fileKey(c.path), zone: 'changes', at: topRows + 2 + (changesW.above ? 1 : 0) + i, n: pillRows(c).length })),
    ...shownCommits.map((c, j) => ({ key: commitKey(c.full), zone: 'commits', at: commitsAt0 + j, n: 1 + (c.refs.length || c.tags.length ? 1 : 0) + (commitStats.has(c.full) ? 1 : 0) })),
  ]
  const upOf = (at: number, n: number) => at + 4 + n > tabRows
  const lines = [...topLines, ...lower.map(l => [l.key])]
  // The engine dims it, the plugin's redraw too slow (measured ~60 ms behind the lit row): each line's row Clients
  // join group `line:<n>`, and the next line's pieces fade while it is hovered. Nested in the row's Text, a piece
  // follows that group without heating it, so the pointer on it leaves it bright.
  const lineOf = (key: string) => lines.findIndex(line => line.includes(key))
  const faded = (scope: string, x: Piece) => ({ scope, color: PILL_CAPS.has(x.text) ? fadeBg(x.color) : fade(x.color), ...(x.backgroundColor && { backgroundColor: fadeBg(x.backgroundColor) }) })
  // A lower row fades for the row above it in its zone when that card opens down, and for the row below when that
  // card opens up; the second rides on a nested Text (`under`), as a Text takes one hover.
  const dimOn = (key: string, pieces: Piece[]) => {
    const i = lineOf(key)
    if (dimmed || i < 1) return pieces
    if (i < topLines.length) return pieces.map(x => ({ ...x, hover: faded(`line:${i - 1}`, x) }))
    const k = i - topLines.length
    const [prev, here, after] = [lower[k - 1], lower[k]!, lower[k + 1]]
    const fromAbove = prev && prev.zone === here.zone && !upOf(prev.at, prev.n)
    const fromBelow = after && after.zone === here.zone && upOf(after.at, after.n)
    return pieces.map(x => ({ ...x, ...(fromAbove && { hover: faded(`line:${i - 1}`, x) }), ...(fromBelow && { under: faded(`line:${i + 1}`, x) }) }))
  }
  // Shown on hover, one row below its row: a step down lands on the next row, not on the card. A card under the
  // pointer keeps its group lit, so with row Clients the card of the row last left is not drawn: a jump past the
  // next row onto the card is the row's leave.
  rowHover.lines = Object.fromEntries([...topLines.flatMap((line, i) => line.map(key => [key, i])), ...lower.map(l => [l.key, l.at])])
  const spans = rowHover.spans
  rowHover.spans = {}
  const gone = pointer.left && spans[pointer.left]
  // A hover card's widest: 75% of the body.
  const cardWidth = Math.floor(props.bodyColumns * 0.75)
  const rc: RowCtx = { el: ctx.el, dimmed, pointer, gone: gone || undefined, cards, columns: props.bodyColumns, cardWidth, up: upOf }
  const card = (scope: string, at: number, anchor: 'left' | 'right' | 'center', ...rows: JSX.Element[]) => kitCard(rc, scope, at, anchor, ...rows)
  const kv = (label: string, info: JSX.Element | string, right?: JSX.Element) => kitKv(rc, label, info, right)
  // Against the upstream: ✓ in sync, ↑ unpushed, ↓ unpulled, both when diverged; local never pushed, gone deleted.
  const syncOf = (b: { upstream: string; ahead: number; behind: number }) =>
    b.upstream !== 'ok' ? <Text color={HUD.faint}>{b.upstream}</Text>
    : !b.ahead && !b.behind ? <Text color={HUD.action}>✓</Text>
    : (
      <Text>
        {b.ahead ? <Text color={AHEAD}>{`↑${b.ahead}`}</Text> : ''}
        {b.ahead && b.behind ? ' ' : ''}
        {b.behind ? <Text color={BEHIND}>{`↓${b.behind}`}</Text> : ''}
      </Text>
    )
  const sync = syncOf(hd)
  // Overview's marks: done, failed, running; skipped faint.
  const GLYPHS: Record<CheckState, [string, string]> = { ok: ['✓', HUD.action], bad: ['✗', TYPES.fix!], run: ['◌', 'claude'], skip: ['–', HUD.faint] }
  const glyph = (state: CheckState) => <Text color={GLYPHS[state][1]}>{GLYPHS[state][0]}</Text>
  // A branch prefix in its commit type's colour (feat/ green, fix/ red); any other prefix faint.
  const prefixColor = (prefix: string) => TYPES[prefix.replace(/\/$/, '')] ?? HUD.faint
  // A commit's refs as the branch modal draws names: the current branch bold in the action colour; else a remote's
  // name faint, a type prefix in its colour, the rest plain. Tags in warning. Two spaces apart.
  const refTexts = (refs: LogRow['refs'], tags: string[]) =>
    [
      ...refs.map(({ remote, branch }) => {
        if (!remote && branch === hd.name) return [<Text bold color={HUD.action}>{branch}</Text>]
        const at = branch.indexOf('/')
        return [
          ...(remote ? [<Text color={HUD.faint}>{`${remote}/`}</Text>] : []),
          ...(at < 0 ? [<Text>{branch}</Text>] : [<Text color={prefixColor(branch.slice(0, at + 1))}>{branch.slice(0, at + 1)}</Text>, <Text>{branch.slice(at + 1)}</Text>]),
        ]
      }),
      ...tags.map(tag => [<Text color="warning">{tag}</Text>]),
    ].flatMap((pieces, i) => (i ? [<Text>{'  '}</Text>, ...pieces] : pieces))
  // The tab body the modals sit in, under the tabs and their rule.
  const tabRows = props.scroll.bodyRows - 2 - BAR_ROWS
  // The divider fades in the last CHANGES row's group while its card hangs down, only when it is the line right
  // under that row: past empty zone rows the card never reaches it.
  const lastChange = lower.filter(l => l.zone === 'changes').at(-1)
  const underLast = lastChange && lastChange.at + 1 === topRows + 2 + changesRows
  const lastChangeLine = lastChange && underLast && !upOf(lastChange.at, lastChange.n) ? `line:${topLines.length + lower.indexOf(lastChange)}` : undefined
  const layers: { m?: Layer; s?: Layer } = {}
  const lc: LayerCtx = { el: ctx.el, layers, setModal: change => ctx.setModal(change) }
  const drawLayer = (layer: 'm' | 's', f: Frame, at: { top: number; left: number }, acts: JSX.Element[], pin: JSX.Element[], rows: JSX.Element[], top: number, centre?: number) =>
    kitDrawLayer($, lc, layer, f, at, acts, pin, rows, top, centre)
  // A commit subject as COMMITS colours it: the type in its colour, the scope grey, the rest plain.
  const subjectTexts = (text: string, room = Infinity, bold = false) => {
    const shown = fit(text.replace(/[\x00-\x1f\x7f]/g, ' '), room)
    const [, type, scope, tail, rest] = /^(\w+)(?:\(([^)]*)\))?(!?: )(.*)$/.exec(shown) ?? []
    if (!type) return [<Text bold={bold}>{shown}</Text>]
    return [
      <Text bold={bold} color={TYPES[type] ?? HUD.faint}>{type}</Text>,
      ...(scope === undefined ? [] : [<Text bold={bold} color={HUD.faint}>(</Text>, <Text bold={bold} color={SCOPE}>{scope}</Text>]),
      <Text bold={bold} color={HUD.faint}>{scope === undefined ? tail : `)${tail}`}</Text>,
      <Text bold={bold}>{rest}</Text>,
    ]
  }
  const PILL: Record<PrState | Stage | Word, [string, string]> = {
    open: [PILL_BG.green, 'success'], draft: [PILL_BG.gray, SCOPE], merged: [PILL_BG.purple, HUD.label], closed: [PILL_BG.red, 'error'],
    staged: [PILL_BG.green, 'success'], 'not staged': [PILL_BG.gray, SCOPE],
    modified: [PILL_BG.yellow, STATUS.M!], added: [PILL_BG.green, STATUS.A!], deleted: [PILL_BG.red, STATUS.D!], renamed: [PILL_BG.blue, STATUS.R!], untracked: [PILL_BG.cyan, STATUS['?']!], conflict: [PILL_BG.red, STATUS.U!],
  }
  // A state pill: the rounded ends in its background colour around the word.
  const pill = (state: PrState | Stage | Word) => [
    <Text color={PILL[state][0]}>{''}</Text>,
    <Text backgroundColor={PILL[state][0]} color={PILL[state][1]}>{state}</Text>,
    <Text color={PILL[state][0]}>{''}</Text>,
  ]
  const CI: Record<CheckState, [string, string]> = { bad: ['✗ CI failed', TYPES.fix!], run: ['◌ CI running', 'claude'], ok: ['✓ CI passed', HUD.action], skip: ['✓ CI passed', HUD.action] }
  // Lines added and removed; a side that is 0 is left out, as the mockup draws it: "+8", "−9".
  const churnText = (add: number, del: number) => [add || !del ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ')
  // A file list's count columns: the widest "+n" and "−n", so each side lines up right-aligned; `bin` fits too.
  type Cols = { add: number; del: number }
  const colsWidth = (cols: Cols) => cols.add + (cols.add && cols.del ? 1 : 0) + cols.del
  const churnCols = (list: (Counts | undefined)[]) => {
    const cols = { add: 0, del: 0 }
    for (const c of list)
      if (c && c !== 'bin') {
        cols.add = Math.max(cols.add, c.add || !c.del ? `+${c.add}`.length : 0)
        cols.del = Math.max(cols.del, c.del ? `−${c.del}`.length : 0)
      }
    // Widen the side already drawn, so an all-deletions list gains no separator.
    if (list.includes('bin')) cols[cols.add ? 'add' : 'del'] += Math.max(0, 3 - colsWidth(cols))
    return cols
  }
  const churnOf = (add: number, del: number, cols?: Cols) => {
    const a = add || !del ? `+${add}` : ''
    const d = del ? `−${del}` : ''
    if (!cols)
      return (
        <Text>
          {a ? <Text color="success">{a}</Text> : null}
          {a && d ? ' ' : null}
          {d ? <Text color="error">{d}</Text> : null}
        </Text>
      )
    return (
      <Text>
        {' '.repeat(cols.add - a.length)}
        {a ? <Text color="success">{a}</Text> : null}
        {cols.add && cols.del ? ' '.repeat(1 + cols.del - d.length) : null}
        {d ? <Text color="error">{d}</Text> : null}
      </Text>
    )
  }
  // A changed file's parts, for a CHANGES row and every modal file list: its mark, its path cut in the middle so
  // the file name stays, and its line counts at the right (`bin` for a binary file). `room`: the path's columns
  // with no counts; counts take theirs and a 2-column gap.
  const changeParts = (mark: JSX.Element[], path: string, counts: Counts | undefined, room: number, pathColor?: string, cols?: Cols) => {
    const used = !counts ? 0 : cols ? colsWidth(cols) : counts === 'bin' ? 3 : churnText(counts.add, counts.del).length
    return {
      left: [...mark, <Text color={pathColor}>{` ${cutMiddle(printable(path), room - (used ? used + 2 : 0))}`}</Text>],
      right: counts === 'bin' ? <Text color={HUD.faint}>{'bin'.padStart(cols ? colsWidth(cols) : 3)}</Text> : counts ? churnOf(counts.add, counts.del, cols) : undefined,
    }
  }
  // Over every change, not the rows drawn, so tracked rows hold the columns still as CHANGES scrolls.
  // shortcut: untracked counts are read only for drawn rows, so a wide one shifts the columns once drawn; read all
  // untracked counts if users report the jitter.
  const changeCols = churnCols(changes.map(c => counts.get(c.path) ?? lineCounts.get(c.path)))
  // A modal's file row: lit under the pointer, a press opens the file in the File tab. `layer`: the modal's key
  // prefix, m or s for the stacked one. A deleted file neither lights nor opens.
  // A row Client, as a CHANGES row, so it lights where a Button would invert; a surface with no Client gets the
  // Button.
  const fileRow = (mark: JSX.Element, path: string, add: number, del: number, width: number, layer: 'm' | 's', deleted = false, cols?: Cols) => {
    const { left, right } = changeParts([mark], path, { add, del }, width - 3, undefined, cols)
    if (deleted) return line(left, right)
    const key = `${layer}f:${fileKey(path)}`
    rowHover.acts[key] = () => openFile(path)
    return (
      // Keyed, its own hover scope: unkeyed, it would light whenever the pointer is anywhere in the modal.
      // A column, as a CHANGES row's: the Client stretches across, so its counts end at the far right.
      <Box key={`${layer}:row:${path}`} flexDirection="column" height={1} hover={{ backgroundColor: LIT }}>
        {Client ? (
          <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: toPieces(left), right: right ? toPieces(right) : [] }} />
        ) : (
          <Box justifyContent="space-between" gap={2}>
            <Button key={`${layer}:file:${path}`} plain onPress={() => openFile(path)}>
              <Text wrap="truncate-end">{left}</Text>
            </Button>
            {right ? <Box flexShrink={0}>{right}</Box> : null}
          </Box>
        )}
      </Box>
    )
  }
  // A count in normal text: each standalone number in the claude colour; faint text stays faint. IDs (#n,
  // shas), times (11h), churn (+7) and numbers inside names are not counts: a number touching a letter, #, + or
  // − stays.
  const counted = (text: string) =>
    text.split(/(?<![\w#+−.\/-])(\d+)(?![\w.\/-])/).map((part, i) => (part ? <Text color={i % 2 ? 'claude' : undefined}>{part}</Text> : null))
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const opRows = op ? 1 : 0
  const prRow = (() => {
    if (!pr) return null
    const ended = pr.state === 'merged' || pr.state === 'closed'
    const w = worst(pr.checks)
    const passed = pr.checks.filter(c => c.state === 'ok').length
    // The check that needs attention: the first failed one, else the first running.
    const current = pr.checks.find(c => c.state === 'bad') ?? pr.checks.find(c => c.state === 'run')
    const changes = kv('changes', <Text>{counted(`${prCommits ? `${plural(prCommits, 'commit')} · ` : ''}${plural(pr.files, 'file')}`)}</Text>, churnOf(pr.additions, pr.deletions))
    const title = <Box>{subjectTexts(pr.title, cardWidth - 4, true)}</Box>
    // A merged or closed PR: when and where it ended replaces base and checks, which no longer matter.
    const rows = ended
      ? [title, kv(pr.state, <Text><Text color={HUD.faint}>into</Text>{` ${pr.base}`}</Text>, <Text color={HUD.faint}>{ago(pr.at, now)}</Text>), changes]
      : [
          title,
          kv(
            'base',
            pr.conflicting ? <Text><Text color={TYPES.fix}>✗</Text> conflicts</Text>
            : behind ? <Text><Text color="warning">↓</Text>{counted(` ${behind} behind`)}</Text>
            : <Text><Text color={HUD.action}>✓</Text> up to date</Text>,
            pr.conflicting && conflictFiles.length ? <Text color={HUD.faint}>{plural(conflictFiles.length, 'file')}</Text> : undefined,
          ),
          kv('checks', <Text>{glyph(w)}{counted(` ${passed} of ${pr.checks.length} passed`)}</Text>, current && <Text color={GLYPHS[current.state][1]}>{current.name}</Text>),
          changes,
        ]
    return topRow(
      'pr',
      [
        <Text dimColor={ended}>  </Text>,
        basic ? '' : <Text color="claude" dimColor={ended}>{' '}</Text>,
        <Text color="claude" dimColor={ended}>{`#${pr.n}`}</Text>,
        <Text color={HUD.faint} dimColor={ended}> into </Text>,
        <Text dimColor={ended}>{pr.base}</Text>,
        ended ? '' : pr.conflicting ? <Text color={TYPES.fix} dimColor={ended}> ✗</Text> : behind ? <Text color="warning" dimColor={ended}> !</Text> : '',
      ],
      [!ended && pr.checks.length ? <Text color={CI[w][1]}>{`${CI[w][0]} `}</Text> : null, ...pill(pr.state)],
      card('card:pr', opRows + 1, 'center', ...rows),
    )
  })()
  // The rebase or merge row: what runs, onto what, and what it waits on.
  const opRow = op && (() => {
    const rebase = op.kind === 'rebase'
    const stop = rebase ? op.steps[op.at] : undefined
    const right =
      rebase && op.edit ? [<Text color="warning">edit</Text>, <Text color={HUD.faint}>{` ${stop?.sha ?? ''}`}</Text>]
      : blocked ? [<Text color={TYPES.fix}>{`✗ ${plural(op.conflicts.length, 'conflict')}`}</Text>]
      : [<Text color={HUD.action}>✓ ready</Text>]
    const names = op.conflicts.map(c => printable(c.path.slice(c.path.lastIndexOf('/') + 1))).join(', ')
    // The card adds where it stopped and the files to fix; the modal's actions say what to do.
    const rows = [
      rebase
        ? kv('step', <Text>{counted(`${op.at + 1} of ${op.steps.length}`)}</Text>, <Text color={HUD.faint}>{stop?.sha ?? ''}</Text>)
        : kv('incoming', <Text>{counted(plural(op.incoming.length, 'commit'))}</Text>, <Text color={HUD.faint}>{op.sha}</Text>),
      ...((rebase && op.edit) || !op.conflicts.length
        ? []
        : [
            kv(
              op.resolved ? 'resolved' : 'conflict',
              fit(names, cardWidth - 24),
              op.conflicts.length > 1 ? <Text color={HUD.faint}>{plural(op.conflicts.length, 'file')}</Text> : churnOf(op.conflicts[0]!.additions, op.conflicts[0]!.deletions),
            ),
          ]),
    ]
    return (
      topRow(
        'rebase',
        [
          <Text>  </Text>,
          <Text color="warning">{rebase ? '↺ ' : ' '}</Text>,
          <Text>{rebase ? 'rebasing ' : op.verb === 'cherry-pick' ? 'cherry-picking ' : op.verb === 'revert' ? 'reverting ' : 'merging '}</Text>,
          rebase ? <Text color={HUD.faint}>onto </Text> : '',
          <Text>{rebase ? op.onto : op.from}</Text>,
        ],
        [right].flat(),
        card('card:rebase', 1, 'center', ...rows),
      )
    )
  })()
  // A summary row: two or more PRs on one row, the count and the worst CI; each PR in its card and modal.
  const summaryRow = summary && (() => {
    const bad = summary.list.filter(p => worst(p.checks) === 'bad').length
    const run = summary.list.filter(p => worst(p.checks) === 'run').length
    const right = bad ? <Text color={TYPES.fix}>{`✗ ${bad} failing`}</Text>
      : run ? <Text color="claude">{`◌ ${run} running`}</Text>
      : <Text color={HUD.action}>✓ all passed</Text>
    const item = (p: Pr) => (
      <Box justifyContent="space-between">
        <Box>
          <Text color="claude">{` #${p.n} `}</Text>
          {summary.out ? [<Text color={HUD.faint}>into </Text>, <Text>{p.base}</Text>] : subjectTexts(p.title, cardWidth - 20)}
        </Box>
        <Box>
          {glyph(worst(p.checks))}
          <Text> </Text>
          {pill(p.state)}
        </Box>
      </Box>
    )
    // A card shows at most 8 rows; past that the last counts the rest, and the modal lists them all.
    const rows = summary.list.length > 8 ? [...summary.list.slice(0, 7).map(item), <Text color={HUD.faint}>{` … ${summary.list.length - 7} more`}</Text>] : summary.list.map(item)
    return (
      topRow(
        'prs',
        [
          <Text>  </Text>,
          <Text color="claude">{summary.out ? '↗ ' : '↘ '}</Text>,
          <Text>{counted(`${summary.list.length} PRs `)}</Text>,
          <Text color={HUD.faint}>{summary.out ? 'out' : 'into '}</Text>,
          summary.out ? '' : <Text>{branchName}</Text>,
        ],
        [right].flat(),
        card('card:prs', opRows + 1, 'center', ...rows),
      )
    )
  })()
  const home = trees.length > 1 ? await $.env.get('HOME').catch(() => undefined) : undefined
  const parent = trees[0]?.path.replace(/[^/]+$/, '') ?? ''
  // Beside the main worktree as ../, else under home as ~.
  const where = (path: string) => (parent !== '/' && path.startsWith(parent) ? `../${path.slice(parent.length)}` : home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
  // Cut from the start: a worktree's last folder tells it apart.
  const endOf = (path: string, room: number) => (path.length <= room ? path : `…${path.slice(1 - room)}`)
  const modalRows = (want: number) => modalFrame(props.bodyColumns, tabRows, want)
  if (open?.key === 'branch' && dropped(branchRead))
    branchRead = {
      key,
      signal: ctx.signal,
      run: $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => undefined),
    }
  const defaultRun = open?.key === 'branch' ? await branchRead!.run : undefined
  const view = await read($, branchView)
  const showTrees = open?.key === 'branch' && view.by === 'worktrees' && trees.length > 1
  // Off the draw, each count landing on its own: a slow worktree holds back no other draw.
  if (showTrees && dropped(treeRead)) {
    const { signal } = ctx
    treeRead = { key, signal }
    for (const t of trees.slice(1).filter(t => !t.gone && t.path !== root))
      $.clock.after(0, () =>
        $.process
          .run(['git', '--no-optional-locks', '-C', t.path, 'status', '--porcelain'], { timeoutMs: 5000 })
          .then(
            r => (r.exitCode ? null : r.stdout.split('\n').filter(Boolean).length),
            () => null,
          )
          .then(count => {
            // A run lost with a dropped draw says nothing about the worktree: the next draw reads it again.
            if (count === null && signal.aborted) return
            treeStatus.set(t.path, count)
            $.ui.invalidate('ui.render')
          }),
      )
  }
  const views = await read($, prViews)
  const commitViewsNow = await read($, commitViews)
  // The branch modal: the tree of local branches, the current one lit; it opens on it. Rows only inform.
  const branchModal = () => {
    const defaultName = (defaultRun?.exitCode === 0 && defaultRun.stdout.trim().replace(/^origin\//, '')) || 'main'
    const list = branches(refs?.exitCode === 0 ? refs.stdout : '', prs, worktreeList, defaultName)
    // The worktrees view only while there is a linked worktree; else base.
    const by = showTrees ? 'worktrees' : view.by === 'worktrees' ? 'base' : view.by
    const tree = by === 'worktrees' ? [] : treeRows(list, by, view.showMerged)
    const merged = by === 'worktrees' ? 0 : list.filter(b => b.pr?.state === 'merged').length
    const linkedTrees = trees.slice(1)
    // Columns: sync, the PR with its mark, age. Each as wide as its widest cell, 2 columns apart and 2 past the
    // widest name, so they read with it; a column no row fills is dropped.
    const shown = tree.flatMap(r => (r.branch ? [r.branch] : []))
    const cols = [
      Math.max(0, ...shown.map(b => toPieces(syncOf(b)).map(x => x.text).join('').length)),
      Math.max(0, ...shown.map(b => (b.pr ? `#${b.pr.n}`.length + 2 : 0))),
      Math.max(0, ...shown.map(b => age(b.at, now).length)),
    ]
    const colsWidth = cols.filter(Boolean).reduce((n, w) => n + w + 2, 0)
    // ⎇ on the current branch and ⧉ on a worktree's, each 2 columns.
    const marks = (name?: string, worktree?: boolean) => (name === hd.name ? 2 : 0) + (worktree ? 2 : 0)
    const widestBranch = Math.max(0, ...tree.map(r => r.guide.length + r.label.length + marks(r.branch?.name, r.branch?.worktree)))
    const synced = new Map(list.map(b => [b.name, b]))
    // The worktrees view's columns: sync, then changed files or gone.
    const treeCells = linkedTrees.map(t => {
      const b = t.branch ? synced.get(t.branch) : undefined
      const changed = t.path === root ? files.length : treeStatus.get(t.path)
      return [
        !t.gone && b ? syncOf(b) : null,
        t.gone ? <Text color={HUD.faint}>gone</Text> : changed === null ? <Text color="warning">? changed</Text> : changed ? <Text color={HUD.faint}>{`${changed} changed`}</Text> : null,
      ]
    })
    const treeCols = [0, 1].map(i => Math.max(0, ...treeCells.map(cells => textLength(cells[i]))))
    const treeColsWidth = treeCols.filter(Boolean).reduce((n, w) => n + w + 2, 0)
    const widestTree = Math.max(0, ...linkedTrees.map(t => t.branch?.length ?? 8 + where(t.path).length))
    const viewNames = ['base', 'prefix', ...(trees.length > 1 ? (['worktrees'] as const) : [])] as const
    // The actions row needs each label, 2 between, then the ✕; the merged row its words and `show`.
    const actsWidth = viewNames.reduce((n, one) => n + one.length + 4, 1)
    const mergedWidth = merged ? `${merged} merged hidden`.length + 6 : 0
    const rowsWidth = by === 'worktrees' ? widestTree + treeColsWidth : widestBranch + colsWidth
    // As wide as its rows, not the pane: columns sit with the names and the frame leaves no blank right side.
    const f = contentFrame(modalRows(4 + (by === 'worktrees' ? linkedTrees.length : tree.length) + (merged ? 2 : 0)), Math.max(actsWidth, mergedWidth, rowsWidth))
    const inner = f.width - 4
    const room = inner - colsWidth
    const treeNameCol = Math.min(room, widestBranch)
    // Sync and changes kept whole, the name cut to the rest. Only a detached one's path shows, as its id names no
    // folder; it takes what is left, and under 4 columns shows not at all.
    const left = inner - treeColsWidth
    // Sync and changes follow the widest name: with no path to fill it, the far right leaves a gulf.
    const nameCol = Math.min(left, widestTree)
    const worktreeRow = (t: (typeof trees)[number], i: number) => {
      const name = fit(t.branch ?? t.head.slice(0, 7), left)
      const pathRoom = left - name.length - 1
      const at = name.indexOf('/')
      const label = t.path === root ? [<Text bold color={HUD.action}>{name}</Text>]
        : !t.branch ? [<Text color={HUD.faint}>{name}</Text>]
        : at < 0 ? [<Text>{name}</Text>]
        : [<Text color={prefixColor(name.slice(0, at + 1))}>{name.slice(0, at + 1)}</Text>, <Text>{name.slice(at + 1)}</Text>]
      return (
        <Box gap={2} backgroundColor={t.path === root ? LIT : undefined}>
          <Box width={nameCol} flexShrink={0}>
            {label}
            {!t.branch && pathRoom >= 4 ? <Text color={HUD.faint}>{` ${endOf(printable(where(t.path)), pathRoom)}`}</Text> : null}
          </Box>
          {treeCells[i]!.flatMap((cell, c) => (treeCols[c] ? [<Box width={treeCols[c]} justifyContent="flex-end">{cell}</Box>] : []))}
        </Box>
      )
    }
    const rows = by === 'worktrees' ? linkedTrees.map(worktreeRow) : tree.map(r => {
      const b = r.branch
      const isCurrent = b?.name === hd.name
      const at = r.label.indexOf('/')
      const rest = room - r.guide.length - marks(b?.name, b?.worktree)
      const label = isCurrent
        ? [<Text bold color={HUD.action}>⎇ </Text>, <Text bold color={HUD.action}>{fit(r.label, rest)}</Text>]
        : r.heading || at < 0
          ? [<Text color={r.heading ? prefixColor(r.heading) : undefined}>{fit(r.label, rest)}</Text>]
          : [<Text color={prefixColor(r.label.slice(0, at + 1))}>{r.label.slice(0, at + 1)}</Text>, <Text>{fit(r.label.slice(at + 1), rest - at - 1)}</Text>]
      return (
        <Box gap={2} backgroundColor={isCurrent ? LIT : undefined}>
          <Box width={b ? treeNameCol : undefined} flexShrink={0}>
            {r.guide ? <Text color={HUD.faint}>{r.guide}</Text> : null}
            {label}
            {b?.worktree ? <Text color={HUD.faint}> ⧉</Text> : null}
          </Box>
          {b
            ? [
                syncOf(b),
                b.pr ? (
                  <Text>
                    <Text color={HUD.faint}>{`#${b.pr.n} `}</Text>
                    {b.pr.state === 'merged' ? <Text color={HUD.label}>{'\uf419'}</Text> : glyph(worst(b.pr.checks))}
                  </Text>
                ) : null,
                <Text color={HUD.faint}>{age(b.at, now)}</Text>,
              ].flatMap((cell, i) => (cols[i] ? [<Box width={cols[i]} justifyContent="flex-end">{cell}</Box>] : []))
            : null}
        </Box>
      )
    })
    if (merged)
      rows.push(
        <Text color="promptBorder">{'─'.repeat(inner)}</Text>,
        <Box justifyContent="space-between">
          <Text color={HUD.faint}>{`${merged} merged${view.showMerged ? '' : ' hidden'}`}</Text>
          <Button key="m:merged" plain onPress={() => update($, branchView, v => ({ ...v, showMerged: !v.showMerged }))}>
            <Text color="claude">{view.showMerged ? 'hide' : 'show'}</Text>
          </Button>
        </Box>,
      )
    // The chosen view is plain text; only the other is a button, and switching opens on the current branch again.
    const acts = viewNames.map(one => {
      const label = `${one === 'base' ? '\uf419' : one === 'prefix' ? '\uea83' : '⧉'} ${one}`
      return by === one ? (
        <Text color="claude">{label}</Text>
      ) : (
        <Button key={`m:by:${one}`} plain dimColor onPress={() => Promise.all([update($, branchView, v => ({ ...v, by: one })), update($, modal, m => m && { ...m, top: -1 })])}>
          {label}
        </Button>
      )
    })
    const here = by === 'worktrees' ? linkedTrees.findIndex(t => t.path === root) : tree.findIndex(r => r.branch?.name === hd.name)
    return drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top, here)
  }
  const inner = modalRows(0).width - 4
  const line = (left: JSX.Element | JSX.Element[], right?: JSX.Element) => kitLine(ctx.el, left, right)
  const heading = (label: string, right?: JSX.Element) => kitHeading(ctx.el, label, right)
  const rule = <Text color="promptBorder">{'─'.repeat(inner)}</Text>
  const showAll = (label: string) => (
    <Box>
      <Text>  </Text>
      <Button key={`m:all:${label}`} plain onPress={() => update($, modal, m => m && { ...m, sub: { key: label, top: 0 } })}>
        <Text color="claude">show all</Text>
      </Button>
    </Box>
  )
  // A check: its mark and name, its run time at the right.
  const checkLine = (c: Check) => line([<Text> </Text>, glyph(c.state), <Text>{` ${c.name}`}</Text>], <Text color={c.state === 'run' ? 'claude' : HUD.faint}>{c.time}</Text>)
  // `full`: the rows a stacked modal shows at its own width, where they wrap to it.
  type Section = { label: string; right?: JSX.Element; rows: JSX.Element[]; shown?: JSX.Element[]; from?: number; full?: (inner: number) => JSX.Element[] }
  // A modal of sections under a head: each list capped, "show all" opening it whole in a stacked modal.
  const sectionModal = (head: JSX.Element[], sections: Section[], acts: JSX.Element[], subActs: (label: string) => JSX.Element[]) => {
    const rows = [
      ...head,
      ...sections.flatMap(one => {
        const cap = capped(one.rows, one.from)
        return [rule, heading(one.label, one.right), ...(one.shown ?? cap.rows), ...(cap.more ? [showAll(one.label)] : [])]
      }),
    ]
    const f = modalRows(4 + rows.length)
    const sub = open?.sub && sections.find(one => one.label === open.sub!.key)
    // As for a modal: a stacked one whose list has gone closes.
    if (open?.sub && !sub && !ctx.signal.aborted) $.clock.after(0, () => ctx.setModal(m => (m?.sub?.key === open.sub!.key ? { ...m, sub: undefined } : m)))
    // The stacked modal is drawn after the modal, not in it, so the modal's border never paints over it.
    const stacked = sub && (() => {
      const width = stackFrame(props.bodyColumns, tabRows, f, 0).width - 4
      const all = sub.full?.(width) ?? sub.rows
      const sf = stackFrame(props.bodyColumns, tabRows, f, 5 + all.length)
      return drawLayer('s', sf, { top: sf.top, left: sf.left - PAD }, subActs(sub.label), [heading(sub.label, sub.right)], all, open!.sub!.top)
    })()
    return [drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top), stacked || null]
  }
  // A Markdown body 1 column in, numbers in counted()'s colour, code spans in the colour the engine gives them,
  // fence lines through the engine's highlighter.
  const mdBody = (body: string, width: number) =>
      mdRows(body, width - 1).map(r =>
        'code' in r ? (
          <Box paddingLeft={1}>
            <Code source={r.code || ' '} language={r.language} wrap="truncate-end" />
          </Box>
        ) : (
          <Text>
            {' '.repeat(1 + r.indent)}
            {r.spans.map(sp =>
              sp.href ? (
                <Link href={sp.href}>
                  <Text>{sp.text}</Text>
                </Link>
              ) : sp.code ? (
                <Text color="permission">{sp.text}</Text>
              ) : (
                <Text bold={sp.bold} italic={sp.italic}>
                  {counted(sp.text)}
                </Text>
              ),
            )}
          </Text>
        ),
      )
  const VERB: Record<PrState, string> = { open: 'opened', draft: 'drafted', merged: 'merged', closed: 'closed' }
  // The PR modal: title and who and when, then its sections, each capped with "show all" opening it stacked.
  const prModal = () => {
    if (!pr) return null
    const view = views[pr.n]
    // A merged or closed PR's checks have all finished.
    const ended = pr.state === 'merged' || pr.state === 'closed'
    const checks = sortChecks(ended ? pr.checks.map(c => (c.state === 'run' ? { ...c, state: 'ok' as const, time: '' } : c)) : pr.checks)
    const passed = checks.filter(c => c.state === 'ok').length
    // The body 1 column in, numbers in counted()'s colour, code spans in the colour the engine gives them, fence
    // lines through the engine's highlighter.
    const descRows = (width: number) => mdBody(view?.body ?? '', width)
    const desc = descRows(inner)
    // A failed check's last log lines, red-edged under its row at the name's column: the row names the check.
    const logged = view?.log && checks.find(c => c.name === view.log!.check)
    const withLog = (list: Check[]) =>
      list.flatMap(c => [checkLine(c), ...(c === logged ? view!.log!.lines.map(text => line([<Text>   </Text>, <Text color={TYPES.fix}>▎</Text>, <Text color={HUD.faint}>{text}</Text>])) : [])])
    const cols = churnCols((view?.files ?? []).map(f => ({ add: f.additions, del: f.deletions })))
    const files = (width: number, layer: 'm' | 's' = 's') =>
      (view?.files ?? []).map(f => fileRow(<Text color={STATUS[f.status] ?? HUD.faint}>{` ${f.status}`}</Text>, f.path, f.additions, f.deletions, width, layer, f.status === 'D', cols))
    const sections: Section[] = [
      ...(desc.length
        ? [{
            label: 'DESCRIPTION',
            rows: desc,
            full: descRows,
          }]
        : []),
      {
        label: 'CHECKS',
        right: <Text color={HUD.faint}>{`${passed} of ${checks.length} passed`}</Text>,
        // Counted and capped by check; the log rides under its check, in the modal and stacked.
        rows: checks.map(checkLine),
        shown: withLog(capped(checks).rows),
        full: () => withLog(checks),
      },
      ...(view
        ? [
            {
              label: 'COMMITS',
              right: <Text color={HUD.faint}>{`${view.commits.length} total`}</Text>,
              rows: view.commits.map(c => line([<Text> </Text>, ...subjectTexts(c.subject)], <Text color={HUD.faint}>{ago(c.at, now)}</Text>)),
            },
            {
              label: 'FILES',
              right: (
                <Text>
                  <Text color={HUD.faint}>{`${view.files.length} total  `}</Text>
                  {churnOf(view.files.reduce((n, f) => n + f.additions, 0), view.files.reduce((n, f) => n + f.deletions, 0))}
                </Text>
              ),
              rows: files(inner, 'm'),
              full: files,
            },
          ]
        : []),
    ]
    const failedRuns = [...new Set(checks.filter(c => c.state === 'bad' && c.run).map(c => c.run!))]
    const rerun = (layer: 'm' | 's') => (
      <Button key={`${layer}:rerun`} plain onPress={() => ctx.rerunFailed(failedRuns)}>
        <Text color="claude">{'\uebc0 rerun'}</Text>
      </Button>
    )
    // Each action its icon and one word in the accent, as the mockup's buttons; github is a link, so the terminal
    // opens the page.
    const acts = [
      <Link href={pr.url}>
        <Text color="claude">{'\uf408 github'}</Text>
      </Link>,
      <Button key="m:copy" plain onPress={press => $.ui.copy({ text: pr.url, surface: press.surface })}>
        <Text color="claude">{'\uf44c copy'}</Text>
      </Button>,
      ...(failedRuns.length ? [rerun('m')] : []),
    ]
    return sectionModal(
      [
        line(subjectTexts(pr.title, Infinity, true)),
        line([<Text color="claude">{` #${pr.n}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{pr.author}</Text>], <Text color={HUD.faint}>{`${VERB[pr.state]} ${ago(pr.at, now)}`}</Text>),
        ...(pr.conflicting && conflictFiles.length
          ? [line([<Text color={TYPES.fix}> ✗</Text>, <Text>{` conflicts in ${conflictFiles.map(path => path.slice(path.lastIndexOf('/') + 1)).join(', ')}`}</Text>])]
          : []),
      ],
      sections,
      acts,
      label => (label === 'CHECKS' && failedRuns.length ? [rerun('s')] : []),
    )
  }
  // The commit modal: the subject, who and when, its refs; then its body and files, each capped with "show all".
  const commitModal = () => {
    const opened = open?.sha ? commitViewsNow[open.sha] : undefined
    if (!opened) return null
    const { row, view } = opened
    const cols = churnCols((view?.files ?? []).map(f => ({ add: f.additions, del: f.deletions })))
    const files = (width: number, layer: 'm' | 's' = 's') =>
      (view?.files ?? []).map(f => fileRow(<Text color={STATUS[f.status] ?? HUD.faint}>{` ${f.status}`}</Text>, f.path, f.additions, f.deletions, width, layer, f.status === 'D', cols))
    const sections: Section[] = [
      ...(view?.body ? [{ label: 'DESCRIPTION', rows: mdBody(view.body, inner), full: (width: number) => mdBody(view.body, width) }] : []),
      ...(view
        ? [{
            label: 'FILES',
            right: (
              <Text>
                <Text color={HUD.faint}>{`${view.files.length} total  `}</Text>
                {churnOf(view.files.reduce((n, f) => n + f.additions, 0), view.files.reduce((n, f) => n + f.deletions, 0))}
              </Text>
            ),
            rows: files(inner, 'm'),
            full: files,
          }]
        : []),
    ]
    // A page only for a commit some remote surely has: not when the unpushed list failed.
    const href = local && !local.has(row.full) && web?.commit(row.full)
    const acts = [
      ...(href
        ? [
            <Link href={href}>
              <Text color="claude">{'\uf408 github'}</Text>
            </Link>,
          ]
        : []),
      <Button key="m:copy" plain onPress={press => $.ui.copy({ text: row.full, surface: press.surface })}>
        <Text color="claude">{'\uf44c copy'}</Text>
      </Button>,
    ]
    return sectionModal(
      [
        line(subjectTexts(row.subject, Infinity, true)),
        line([<Text color="claude">{` ${row.short}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{row.author}</Text>], <Text color={HUD.faint}>{ago(row.at, now)}</Text>),
        ...(row.refs.length || row.tags.length ? [line([<Text> </Text>, ...refTexts(row.refs, row.tags)])] : []),
      ],
      sections,
      acts,
      () => [],
    )
  }
  // The rebase or merge modal: the commit it stopped on, the steps with Overview's marks, the files to fix.
  const rebaseModal = () => {
    if (!op) return null
    const rebase = op.kind === 'rebase'
    const ready = !blocked
    const runGit = async (argv: string[]) => {
      if (gitActing) return
      gitActing = true
      try {
        // No editor: continue and commit keep the message git wrote.
        const run = await $.process.run(['git', '-c', 'core.editor=true', ...argv]).catch(() => undefined)
        if (run?.exitCode !== 0) $.ui.toast(`git ${argv[0]} failed: ${(run?.stderr ?? '').split('\n')[0]}`)
        // Closed: a rebase that ended must not open it again at the next one; a new stop is a click away.
        await ctx.setModal(() => null)
        await update($, toolCalls, n => n + 1)
      } finally {
        gitActing = false
      }
    }
    // abort throws work away (red); continue and commit go forward (green) once nothing blocks them.
    // abort and skip lose work, and sit side by side: the first press asks, the second runs.
    const act = (word: string, icon: string, argv: string[]) => {
      const asks = word === 'abort' || word === 'skip'
      // Held for this step only: the rebase may move on while the modal stays open.
      const ask = `${word}:${rebase ? op.at : ''}`
      const asking = open?.armed === ask
      return (
        <Button key={`m:${word}`} plain onPress={() => (asks && !asking ? ctx.setModal(m => m && { ...m, armed: ask }) : runGit(argv))}>
          {/* The mockup's buttons: abort throws work away (error); continue and commit go forward (success) once
              nothing blocks them; else the accent. */}
          <Text color={word === 'abort' || asking ? 'error' : ready && (word === 'continue' || word === 'commit') ? 'success' : 'claude'}>{`${icon} ${word}${asking ? '?' : ''}`}</Text>
        </Button>
      )
    }
    const acts = rebase
      ? [act('continue', '', ['rebase', '--continue']), act('skip', '', ['rebase', '--skip']), act('abort', '', ['rebase', '--abort'])]
      : [act('commit', '', ['commit', '--no-edit']), act('abort', '', [op.verb ?? 'merge', '--abort'])]
    const mark = (m: 'done' | 'stop' | 'todo') =>
      m === 'done' ? <Text color={HUD.action}>✓</Text>
      : m === 'todo' ? <Text color={HUD.faint}>○</Text>
      : blocked ? <Text color={TYPES.fix}>✗</Text>
      : <Text color={HUD.dirty}>■</Text>
    const cols = churnCols(op.conflicts.map(c => ({ add: c.additions, del: c.deletions })))
    const conflicts = (width: number, layer: 'm' | 's' = 's') =>
      op.conflicts.map(c => fileRow(<Text color={op.resolved ? HUD.action : TYPES.fix}>{` ${op.resolved ? 'M' : 'U'}`}</Text>, c.path, c.additions, c.deletions, width, layer, false, cols))
    const commits: Section = rebase
      ? {
          label: 'COMMITS',
          right: <Text color={HUD.faint}>{`${op.steps.length} total`}</Text>,
          rows: op.steps.map(st =>
            line(
              [<Text> </Text>, mark(st.mark), <Text> </Text>, ...(st.mark === 'todo' ? [<Text color={HUD.faint}>{st.subject}</Text>] : subjectTexts(st.subject))],
              <Text color={HUD.faint}>{st.sha}</Text>,
            ),
          ),
          from: op.at - 1,
        }
      : {
          label: 'COMMITS',
          right: <Text color={HUD.faint}>{`${op.incoming.length} total`}</Text>,
          rows: op.incoming.map(c => line([<Text> </Text>, ...subjectTexts(c.subject)], <Text color={HUD.faint}>{ago(c.at, now)}</Text>)),
        }
    const files: Section[] = op.conflicts.length
      ? [{
          label: op.resolved ? 'RESOLVED' : 'CONFLICTS',
          right: <Text color={HUD.faint}>{`${op.conflicts.length} total`}</Text>,
          rows: conflicts(inner, 'm'),
          full: conflicts,
        }]
      : []
    const stop = rebase ? op.steps[op.at] : undefined
    const head = rebase
      ? [
          line(subjectTexts(stop?.subject ?? '', Infinity, true)),
          line(<Text color="claude">{` ${stop?.sha ?? ''}`}</Text>, <Text color={HUD.faint}>{`step ${op.at + 1} of ${op.steps.length}${op.edit ? ', stopped to edit' : ''}`}</Text>),
        ]
      : [
          line(<Text bold>{op.verb ? (op.incoming[0]?.subject ?? op.from) : `Merge branch '${op.from}' into ${op.head}`}</Text>),
          line(<Text color="claude">{` ${op.sha}`}</Text>, <Text color={HUD.faint}>{plural(op.incoming.length, 'incoming commit')}</Text>),
        ]
    return sectionModal(head, [commits, ...files], acts, () => [])
  }
  // The summary modal: each PR as two rows between dividers; a PR opens its own details stacked over it.
  const summaryModal = () => {
    if (!summary) return null
    const label = `${summary.list.length} PRs`
    const block = (p: Pr) => [
      <Box justifyContent="space-between">
        <Button key={`m:pr:${p.n}`} plain onPress={() => update($, modal, m => m && { ...m, sub: { key: `pr:${p.n}`, top: 0 } })}>
          <Text color="claude">{` #${p.n} `}</Text>
          {subjectTexts(p.title, inner - 22)}
        </Button>
        <Box>
          {glyph(worst(p.checks))}
          <Text> </Text>
          {pill(p.state)}
        </Box>
      </Box>,
      line([<Text>{`  ${p.author}`}</Text>, <Text color={HUD.faint}>{' from '}</Text>, <Text color={HUD.faint}>{p.head}</Text>], <Text color={HUD.faint}>{ago(p.at, now)}</Text>),
    ]
    const join = (blocks: JSX.Element[][]) => blocks.flatMap((b, i) => (i ? [rule, ...b] : b))
    const blocks = summary.list.map(block)
    const cap = capped(blocks)
    const rows = [...join(cap.rows), ...(cap.more ? [showAll(label)] : [])]
    const f = modalRows(4 + rows.length)
    const sub = open?.sub
    const subPr = sub?.key.startsWith('pr:') ? summary.list.find(p => `pr:${p.n}` === sub.key) : undefined
    const at = (sf: Frame) => ({ top: sf.top, left: sf.left - PAD })
    // A PR stacked: its title pinned, who and when, its checks.
    const stacked = !sub ? undefined
      : subPr ? (() => {
          const checks = sortChecks(subPr.checks)
          const runs = [...new Set(checks.filter(c => c.state === 'bad' && c.run).map(c => c.run!))]
          const subRows = [
            line([<Text color="claude">{` #${subPr.n}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{subPr.author}</Text>], <Text color={HUD.faint}>{`${VERB[subPr.state]} ${ago(subPr.at, now)}`}</Text>),
            rule,
            heading('CHECKS', <Text color={HUD.faint}>{`${checks.filter(c => c.state === 'ok').length} of ${checks.length} passed`}</Text>),
            ...checks.map(checkLine),
          ]
          const sf = stackFrame(props.bodyColumns, tabRows, f, 5 + subRows.length)
          const acts = [
            <Link href={subPr.url}>
              <Text>{' github'}</Text>
            </Link>,
            ...(runs.length
              ? [
                  <Button key="s:rerun" plain onPress={() => ctx.rerunFailed(runs)}>
                    <Text>{' rerun'}</Text>
                  </Button>,
                ]
              : []),
          ]
          return drawLayer('s', sf, at(sf), acts, [line(subjectTexts(subPr.title, Infinity, true))], subRows, sub.top)
        })()
      : sub.key === label ? (() => {
          const all = join(blocks)
          const sf = stackFrame(props.bodyColumns, tabRows, f, 5 + all.length)
          return drawLayer('s', sf, at(sf), [], [heading(label.toUpperCase())], all, sub.top)
        })()
      : undefined
    const pulls = summary.list[0]!.url.replace(/\/pull\/\d+$/, '/pulls')
    const acts = [
      <Link href={pulls}>
        <Text>{' github'}</Text>
      </Link>,
    ]
    return [drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top), stacked ?? null]
  }
  const modalBox = !dimmed ? null : open?.key === 'commit' ? commitModal() : open?.key === 'prs' ? summaryModal() : open?.key === 'branch' ? branchModal() : open?.key === 'pr' ? prModal() : open?.key === 'rebase' ? rebaseModal() : null
  const layerZone = modalZone($, 'Git', layers)
  if (layerZone) drawn.push(layerZone)
  const body = !head ? (
    // The rows under the tabs and their rule. No answer at all: git is not on PATH, or the surface
    // runs no command.
    status ? (
      emptyNote(
        ctx.el,
        props.scroll.bodyRows - BAR_ROWS - 2,
        'Not a git repository',
        <Text color={HUD.faint}>Branch, changes and commits</Text>,
        <Text color={HUD.faint}>show here inside a repo.</Text>,
      )
    ) : (
      emptyNote(
        ctx.el,
        props.scroll.bodyRows - BAR_ROWS - 2,
        "Git can't run here",
        <Text color={HUD.faint}>It needs git on PATH,</Text>,
        <Text color={HUD.faint}>in a terminal session.</Text>,
      )
    )
  ) : (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {/* The HUD statusline's branch glyph and green; one mark after it only when the branch needs you. */}
        {topRow(
          'branch',
          [<Text color={HUD.action}>{branchLabel}</Text>, linked && <Text color={HUD.faint}> ⧉</Text>, mark && <Text color={MARKS[mark][1]}>{` ${MARKS[mark][0]}`}</Text>],
          [],
          card('card:branch', 0, 'left', upstreamName ? kv('upstream', upstreamName, sync) : kv('upstream', hd.upstream), ...(stashes ? [kv('stash', <Text>{counted(`${stashes} on this branch`)}</Text>)] : [])),
          [...branchLabel].length + (linked ? 2 : 0) + (mark ? 2 : 0),
        )}
        {topRow(
          'fetch',
          [isFetching ? <Text color="claude">◌ fetching</Text> : <Text color={stale ? 'warning' : HUD.faint}>{fetchLabel}</Text>],
          [],
          card(
            'card:fetch',
            0,
            'right',
            kv('fetched', <Text color={stale ? 'warning' : undefined}>{fetchedText}</Text>),
            // The URL cut in the middle to the card: border and padding, the label ("fetched" and 2), "origin  ".
            ...(remoteUrl ? [kv('remote', <Text>origin  <Text color={HUD.faint}>{cutMiddle(remoteUrl, cardWidth - 4 - 9 - 8)}</Text></Text>)] : []),
          ),
          fetchWidth,
        )}
      </Box>
      {opRow}
      {prRow}
      {summaryRow}
      {/* The primer pane's rule color, as every margin rule but History's day lines. */}
      <Text>
        <Text color="promptBorder" hover={dimmed ? undefined : { scope: `line:${topLines.length - 1}`, color: fade('promptBorder') }}>
          {bodyRule}
        </Text>
      </Text>
      {files.length > 0 && (
        <Box justifyContent="space-between">
          <Text bold color={HUD.label}>CHANGES</Text>
          <Box>
            {fits(`${files.length} files`) && <Text color={HUD.faint}>{`${files.length} files`}</Text>}
            {(summed.add || summed.del) && fits(`${files.length} files`, `  +${summed.add} −${summed.del}`) ? (
              <Text>
                {'  '}
                {churnOf(summed.add, summed.del)}
              </Text>
            ) : null}
          </Box>
        </Box>
      )}
      {files.length > 0 && changesRows > 0 && (
        <Box flexDirection="column" height={changesRows}>
          {changesW.above > 0 && changesCues.up}
          {shownChanges.map((c, i) => {
            // The index's letter dim, the worktree's bright; untracked and conflicted both bright, one colour.
            const whole = c.xy === '??' || c.words[0] === 'conflict'
            const letters = [...c.xy].map((l, side) => {
              const color = STATUS[c.words[0] === 'conflict' ? 'U' : l] ?? HUD.faint
              return <Text color={side || whole ? color : dim(color)}>{l}</Text>
            })
            // Two columns in, the letters, then the path and counts as every file list draws them.
            const { left, right } = changeParts([<Text>  </Text>, ...letters], c.path, counts.get(c.path) ?? lineCounts.get(c.path), room - 4, c.dim ? HUD.faint : undefined, changeCols)
            // Plain rows, not kv: a kv value stops at the 75% cap, which would cut the pills.
            const statusRow = (label: string, words: (Stage | Word)[]) => (
              <Text wrap="truncate-end">
                <Text color={HUD.faint}>{label.padEnd(8)}</Text>
                {words.flatMap((s, j) => [...(j ? [<Text> </Text>] : []), ...pill(s)])}
              </Text>
            )
            const status = pillRows(c).map((words, j) => statusRow(j ? '' : 'status', words))
            return topRow(
              fileKey(c.path),
              left,
              right ? [right] : [],
              card(`card:${fileKey(c.path)}`, topRows + 2 + (changesW.above ? 1 : 0) + i, 'center', ...status),
            )
          })}
          {changesW.below > 0 && changesCues.down}
        </Box>
      )}
      {/* Only the terminal and desktop draw a Client: elsewhere the rule stays put. */}
      {files.length > 0 &&
        (Client ? (
          <Client key="divider" module="./divider.tsx" props={{ split: changesRows, min: changesMin, max: changesMax, faded: dimmed, hairline: DIMMED, ...(!dimmed && lastChangeLine && { line: lastChangeLine }) }} height={1} />
        ) : (
          <Text color="promptBorder">{bodyRule}</Text>
        ))}
      {commits.length > 0 && (
        <Box justifyContent="space-between">
          <Text bold color={HUD.label}>COMMITS</Text>
          {/* Unpushed is ahead, gold as everywhere; the total faint. */}
          <Box>
            {aheadCount && fits(aheadCount) && <Text color={AHEAD}>{aheadCount}</Text>}
            {totalCount && fits(aheadCount, totalCount) && <Text color={HUD.faint}>{totalCount}</Text>}
          </Box>
        </Box>
      )}
      {commitsW.above > 0 && commitsCues.up}
      {/* Local commits bright, pushed ones dim; the type colored by what it does (TYPES). */}
      {shownCommits.map(({ full, short, author, at, refs, tags, subject: text }, j) => {
        const isLocal = !!local?.has(full)
        const when = age(at, now)
        // A control character in any text gets the whole pane refused. Two columns in, the age 2 after.
        const shown = fit(text.replace(/[\x00-\x1f\x7f]/g, ' '), room - when.length - 1)
        // "type(scope)!: rest"; a subject cut inside the type part shows plain.
        const [, type, scope, tail, rest] = /^(\w+)(?:\(([^)]*)\))?(!?: )(.*)$/.exec(shown) ?? []
        const known = type ? TYPES[type] : undefined
        const typeColor = !known ? HUD.faint : isLocal ? known : dim(known)
        const left = type
          ? [
              <Text>  </Text>,
              <Text color={typeColor}>{type}</Text>,
              ...(scope === undefined ? [] : [<Text color={HUD.faint}>(</Text>, <Text color={isLocal ? SCOPE : HUD.faint}>{scope}</Text>]),
              <Text color={HUD.faint}>{scope === undefined ? tail : `)${tail}`}</Text>,
              <Text color={isLocal ? undefined : HUD.faint}>{rest}</Text>,
            ]
          : [<Text>  </Text>, <Text color={isLocal ? undefined : HUD.faint}>{shown}</Text>]
        const stat = commitStats.get(full)
        // The author gives way first: the age and counts stay whole. `commit` or `changes`, and 2 more, sets the label.
        const authorRoom = cardWidth - 4 - (stat ? 9 : 8) - 2 - when.length - short.length - 4
        return topRow(
          commitKey(full),
          left,
          [<Text color={HUD.faint}>{when}</Text>],
          card(
            `card:${commitKey(full)}`,
            commitsAt0 + j,
            'center',
            kv('commit', <Text><Text color="claude">{short}</Text><Text color={HUD.faint}>{' by '}</Text><Text>{fit(author, Math.max(1, authorRoom))}</Text></Text>, <Text color={HUD.faint}>{when}</Text>),
            ...(refs.length || tags.length ? [kv('refs', <Text>{refTexts(refs, tags)}</Text>)] : []),
            ...(stat ? [kv('changes', <Text>{counted(plural(stat.files, 'file'))}</Text>, churnOf(stat.add, stat.del))] : []),
          ),
        )
      })}
      {commitsW.below > 0 && commitsCues.down}
      {cards}
      {modalBox}
    </Box>
  )
  // Behind an open modal everything fades but the row that opened it; under a stacked modal the modal fades too.
  return { body, zones: drawn, trace, ...(head && dimmed && { fade: { keep: new Set([layers.s ? 'stack' : 'modal']), open: `${Client ? 'row' : 'hov'}:${openRow}` } }) }
}
