import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'

import { cellsOf, fileWindow, layoutFor, sliceTokens } from './explorer-layout'
import type { Cached } from './explorer-layout'
import { listDir, loadFile, latestOf, projectRoot } from './explorer-load'
import type { Loaded } from './explorer-load'
import { back, current, forward, navStart, remember, visit } from './explorer-nav'
import type { Nav } from './explorer-nav'
import { tokenize } from './explorer-tokens'
import type { Token } from './explorer-tokens'
import { iconOf, treeRows } from './explorer-tree'
import type { Listing } from './explorer-tree'
import { printable } from './git-data'
import { HUD, LIT, PAD, TYPES, basicGlyphs, emptyNote } from './kit'
import type { TabCtx, TabDraw } from './kit'

// The open place, so a change redraws the pane; the draw applies a place whose rev it has not seen.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as { rev: number; path: string; line?: number; kind?: 'file' | 'folder' } | undefined)

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
// A row icon's colour name (explorer-tree.ts) to the colour the Git tab draws that name in.
const ICON_COLORS = (): Record<string, string> => ({ claude: 'claude', faint: HUD.faint, refactor: TYPES.refactor!, docs: TYPES.docs!, test: TYPES.test!, feat: TYPES.feat! })

// Remembers the spot, moves through `change`, and restores the spot of an entry it landed on.
function moveTo(change: (nav: Nav) => Nav): boolean {
  const remembered = remember(state.nav, state.top ?? 0, state.lit?.from)
  state.nav = change(remembered)
  const entry = current(state.nav)
  if (entry === current(remembered)) return false
  state.top = entry.top
  state.lit = entry.kind === 'file' && entry.line !== undefined ? { from: entry.line, to: entry.line } : undefined
  state.col = 0
  return true
}

// The open place at a new revision the draw has already taken.
function placeOf() {
  const here = current(state.nav)
  return { rev: (state.applied = ++state.rev), path: here.path, line: state.lit?.from, kind: here.kind }
}

export function showPlace(place: { path: string; line?: number }): number {
  moveTo(nav => visit(nav, { kind: 'file', ...place }))
  state.lastFile = place.path
  return (state.applied = ++state.rev)
}

