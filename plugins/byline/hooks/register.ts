import type { Register } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('byline')

// git.md: no Claude session link in commits or PRs; rules-guard's sessionLink deny stays as the backstop.
const URL = /\s*https?:\/\/claude\.ai\/code\/session_[\w-]+/g

export function strip(text: string): string {
  const out = text
    .split('\n')
    .filter(line => !/^\s*Claude-Session:/.test(line))
    .map(line => line.replace(URL, ''))
    .join('\n')
  return out === text ? text : out.replace(/\n{3,}/g, '\n\n').trimEnd()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await t.flush(traceIo($))
    return next(e)
  })

  on('attribution.text', async ($, e, next) => {
    const r = await next(e)
    const text = strip(r.text)
    t.event('attribution.text', { kind: e.kind, changed: text !== r.text, removed: r.text.length - text.length })
    return { ...r, text }
  })
}
