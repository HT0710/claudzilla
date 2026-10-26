import { expect, test } from 'claude-code/testing'

import { href, linked, mentions } from '../hooks/mentions'

test('non-path spans stay plain', () => {
  expect(mentions('`go test ./auth` `--force` `v1.4.0` `a b.ts`')).toEqual([])
})

test('path, path:line, path:line-line', () => {
  expect(mentions('`a/b.ts` `c.tsx:65` `d.md:3-9`').map(m => [m.path, m.line])).toEqual([['a/b.ts', 1], ['c.tsx', 65], ['d.md', 3]])
})

test('spans inside fences are skipped', () => {
  expect(mentions('```\n`a.ts:1`\n```')).toEqual([])
})

test('spans inside a markdown link are skipped', () => {
  expect(mentions('[`a.ts:1`](https://x)')).toEqual([])
})

test('linked rewrites only spans with an href', () => {
  const hrefs = new Map([['a.ts:3', 'file:///r/a.ts#L3']])
  expect(linked('see `a.ts:3` and `b.ts`', hrefs)).toBe('see [`a.ts:3`](file:///r/a.ts#L3) and `b.ts`')
})

test('linked leaves fences and links Claude wrote alone', () => {
  const hrefs = new Map([['a.ts', 'file:///r/a.ts#L1']])
  const text = '```\n`a.ts`\n```\n[`a.ts`](https://x) `a.ts`'
  expect(linked(text, hrefs)).toBe('```\n`a.ts`\n```\n[`a.ts`](https://x) [`a.ts`](file:///r/a.ts#L1)')
})

test('href keeps the markdown link and the line fragment whole', () => {
  expect(href('/r/(g)/a#b c.ts', 2)).toBe('file:///r/%28g%29/a%23b%20c.ts#L2')
})
