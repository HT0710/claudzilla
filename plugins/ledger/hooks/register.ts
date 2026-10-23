import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'

import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('ledger')

// Long enough to cover a task in progress, short enough that a finished session stops pausing others.
const WINDOW = 30 * 60_000

type Edits = Record<string, { session: string; at: number }>

// Files this session was paused on once; the retry goes through (module state: a hot reload pauses again, harmless).
const paused = new Set<string>()

// The store is one file every session shares; the key is the path the file lands at, so ~/.claude links match the clone.
const where = async ($: EngineInterface, path: string) =>
  (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path

// shortcut: read-modify-write across sessions, so two sessions writing at once can lose one entry; fine for a warning, use a lock file if misses show up.
const record = async ($: EngineInterface, key: string, session: string, now: number) => {
  const edits = ((await $.store.get('edits')) ?? {}) as Edits
  const kept = Object.fromEntries(Object.entries(edits).filter(([, v]) => now - v.at < WINDOW))
  await $.store.set('edits', { ...kept, [key]: { session, at: now } })
  t.event('ledger.record', { pruned: Object.keys(edits).length - Object.keys(kept).length })
}

const guard = async <E extends ToolCallInput>($: EngineInterface, e: E, next: (e: E) => Promise<ToolCallResult>, path: string) => {
  const [key, me, now] = await Promise.all([where($, path), $.session.id(), $.clock.now()])
  // A broken store never blocks an edit: skip the check or the record, trace why.
  const hit = await $.store.get('edits').then(v => ((v ?? {}) as Edits)[key], err => void t.error('ledger.failed', err, { at: 'check' }))
  if (hit && hit.session !== me && now - hit.at < WINDOW && !paused.has(key)) {
    const ago = `${Math.max(1, Math.round((now - hit.at) / 60_000))} min ago`
    const sent = await $.session.send({
      to: { sessionId: hit.session },
      text: `ledger: another session is about to edit ${path}${key === path ? '' : ` (${key})`}, which you edited ${ago}. If you are still changing it, reply to that session with what you are changing.`,
    }).catch(() => ({ isDelivered: false }))
    t.event('ledger.pause', { delivered: sent.isDelivered })
    if (sent.isDelivered) {
      paused.add(key)
      $.ui.log(`paused an edit of ${path}; told the session that edited it ${ago}`)
      return {
        deny: `ledger: ${path} was edited by another session ${ago}, maybe still in progress. That session has been told and may reply. Re-read the file; if your change touches lines that session changed, wait for its reply or ask the user. The retry goes through. When committing, stage only your own hunks.`,
      }
    }
  }
  const r = await next(e)
  // Resolved again: a Write that created the file had no realPath before it ran.
  if (r.deny === undefined && !r.isError) await record($, await where($, path), me, now).catch(err => t.error('ledger.failed', err, { at: 'record' }))
  return r
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
    try {
      const me = await $.session.id()
      const edits = ((await $.store.get('edits')) ?? {}) as Edits
      const kept = Object.fromEntries(Object.entries(edits).filter(([, v]) => v.session !== me))
      await $.store.set('edits', kept)
      t.event('ledger.end', { dropped: Object.keys(edits).length - Object.keys(kept).length })
    } catch (err) {
      t.error('ledger.failed', err, { at: 'end' })
    }
    await t.flush(traceIo($))
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, ($, e, next) => guard($, e, next, e.file_path))
  on('tool.call', { tool: 'Write' }, ($, e, next) => guard($, e, next, e.file_path))
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => guard($, e, next, e.notebook_path))
}
