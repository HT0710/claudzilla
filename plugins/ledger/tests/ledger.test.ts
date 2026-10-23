import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
const MIN = 60_000

type Edits = Record<string, { session: string; at: number }>

// One session `me` at time `now`, the engine's edit tools answering `isError`; the store is `store`, every send lands in `sent`.
const world = (on: On, { me = 's-b', now = 100 * MIN, edits = {} as Edits, isError = false, delivered = (): boolean => true, real = {} as Record<string, string>, ran = () => {} } = {}) => {
  const sent: { to: unknown; text: string }[] = []
  const store = new Map<string, unknown>([['edits', edits]])
  on('store.get', (_, e) => ({ value: structuredClone(store.get(e.key)) }))
  on('store.set', (_, e) => { store.set(e.key, structuredClone(e.value)); return { value: undefined } })
  mock.clock(on, { now })
  on('session.id', () => ({ value: me }))
  on('fs.stat', (_, e) => (real[e.path] ? { value: { realPath: real[e.path] } } : { deny: 'ENOENT' }) as any)
  on('session.send', (_, e) => {
    sent.push({ to: e.to, text: e.text })
    return delivered() ? { isDelivered: true } : { isDelivered: false, reason: 'no live session' }
  })
  on('tool.call', () => (ran(), isError ? { result: 'failed', isError: true } : { result: { filePath: '/x' } }) as any)
  return { sent, edits: () => store.get('edits') as Edits }
}
const edit = ($: Parameters<TestBody>[0], file_path: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as any)

test('an edit records the file under this session', async ($, on) => {
  const { edits } = world(on)
  await edit($, '/repo/one.ts')
  expect(edits()['/repo/one.ts']).toEqual({ session: 's-b', at: 100 * MIN })
})

test('a file another session edited 4 min ago: first edit paused, that session told, retry passes', async ($, on) => {
  const { sent, edits } = world(on, { edits: { '/repo/two.ts': { session: 's-a', at: 96 * MIN } } })
  const first = await edit($, '/repo/two.ts')
  expect(first.deny).toContain('/repo/two.ts')
  expect(first.deny).toContain('4 min ago')
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('/repo/two.ts')
  expect(sent[0]?.to).toBe('s-a')
  expect(edits()['/repo/two.ts']?.session).toBe('s-a')
  const retry = await edit($, '/repo/two.ts')
  expect(retry.deny).toBeUndefined()
  expect(sent).toHaveLength(1)
  expect(edits()['/repo/two.ts']?.session).toBe('s-b')
})

test('an edit older than 30 min passes untold', async ($, on) => {
  const { sent, edits } = world(on, { edits: { '/repo/three.ts': { session: 's-a', at: 69 * MIN } } })
  expect((await edit($, '/repo/three.ts')).deny).toBeUndefined()
  expect(sent).toHaveLength(0)
})

test('this session\'s own earlier edit passes untold', async ($, on) => {
  const { sent, edits } = world(on, { edits: { '/repo/four.ts': { session: 's-b', at: 99 * MIN } } })
  expect((await edit($, '/repo/four.ts')).deny).toBeUndefined()
  expect(sent).toHaveLength(0)
})

test('the other session gone: the edit passes and takes the entry', async ($, on) => {
  const { edits } = world(on, { edits: { '/repo/five.ts': { session: 's-a', at: 99 * MIN } }, delivered: () => false })
  expect((await edit($, '/repo/five.ts')).deny).toBeUndefined()
  expect(edits()['/repo/five.ts']?.session).toBe('s-b')
})

test('an undelivered send leaves the file\'s one pause unused', async ($, on) => {
  let delivered = false
  const { edits } = world(on, { edits: { '/repo/ten.ts': { session: 's-a', at: 99 * MIN } }, delivered: () => delivered })
  expect((await edit($, '/repo/ten.ts')).deny).toBeUndefined()
  edits()['/repo/ten.ts'] = { session: 's-c', at: 100 * MIN }
  delivered = true
  expect((await edit($, '/repo/ten.ts')).deny).toBeDefined()
})

