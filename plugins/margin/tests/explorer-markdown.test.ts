import type { Register } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { disk, explorer, lines, open, pathText, setup, mountPane, textOf } from './explorer-helpers'

// Drawn as Markdown: the heading text without the source row.
const md = async (ui: any) => !!(await ui.find({ type: 'Text', text: 'Title' })) && !(await ui.find({ key: 'row:1' }))
const doc = '# Title\n\n- item one'
const flip = async (ui: any) => {
  await ui.press({ key: 'explorer:markdown' })
  await ui.redraw()
}
const edit = { name: 'edit', register: (on => { on('command.run', { command: 'show-edit' }, async ($, e) => (await ($ as any).margin.show(JSON.parse((e as any).args)), {})) }) as Register }
const hostOk = (on: any) => on('tool.call', () => ({ result: { stdout: '', stderr: '' } }) as any)

test('a .md file shows the switch', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  expect(await ui.find({ key: 'explorer:markdown' })).toBeDefined()
})

test('a .ts file has no switch', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.ts' }, doc)
  expect(await ui.find({ key: 'explorer:markdown' })).toBeUndefined()
})

test('basic glyphs show M', async ($, on) => {
  on('fs.exists', (_, e) => ({ value: String((e as any).path ?? '').endsWith('.claudzilla-basic-glyphs') }))
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  expect(textOf(await ui.find({ key: 'explorer:markdown' }))).toBe('M')
})

test('a .md file opens drawn, and the switch flips to source and back', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  expect(await md(ui)).toBe(true)
  await flip(ui)
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
  await flip(ui)
  expect(await md(ui)).toBe(true)
})

test('an unreadable .md shows the note and no switch', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, 'ab\0cd')
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeDefined()
  expect(await ui.find({ key: 'explorer:markdown' })).toBeUndefined()
})

test('an empty .md shows no note and the switch', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, '')
  expect(await ui.find({ type: 'Text', text: "Can't show this file" })).toBeUndefined()
  expect(await ui.find({ key: 'explorer:markdown' })).toBeDefined()
})

test('CRLF text draws as Markdown', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, '# Title\r\n\r\n- item one\r\n')
  expect(await md(ui)).toBe(true)
})

test('the header path is 2 cells shorter for .md than .ts when cut', async ($, on) => {
  const dir = '/home/me/' + 'd'.repeat(90)
  const ui = await explorer($, on, { path: `${dir}/ab.ts` }, doc)
  const ts = await pathText(ui)
  disk.set(`${dir}/ab.md`, { text: doc, mtimeMs: 1 })
  open({ path: `${dir}/ab.md` })
  await ui.redraw()
  expect((await pathText(ui)).length).toBe(ts.length - 2)
})

test('a reload keeps the Markdown view', async ($, on) => {
  hostOk(on)
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  disk.set('/repo/a.md', { text: '# Title\n\n- item two', mtimeMs: 2 })
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/one/two/ a.md' } as any)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'item two' })).toBeDefined()
  expect(await md(ui)).toBe(true)
})

test('the wheel scrolls the Markdown view', async ($, on) => {
  const wheel = async (ui: any, by: number) => {
    await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 0, row: 6 } })
    await ui.redraw()
  }
  const long = '# Title\n\n' + Array.from({ length: 200 }, (_, i) => `- item ${i}`).join('\n')
  const ui = await explorer($, on, { path: '/repo/a.md' }, long)
  for (let i = 0; i < 60; i++) await wheel(ui, 10)
  expect(await ui.find({ type: 'Text', text: 'item 199' })).toBeDefined()
  expect(await ui.find({ key: 'row:1' })).toBeUndefined()
})

test('a short Markdown file keeps its top after a wheel tick', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  await $.ui.scroll({ component: 'Pane', requestId: 'margin', offset: 0, by: 3, bodyRows: 19, contentRows: 19, origin: { kind: 'person' }, pointer: { column: 0, row: 6 } })
  await ui.redraw()
  expect(await md(ui)).toBe(true)
})

test('a line open shows source, a later plain open shows Markdown', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md', line: 2 }, doc)
  expect(await ui.find({ key: 'row:2' })).toBeDefined()
  expect(await md(ui)).toBe(false)
  disk.set('/repo/b.md', { text: doc, mtimeMs: 1 })
  open({ path: '/repo/b.md' })
  await ui.redraw()
  expect(await md(ui)).toBe(true)
})

test('the view is per file', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  await flip(ui)
  disk.set('/repo/b.md', { text: doc, mtimeMs: 1 })
  open({ path: '/repo/b.md' })
  await ui.redraw()
  expect(await md(ui)).toBe(true)
})

test('back and forward keep each entry its view', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  await flip(ui)
  disk.set('/repo/b.ts', { text: lines(3), mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
  await ui.press({ key: 'forward' })
  await ui.redraw()
  expect(await pathText(ui)).toBe('repo/b.ts')
})

test('back to a file left in Markdown view shows Markdown', async ($, on) => {
  const ui = await explorer($, on, { path: '/repo/a.md' }, doc)
  disk.set('/repo/b.ts', { text: lines(3), mtimeMs: 1 })
  open({ path: '/repo/b.ts' })
  await ui.redraw()
  await ui.press({ key: 'back' })
  await ui.redraw()
  expect(await md(ui)).toBe(true)
})

test('an edit press on the shown .md file shows source', { plugins: [edit] }, async ($, on) => {
  on('ui.panes', () => ({ value: [{ id: 'margin', isPlaced: true }] }))
  await setup($, on)
  disk.set('/repo/a.md', { text: doc, mtimeMs: 1 })
  open({ path: '/repo/a.md' })
  const ui = await mountPane($)
  expect(await md(ui)).toBe(true)
  await $.command.run({ command: 'show-edit', args: JSON.stringify({ path: '/repo/a.md', diff: '@@ -3 +3 @@\n-item\n+item one' }), origin: { kind: 'composer' } } as any)
  await ui.redraw()
  expect(await ui.find({ key: 'row:1' })).toBeDefined()
})
