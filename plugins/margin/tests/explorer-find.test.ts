import { expect, test } from 'claude-code/testing'

import { findIn, leavesField, markCells } from '../hooks/explorer-find'
import { hitsOf, sliceTokens } from '../hooks/explorer-layout'
import { tokenize } from '../hooks/explorer-tokens'

const q = (text: string, o: Partial<{ matchCase: boolean; word: boolean; regex: boolean }> = {}) => ({ text, matchCase: false, word: false, regex: false, ...o })
const starts = (r: { matches: { start: number }[] }) => r.matches.map((m) => m.start)

test('literal ignores case by default', () => {
  const r = findIn(['Foo foo FOO'], q('foo'))
  expect(starts(r)).toEqual([0, 4, 8])
  expect(r.matches.every((m) => m.end - m.start === 3)).toBe(true)
})

test('match case keeps only the exact case', () => {
  expect(starts(findIn(['Foo foo FOO'], q('foo', { matchCase: true })))).toEqual([4])
})

test('regex reads a JavaScript pattern', () => {
  expect(findIn(['FILE_SPAN x FILE_LINE'], q('FILE_(SPAN|LINE)', { regex: true })).matches.length).toBe(2)
})

test('a literal dot is not a wildcard', () => {
  expect(starts(findIn(['a.b axb'], q('.')))).toEqual([1])
})

test('line numbers are 1-based', () => {
  const r = findIn(['x', 'y x'], q('x'))
  expect(r.matches.map((m) => [m.line, m.start])).toEqual([[1, 0], [2, 2]])
})

test('whole word skips a match inside a longer word', () => {
  expect(starts(findIn(['concat cat'], q('cat', { word: true })))).toEqual([7])
})

test('whole word matches beside punctuation', () => {
  expect(starts(findIn(['x = foo();'], q('foo()', { word: true })))).toEqual([4])
})

test('whole word keeps alternation inside its group', () => {
  const r = findIn(['concat dog'], q('cat|dog', { regex: true, word: true }))
  expect(r.matches.map((m) => [m.start, m.end])).toEqual([[7, 10]])
})

test('a pattern that can match nothing moves on', () => {
  const r = findIn(['baa'], q('a*', { regex: true }))
  expect(r.matches.map((m) => [m.start, m.end])).toEqual([[1, 3]])
})

test('a pattern that matches only empty text returns', () => {
  const r = findIn(['abc'], q('^', { regex: true }))
  expect(r.matches.length).toBe(0)
  expect(r.bad).toBe(false)
})

test('an empty text runs no find', () => {
  const r = findIn(['a'], q(''))
  expect(r.matches.length).toBe(0)
  expect(r.bad).toBe(false)
})

test('a space is a query', () => {
  expect(starts(findIn(['a b c'], q(' ')))).toEqual([1, 3])
})

test('a bad pattern finds nothing and sets bad', () => {
  const r = findIn(['(x'], q('(', { regex: true }))
  expect(r.matches.length).toBe(0)
  expect(r.bad).toBe(true)
})

test('a bad pattern is still bad under whole word', () => {
  expect(findIn(['a)(b'], q('a)(b', { regex: true, word: true })).bad).toBe(true)
})

test('the count stops at 10,000 and sets capped only past it', () => {
  const lines = (n: number) => Array.from({ length: n }, () => 'x')
  const over = findIn(lines(10001), q('x'))
  expect([over.matches.length, over.capped]).toEqual([10000, true])
  const exact = findIn(lines(10000), q('x'))
  expect([exact.matches.length, exact.capped]).toEqual([10000, false])
  const under = findIn(lines(9999), q('x'))
  expect([under.matches.length, under.capped]).toEqual([9999, false])
})

test('a match that ends at the cut is found', () => {
  const r = findIn(['x'.repeat(1998) + 'ab'], q('ab'))
  expect(r.matches.map((m) => [m.start, m.end])).toEqual([[1998, 2000]])
})

test('a match after a tab lands past the tab stop', () => {
  expect(hitsOf('\tfoo', [{ start: 1, end: 4, current: false }])).toEqual([{ from: 4, to: 7, current: false }])
})

test('a match after a wide glyph counts 2 cells', () => {
  expect(hitsOf('中foo', [{ start: 1, end: 4, current: true }])).toEqual([{ from: 2, to: 5, current: true }])
})

test('a literal emoji takes its 2 cells', () => {
  expect(hitsOf('😀x', [{ start: 0, end: 2, current: false }])).toEqual([{ from: 0, to: 2, current: false }])
})

test('slicing from a column keeps each hit at its offset', () => {
  const hits = hitsOf('\tfoo', [{ start: 1, end: 4, current: false }])
  expect(sliceTokens(tokenize('\tfoo'), 3, 4, hits)).toEqual([
    { text: ' ', kind: 'plain' },
    { text: 'foo', kind: 'plain', hit: 'match' },
  ])
})

test('a match that ends at the cut is highlighted at the last cells', () => {
  const line = 'x'.repeat(1998) + 'ab'
  const hits = hitsOf(line, [{ start: 1998, end: 2000, current: true }])
  const out = sliceTokens([{ text: line, kind: 'plain' }], 1990, 10, hits)
  expect(out.map((t) => [t.text, t.hit])).toEqual([['x'.repeat(8), undefined], ['ab', 'current']])
})

test('a wide glyph cut at the slice edge is a plain space with no hit', () => {
  const out = sliceTokens([{ text: '中', kind: 'plain' }], 1, 4, [{ from: 0, to: 2, current: false }])
  expect(out).toEqual([{ text: ' ', kind: 'plain' }])
  expect('hit' in out[0]).toBe(false)
})

test('no hits leaves the tokens unchanged', () => {
  const out = sliceTokens(tokenize('const x'), 0, 7)
  expect(out.some((t) => 'hit' in t)).toBe(false)
})

test('a find bar button does not count as leaving', () => {
  expect(leavesField({ element: 'explorer:find:case' }, 'explorer:find')).toBe(false)
})

test('no element counts as leaving', () => {
  expect(leavesField({}, 'explorer:find')).toBe(true)
})

test('another element counts as leaving', () => {
  expect(leavesField({ element: 'explorer:name' }, 'explorer:find')).toBe(true)
})

test('the field itself does not count as leaving', () => {
  expect(leavesField({ element: 'explorer:find' }, 'explorer:find')).toBe(false)
})

const flagged = (f: boolean[]) => f.flatMap((b, i) => (b ? [i] : []))

test('a row in the first cell marks only cell 0', () => {
  expect(flagged(markCells(200, 16, [0]))).toEqual([0])
})

test('the last row marks the last cell', () => {
  expect(flagged(markCells(200, 16, [199]))).toEqual([15])
})

test('rows map to cells by floor(r * cells / total)', () => {
  expect(markCells(3, 2, [1, 2])).toEqual([true, true])
  expect(markCells(3, 2, [0])).toEqual([true, false])
})

test('rows past the total are ignored', () => {
  expect(markCells(3, 2, [5])).toEqual([false, false])
})

test('a wrapped line marks every row it spans', () => {
  expect(markCells(4, 4, [1, 2])).toEqual([false, true, true, false])
})

test("a total below the cell count marks each row's own cell", () => {
  expect(markCells(2, 4, [1])).toEqual([false, true, false, false])
})
