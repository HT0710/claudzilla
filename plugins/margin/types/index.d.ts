import type { AgentStatus } from 'claude-code'

export type Tab = 'Overview' | 'Decisions' | 'History' | 'File' | 'Tree' | 'Git'
export type Step = { text: string; status: 'pending' | 'in_progress' | 'completed'; agents?: string[] }
// An agent the main loop started: the step in progress then, and the turn (user prompt) it came in.
export type Spawn = { id: string; description: string; step: string; turn: number; status: AgentStatus }
export type AgentRow = { id?: string; description: string; status: AgentStatus | 'planned' }
export type Intent = { wants: string; plan: string; steps: Step[]; at: number; ended: boolean; waiting?: boolean; agents?: number; turn?: number }
export type Overview = { topics: string[]; running: boolean; failed?: string }
export type PanelShow = { path: string; line: number }
export type Panel = { show: (at: PanelShow) => Promise<void> }
// `text`: the lines around `line`, from line number `first`; empty when the file cannot be shown.
export type FileView = { path: string; line: number; first: number; text: string } | undefined

export type CheckState = 'bad' | 'run' | 'ok' | 'skip'
// `run` and `job`: the Actions ids in its details link, for a rerun and its log.
export type Check = { state: CheckState; name: string; time: string; job?: string; run?: string }
export type PrState = 'open' | 'draft' | 'merged' | 'closed'
// `at`: when it was opened, merged or closed, as its state says.
export type Pr = {
  n: number; title: string; state: PrState; head: string; base: string; author: string; at: number
  additions: number; deletions: number; files: number; conflicting: boolean; checks: Check[]; url: string
}
export type Counts = { add: number; del: number } | 'bin'
// One CHANGES row: git's two status letters, dim when only staged, and the card's words.
export type Stage = 'staged' | 'not staged'
export type Word = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'
export type Change = { path: string; xy: string; dim: boolean; stage: Stage[]; words: Word[] }
// One COMMITS row: `at` in ms; `refs` the branches pointing at it, `remote` '' for a local one; `tags` tag names.
export type LogRow = { full: string; short: string; author: string; at: number; refs: { remote: string; branch: string }[]; tags: string[]; subject: string }
export type CommitView = { body: string; files: { path: string; status: string; additions: number; deletions: number }[] }
export type PrView = {
  body: string
  commits: { subject: string; at: number }[]
  files: { path: string; status: string; additions: number; deletions: number }[]
  log?: { check: string; lines: string[] }
}
// `remote`: the origin URL the list was read for.
export type Gh = { at: number; remote: string; prs: Pr[] }
export type RebaseStep = { sha: string; subject: string; mark: 'done' | 'stop' | 'todo' }
export type Conflict = { path: string; additions: number; deletions: number }
export type Op =
  | { kind: 'rebase'; head: string; onto: string; steps: RebaseStep[]; at: number; edit: boolean; conflicts: Conflict[]; resolved: boolean }
  | { kind: 'merge'; verb?: 'cherry-pick' | 'revert'; head: string; from: string; sha: string; incoming: { subject: string; at: number }[]; conflicts: Conflict[]; resolved: boolean }
export type Branch = { name: string; base?: string; ahead: number; behind: number; upstream: 'ok' | 'local' | 'gone'; pr?: Pr; worktree: boolean; at: number }
export type ModalKey = 'branch' | 'pr' | 'prs' | 'rebase' | 'commit'
// `top`: the first list row shown; `sub`: the stacked modal over it, keyed by its section; `sha`: the commit modal's.
export type Modal = { key: ModalKey; top: number; sub?: { key: string; top: number }; sha?: string; n?: number; armed?: string }

declare module 'claude-code' {
  interface EngineInterface {
    margin: Panel
  }
  interface PluginState {
    margin: { tab: Tab; notices: Tab[]; submitted: number; toolCalls: number; rowPointer: { left: string | null; at: string | null }; split: number; scrolled: { changes: number; commits: number }; historyTop: number; topicsSplit: number; topicsTop: number; intent: Intent; overview: Overview; spawns: Spawn[]; turns: number; expanded: number; file: FileView; modal: Modal | null; fetching: boolean; branchView: { by: 'base' | 'prefix' | 'worktrees'; showMerged: boolean }; gh: Gh; prViews: Record<number, PrView> }
  }
}
