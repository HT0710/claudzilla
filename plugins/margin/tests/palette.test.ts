import { expect, test } from 'claude-code/testing'
import { DEFAULTS, mergePalette } from '../hooks/palette'

test('no palette gives the defaults', () => {
  expect(mergePalette(undefined)).toEqual({ palette: DEFAULTS, ignored: [] })
})
test('a set key wins and the rest keep their defaults', () => {
  const { palette, ignored } = mergePalette({ shared: { label: '#112233' }, margin: { types: { fix: '#AABBCC' }, pill: { red: '#010203' } }, hud: { session: '#0a0b0c' } })
  expect(ignored).toEqual([])
  expect([palette.shared.label, palette.margin.types.fix, palette.margin.pill.red, palette.hud.session]).toEqual(['#112233', '#AABBCC', '#010203', '#0a0b0c'])
  expect([palette.shared.faint, palette.margin.compacted, palette.margin.types.feat]).toEqual(['#4f5c68', '#8c7850', '#98c379'])
})
test('a bad value is ignored and named', () => {
  const { palette, ignored } = mergePalette({ hud: { rampHot: 'orange', note: '#12\u001b[0m', track: '#12345', sweep: 5 }, margin: { status: { M: null } } })
  expect(ignored).toEqual(['palette.hud.rampHot', 'palette.hud.note', 'palette.hud.track', 'palette.hud.sweep', 'palette.margin.status.M'])
  expect(palette).toEqual(DEFAULTS)
})
test('a shared key set under a component table is ignored and named', () => {
  const { palette, ignored } = mergePalette({ margin: { label: '#112233' }, hud: { faint: '#112233' } })
  expect(ignored).toEqual(['palette.margin.label', 'palette.hud.faint'])
  expect(palette).toEqual(DEFAULTS)
})
test('unknown tables, keys and shapes are named', () => {
  expect(mergePalette({ folio: { lit: '#112233' }, margin: { types: { chore: '#112233' }, pill: '#112233' }, shared: ['#112233'] }).ignored)
    .toEqual(['palette.folio', 'palette.margin.types.chore', 'palette.margin.pill', 'palette.shared'])
  expect(mergePalette('dark').ignored).toEqual(['palette'])
})
test('merging leaves DEFAULTS as they were', () => {
  mergePalette({ shared: { label: '#112233' }, margin: { types: { fix: '#112233' } } })
  expect([DEFAULTS.shared.label, DEFAULTS.margin.types.fix]).toEqual(['#a396d2', '#e06c75'])
})
