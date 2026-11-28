import { expect, test } from 'claude-code/testing'
import { callsSeen, cells, newScan, rowLines, sentAt, stamp, tidy, widest, wrap } from '../hooks/prompt'

test('cells counts CJK and emoji as 2', () => {
  expect(cells('界a')).toBe(3)
})

test('tidy hides pasted_content tag lines and keeps the paste', () => {
  expect(tidy('look:\n<pasted_content id="f4bf">\n  one\n\n  two\n</pasted_content id="f4bf">\nthanks')).toBe('look:\n  one\n\n  two\nthanks')
  expect(tidy('<pasted_content id="a1">\nonly\n</pasted_content id="a1">')).toBe('only')
})

test('tidy drops blank edges, squashes runs, and shows a tab as one space', () => {
  expect(tidy('\n\na\n\n\n\nb\n\n')).toBe('a\n\nb')
  expect(tidy('a\tb\x07c')).toBe('a bc')
})

test('wrap keeps lines within room and cuts by grapheme', () => {
  const cjk = wrap('界'.repeat(12), 5)
  expect(cjk.join('')).toBe('界'.repeat(12))
  expect(cjk.every(l => cells(l) <= 5)).toBe(true)
  const emoji = wrap('😀'.repeat(6), 5)
  expect(emoji.join('')).toBe('😀'.repeat(6))
  expect(emoji.every(l => l === l.toWellFormed() && cells(l) <= 5)).toBe(true)
})

test('cells counts VS16 emoji as 2', () => {
  expect(cells('⚠️')).toBe(2)
  expect(cells('😀')).toBe(2)
})

test('wrap cuts a long word fast', () => {
  const start = performance.now()
  const lines = wrap('a'.repeat(20000), 40)
  expect(performance.now() - start).toBeLessThan(500)
  expect(lines.every(l => cells(l) <= 40)).toBe(true)
})

test('wrap takes one grapheme when room is 1', () => {
  expect(wrap('界界', 1)).toEqual(['界', '界'])
})

test('wrap keeps indentation and space runs', () => {
  expect(wrap('    if x:\n        y', 40)).toEqual(['    if x:', '        y'])
  expect(wrap('a  b', 40)).toEqual(['a  b'])
})

test('wrap fills each line to the room', () => {
  expect(wrap('one two three', 7)).toEqual(['one two', 'three'])
})

test('widest survives a very long list', () => {
  expect(widest([...Array(300000).fill('a'), '界界'])).toBe(4)
})

test('stamp spells September as Sep', () => {
  expect(stamp(new Date(2026, 8, 15, 9, 56).getTime(), new Date(2026, 10, 1).getTime())).toBe('Tue 15 Sep 09:56')
})

test('stamp gives the time on the send day, the day on another', () => {
  const sent = new Date(2026, 10, 23, 9, 56).getTime()
  expect(stamp(sent, new Date(2026, 10, 23, 18, 0).getTime())).toBe('09:56')
  expect(stamp(sent, new Date(2026, 10, 24, 8, 0).getTime())).toBe('Mon 23 Nov 09:56')
})

const row = (uuid: string, extra = '', parentUuid = 'null') =>
  `{"type":"user","uuid":"${uuid}","parentUuid":${parentUuid === 'null' ? 'null' : `"${parentUuid}"`},"timestamp":"2026-11-24T10:00:00Z"${extra}}\n`
const T = Date.parse('2026-11-24T10:00:00Z')
const fake = (get: () => string) => async (_p: string, off: number, len: number) =>
  new TextDecoder().decode(new TextEncoder().encode(get()).subarray(off, off + len))

test('sentAt returns the row\'s time, also when a row is cut by a chunk edge (chunk 100)', async () => {
  const f = row('a') + row('b') + row('c')
  expect(await sentAt(fake(() => f), 'p', newScan(), 'c', 100)).toBe(T)
})

