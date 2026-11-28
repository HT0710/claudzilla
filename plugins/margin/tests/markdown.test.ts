import { expect, test } from 'claude-code/testing'

import { mdLayout, mdRows, mdTopFor } from '../hooks/markdown'

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

test('a fence draws one code row per line with its language; a table draws as a grid', () => {
  expect(mdRows('```ts\nconst a = 1\n\nb()\n```', 80)).toEqual([
    { code: 'const a = 1', language: 'ts' },
    { code: '', language: 'ts' },
    { code: 'b()', language: 'ts' },
  ])
  expect(texts('| a | b | c |\n|---|---|---|\n| x | y | z |', 80)).toEqual(['a │ b  c', '──┼─────', 'x │ y  z'])
  expect(mdRows('', 8)).toEqual([])
})

test('a table cell keeps its own marks in the grid', () => {
  const md = '| a | b |\n|---|---|\n| **foo** | 1 |\n| `x.ts` | 2 |\n| [x](./a.md) | 3 |\n| plain | 4 |\n|  | 5 |'
  expect(texts(md, 80)).toEqual(['a     │ b', '──────┼──', 'foo   │ 1', 'x.ts  │ 2', 'x     │ 3', 'plain │ 4', '      │ 5'])
  expect(mdRows(md, 80)[2].spans.filter(s => s.bold).map(s => s.text)).toEqual(['foo'])
  expect(mdRows(md, 80)[3].spans.filter(s => s.code).map(s => s.text)).toEqual(['x.ts'])
})

test('a table cell keeps an escaped pipe; a table after a paragraph or without outer pipes is still a table', () => {
  expect(texts('| a | b |\n|---|---|\n| `x \\| y` | z \\| w |', 80)).toEqual(['a     │ b    ', '──────┼──────', 'x | y │ z | w'])
  expect(texts('Intro line\n| a | b |\n|---|---|\n| 1 | 2 |', 80)).toEqual(['Intro line', 'a │ b', '──┼──', '1 │ 2'])
  expect(texts('a | b\n:--|--:\n1 | 2', 80)).toEqual(['a │ b', '──┼──', '1 │ 2'])
  expect(texts('a | b\nc', 80)).toEqual(['a | b c'])
})

test('a table that fits draws as a grid: bold header, rule under it, rows padded to the grid width', () => {
  const md = '| # | file | status |\n|---|---|---|\n| 1 | a.ts | ok |\n| 2 | b.ts | failed |'
  expect(texts(md, 80)).toEqual(['# │ file  status', '──┼─────────────', '1 │ a.ts  ok    ', '2 │ b.ts  failed'])
  expect(mdRows(md, 80)[0].spans.filter(s => s.bold).map(s => s.text)).toEqual(['#', 'file', 'status'])
})

test('a blank cell draws as padding; a row longer than the header drops its extra cells; a shorter row draws blank cells', () => {
  expect(texts('| # | file |\n|---|---|\n| 1 |  |', 80)).toEqual(['# │ file', '──┼─────', '1 │     '])
  expect(texts('| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| 4 |', 80)).toEqual(['a │ b', '──┼──', '1 │ 2', '4 │  '])
})

test('a one-column table draws no vertical line', () => {
  expect(texts('| name |\n|---|\n| ab |', 80)).toEqual(['name', '────', 'ab  '])
})

test('a table with no data rows draws its header and rule', () => {
  expect(texts('| a | b |\n|---|---|', 80)).toEqual(['a │ b', '──┼──'])
})

test('a body row of only dashes stays a data row', () => {
  expect(texts('| k | v |\n|---|---|\n| a | 1 |\n| - | - |\n| b | 2 |', 80)).toEqual(['k │ v', '──┼──', 'a │ 1', '- │ -', 'b │ 2'])
})

test('a grid keeps its source lines: header, rule, then each body row', () => {
  const { rows, lines } = mdLayout('# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 80)
  expect(rows.length).toBe(6)
  expect(lines).toEqual([0, 0, 2, 3, 4, 5])
})

test('inline triple backticks are a code span, not a fence; quotes lose > on every line; comments and empty blocks draw nothing', () => {
  expect(texts('```foo``` bar\n\nnext', 80)).toEqual(['foo bar', '', 'next'])
  expect(texts('> a\n> b', 80)).toEqual(['a b'])
  expect(texts('a\n\n<!-- hidden -->\n\n```\n```\n\nb', 80)).toEqual(['a', '', 'b'])
})

test('control characters in a body draw as spaces; a fence keeps its tab', () => {
  expect(JSON.stringify(mdRows('a\x1b[31mred\x07\n\n```\n\tb\x1bc\n```', 80))).not.toMatch(/\\u00(0[0-8b-f]|1|7f)/)
  expect(mdRows('```\n\tb\x1bc\n```', 80)).toEqual([{ code: '\tb c', language: undefined }])
})

test('only http and https links stay links: the text of any other scheme draws plain', () => {
  expect(mdRows('[a](x-handler://run) [b](file:///etc/passwd)', 80)).toEqual([{ indent: 0, spans: [{ text: 'a b' }] }])
  expect(mdRows('[a](HTTP://x.io)', 80)).toEqual([{ indent: 0, spans: [{ text: 'a', href: 'HTTP://x.io' }] }])
})

test('a multi-line HTML comment reads as blank, as GitHub hides it; inside a fence it stays', () => {
  expect(texts('a\n<!--\nhide\n-->\nb', 80)).toEqual(['a', '', 'b'])
  expect(texts('a\n<!-- hide\nhide -->\nb', 80)).toEqual(['a', '', 'b'])
  expect(texts('```\n<!--\n```', 80)).toEqual(['code:<!--'])
})

test('a fence closes only on its own marker, as long, with no info string', () => {
  expect(texts('```\n~~~\n```js\nx\n```\nafter', 80)).toEqual(['code:~~~', 'code:```js', 'code:x', '', 'after'])
  expect(texts('````\n```\n````', 80)).toEqual(['code:```'])
  expect(texts('```\na\n~~~', 80)).toEqual(['code:a', 'code:~~~'])
})

test('a link past 2048 characters, written or percent-encoded, draws plain: the engine refuses the whole pane on one', () => {
  const at = 'https://x.io/'
  const fit = at + 'a'.repeat(2048 - at.length)
  expect(mdRows(`[a](${fit})`, 80)).toEqual([{ indent: 0, spans: [{ text: 'a', href: fit }] }])
  expect(mdRows(`[a](${fit}a)`, 80)).toEqual([{ indent: 0, spans: [{ text: 'a' }] }])
  expect(mdRows(`[a](${at}${'字'.repeat(1000)})`, 80)).toEqual([{ indent: 0, spans: [{ text: 'a' }] }])
  expect(mdRows(`[a](${at}\ud800)`, 80)).toEqual([{ indent: 0, spans: [{ text: 'a' }] }])
})

test('each row keeps its source line; the top row for a source line is its item or block', () => {
  const { rows, lines } = mdLayout('# T\n\npara one\npara two\n\n- a\n- b\n\n```\nx\n```', 80)
  expect(rows.length).toBe(lines.length)
  expect(lines).toEqual([0, 0, 2, 2, 5, 6, 6, 9])
  expect(mdTopFor(lines, 3)).toBe(2)
  expect(mdTopFor(lines, 6)).toBe(5)
  expect(mdTopFor(lines, 10)).toBe(7)
  expect(mdTopFor(lines, 0)).toBe(0)
})
