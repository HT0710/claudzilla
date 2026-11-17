declare module 'claude-code' {
  interface EngineInterface {
    primer: { open: () => Promise<void> }
  }
  interface PluginState {
    primer: { tocTop: number; bodyTop: number; split: number }
  }
}

export {}
