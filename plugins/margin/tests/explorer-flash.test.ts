import type { Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { FLASH, mixHex } from '../hooks/kit'
import { clock, diffOut, disk, mountPane, open, setup } from './explorer-helpers'

// Own file: the pane reads the theme once per module, so this test gets a module no other test has read it in.
const edit = { name: 'edit', register: (on => { on('command.run', { command: 'show-edit' }, async ($, e) => (await ($ as any).margin.show(JSON.parse((e as any).args)), {})) }) as Register }
const bgOf = async (ui: any, n: number) => (await ui.find({ key: `row:${n}` }))?.props.backgroundColor

test('flash: a custom theme fades an added row in 12 steps', { plugins: [edit] }, async ($, on) => {
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }))
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'custom:mine' }] }) as any)
  await setup($, on)
  // Git's own mark on the row gives it a colour to fade to.
  diffOut.out = '@@ -2 +2 @@\n-old\n+NEW\n'
  disk.set('/repo/a.ts', { text: 'a\nNEW\nc', mtimeMs: 1 })
  open({ path: '/repo/a.ts' })
  const ui = await mountPane($)
  disk.set('/home/me/themes/mine.json', { text: JSON.stringify({ name: 'mine', base: 'dark', overrides: { diffAdded: '#1d3a2a' } }), mtimeMs: 1 })
  await $.command.run({ command: 'show-edit', args: JSON.stringify({ path: '/repo/a.ts', diff: '@@ -1,3 +1,3 @@\n a\n-OLD\n+NEW\n c' }), origin: { kind: 'composer' } } as any)
  await ui.redraw()
  expect(await bgOf(ui, 2)).toBe(FLASH)
  await clock.advance(125)
  await ui.redraw()
  expect(await bgOf(ui, 2)).toBe(mixHex(FLASH, '#1d3a2a', 1 / 12))
  await clock.advance(1375)
  await ui.redraw()
  expect(await bgOf(ui, 2)).toBe('diffAdded')
})
