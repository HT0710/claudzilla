import { expect, test } from 'claude-code/testing'

import { cellsOf, expandTabs, fileWindow, layoutFor, layoutOf, lineAt, sliceTokens, thumbOf } from '../hooks/explorer-layout'
import { tokenize } from '../hooks/explorer-tokens'

test('tokenize: a keyword, a string, a comment and a number', () => {
  expect(tokenize('const s = "a" // x 42')).toEqual([
    { text: 'const', kind: 'keyword' },
    { text: ' s = ', kind: 'plain' },
    { text: '"a"', kind: 'string' },
    { text: ' ', kind: 'plain' },
    { text: '// x 42', kind: 'comment' },
  ])
  expect(tokenize('n = 3.5').find(t => t.kind === 'number')?.text).toBe('3.5')
})

test('tokenize keeps every character in order', () => {
  const line = 'if (x) { return "a\\"b" + `t` } # 0x1F'
  expect(tokenize(line).map(t => t.text).join('')).toBe(line)
})

test('tokenize: a string unclosed at the line end runs to it', () => {
  expect(tokenize('say "hi')).toEqual([
    { text: 'say ', kind: 'plain' },
    { text: '"hi', kind: 'string' },
  ])
})

test('tokenize: a double slash inside a string is not a comment', () => {
  expect(tokenize('"http://x"').map(t => t.kind)).toEqual(['string'])
})

test('tokenize: a hash inside a word does not start a comment', () => {
  const kinds = tokenize('this.#count; return x')
  expect(kinds.find(t => t.text === 'return')?.kind).toBe('keyword')
  expect(kinds.some(t => t.kind === 'comment')).toBe(false)
})

const text = (tokens: { text: string }[]) => tokens.map(t => t.text).join('')

test('tabs stop every 4 cells', () => {
  expect(expandTabs('a\tb')).toBe('a   b')
  expect(expandTabs('abcd\te')).toBe('abcd    e')
})

test('wide glyphs count 2 cells, a code point at a time', () => {
  expect(cellsOf('中a')).toBe(3)
  expect(cellsOf('😀')).toBe(2)
  expect(cellsOf('✅\u{1F680}')).toBe(4)
})

test('a slice keeps the token kind of the cells it shows', () => {
  expect(sliceTokens(tokenize('const x = 1'), 2, 4)).toEqual([
    { text: 'nst', kind: 'keyword' },
    { text: ' ', kind: 'plain' },
  ])
})

test('a slice starting inside a wide glyph shows a space for its right half', () => {
  expect(text(sliceTokens(tokenize('中ab'), 1, 3))).toBe(' ab')
  expect(text(sliceTokens(tokenize('中ab'), 0, 3))).toBe('中a')
  expect(sliceTokens(tokenize('"中"'), 2, 1)[0]).toEqual({ text: ' ', kind: 'plain' })
})

test('a wide glyph crossing the right edge becomes a space, no overflow', () => {
  expect(text(sliceTokens(tokenize('ab中'), 0, 3))).toBe('ab ')
})

test('no wrap: one row per line, widest counted after tabs', () => {
  const l = layoutOf(['a', 'bbbbbbbbbb', '', 'x\ty'], 4, false)
  expect(l.rows).toBe(4)
  expect(lineAt(l, 2)).toBe(2)
  expect(l.widest).toBe(10)
})

test('wrap breaks a line at the exact column', () => {
  const l = layoutOf(['abcdefghij'], 4, true)
  expect(l.rows).toBe(3)
  expect(lineAt(l, 2)).toBe(0)
  expect(l.starts[1]).toBe(3)
})

test('wrap: an empty line still takes one row', () => {
  expect(layoutOf(['', 'ab'], 4, true).rows).toBe(2)
})

test('the window clamps the top to both ends', () => {
  expect(fileWindow(100, 95, 10)).toEqual({ top: 90, last: 100 })
  expect(fileWindow(100, -5, 10)).toEqual({ top: 0, last: 10 })
  expect(fileWindow(4, 0, 10)).toEqual({ top: 0, last: 4 })
})

test('the thumb is the shown share of the cells, at least one', () => {
  expect(thumbOf(100, 20, 0, 10)).toEqual({ from: 0, to: 2 })
  expect(thumbOf(100, 20, 80, 10)).toEqual({ from: 8, to: 10 })
  expect(thumbOf(1000000, 1, 0, 10)).toEqual({ from: 0, to: 1 })
})

test('the layout cache returns the same layout while its inputs are unchanged', () => {
  const loaded = {}
  const lines = ['abc']
  const first = layoutFor(undefined, loaded, 10, false, lines)
  expect(layoutFor(first, loaded, 10, false, lines)).toBe(first)
  expect(layoutFor(first, loaded, 5, false, lines)).not.toBe(first)
  expect(layoutFor(first, loaded, 10, true, lines)).not.toBe(first)
  expect(layoutFor(first, {}, 10, false, lines)).not.toBe(first)
})
