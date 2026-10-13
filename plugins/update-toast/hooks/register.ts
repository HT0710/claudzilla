import type { EngineInterface, Register } from 'claude-code'

// One line per update event, appended by claude/hooks/claudzilla-update.sh: `<epoch s>\t<kind>\t<text>`.
export type Event = { at: number; kind: 'start' | 'live' | 'fail'; text: string }

const KINDS = ['start', 'live', 'fail']
// The update hook is linked into ~/.claude from the claudzilla clone; the mod itself runs from the plugin cache.
// No link, no lookup: a git -C on an empty path would find the session's own repo.
const FIND = 'f=$(readlink -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/claudzilla-update.sh") && [ -f "$f" ] && git -C "${f%/*}" rev-parse --show-toplevel --absolute-git-dir'

export function parse(line: string): Event | undefined {
  const [at = '', kind = '', ...text] = line.split('\t')
  if (!/^\d+$/.test(at) || !KINDS.includes(kind)) return undefined
  return { at: Number(at), kind: kind as Event['kind'], text: text.join('\t') }
}

// start lines belong to the session that began within 30 s of them, so an open session never takes a newer one's;
// live lines get 5 s of grace, as the SessionStart hook's job may write before the mod reads its clock.
export function due(ev: Event, startedS: number): boolean {
  return ev.kind === 'start' ? Math.abs(ev.at - startedS) <= 30 : ev.at >= startedS - 5
}

export async function watch($: EngineInterface, startedS: number, onFail: (note: string) => void): Promise<void> {
  const found = await $.process.run(['sh', '-c', FIND])
  if (found.exitCode !== 0) return
  const [repo, gd] = found.stdout.trim().split('\n')
  if (!repo || !gd) return
  let rest = ''
  // tail -F reads a trimmed file again from the top.
  const shown = new Set<string>()
  for await (const { stream, text } of $.process.spawn({ argv: ['tail', '-n', '20', '-F', `${gd}/claudzilla-update.events`] })) {
    if (stream !== 'stdout') continue
    const lines = (rest + text).split('\n')
    rest = lines.pop() ?? ''
    for (const raw of lines) {
      const ev = parse(raw)
      if (!ev || !due(ev, startedS) || shown.has(raw)) continue
      shown.add(raw)
      $.ui.toast(ev.text, { timeoutMs: 15000 })
      if (ev.kind === 'fail')
        onFail(`${ev.text}. Only if the user asks, read the log, fix the cause, then run: git -C ${repo} pull --ff-only && ${repo}/install.sh - then report the result.`)
    }
  }
}

export const register: Register = on => {
  let note: string | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started
    const startedS = Math.floor((await $.clock.now()) / 1000)
    // session.start is awaited before the first prompt: the watch runs on detached, for the module's life.
    void watch($, startedS, text => (note = text)).catch(() => {})
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    if (note === undefined) return next(e)
    const context = [...(e.context ?? []), note]
    note = undefined
    return next({ ...e, context })
  })
}
