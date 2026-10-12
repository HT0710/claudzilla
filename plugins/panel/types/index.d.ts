export type Tab = 'Activity' | 'Git' | 'History'

declare module 'claude-code' {
  interface PluginState {
    panel: { tab: Tab; notices: Tab[]; submitted: number; toolCalls: number; split: number; scrolled: { changes: number; commits: number } }
  }
}
