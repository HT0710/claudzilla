import { expect, test } from 'claude-code/testing'

import { mask, tracer } from '../hooks/trace'

const DIR = '/cfg/claudzilla-trace'
// Stands for $: a fake fs and process, a clock that holds its timers.
function fake({ off = false, failWrite = false } = {}) {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const timers: [number, () => void][] = []
  const $: any = {
    env: { get: async (k: string) => ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' })[k] },
    session: { id: async () => 's1' },
    fs: {
      read: async (p: string) => { if (p === `${DIR}/.off` && off) return ''; throw new Error('ENOENT') },
      write: async (p: string, t: string) => { if (failWrite) throw new Error('EROFS'); files.set(p, t) },
    },
    process: { run: async (a: string[]) => { runs.push(a); return { exitCode: 0 } } },
    clock: { after: (ms: number, fn: () => void) => { timers.push([ms, fn]) } },
  }
  return { $, files, runs, timers }
}
const lines = (t: string) => t.trimEnd().split('\n').map(l => JSON.parse(l))

test('ring keeps newest 2000', async () => {
  const { $, files } = fake()
  const t = tracer('p')
  await t.start($)
  for (let i = 0; i < 2005; i++) t.event('e', { i })
  await t.flush($)
  const rows = lines(files.get(`${DIR}/s1.p.jsonl`)!)
  expect(rows.length).toBe(2000)
  expect(rows[0].data.i).toBe(5)
  expect(rows[1999].data.i).toBe(2004)
})

test('flush writes JSONL with part and session', async () => {
  const { $, files, runs } = fake()
  const t = tracer('panel')
  await t.start($)
  const id = t.event('hello', { a: 1 }, 'warn')
  t.turn()
  const sp = t.span('work')
  sp.end({ b: 2 }, 'error')
  t.error('boom', new Error('bad'), { k: 1 })
  await t.flush($)
  const rows = lines(files.get(`${DIR}/s1.panel.jsonl`)!)
  expect(rows[0]).toMatchObject({ session: 's1', part: 'panel', event: 'hello', id, level: 'warn', data: { a: 1 } })
  expect(rows[0].id).toMatch(/^[0-9a-f]{8}$/)
  expect(rows[0].ts).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/)
  expect(rows[0].turn).toBeUndefined()
  expect(rows[1]).toMatchObject({ event: 'work', id: sp.id, status: 'error', turn: 1, data: { b: 2 } })
  expect(rows[1].end).toBeDefined()
  expect(rows[2]).toMatchObject({ event: 'boom', level: 'error', status: 'error', turn: 1, data: { k: 1, message: 'bad' } })
  expect(rows[2].data.stack.split('\n').length).toBeLessThanOrEqual(5)
  expect(runs.some(r => r.includes('chmod') && r.includes('600'))).toBe(true)
  expect(runs.some(r => r.join(' ').includes('chmod 700'))).toBe(true)
})

test('masks and cuts like node', async () => {
  const { $, files } = fake()
  const t = tracer('p')
  await t.start($)
  t.event('e', { tok: 'sk-ant-api03-' + 'A'.repeat(30), path: '/home/u/proj/x', long: 'ab '.repeat(2000), n: { a: ['/home/u/f'] } })
  await t.flush($)
  const d = lines(files.get(`${DIR}/s1.p.jsonl`)!)[0].data
  expect(d.tok).toBe('[masked]')
  expect(d.path).toBe('~/proj/x')
  expect(d.long).toBe('ab '.repeat(2000).slice(0, 2000) + '…[cut]')
  expect(d.n.a[0]).toBe('~/f')
  expect(mask('a'.repeat(40))).toBe('a'.repeat(40))
})

test('.off → flush writes nothing', async () => {
  const { $, files, runs } = fake({ off: true })
  const t = tracer('p')
  await t.start($)
  expect(t.event('e')).toMatch(/^[0-9a-f]{8}$/)
  await t.flush($)
  expect(files.size).toBe(0)
  expect(runs.length).toBe(0)
})

test('write failure → no throw', async () => {
  const { $ } = fake({ failWrite: true })
  const t = tracer('p')
  await t.start($)
  t.event('e')
  await t.flush($)
})

test('debounce: one timer, flushes 3 s after the last entry', async () => {
  const { $, files, timers } = fake()
  const t = tracer('p')
  await t.start($)
  t.event('a')
  t.event('b')
  expect(timers.length).toBe(1)
  expect(timers[0]![0]).toBe(3000)
  timers[0]![1]()
  await t.flush($)
  expect(lines(files.get(`${DIR}/s1.p.jsonl`)!).length).toBe(2)
})

test('error never throws, even on an odd value', () => {
  const t = tracer('p')
  t.error('x', Object.create(null))
  t.event('y', { n: 1n })
})

test('an event before start still gets ~ on disk', async () => {
  const { $, files } = fake()
  const t = tracer('p')
  t.event('early', { p: '/home/u/secret-proj' })
  await t.start($)
  await t.flush($)
  const row = lines(files.get(`${DIR}/s1.p.jsonl`)!)[0]
  expect(row.data.p).toBe('~/secret-proj')
  expect(row.session).toBe('s1')
})

