import type { AgentStatus } from 'claude-code'

export type Tab = 'Git' | 'History' | 'Overview'
export type Step = { text: string; status: 'pending' | 'in_progress' | 'completed'; agents?: string[] }
// An agent the main loop started: the step in progress then, and the turn (user prompt) it came in.
export type Spawn = { id: string; description: string; step: string; turn: number; status: AgentStatus }
export type AgentRow = { id?: string; description: string; status: AgentStatus | 'planned' }
export type Intent = { wants: string; plan: string; steps: Step[]; at: number; ended: boolean; waiting?: boolean; agents?: number; turn?: number }
export type Overview = { topics: string[]; running: boolean; failed?: string }

declare module 'claude-code' {
  interface PluginState {
    panel: { tab: Tab; notices: Tab[]; submitted: number; toolCalls: number; split: number; scrolled: { changes: number; commits: number }; historyTop: number; topicsSplit: number; topicsTop: number; intent: Intent; overview: Overview; spawns: Spawn[]; turns: number; expanded: number }
  }
}