// Opens a folder page, expanding the folders down to the last file shown when it lies under it.
export function showFolder(path: string): number {
  moveTo(nav => visit(nav, { kind: 'folder', path }))
  const last = state.lastFile
  if (last?.startsWith(`${path.replace(/\/$/, '')}/`)) {
    for (let at = last.slice(0, last.lastIndexOf('/')); at.length > path.length; at = at.slice(0, at.lastIndexOf('/'))) state.expanded.add(at)
  }
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

export async function goBack($: EngineInterface): Promise<void> {
  if (!moveTo(back)) return
  await update($, file, () => placeOf())
}

export async function goForward($: EngineInterface): Promise<void> {
  if (!moveTo(forward)) return
  await update($, file, () => placeOf())
}

// The path as the header shows it: from the project root's name, else from ~, else whole; cut from the start to fit.
function headOf(path: string, root: string, home: string | undefined, room: number): string {
  const name = root.slice(root.lastIndexOf('/') + 1)
  const shown = root && path.startsWith(`${root}/`) ? `${name}/${path.slice(root.length + 1)}` : root.length > 1 && path === root ? name : home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path
  const clean = printable(shown)
  if (cellsOf(clean) <= room) return clean
  let tail = ''
  for (const ch of [...clean].reverse()) {
    if (cellsOf(tail + ch) > room - 1) break
    tail = ch + tail
  }
  return `…${tail}`
}

export const refOf = (rel: string, first: number, last: number): string => (first === last ? `${rel}:${first}` : `${rel}:${first}-${last}`)

async function copyLines($: EngineInterface, first: number, last: number, surface?: RenderSurface): Promise<void> {
  const here = current(state.nav)
  if (here.kind === 'folder') return
  const cwd = (state.cwd ?? '').replace(/\/$/, '')
  const ref = refOf(cwd && here.path.startsWith(`${cwd}/`) ? here.path.slice(cwd.length + 1) : here.path, first, last)
  const copied = await $.ui.copy({ text: ref, surface }).catch(() => undefined)
  if (!copied?.isCopied) return
  state.lit = { from: first, to: last }
  state.notice = ref
  await update($, file, () => placeOf())
  $.clock.after(3000, async () => {
    if (state.notice !== ref) return
    state.notice = undefined
    await update($, file, () => placeOf())
  })
}

export async function explorerPost($: EngineInterface, e: { element: string; data: unknown; surface?: RenderSurface }): Promise<void> {
  const d = e.data as { first?: unknown; last?: unknown } | undefined
  if (e.element === 'explorer:gutter' && typeof d?.first === 'number' && typeof d.last === 'number') await copyLines($, d.first, d.last, e.surface)
}

export async function draw($: EngineInterface, ctx: TabCtx): Promise<TabDraw> {
  const { Box, Button, Text } = ctx.el
  const { props } = ctx
  const open = await read($, file)
  if (open && open.rev > state.applied) {
    if (open.kind === 'folder') showFolder(open.path)
    else showPlace({ path: open.path, line: open.line })
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
  if (place.kind === 'folder') {
    const n = guard.begin()
    // A newer draw or a move since the awaits: this page is old, so draw the current one instead.
    const stale = () => !guard.isLatest(n) || current(state.nav).path !== place.path
    if (!state.listed.has(place.path)) state.listed.set(place.path, await listDir($, place.path))
    if (stale()) return draw($, ctx)
    let all = treeRows(place.path, state.expanded, state.listed)
    for (;;) {
      const top = Math.max(0, Math.min(state.top ?? 0, all.length - codeRows))
      const todo = all.slice(top, top + codeRows).filter(r => r.kind === 'dir' && !state.listed.has(r.path))
      if (!todo.length) break
      await Promise.all(todo.map(async r => void state.listed.set(r.path, await listDir($, r.path))))
      if (stale()) return draw($, ctx)
      all = treeRows(place.path, state.expanded, state.listed)
    }
    state.top = Math.max(0, Math.min(state.top ?? 0, all.length - codeRows))
    const top = state.top
    if (!all.length) body = [<Text key="empty" color={HUD.faint}>empty</Text>]
    for (const r of all.slice(top, top + codeRows)) {
      const icon = iconOf(r.name, r.kind, r)
      const faint = r.dim || r.broken
      const tone = (name: string) => (faint ? HUD.faint : ICON_COLORS()[name] ?? HUD.faint)
      body.push(
        <Button
          key={r.path}
          plain
          onPress={() => {
            if (r.kind === 'file') return openPlace($, { path: r.path })
            if (r.empty) return
            if (!state.expanded.delete(r.path)) state.expanded.add(r.path)
            return update($, file, () => placeOf())
          }}
        >
          <Text>{' '.repeat(r.x)}</Text>
          <Text color={HUD.faint}>{r.kind === 'dir' && !r.empty ? (r.open ? '▾' : '▸') : ' '}</Text>
          <Text> </Text>
          {basic ? null : <Text color={tone(icon.color)}>{icon.glyph}</Text>}
          {basic ? null : <Text> </Text>}
          <Text color={faint ? HUD.faint : undefined}>{printable(r.name)}</Text>
        </Button>,
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
        state.top = Math.max(0, Math.min((state.top ?? 0) + by, all.length - codeRows))
        return update($, file, () => placeOf())
      },
    })
  } else if (loaded?.unreadable) {
    body = [emptyNote(ctx.el, codeRows, "Can't show this file", <Text color={HUD.faint}>{loaded.missing ? 'It no longer exists.' : 'It is binary, unreadable or over 4 MiB.'}</Text>)]
  } else if (loaded) {
    state.layout = layoutFor(state.layout, loaded, C, state.wrap, lines)
    const { layout } = state.layout
    const line = state.lit?.from
    const asked = state.top ?? (line === undefined ? 0 : Math.max(0, (layout.starts[Math.max(0, Math.min(line, lines.length) - 1)] ?? 0) - Math.floor(codeRows / 2)))
    const win = fileWindow(layout.rows, asked, codeRows)
    state.top = win.top
    const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
    const drawn: { line: number; cell: string; lit: boolean }[] = []
    const code: JSX.Element[] = []
    for (let i = win.top; i < win.last; i++) {
      const n = i + 1
      let tokens = state.tokens.get(i)
      if (!tokens) state.tokens.set(i, (tokens = tokenize(lines[i]!)))
      const lit = !!state.lit && n >= state.lit.from && n <= state.lit.to
      drawn.push({ line: n, cell: ` ${String(n).padStart(digits)} `, lit })
      code.push(
        <Box key={`row:${n}`} backgroundColor={lit ? LIT : undefined}>
          <Box width={C} flexShrink={0}>
            <Button
              key={`code:${i - win.top}`}
              plain
              onPress={() => {
                state.lit = undefined
                return update($, file, () => placeOf())
              }}
            >
              {sliceTokens(tokens, state.col, C).map((t, k) => (
                <Text key={k} color={t.kind === 'keyword' ? HUD.label : t.kind === 'string' ? TYPES.feat : t.kind === 'number' ? TYPES.perf : t.kind === 'comment' ? HUD.faint : undefined}>
                  {t.text}
                </Text>
              ))}
            </Button>
          </Box>
          <Text color={HUD.faint}>│</Text>
        </Box>,
      )
    }
    body.push(
      <Box key="view">
        <Box width={G} flexShrink={0} flexDirection="column">
          {Client ? (
            <Client key="explorer:gutter" module="./explorer-gutter.tsx" height={codeRows} props={{ rows: drawn, colors: { lit: LIT, faint: HUD.faint, claude: 'claude' } }} />
          ) : (
            drawn.map(r => (
              <Button key={`gutter:${r.line}`} plain onPress={press => copyLines($, r.line, r.line, press.surface)}>
                <Text color={HUD.faint} backgroundColor={r.lit ? LIT : undefined}>
                  {r.cell}
                </Text>
              </Button>
            ))
          )}
        </Box>
        <Box flexDirection="column">{code}</Box>
      </Box>,
    )
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
  const glyph = (key: string, plain: string, code: number, press: () => unknown) => (
    <Button key={key} plain onPress={press}>
      <Text color={HUD.faint}>{basic ? plain : String.fromCharCode(code)}</Text>
    </Button>
  )
  const shown = headOf(place.path, state.root, home, W - 6)
  const inRoot = state.root !== '/' && (place.path === state.root || place.path.startsWith(`${state.root}/`))
  let path: JSX.Element[] | string = shown
  if (inRoot && !shown.startsWith('…')) {
    const parts = place.path === state.root ? [] : place.path.slice(state.root.length + 1).split('/')
    let at = state.root
    const openFolder = (dir: string) => () => update($, file, () => (showFolder(dir), placeOf()))
    const rootName = printable(at.slice(at.lastIndexOf('/') + 1))
    path = [
      parts.length ? (
        <Button key={at} plain onPress={openFolder(at)}>
          <Text color={HUD.action}>{rootName}</Text>
        </Button>
      ) : (
        <Text key="last" bold color="claude">
          {rootName}
        </Text>
      ),
    ]
    parts.forEach((part, i) => {
      path.push(<Text key={`sep:${i}`} color="promptBorder">/</Text>)
      at += `/${part}`
      path.push(
        i < parts.length - 1 ? (
          <Button key={at} plain onPress={openFolder(at)}>
            <Text color={HUD.action}>{printable(part)}</Text>
          </Button>
        ) : (
          <Text key="last" bold color="claude">
            {printable(part)}
          </Text>
        ),
      )
    })
  }
  return {
    body: (
      <Box flexDirection="column" height={rows} flexShrink={0}>
        <Box>
          <Box width={5} flexShrink={0} gap={1}>
            {glyph('back', '‹', 0xea9b, () => goBack($))}
            {glyph('forward', '›', 0xea9c, () => goForward($))}
            {glyph('refresh', '↻', 0xeb37, () => reloadPlace($))}
          </Box>
          <Box key="path" flexGrow={1} justifyContent="center">
            {state.notice ? (
              [<Text key="verb" color={HUD.faint}>copied </Text>, <Text key="ref" color="claude">{state.notice}</Text>]
            ) : typeof path === 'string' ? (
              <Text color={HUD.action}>{path}</Text>
            ) : (
              path
            )}
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
