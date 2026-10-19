import type { EngineInterface } from 'claude-code'

// A hooks module may not hand `$` on, so the tracer gets this view of the calls it makes.
export function traceIo($: EngineInterface): EngineInterface {
  return {
    env: { get: async (n: string) => (n === 'HOME' ? $.env.get('HOME') : n === 'CLAUDE_CONFIG_DIR' ? $.env.get('CLAUDE_CONFIG_DIR') : undefined) },
    session: { id: () => $.session.id() },
    fs: { read: (p: string) => $.fs.read(p), write: (p: string, text: string) => $.fs.write(p, text) },
    process: { run: (argv: string[]) => $.process.run(argv) },
    clock: { after: (ms: number, fn: () => void) => $.clock.after(ms, fn) },
  } as unknown as EngineInterface
}