test('a file a Write creates through a link is keyed where it lands', async ($, on) => {
  const real: Record<string, string> = {}
  const { edits } = world(on, { real, ran: () => { real['/home/u/.claude/rules/new.md'] = '/clone/rules/new.md' } })
  await $.tool.call({ tool: 'Write', file_path: '/home/u/.claude/rules/new.md', content: '' } as any)
  expect(Object.keys(edits())).toEqual(['/clone/rules/new.md'])
})

test('a failed edit records nothing', async ($, on) => {
  const { edits } = world(on, { isError: true })
  await edit($, '/repo/six.ts')
  expect(edits()['/repo/six.ts']).toBeUndefined()
})

test('Write and NotebookEdit are watched too', async ($, on) => {
  const { sent, edits } = world(on, { edits: { '/repo/a.ts': { session: 's-a', at: 99 * MIN }, '/repo/n.ipynb': { session: 's-a', at: 99 * MIN } } })
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: '' } as any)).deny).toBeDefined()
  expect((await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb', new_source: '' } as any)).deny).toBeDefined()
  expect(sent).toHaveLength(2)
})

test('a path through a symlink is keyed by where it lands', async ($, on) => {
  const { edits } = world(on, { edits: { '/clone/rules/git.md': { session: 's-a', at: 99 * MIN } }, real: { '/home/u/.claude/rules/git.md': '/clone/rules/git.md' } })
  expect((await edit($, '/home/u/.claude/rules/git.md')).deny).toContain('/home/u/.claude/rules/git.md')
})

test('entries past 30 min are pruned on write', async ($, on) => {
  const { edits } = world(on, { edits: { '/repo/old.ts': { session: 's-a', at: 10 * MIN } } })
  await edit($, '/repo/seven.ts')
  expect(edits()['/repo/old.ts']).toBeUndefined()
})

test('session end drops this session\'s entries, keeps others\'', async ($, on) => {
  const { edits } = world(on, { edits: { '/repo/mine.ts': { session: 's-b', at: 99 * MIN }, '/repo/theirs.ts': { session: 's-a', at: 99 * MIN } } })
  on('session.end', () => ({ sessionId: 's-b' }))
  await $.session.end({ reason: 'other' } as any)
  expect(Object.keys(edits())).toEqual(['/repo/theirs.ts'])
})

// The trace file lands through fs.write; these handlers stand in beneath the mod, as in the other plugins' trace tests.
const traced = async ($: Parameters<TestBody>[0], on: On) => {
  const files = new Map<string, string>()
  on('env.get', (_, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' } as Record<string, string>)[e.name] }))
  on('fs.read', () => ({ deny: 'no marker' }))
  on('fs.write', (_, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's-b' }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  return () => [...files.entries()].find(([p]) => p.endsWith('s-b.ledger.jsonl'))![1].trim().split('\n').map(l => JSON.parse(l))
}

test('traces each recorded edit and the session-end cleanup', async ($, on) => {
  world(on, { edits: { '/repo/old.ts': { session: 's-a', at: 10 * MIN }, '/repo/mine.ts': { session: 's-b', at: 99 * MIN } } })
  const rows = await traced($, on)
  await edit($, '/repo/eight.ts')
  await $.session.end({ reason: 'other' } as any)
  expect(rows().find(r => r.event === 'ledger.record')?.data).toEqual({ pruned: 1 })
  expect(rows().find(r => r.event === 'ledger.end')?.data).toEqual({ dropped: 2 })
})

test('a store that fails lets the edit through and traces the error', async ($, on) => {
  let ran = 0
  on('store.get', () => ({ deny: 'store broken' }))
  on('session.id', () => ({ value: 's-b' }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  mock.clock(on, { now: 100 * MIN })
  on('tool.call', () => { ran++; return { result: { filePath: '/x' } } as any })
  const rows = await traced($, on)
  expect((await edit($, '/repo/nine.ts')).deny).toBeUndefined()
  expect(ran).toBe(1)
  await $.session.end({ reason: 'other' } as any)
  expect(rows().filter(r => r.event === 'ledger.failed').map(r => r.data.at)).toEqual(['check', 'record', 'end'])
})