test('the file stays under 3.5 MiB, newest kept', async () => {
  const { $, files } = fake()
  const t = tracer('p')
  await t.start($)
  for (let i = 0; i < 2000; i++) t.event('e', { i, v: 'ab '.repeat(900) })
  await t.flush($)
  const text = files.get(`${DIR}/s1.p.jsonl`)!
  expect(new TextEncoder().encode(text).length).toBeLessThan(3.5 * 1024 * 1024 + 1000)
  const rows = lines(text)
  expect(rows.length).toBeLessThan(2000)
  expect(rows[rows.length - 1].data.i).toBe(1999)
})

test('a value JSON cannot encode is dropped, later entries still flush', async () => {
  const { $, files } = fake()
  const t = tracer('p')
  await t.start($)
  t.event('a', { n: 1n })
  t.event('b')
  await t.flush($)
  expect(lines(files.get(`${DIR}/s1.p.jsonl`)!).map(r => r.event)).toEqual(['b'])
})

test('a new session starts a clean file, the old one is flushed first', async () => {
  const f = fake()
  let sid = 'A'
  f.$.session.id = async () => sid
  const t = tracer('p')
  await t.start(f.$)
  t.event('a1')
  sid = 'B'
  await t.start(f.$)
  t.event('b1')
  await t.flush(f.$)
  expect(lines(f.files.get(`${DIR}/A.p.jsonl`)!).map(r => r.event)).toEqual(['a1'])
  expect(lines(f.files.get(`${DIR}/B.p.jsonl`)!).map(r => r.event)).toEqual(['b1'])
})

test('failed mkdir: no write, retried on the next flush', async () => {
  const f = fake()
  let code = 1
  f.$.process.run = async (a: string[]) => { f.runs.push(a); return { exitCode: a[0] === 'sh' ? code : 0 } }
  const t = tracer('p')
  await t.start(f.$)
  t.event('e')
  await t.flush(f.$)
  expect(f.files.size).toBe(0)
  code = 0
  await t.flush(f.$)
  expect(f.files.size).toBe(1)
})

test('chmod 600 runs once per file, not per flush', async () => {
  const f = fake()
  const t = tracer('p')
  await t.start(f.$)
  t.event('a')
  await t.flush(f.$)
  t.event('b')
  await t.flush(f.$)
  expect(f.runs.filter(r => r[0] === 'chmod').length).toBe(1)
})

test('a refused clock.after does not stop later flushes', async () => {
  const f = fake()
  let refuse = true
  f.$.clock.after = (ms: number, fn: () => void) => { if (refuse) throw new Error('no'); f.timers.push([ms, fn]) }
  const t = tracer('p')
  await t.start(f.$)
  t.event('a')
  refuse = false
  t.event('b')
  expect(f.timers.length).toBe(1)
})

test('.off made after start → flush writes nothing; removed → next flush writes', async () => {
  const f = fake()
  let off = false
  f.$.fs.read = async (p: string) => { if (p === `${DIR}/.off` && off) return ''; throw new Error('ENOENT') }
  const t = tracer('p')
  await t.start(f.$)
  t.event('a')
  off = true
  await t.flush(f.$)
  expect(f.files.size).toBe(0)
  off = false
  t.event('b')
  await t.flush(f.$)
  expect(lines(f.files.get(`${DIR}/s1.p.jsonl`)!).map(r => r.event)).toEqual(['a', 'b'])
})

test('a resumed session keeps the earlier entries in its file', async () => {
  const f = fake()
  const old = [{ session: 's1', ts: 't0', event: 'old1' }, { session: 's1', ts: 't1', event: 'old2' }].map(e => JSON.stringify(e)).join('\n') + '\n'
  f.$.fs.read = async (p: string) => { if (p === `${DIR}/s1.p.jsonl`) return old; throw new Error('ENOENT') }
  const t = tracer('p')
  await t.start(f.$)
  t.event('new')
  await t.flush(f.$)
  const rows = lines(f.files.get(`${DIR}/s1.p.jsonl`)!)
  expect(rows.map(r => r.event)).toEqual(['old1', 'old2', 'new'])
  expect(rows.every(r => r.session === 's1' && Object.keys(r).filter(k => k === 'session').length === 1)).toBe(true)
})

test('resume seed stays inside the 2000-entry ring', async () => {
  const f = fake()
  const old = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ session: 's1', ts: 't', event: 'old', i })).join('\n') + '\n'
  f.$.fs.read = async (p: string) => { if (p === `${DIR}/s1.p.jsonl`) return old; throw new Error('ENOENT') }
  const t = tracer('p')
  await t.start(f.$)
  for (let i = 0; i < 5; i++) t.event('new', { i })
  await t.flush(f.$)
  const rows = lines(f.files.get(`${DIR}/s1.p.jsonl`)!)
  expect(rows.length).toBe(2000)
  expect(rows[0].i).toBe(5)
  expect(rows[1999].event).toBe('new')
})

test('steady entries still flush within 10 s', async () => {
  const f = fake()
  let now = 1_000_000
  const t = tracer('p', () => now)
  await t.start(f.$)
  t.event('e')
  for (let i = 0; i < 6 && f.files.size === 0; i++) {
    now += 2900
    t.event('e')
    const [, fn] = f.timers.pop()!
    fn()
    await new Promise(r => setTimeout(r, 0))
  }
  expect(f.files.size).toBe(1)
})
