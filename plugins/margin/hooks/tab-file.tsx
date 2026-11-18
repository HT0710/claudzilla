import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { cellsOf, fileWindow, layoutFor, sliceTokens } from './explorer-layout'
import type { Cached } from './explorer-layout'
import { loadFile, latestOf, projectRoot } from './explorer-load'
import type { Loaded } from './explorer-load'
import { current, navStart, remember, visit } from './explorer-nav'
import type { Nav } from './explorer-nav'
import { tokenize } from './explorer-tokens'
import type { Token } from './explorer-tokens'
import type { Listing } from './explorer-tree'
import { printable } from './git-data'
import { HUD, LIT, PAD, TYPES, basicGlyphs, emptyNote } from './kit'
import type { TabCtx, TabDraw } from './kit'

// The open place, so a change redraws the pane; the draw applies a place whose rev it has not seen.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as { rev: number; path: string; line?: number } | undefined)

type State = {
  nav: Nav
  root?: string
  cwd?: string
  lastFile?: string
  loaded?: Loaded
  layout?: Cached
  tokens: Map<number, Token[]>
  expanded: Set<string>
  listed: Map<string, Listing[]>
  // Unset: centre the lit line.
  top?: number
  col: number
  wrap: boolean
  lit?: { from: number; to: number }
  menuPinned: boolean
  rev: number
  // The last atom rev the module state has taken.
  applied: number
  notice?: string
}

const fresh = (): State => ({ nav: navStart(''), tokens: new Map(), expanded: new Set(), listed: new Map(), col: 0, wrap: false, menuPinned: false, rev: 0, applied: 0 })
const state = fresh()
const guard = latestOf()

// Remembers the spot, moves through `change`, and restores the spot of an entry it landed on.
function moveTo(change: (nav: Nav) => Nav): void {
  const remembered = remember(state.nav, state.top ?? 0, state.lit?.from)
  state.nav = change(remembered)
  const entry = current(state.nav)
  if (entry === current(remembered)) return
  state.top = entry.top
  state.lit = entry.kind === 'file' && entry.line !== undefined ? { from: entry.line, to: entry.line } : undefined
  state.col = 0
}

// The open place at a new revision the draw has already taken.
function placeOf() {
  return { rev: (state.applied = ++state.rev), path: current(state.nav).path, line: state.lit?.from }
}

export function showPlace(place: { path: string; line?: number }): number {
  moveTo(nav => visit(nav, { kind: 'file', ...place }))
  state.lastFile = place.path
  return (state.applied = ++state.rev)
}

export function openPlace($: EngineInterface, place: { path: string; line?: number }): Promise<void> {
  return update($, file, () => ({ rev: showPlace(place), path: place.path, line: place.line }))
}

export async function reloadPlace($: EngineInterface): Promise<void> {
  const place = current(state.nav)
  if (place.kind === 'file') {
    const n = guard.begin()
    const loaded = await loadFile($, place.path)
    if (guard.isLatest(n)) {
      state.loaded = loaded
      state.tokens = new Map()
      if (state.top !== undefined) state.top = Math.min(state.top, Math.max(0, loaded.lines.length - 1))
    }
  }
  await update($, file, () => placeOf())
}

// The path as the header shows it: from the project root's name, else from ~, else whole; cut from the start to fit.
function headOf(path: string, root: string, home: string | undefined, room: number): string {
  const name = root.slice(root.lastIndexOf('/') + 1)
  const shown = root && path.startsWith(`${root}/`) ? `${name}/${path.slice(root.length + 1)}` : home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path
  const clean = printable(shown)
  if (cellsOf(clean) <= room) return clean
  let tail = ''
  for (const ch of [...clean].reverse()) {
    if (cellsOf(tail + ch) > room - 1) break
    tail = ch + tail
  }
  return `…${tail}`
}

