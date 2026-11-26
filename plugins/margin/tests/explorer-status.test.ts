import { expect, test } from 'claude-code/testing'

import { MIXED, statusLetter, treeMarks, wordOf } from '../hooks/explorer-status'

test('statusLetter: the worktree side wins when both sides are set', () => {
  expect(statusLetter('MM')).toBe('M')
  expect(statusLetter('AM')).toBe('M')
  expect(statusLetter('MD')).toBe('D')
})

test('statusLetter: one side set gives its letter', () => {
  expect([' M', 'A ', 'D ', 'R ', '??'].map(statusLetter)).toEqual(['M', 'A', 'D', 'R', '?'])
})

test('statusLetter: a conflict is U', () => {
  expect(['UU', 'AA', 'DD', 'AU'].map(statusLetter)).toEqual(['U', 'U', 'U', 'U'])
})

test('treeMarks: a file marks its absolute path', () => {
  expect(treeMarks('/r', [{ path: 'src/a.ts', xy: ' M' }]).files.get('/r/src/a.ts')).toBe('M')
})

test('treeMarks: every folder above a change takes its letter', () => {
  const { folders } = treeMarks('/r', [{ path: 'src/a/b.ts', xy: ' M' }])
  expect(folders.get('/r/src')).toBe('M')
  expect(folders.get('/r/src/a')).toBe('M')
  expect(folders.has('/r')).toBe(false)
})

test('treeMarks: a folder with two kinds of change is MIXED', () => {
  const mixed = treeMarks('/r', [{ path: 'src/a.ts', xy: ' M' }, { path: 'src/b.ts', xy: 'A ' }])
  expect(mixed.folders.get('/r/src')).toBe(MIXED)
  const same = treeMarks('/r', [{ path: 'src/a.ts', xy: ' M' }, { path: 'src/b.ts', xy: ' M' }])
  expect(same.folders.get('/r/src')).toBe('M')
})

test('treeMarks: a trailing slash marks the folder itself', () => {
  expect(treeMarks('/r', [{ path: 'sub/', xy: '??' }]).folders.get('/r/sub')).toBe('?')
})

test('treeMarks: a rename marks its new path', () => {
  expect(treeMarks('/r', [{ path: 'new.ts', xy: 'R ' }]).files.get('/r/new.ts')).toBe('R')
})

test('treeMarks: a change at a listed folder marks the folder, not a file', () => {
  const m = treeMarks('/r', [{ path: 'sub', xy: ' M' }], new Set(['/r/sub']))
  expect(m.folders.get('/r/sub')).toBe('M')
  expect(m.files.has('/r/sub')).toBe(false)
})

test('treeMarks: a clean tree has no marks', () => {
  const m = treeMarks('/r', [])
  expect(m.files.size).toBe(0)
  expect(m.folders.size).toBe(0)
})

test('wordOf: M modified, A added, D deleted, R renamed, ? untracked, U conflict', () => {
  expect(['M', 'A', 'D', 'R', '?', 'U'].map(wordOf)).toEqual(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflict'])
})
