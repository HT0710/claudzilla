import { expect, test } from 'claude-code/testing'

import { capped, insets, modalFrame, scrollWindow, stackFrame } from '../hooks/modal'

test('insets are 5% across and 3% down, whole cells, at least 1', () => {
  expect(insets(67, 40)).toEqual({ x: 3, y: 1 })
  expect(insets(120, 70)).toEqual({ x: 6, y: 2 })
  expect(insets(10, 10)).toEqual({ x: 1, y: 1 })
})

test('a modal grows with its content up to its limit, centred', () => {
  expect(modalFrame(67, 40, 10)).toEqual({ top: 15, left: 3, width: 61, height: 10 })
  expect(modalFrame(67, 40, 99)).toEqual({ top: 1, left: 3, width: 61, height: 38 })
})

test('a stacked modal over a modal at its limit copies its gaps', () => {
  const m = modalFrame(67, 40, 99)
  expect(stackFrame(67, 40, m, 99)).toEqual({ top: 2, left: 6, width: 55, height: 36 })
})

test('a stacked modal over a short modal may grow to the modal limit, one step in', () => {
  const m = modalFrame(67, 40, 10)
  expect(stackFrame(67, 40, m, 99)).toEqual({ top: 2, left: 6, width: 55, height: 36 })
  expect(stackFrame(67, 40, m, 8).height).toBe(8)
})

test('lists cap at 3 rows; 4 rows show whole', () => {
  expect(capped([1, 2, 3, 4])).toEqual({ rows: [1, 2, 3, 4], more: false })
  expect(capped([1, 2, 3, 4, 5])).toEqual({ rows: [1, 2, 3], more: true })
  expect(capped([1, 2, 3, 4, 5, 6, 7], 2)).toEqual({ rows: [3, 4, 5], more: true })
  expect(capped([1, 2, 3, 4, 5], 9)).toEqual({ rows: [3, 4, 5], more: true })
})

test('a scroll window gives each cue a row; a merged top cue takes none', () => {
  expect(scrollWindow(5, 0, 10, false)).toEqual({ top: 0, shown: 5, above: 0, below: 0 })
  expect(scrollWindow(30, 0, 10, false)).toEqual({ top: 0, shown: 9, above: 0, below: 21 })
  expect(scrollWindow(30, 5, 10, false)).toEqual({ top: 5, shown: 8, above: 5, below: 17 })
  expect(scrollWindow(30, 5, 10, true)).toEqual({ top: 5, shown: 9, above: 5, below: 16 })
  expect(scrollWindow(30, 99, 10, false)).toEqual({ top: 21, shown: 9, above: 21, below: 0 })
})