export async function draw($: EngineInterface, ctx: TabCtx): Promise<TabDraw> {
  const { Box, Text } = ctx.el
  const { props } = ctx
  const open = await read($, file)
  if (open && open.rev > state.applied) {
    showPlace({ path: open.path, line: open.line })
    state.rev = state.applied = Math.max(state.rev, open.rev)
  }
  state.root ??= await projectRoot($)
  state.cwd = await $.session.cwd().catch(() => '')
  const first = state.nav.entries[0]!
  if (first.path === '') state.nav = { ...state.nav, entries: [{ ...first, path: state.root }, ...state.nav.entries.slice(1)] }
  const wanted = current(state.nav)
  if (wanted.kind === 'file' && wanted.path !== state.loaded?.path) {
    const n = guard.begin()
    const loaded = await loadFile($, wanted.path)
    const here = current(state.nav)
    if (guard.isLatest(n) && here.kind === 'file' && here.path === wanted.path) {
      state.loaded = loaded
      state.tokens = new Map()
    }
  }
  const place = current(state.nav)
  const rows = Math.max(0, props.scroll.bodyRows)
  const codeRows = Math.max(0, rows - 2)
  const W = props.bodyColumns - 2 * PAD
  const home = await $.env.get('HOME').catch(() => undefined)
  const basic = await basicGlyphs($)
  const loaded = place.kind === 'file' && state.loaded?.path === place.path ? state.loaded : undefined
  const lines = loaded?.lines ?? []
  const digits = String(lines.length).length
  const G = digits + 2
  const C = W - G - 1
  let body: JSX.Element[] = []
  const zones: TabDraw['zones'] = []
  if (place.kind !== 'file') {
    body = [emptyNote(ctx.el, codeRows, 'No file open', <Text color={HUD.faint}>Click a file path in</Text>, <Text color={HUD.faint}>a reply to show it here.</Text>)]
  } else if (loaded?.unreadable) {
    body = [emptyNote(ctx.el, codeRows, "Can't show this file", <Text color={HUD.faint}>{loaded.missing ? 'It no longer exists.' : 'It is binary, unreadable or over 4 MiB.'}</Text>)]
  } else if (loaded) {
    state.layout = layoutFor(state.layout, loaded, C, state.wrap, lines)
    const { layout } = state.layout
    const line = state.lit?.from
    const asked = state.top ?? (line === undefined ? 0 : Math.max(0, (layout.starts[Math.max(0, Math.min(line, lines.length) - 1)] ?? 0) - Math.floor(codeRows / 2)))
    const win = fileWindow(layout.rows, asked, codeRows)
    state.top = win.top
    for (let i = win.top; i < win.last; i++) {
      const n = i + 1
      let tokens = state.tokens.get(i)
      if (!tokens) state.tokens.set(i, (tokens = tokenize(lines[i]!)))
      const lit = state.lit && n >= state.lit.from && n <= state.lit.to
      body.push(
        <Box key={`row:${n}`} backgroundColor={lit ? LIT : undefined}>
          <Text color={HUD.faint}>{` ${String(n).padStart(digits)} `}</Text>
          <Box width={C} flexShrink={0}>
            {sliceTokens(tokens, state.col, C).map((t, k) => (
              <Text key={k} color={t.kind === 'keyword' ? HUD.label : t.kind === 'string' ? TYPES.feat : t.kind === 'number' ? TYPES.perf : t.kind === 'comment' ? HUD.faint : undefined}>
                {t.text}
              </Text>
            ))}
          </Box>
          <Text color={HUD.faint}>│</Text>
        </Box>,
      )
    }
    zones.push({
      tab: 'Explorer',
      kind: 'list',
      from: 2,
      to: 2 + codeRows,
      offset: 0,
      fallback: true,
      wheel: by => {
        state.top = fileWindow(layout.rows, (state.top ?? 0) + by, codeRows).top
        return update($, file, () => placeOf())
      },
    })
  }
  const glyphs = basic ? '‹ › ↻' : `${String.fromCharCode(0xea9b)} ${String.fromCharCode(0xea9c)} ${String.fromCharCode(0xeb37)}`
  const path = place.kind === 'file' ? headOf(place.path, state.root, home, W - 6) : ''
  return {
    body: (
      <Box flexDirection="column" height={rows} flexShrink={0}>
        <Box>
          <Box width={5} flexShrink={0}>
            <Text color={HUD.faint}>{glyphs}</Text>
          </Box>
          <Box key="path" flexGrow={1} justifyContent="center">
            <Text color={HUD.action}>{path}</Text>
          </Box>
          <Box width={1} flexShrink={0} />
        </Box>
        <Box marginX={-PAD}>
          <Text color="promptBorder">{'─'.repeat(W + 2 * PAD)}</Text>
        </Box>
        {body}
      </Box>
    ),
    zones,
    trace: {},
    rules: [1],
  }
}
