import { expect, test } from 'claude-code/testing'

import { firstChangeLine, parseDiff } from '../hooks/explorer-diff'

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
