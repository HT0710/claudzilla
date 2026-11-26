import { expect, test } from 'claude-code/testing'

import { layoutOf } from '../hooks/explorer-layout'
import { barCells, cachedBar, codeLineAt, editDiff, firstChangeLine, lineDiff, mergeMarks, parseDiff, pressLine, redLit, relocateEdit, reloadDiff, sameMarks } from '../hooks/explorer-diff'

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

test('mergeMarks: git and reload marks union, and git\'s red rows win at one key', () => {
  const git = { added: new Set([1]), removed: new Map([[2, ['g']]]) }
  const reload = { added: new Set([3]), removed: new Map([[2, ['r']], [5, ['s']]]) }
  const m = mergeMarks(git, reload)!
  expect([...m.added]).toEqual([1, 3])
  expect([...m.removed]).toEqual([[2, ['g']], [5, ['s']]])
  expect(mergeMarks(undefined, undefined)).toBeUndefined()
  expect(mergeMarks(git, undefined)).toBe(git)
})

test('codeLineAt: a red row gives the last line, and a code row gives its own', () => {
  const rows = [{ line: 1 }, { line: 0, tone: 'del' as const }, { line: 2 }]
  expect(codeLineAt(rows, 1, 1)).toBe(1)
  expect(codeLineAt(rows, 2)).toBe(2)
  expect(codeLineAt(rows, 1)).toBeUndefined()
})

test('redLit: a red row needs the lines on both sides in the range', () => {
  expect(redLit(5, 4, 5)).toBe(true)
  expect(redLit(5, 5, 9)).toBe(false)
  expect(redLit(5, 1, 4)).toBe(false)
  expect(redLit(1, 1, 9)).toBe(false)
  expect(redLit(11, 1, 10)).toBe(false)
})

test('sameMarks: equal contents match, and undefined counts as empty', () => {
  const d = '@@ -2 +2 @@\n-old\n+new\n'
  expect(sameMarks(parseDiff(d), parseDiff(d))).toBe(true)
  expect(sameMarks(parseDiff(d), parseDiff('@@ -2 +3 @@\n-old\n+new\n'))).toBe(false)
  expect(sameMarks(undefined, { added: new Set(), removed: new Map() })).toBe(true)
})

test('pressLine: a red row gives no line, and a code row gives its own', () => {
  expect(pressLine({ line: 0, tone: 'del' })).toBeUndefined()
  expect(pressLine({ line: 4 })).toBe(4)
})

const COL = { add: 'a', del: 'd', mixed: 'm' }

test('barCells: a cell with added and removed rows is mixed', () => {
  expect(barCells(10, 5, [{ row: 2, tone: 'add' }, { row: 3, tone: 'del' }], COL)).toEqual([null, 'm', null, null, null])
})

test('barCells: one kind keeps its colour, and rows map to cells the way thumbOf does', () => {
  expect(barCells(10, 5, [{ row: 3, tone: 'del' }, { row: 8, tone: 'add' }], COL)).toEqual([null, 'd', null, null, 'a'])
  expect(barCells(3, 5, [{ row: 1, tone: 'add' }], COL)).toEqual([null, 'a', null, null, null])
})

test('barCells: no cells gives no marks', () => {
  expect(barCells(10, 0, [{ row: 3, tone: 'del' }], COL)).toEqual([])
})

test('cachedBar: the same key returns the same cells, and any changed part builds new ones', () => {
  const layout = layoutOf(['a', 'b', 'c'], 20, false)
  const diff = { added: new Set([2]), removed: new Map<number, string[]>() }
  const key = { layout, reload: undefined, diff, showDiff: true, cells: 3 }
  const first = cachedBar(undefined, key, COL)
  expect(first.marks).toEqual([null, 'a', null])
  expect(cachedBar(first, { ...key }, COL)).toBe(first)
  for (const change of [{ layout: layoutOf(['a', 'b', 'c'], 20, false) }, { reload: { added: new Set<number>(), removed: new Map<number, string[]>() } }, { diff: { ...diff } }, { showDiff: false }, { cells: 2 }])
    expect(cachedBar(first, { ...key, ...change }, COL)).not.toBe(first)
})

test('parseDiff: context lines are skipped and count as new lines', () => {
  const m = parseDiff('@@ -3,1 +3,2 @@\n a\n+b\n')
  expect([...m.added]).toEqual([4])
  expect(m.removed.size).toBe(0)
})

test('parseDiff: a change between context lines keeps its place', () => {
  const m = parseDiff('@@ -3,3 +3,3 @@\n a\n-b\n+c\n d\n')
  expect([...m.added]).toEqual([4])
  expect(m.removed.get(4)).toEqual(['b'])
})

test('parseDiff: a pure deletion of 20000 lines parses in linear time', () => {
  const m = parseDiff(`@@ -1,20000 +0,0 @@\n${'-x\n'.repeat(20000)}`)
  expect(m.removed.get(1)?.length).toBe(20000)
})

const EDIT = '@@ -1,3 +1,3 @@\n a\n-OLD\n+NEW\n c\n'

test('relocateEdit: a hunk that still matches stays at its header line', () => {
  const r = relocateEdit(EDIT, ['a', 'NEW', 'c'])
  expect(r?.first).toBe(2)
  expect([...r!.marks.added]).toEqual([2])
  expect(r!.marks.removed.get(2)).toEqual(['OLD'])
})

test('relocateEdit: a hunk that moved follows its anchor', () => {
  const r = relocateEdit(EDIT, ['x', 'y', 'a', 'NEW', 'c'])
  expect(r?.first).toBe(4)
  expect([...r!.marks.added]).toEqual([4])
  expect(r!.marks.removed.get(4)).toEqual(['OLD'])
})

test('relocateEdit: an anchor found nowhere gives no marks', () => {
  expect(relocateEdit(EDIT, ['a', 'X', 'c'])).toBeUndefined()
})

test('relocateEdit: a repeated anchor that moved gives no marks', () => {
  expect(relocateEdit('@@ -2,1 +2,1 @@\n-old\n+}\n', ['a', 'x', '}', 'y', '}'])).toBeUndefined()
})

test('relocateEdit: a repeated anchor at its header line stays', () => {
  const r = relocateEdit('@@ -2,1 +2,1 @@\n-old\n+}\n', ['a', '}', 'b', '}'])
  expect(r?.first).toBe(2)
  expect([...r!.marks.added]).toEqual([2])
})

test('relocateEdit: an empty anchor matches an empty file only', () => {
  const d = '@@ -1,2 +0,0 @@\n-a\n-b\n'
  expect(relocateEdit(d, [''])?.marks.removed.get(1)).toEqual(['a', 'b'])
  expect(relocateEdit(d, [])?.marks.removed.get(1)).toEqual(['a', 'b'])
  expect(relocateEdit(d, ['x'])).toBeUndefined()
})

test('relocateEdit: control characters in the file do not block a match', () => {
  const r = relocateEdit('@@ -1,3 +1,3 @@\n a\n-OLD\n+x[0m\n c\n', ['a', 'x\x1b[0m', 'c\x85'])
  expect(r?.first).toBe(2)
  expect([...r!.marks.added]).toEqual([2])
  expect(r!.marks.removed.get(2)).toEqual(['OLD'])
})

test('relocateEdit: removed rows that share a key from two hunks are both kept', () => {
  const r = relocateEdit('@@ -2 +2 @@\n-old1\n+NEW\n@@ -1,2 +1,1 @@\n a\n-old2\n', ['a', 'NEW'])
  expect(r?.marks.removed.get(2)).toEqual(['old1', 'old2'])
  expect(r?.first).toBe(2)
})
