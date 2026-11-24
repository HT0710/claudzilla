import { expect, test } from 'claude-code/testing'
import { cells, stamp, tidy, wrap } from '../hooks/prompt'

test('cells counts CJK and emoji as 2', () => {
  expect(cells('界a')).toBe(3)
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
})

test('wrap takes one grapheme when room is 1', () => {
  expect(wrap('界界', 1)).toEqual(['界', '界'])
})

test('wrap fills each line to the room', () => {
  expect(wrap('one two three', 7)).toEqual(['one two', 'three'])
})

test('stamp gives the time on the send day, the day on another', () => {
  const sent = new Date(2026, 10, 23, 9, 56).getTime()
  expect(stamp(sent, new Date(2026, 10, 23, 18, 0).getTime())).toBe('09:56')
  expect(stamp(sent, new Date(2026, 10, 24, 8, 0).getTime())).toBe('Mon 23 Nov 09:56')
})
