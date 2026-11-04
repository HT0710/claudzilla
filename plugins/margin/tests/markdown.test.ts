import { expect, test } from 'claude-code/testing'

import { mdRows } from '../hooks/markdown'

const texts = (md: string, width: number) => mdRows(md, width).map(r => ('code' in r ? `code:${r.code}` : ' '.repeat(r.indent) + r.spans.map(s => s.text).join('')))

test('inline marks become styles; text glued to a mark keeps no space', () => {
  expect(mdRows('**Why:** see `a.ts` (`b.ts`), [the spec](https://x.io) *now*', 80)).toEqual([
    {
      indent: 0,
      spans: [
        { text: 'Why:', bold: true },
        { text: ' see ' },
        { text: 'a.ts', code: true },
        { text: ' (' },
        { text: 'b.ts', code: true },
        { text: '), ' },
        { text: 'the spec', href: 'https://x.io' },
        { text: ' ' },
        { text: 'now', italic: true },
      ],
    },
  ])
})

test('paragraphs wrap at the width with words whole, a long word broken, a blank row between blocks', () => {
  expect(texts('aaa bbb ccc\nddd\n\nabcdefghij', 8)).toEqual(['aaa bbb', 'ccc ddd', '', 'abcdefgh', 'ij'])
})

test('headings bold; list items hang under their text; nested lists keep their indent', () => {
  expect(mdRows('## Hi there', 80)).toEqual([{ indent: 0, spans: [{ text: 'Hi there', bold: true }] }])
  expect(texts('- aaa bbb ccc\n  ddd\n  - eee\n1. fff', 9)).toEqual(['- aaa bbb', '  ccc ddd', '  - eee', '1. fff'])
})

test('a fence draws one code row per line with its language; a table becomes one row per data row', () => {
  expect(mdRows('```ts\nconst a = 1\n\nb()\n```', 80)).toEqual([
    { code: 'const a = 1', language: 'ts' },
    { code: '', language: 'ts' },
    { code: 'b()', language: 'ts' },
  ])
  expect(texts('| a | b | c |\n|---|---|---|\n| x | y | z |', 80)).toEqual(['x — y · z'])
  expect(mdRows('', 8)).toEqual([])
})

test('inline triple backticks are a code span, not a fence; quotes lose > on every line; comments and empty blocks draw nothing', () => {
  expect(texts('```foo``` bar\n\nnext', 80)).toEqual(['foo bar', '', 'next'])
  expect(texts('> a\n> b', 80)).toEqual(['a b'])
  expect(texts('a\n\n<!-- hidden -->\n\n```\n```\n\nb', 80)).toEqual(['a', '', 'b'])
})
