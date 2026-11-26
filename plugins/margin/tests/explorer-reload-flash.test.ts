import { expect, test } from 'claude-code/testing'

import { FLASH } from '../hooks/kit'
import { clock, disk, explorer } from './explorer-helpers'

// Own file: the pane reads the theme once per module, so this test gets a module no other test has read it in.
const bgOf = async (ui: any, n: number) => (await ui.find({ key: `row:${n}` }))?.props.backgroundColor
const hostOk = (on: any) => on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

test('reload flash: an outside change flashes exactly the changed rows, an unchanged reload none', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\nb\nc\nd')
  disk.set('/repo/a.ts', { text: 'a\nB\nc\nd', mtimeMs: 2 })
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/b/B/ a.ts' } as any)
  await ui.redraw()
  expect(await bgOf(ui, 2)).toBe(FLASH)
  for (const n of [1, 3, 4]) expect(await bgOf(ui, n)).not.toBe(FLASH)
  await clock.advance(1500)
  await ui.redraw()
  expect(await bgOf(ui, 2)).not.toBe(FLASH)
  // Same text, new mtime: nothing flashes.
  disk.set('/repo/a.ts', { text: 'a\nB\nc\nd', mtimeMs: 3 })
  await $.tool.call({ tool: 'Bash', command: 'touch a.ts' } as any)
  await ui.redraw()
  for (const n of [1, 2, 3, 4]) expect(await bgOf(ui, n)).not.toBe(FLASH)
})

// A compare by position would flash every row below the first line here.
test('reload flash: a line inserted above flashes only its own new row', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\nb\nc')
  disk.set('/repo/a.ts', { text: 'x\na\nb\nc', mtimeMs: 2 })
  await $.tool.call({ tool: 'Bash', command: 'edit' } as any)
  await ui.redraw()
  expect(await bgOf(ui, 1)).toBe(FLASH)
  for (const n of [2, 3, 4]) expect(await bgOf(ui, n)).not.toBe(FLASH)
})

test('reload flash: a line removed above flashes no row', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.ts' }, 'a\nb\nc\nd')
  disk.set('/repo/a.ts', { text: 'b\nc\nd', mtimeMs: 2 })
  await $.tool.call({ tool: 'Bash', command: 'edit' } as any)
  await ui.redraw()
  for (const n of [1, 2, 3]) expect(await bgOf(ui, n)).not.toBe(FLASH)
})
