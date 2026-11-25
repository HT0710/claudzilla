import { expect, test } from 'claude-code/testing'

import { editDiff, firstChangeLine, lineDiff, parseDiff, reloadDiff } from '../hooks/explorer-diff'

const added = (d: string) => [...parseDiff(d).added]

test('parseDiff: an added block marks its lines', () => {
  const m = parseDiff('@@ -3,0 +4,2 @@\n+x\n+y\n')
  expect([...m.added]).toEqual([4, 5])
  expect(m.removed.size).toBe(0)
})

test('parseDiff: a changed line shows its old text above its new one', () => {
  const m = parseDiff('@@ -2 +2 @@\n-old\n+new\n')
  expect([...m.added]).toEqual([2])
  expect(m.removed.get(2)).toEqual(['old'])
})

test('parseDiff: a hunk header with a function name still reads its counts', () => {
  const m = parseDiff('@@ -2 +2 @@ function foo() {\n-old\n+new\n')
  expect([...m.added]).toEqual([2])
  expect(m.removed.get(2)).toEqual(['old'])
})

test('parseDiff: a pure deletion sits above the line after its start', () => {
  const m = parseDiff('@@ -5,2 +4,0 @@\n-a\n-b\n')
  expect(m.removed.get(5)).toEqual(['a', 'b'])
  expect(m.added.size).toBe(0)
})

test('parseDiff: a deletion at the top sits above line 1', () => {
  expect(parseDiff('@@ -1,2 +0,0 @@\n-a\n-b\n').removed.get(1)).toEqual(['a', 'b'])
})

test('parseDiff: a removed line that starts with -- still counts', () => {
  expect(parseDiff('@@ -4 +4 @@\n--- note\n+x\n').removed.get(4)).toEqual(['-- note'])
})

test('parseDiff: file headers are not rows', () => {
  const m = parseDiff('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
  expect(m.removed.get(1)).toEqual(['a'])
  expect([...m.added]).toEqual([1])
})

test('parseDiff: CRLF text loses its carriage return', () => {
  expect(parseDiff('@@ -1 +1 @@\n-old\r\n+new\r\n').removed.get(1)).toEqual(['old'])
})

test('parseDiff: the no-newline notice and binary notices add nothing', () => {
  const m = parseDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n')
  expect(m.removed.get(1)).toEqual(['a'])
  expect(added('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n')).toEqual([1])
  const b = parseDiff('Binary files a/x and b/x differ\n')
  expect(b.added.size + b.removed.size).toBe(0)
})

test('parseDiff: empty output has no marks', () => {
  const m = parseDiff('')
  expect(m.added.size + m.removed.size).toBe(0)
})

test('firstChangeLine: the new start of the first hunk', () => {
  expect(firstChangeLine('@@ -7 +9,2 @@')).toBe(9)
})

test('firstChangeLine: a hunk at new line 0 opens at line 1', () => {
  expect(firstChangeLine('@@ -1,2 +0,0 @@')).toBe(1)
})

test('firstChangeLine: no hunk gives no line', () => {
  expect(firstChangeLine('')).toBeUndefined()
})

test('lineDiff: identical text has no marks', () => {
  const m = lineDiff(['a', 'b'], ['a', 'b'])!
  expect(m.added.size).toBe(0)
  expect(m.removed.size).toBe(0)
})

test('lineDiff: an appended line is one green row', () => {
  expect([...lineDiff(['a'], ['a', 'b'])!.added]).toEqual([2])
})

test('lineDiff: a removed line sits above the line that follows it', () => {
  const m = lineDiff(['a', 'b', 'c'], ['a', 'c'])!
  expect(m.removed.get(2)).toEqual(['b'])
  expect(m.added.size).toBe(0)
})

test('lineDiff: one changed block shows its old rows, then its new rows', () => {
  const m = lineDiff(['a', 'x', 'c'], ['a', 'y', 'c'])!
  expect(m.removed.get(2)).toEqual(['x'])
  expect([...m.added]).toEqual([2])
})

test('lineDiff: separate edits share one block (A6)', () => {
  const m = lineDiff(['a', 'b', 'c', 'd', 'e'], ['A', 'b', 'c', 'd', 'E'])!
  expect([...m.added]).toEqual([1, 2, 3, 4, 5])
})

test('lineDiff: a side over 20,000 lines is skipped', () => {
  const big = Array.from({ length: 20001 }, (_, i) => String(i))
  expect(lineDiff(big, ['x'])).toBeUndefined()
  expect(lineDiff(['x'], big)).toBeUndefined()
  expect(lineDiff(big.slice(1), ['x'])).toBeDefined()
})

test('editDiff: a unique newText marks its lines green and the old text red', () => {
  const m = editDiff('a\nNEW\nc', 'OLD', 'NEW', false)!
  expect(m.removed.get(2)).toEqual(['OLD'])
  expect([...m.added]).toEqual([2])
})

test('editDiff: a partial-line edit shows the whole old line in red', () => {
  const m = editDiff('a\nx = foo(2);\nc', 'foo(1)', 'foo(2)', false)!
  expect(m.removed.get(2)).toEqual(['x = foo(1);'])
  expect([...m.added]).toEqual([2])
})

test('editDiff: replaceAll, an empty newText, or a repeated newText falls back', () => {
  expect(editDiff('a\nNEW\nc', 'OLD', 'NEW', true)).toBeUndefined()
  expect(editDiff('a\nc', 'OLD', '', false)).toBeUndefined()
  expect(editDiff('NEW\nNEW', 'OLD', 'NEW', false)).toBeUndefined()
  expect(editDiff('a', 'OLD', 'NEW', false)).toBeUndefined()
})

test('reloadDiff: no earlier text gives no marks', () => {
  expect(reloadDiff(undefined, ['a'])).toBeUndefined()
})

test('reloadDiff: an Edit uses its strings, and any other change uses the line diff', () => {
  const edit = { oldText: 'OLD', newText: 'NEW', replaceAll: false }
  const m = reloadDiff(['a', 'OLD', 'c', 'd', 'e'], ['a', 'NEW', 'c', 'd', 'E'], edit)!
  expect([...m.added]).toEqual([2])
  expect(m.removed.get(2)).toEqual(['OLD'])
  expect(reloadDiff(['a', 'x'], ['a', 'y'], { ...edit, replaceAll: true })!.removed.get(2)).toEqual(['x'])
  expect([...reloadDiff(['a'], ['a', 'b'])!.added]).toEqual([2])
})

test('lineDiff: removed rows are cleaned', () => {
  expect(lineDiff(['\x01a'], ['x'])!.removed.get(1)).toEqual([' a'])
})

test('editDiff: a newText ending in a newline does not mark the next line', () => {
  const m = editDiff('a\nNEW\nc', 'OLD\n', 'NEW\n', false)!
  expect([...m.added]).toEqual([2])
  expect(m.removed.get(2)).toEqual(['OLD'])
})

test('editDiff: a newText starting with a newline at the start marks line 1', () => {
  const m = editDiff('\nNEW\nc', '\nOLD', '\nNEW', false)!
  expect([...m.added]).toEqual([1, 2])
  expect(m.removed.get(1)).toEqual(['', 'OLD'])
})

test('editDiff: a newText ending in a newline mid-line keeps the rest of its line', () => {
  const m = editDiff('a\nxNEW\n y\nc', 'OLD', 'NEW\n', false)!
  expect([...m.added]).toEqual([2, 3])
  expect(m.removed.get(2)).toEqual(['xOLD y'])
})
