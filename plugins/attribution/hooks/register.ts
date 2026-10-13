import type { Register } from 'claude-code'

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
  on('attribution.text', async ($, e, next) => {
    const r = await next(e)
    return { ...r, text: strip(r.text) }
  })
}
