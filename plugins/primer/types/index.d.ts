declare module 'claude-code' {
  interface EngineInterface {
    primer: { open: (opts?: { topic?: string }) => Promise<void> }
  }
  interface PluginState {
    primer: { tocTop: number; bodyTop: number; split: number }
  }
}

export {}
