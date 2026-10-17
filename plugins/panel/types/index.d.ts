export type Tab = 'Git' | 'History' | 'Overview'
export type Step = { text: string; status: 'pending' | 'in_progress' | 'completed' }
export type Intent = { wants: string; plan: string; steps: Step[]; at: number; ended: boolean; waiting?: boolean }
export type Overview = { topics: string[]; running: boolean; failed?: string }

declare module 'claude-code' {
  interface PluginState {
    panel: { tab: Tab; notices: Tab[]; submitted: number; toolCalls: number; split: number; scrolled: { changes: number; commits: number }; historyTop: number; topicsSplit: number; topicsTop: number; intent: Intent; overview: Overview }
  }
}
