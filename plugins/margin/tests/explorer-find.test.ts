import { expect, test } from 'claude-code/testing'

import { findIn } from '../hooks/explorer-find'

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