test('a CJK line cut at a chunk edge leaves the offset on that line\'s start', async () => {
  const f = row('a') + row('b', ',"m":"界界界界界界"') + row('c')
  const total = new TextEncoder().encode(f).length
  const at = new TextEncoder().encode(row('a')).length
  for (let chunk = 110; chunk <= 140; chunk++) {
    const scan = newScan()
    expect(await sentAt(fake(() => f.slice(0, f.indexOf('"m"') + 12)), 'p', scan, 'zz', chunk)).toBeUndefined()
    expect(scan.offset).toBe(at)
    scan.offset = 0
    expect(await sentAt(fake(() => f), 'p', scan, 'c', chunk)).toBe(T)
    expect(scan.offset).toBe(total)
  }
})

test('a line longer than chunk is skipped and the next row still resolves', async () => {
  const f = row('a', `,"m":"${'x'.repeat(200)}"`) + row('b')
  expect(await sentAt(fake(() => f), 'p', newScan(), 'b', 90)).toBe(T)
})

const att = (type: string, extra = '', parent = '') =>
  `{${parent ? `"parentUuid":"${parent}",` : ''}"type":"attachment","uuid":"x-${type}","attachment":{"type":"${type}"${extra}}}\n`
// `calls`: the card re-reads on each render while its run is open, one chunk per call once its own row is found.
const rows = async (f: string, id: string, chunk?: number, calls = 1) => {
  const scan = newScan()
  for (let i = 0; i < calls; i++) await sentAt(fake(() => f), 'p', scan, id, chunk)
  return scan.rows.get(id)?.length ?? 0
}

const ROW = 'alpha beta gamma delta '.repeat(10) + 'end'
const said = (hook: string, text: string, extra = '', parent = '') => att('hook_system_message', `,"content":"${text} ${ROW}","hookName":"${hook}"${extra}`, parent)

test('a wrapped hook message under a prompt counts every line it takes', async () => {
  // Probe at 66 columns (2.1.332): `UserPromptSubmit says: ROW…` took 5 lines.
  const scan = newScan()
  await sentAt(fake(() => row('a') + said('UserPromptSubmit', 'ROW6 prompt hook message', ',"hookEvent":"UserPromptSubmit","toolUseID":"u1"', 'a')), 'p', scan, 'a')
  expect(rowLines(scan.rows.get('a'), 66)).toBe(5)
})

test('a tool hook message counts for its call once the call\'s result is read', async () => {
  const f = said('PostToolUse:Bash', 'ROW1 post hook message', ',"hookEvent":"PostToolUse","toolUseID":"t1"')
    + att('hook_additional_context', ',"hookEvent":"PostToolUse","toolUseID":"t1"')
    + row('r', ',"message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]}')
  const scan = newScan()
  await callsSeen(fake(() => f), 'p', scan, ['t1'])
  expect(scan.results.has('t1')).toBe(true)
  expect(rowLines(scan.calls.get('t1'), 66)).toBe(5)
  expect(rowLines(scan.calls.get('t2'), 66)).toBe(0)
})

const under = (prompt: string) => att('file', '', prompt) + att('hook_additional_context', '', 'x-file') + att('directory', '', 'x-hook_additional_context')

test('sentAt counts the drawn attachment rows under a prompt', async () => {
  expect(await rows(row('a') + under('a'), 'a')).toBe(2)
})

test('rows past a chunk edge count on the next read (chunk 150)', async () => {
  expect(await rows(row('a') + under('a'), 'a', 150, 5)).toBe(2)
})

// Claude Code 2.1.332 writes request log rows between a prompt and its attachments.
const LOG = '{"type":"api-request-shape","sessionId":"s"}\n{"type":"api-request-blob","sessionId":"s","blob":[{"type":"tool_use"}]}\n'

test('request log rows between a prompt and its attachments keep the count', async () => {
  expect(await rows(row('a') + LOG + under('a'), 'a')).toBe(2)
})

test('request log rows leave the prompt open for attachments written later', async () => {
  const scan = newScan()
  await sentAt(fake(() => row('a') + LOG), 'p', scan, 'a')
  expect(scan.last).toBe('a')
})

test('an attachment after a tool result or the reply counts for no prompt', async () => {
  const tool = row('a') + row('t', ',"message":{"content":[{"type":"tool_result"}]}', 'a') + att('file', '', 't')
  expect(await rows(tool, 'a')).toBe(0)
  expect(await rows(row('a') + '{"parentUuid":"a","type":"assistant","uuid":"r"}\n' + att('file', '', 'r'), 'a')).toBe(0)
})

