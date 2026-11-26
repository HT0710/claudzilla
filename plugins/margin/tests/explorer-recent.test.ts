import { expect, test } from 'claude-code/testing'

import { ageText, editedAt, markEdited, markViewed, RECENT_MAX, recentSplit, resetRecent, startOfDay, viewedList } from '../hooks/explorer-recent'

const day = 86_400_000

test('ageText: now under a minute, then minutes, hours and days', () => {
  expect(ageText(0, 30_000)).toBe('now')
  expect(ageText(0, 60_000)).toBe(' 1m')
  expect(ageText(0, 40 * 60_000)).toBe('40m')
  expect(ageText(0, 3 * 3_600_000)).toBe(' 3h')
  expect(ageText(0, day)).toBe(' 1d')
})

test('ageText: weeks from 100 days, years from 365', () => {
  expect(ageText(0, 99 * day)).toBe('99d')
  expect(ageText(0, 100 * day)).toBe('14w')
  expect(ageText(0, 364 * day)).toBe('52w')
  expect(ageText(0, 365 * day)).toBe(' 1y')
})

test('ageText: a time after now reads now', () => {
  expect(ageText(10_000, 0)).toBe('now')
})

test('ageText: every result is 3 cells', () => {
  for (const ms of [0, 59_999, 60_000, 3_599_999, 3_600_000, day, 99 * day, 100 * day, 365 * day, 5000 * day])
    expect(ageText(0, ms).length).toBe(3)
})

test('startOfDay: local midnight', () => {
  expect(startOfDay(new Date(2026, 10, 26, 15).getTime())).toBe(new Date(2026, 10, 26).getTime())
})

test('recentSplit: newest first, and today means since local midnight', () => {
  const now = new Date(2026, 10, 26, 15).getTime()
  const mid = startOfDay(now)
  const input = [
    { path: 'a', at: mid - 1 },
    { path: 'b', at: mid },
    { path: 'c', at: now },
  ]
  const { today, earlier } = recentSplit(input, now, '')
  expect(today.map((r) => r.path)).toEqual(['c', 'b'])
  expect(earlier.map((r) => r.path)).toEqual(['a'])
  expect(input.map((r) => r.path)).toEqual(['a', 'b', 'c'])
})

test('recentSplit: at most 8 entries, with or without text', () => {
  const now = new Date(2026, 10, 26, 15).getTime()
  const input = Array.from({ length: 10 }, (_, i) => ({ path: `d/f${i}.ts`, at: now - i }))
  for (const text of ['', 'f']) {
    const { today, earlier } = recentSplit(input, now, text)
    expect(today.length + earlier.length).toBe(RECENT_MAX)
  }
})

test('recentSplit: text filters by file name, ignoring case, before the cap', () => {
  const now = new Date(2026, 10, 26, 15).getTime()
  const input = [
    { path: 'lib/other.ts', at: now },
    { path: 'src/app.ts', at: now - 1 },
    { path: 'docs/Appendix.md', at: now - 2 },
  ]
  const { today } = recentSplit(input, now, 'APP')
  expect(today.map((r) => r.path)).toEqual(['src/app.ts', 'docs/Appendix.md'])
})

test('markViewed keeps the latest time per path; editedAt is undefined until markEdited', () => {
  resetRecent()
  markViewed('a', 5)
  markViewed('a', 9)
  markViewed('a', 7)
  expect(viewedList()).toEqual([{ path: 'a', at: 9 }])
  expect(editedAt('a')).toBeUndefined()
  markEdited('a', 3)
  expect(editedAt('a')).toBe(3)
})
