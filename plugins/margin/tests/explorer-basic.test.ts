import { expect, test } from 'claude-code/testing'

import { explorer, lines, textOf } from './explorer-helpers'

test('basic glyphs swap the header buttons for plain Unicode', async ($, on) => {
  on('fs.exists', (_, e) => ({ value: String((e as any).path ?? '').endsWith('.claudzilla-basic-glyphs') }))
  const ui = await explorer($, on, { path: '/repo/a.ts' }, lines(3))
  expect(textOf(await ui.find({ key: 'back' }))).toBe('‹')
  expect(textOf(await ui.find({ key: 'forward' }))).toBe('›')
  expect(textOf(await ui.find({ key: 'refresh' }))).toBe('↻')
})