test('a queued prompt collects the rows after its queued_command attachment', async () => {
  const f = '{"parentUuid":null,"type":"attachment","uuid":"q","timestamp":"2026-11-24T10:00:00Z","attachment":{"type":"queued_command"}}\n' + att('file', '', 'q')
  expect(await rows(f, 'q')).toBe(1)
})

test('an attachment with its type key not first counts and keeps the run going', async () => {
  const f = row('a') + '{"parentUuid":"a","type":"attachment","uuid":"y","attachment":{"x":1,"type":"file"}}\n' + att('file', '', 'y')
  expect(await rows(f, 'a')).toBe(2)
})

test('sentAt ignores a child row whose parentUuid is the id', async () => {
  const f = row('child', '', 'a')
  expect(await sentAt(fake(() => f), 'p', newScan(), 'a')).toBeUndefined()
})

test('sentAt reads only new bytes on a miss', async () => {
  let f = row('a')
  const offs: number[] = []
  const r = fake(() => f)
  const spy = async (p: string, o: number, l: number) => { offs.push(o); return r(p, o, l) }
  const scan = newScan()
  expect(await sentAt(spy, 'p', scan, 'b')).toBeUndefined()
  const old = new TextEncoder().encode(f).length
  f += row('b')
  expect(await sentAt(spy, 'p', scan, 'b')).toBe(T)
  expect(offs[offs.length - 1]).toBe(old)
})

test('sentAt returns undefined for an empty path, with no read, and when a read rejects', async () => {
  let calls = 0
  const bad = async () => { calls++; throw new Error('x') }
  expect(await sentAt(bad, '', newScan(), 'a')).toBeUndefined()
  expect(calls).toBe(0)
  expect(await sentAt(bad, 'p', newScan(), 'a')).toBeUndefined()
})

test('a long line partly written then completed still resolves the next row', async () => {
  const a = row('a', `,"m":"${'x'.repeat(200)}"`)
  let f = a.slice(0, a.length - 3)
  const scan = newScan()
  expect(await sentAt(fake(() => f), 'p', scan, 'b', 100)).toBeUndefined()
  f = a + row('b')
  expect(await sentAt(fake(() => f), 'p', scan, 'b', 100)).toBe(T)
})

test('a skip read that starts mid-character keeps the offset exact', async () => {
  const f = row('a', `,"m":"${'界'.repeat(60)}"`) + row('b')
  for (let chunk = 88; chunk <= 92; chunk++)
    expect(await sentAt(fake(() => f), 'p', newScan(), 'b', chunk)).toBe(T)
})

test('a call that stops mid-skip resumes in skip mode on the next call', async () => {
  const a = row('a', `,"m":"${'界'.repeat(100)}"`)
  const enc = new TextEncoder().encode(a)
  let cuts = 0
  for (let chunk = 90; chunk <= 200; chunk++)
    for (let end = chunk + 1; end < 300; end += 7) {
      let f = new TextDecoder().decode(enc.subarray(0, end))
      const scan = newScan()
      await sentAt(fake(() => f), 'p', scan, 'b', chunk)
      f = a + row('b')
      if ((await sentAt(fake(() => f), 'p', scan, 'b', chunk)) !== T) cuts++
    }
  expect(cuts).toBe(0)
})

test('sentAt finds a renamed id by its uuid prefix', async () => {
  const f = row('778317c7-902c-42ce-9edd-db2ad4ab8d62')
  expect(await sentAt(fake(() => f), 'p', newScan(), '778317c7-902c-42ce-9edd-000000000000')).toBe(T)
})

test('sentAt finds a queued prompt by its queued_command attachment uuid', async () => {
  const f = row('a') + '{"parentUuid":"a","type":"attachment","uuid":"q1","timestamp":"2026-11-24T10:00:00Z","attachment":{"type":"queued_command","prompt":"oke"}}\n'
  expect(await sentAt(fake(() => f), 'p', newScan(), 'q1')).toBe(T)
})
