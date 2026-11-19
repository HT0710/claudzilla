import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'

import { FIND_WAIT, findIn, leavesField } from './explorer-find'
import type { FindResult } from './explorer-find'
import { cellsOf, fileWindow, layoutFor, layoutOf, lineAt, sliceTokens, thumbOf } from './explorer-layout'
import type { Cached } from './explorer-layout'
import { listDir, loadFile, latestOf, projectRoot, statOf } from './explorer-load'
import type { Loaded } from './explorer-load'
import { back, current, forward, navStart, remember, visit } from './explorer-nav'
import type { Nav } from './explorer-nav'
import { tokenize } from './explorer-tokens'
import type { Token } from './explorer-tokens'
import { iconOf, treeRows } from './explorer-tree'
import type { Listing } from './explorer-tree'
import { fileKey, printable } from './git-data'
import { CARD, HUD, LIT, PAD, TYPES, basicGlyphs, emptyNote, rowHovers, toPieces } from './kit'
import type { TabCtx, TabDraw } from './kit'

// The open place, so a change redraws the pane; the draw applies a place whose rev it has not seen.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as { rev: number; path: string; line?: number; kind?: 'file' | 'folder' } | undefined)

type State = {
  nav: Nav
  root?: string
  cwd?: string
  lastFile?: string
  loaded?: Loaded
  afterFolder?: boolean
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
  find?: { open: boolean; text: string; pending: boolean; result: FindResult; current: number }
  toggles: { matchCase: boolean; word: boolean; regex: boolean }
  rev: number
  // The last atom rev the module state has taken.
  applied: number
  notice?: string
  noticeVerb?: string
}

const fresh = (): State => ({ nav: navStart(''), tokens: new Map(), expanded: new Set(), listed: new Map(), col: 0, wrap: false, menuPinned: false, toggles: { matchCase: false, word: false, regex: false }, rev: 0, applied: 0 })
const state = fresh()
const rowHover = rowHovers.Explorer
const guard = latestOf()
// Folder listings count apart from file loads, so folder work never drops a reload.
const folders = latestOf()
const finds = latestOf()
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

export function openPlace($: EngineInterface, place: { path: string; line?: number; kind?: 'file' | 'folder' }): Promise<void> {
  if (place.kind === 'folder') return update($, file, () => (showFolder(place.path), placeOf()))
  return update($, file, () => ({ rev: showPlace(place), path: place.path, line: place.line }))
}

// Lists every folder again at the next draw, which reads only those on screen.
async function relistPage($: EngineInterface): Promise<void> {
  state.listed.clear()
  await update($, file, () => placeOf())
}

export async function reloadPlace($: EngineInterface): Promise<void> {
  const place = current(state.nav)
  if (place.kind === 'folder') return relistPage($)
  const n = guard.begin()
  const loaded = await loadFile($, place.path)
  if (guard.isLatest(n)) {
    state.loaded = loaded
    state.tokens = new Map()
  }
  await update($, file, () => placeOf())
}

// Reloads the open file when its stamp changed or it is gone.
export async function checkOpenFile($: EngineInterface): Promise<void> {
  const place = current(state.nav)
  if (place.kind !== 'file' || state.loaded?.path !== place.path) return
  const st = await statOf($, place.path)
  if (st ? st.mtimeMs !== state.loaded.mtimeMs || st.size !== state.loaded.size : !state.loaded.missing) await reloadPlace($)
}

export async function changedOnDisk($: EngineInterface, call: { tool: string } & Record<string, unknown>): Promise<void> {
  if (!state.root) return
  const here = current(state.nav)
  const target = call.tool === 'NotebookEdit' ? call.notebook_path : call.file_path
  if (here.kind === 'file' && (call.tool === 'Edit' || call.tool === 'Write' || call.tool === 'NotebookEdit') && target === here.path) return reloadPlace($)
  if (here.kind === 'folder' && (call.tool === 'Write' || call.tool === 'Bash')) await relistPage($)
  if (call.tool === 'Bash') await checkOpenFile($)
}

const FIELD = 'explorer:find'
const PLACEHOLDER = 'type text to find'

// Closes the find field when focus leaves it with no text.
export async function fieldLeft($: EngineInterface, e: { element?: string }): Promise<void> {
  if (!state.find?.open || state.find.text || !leavesField(e, FIELD)) return
  state.find = undefined
  await update($, file, () => placeOf())
}

async function openFind($: EngineInterface): Promise<void> {
  state.find ??= { open: true, text: '', pending: false, result: { matches: [], bad: false, capped: false }, current: 0 }
  state.find.open = true
  await update($, file, () => placeOf())
  await $.ui.focus({ requestId: 'margin', key: FIELD }).catch(() => undefined)
}

function typeFind($: EngineInterface, text: string): void {
  const find = state.find
  if (!find) return
  find.text = text
  const n = finds.begin()
  if (!text) {
    find.pending = false
    find.result = { matches: [], bad: false, capped: false }
    find.current = 0
    state.lit = undefined
  } else {
    find.pending = true
    $.clock.after(FIND_WAIT, async () => {
      if (!finds.isLatest(n) || !state.find?.open) return
      find.result = findIn(state.loaded?.lines ?? [], { text, ...state.toggles })
      find.pending = false
      find.current = 0
      const first = find.result.matches[0]
      state.lit = first && { from: first.line, to: first.line }
      state.top = undefined
      await update($, file, () => placeOf())
    })
  }
  $.ui.invalidate('ui.render')
}

export async function goBack($: EngineInterface): Promise<void> {
  if (!moveTo(back)) return
  await update($, file, () => placeOf())
}

export async function goForward($: EngineInterface): Promise<void> {
  if (!moveTo(forward)) return
  await update($, file, () => placeOf())
}

// Width of a menu label column; the mark column adds 1.
const LABEL = 18

// The path as the header shows it: from the project root's name, else from ~, else whole; cut from the start to fit.
function headOf(path: string, root: string, home: string | undefined, room: number): string {
  const name = root.slice(root.lastIndexOf('/') + 1)
  const shown = root && path.startsWith(`${root}/`) ? `${name}/${path.slice(root.length + 1)}` : root.length > 1 && path === root ? name : home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path
  return cutStart(printable(shown), room)
}

// Text cut from its start with `…` to fit room cells.
function cutStart(clean: string, room: number): string {
  if (cellsOf(clean) <= room) return clean
  let tail = ''
  for (const ch of [...clean].reverse()) {
    if (cellsOf(tail + ch) > room - 1) break
    tail = ch + tail
  }
  return `…${tail}`
}

export const refOf = (rel: string, first: number, last: number): string => (first === last ? `${rel}:${first}` : `${rel}:${first}-${last}`)

// A path as the menu and the copied reference give it: from the working directory when under it, else absolute.
function relOf(path: string): string {
  const cwd = (state.cwd ?? '').replace(/\/$/, '')
  const bare = path.replace(/(.)\/$/, '$1')
  return cwd && bare === cwd ? '.' : cwd && bare.startsWith(`${cwd}/`) ? bare.slice(cwd.length + 1) : bare
}

// Shows the header notice and clears it after 3 seconds if it is still the same.
function notify($: EngineInterface, verb: string, text: string): void {
  state.noticeVerb = verb
  state.notice = text
  $.clock.after(3000, async () => {
    if (state.notice !== text || state.noticeVerb !== verb) return
    state.notice = undefined
    await update($, file, () => placeOf())
  })
}

async function copyText($: EngineInterface, text: string, surface?: RenderSurface): Promise<boolean> {
  const copied = await $.ui.copy({ text, surface }).catch(() => undefined)
  return !!copied?.isCopied
}

async function copyLines($: EngineInterface, first: number, last: number, surface?: RenderSurface): Promise<void> {
  const here = current(state.nav)
  if (here.kind === 'folder') return
  const ref = refOf(relOf(here.path), first, last)
  if (!(await copyText($, ref, surface))) return
  state.lit = { from: first, to: last }
  notify($, 'copied', ref)
  await update($, file, () => placeOf())
}

export async function explorerPost($: EngineInterface, e: { element: string; data: unknown; surface?: RenderSurface }): Promise<void> {
  const d = e.data as { first?: unknown; last?: unknown; top?: unknown } | undefined
  if ((e.element === 'explorer:vbar' || e.element === 'explorer:hbar') && typeof d?.top === 'number') {
    // The next draw clamps the spot to the file.
    if (e.element === 'explorer:vbar') state.top = d.top
    else state.col = d.top
    await update($, file, () => placeOf())
    return
  }
  if (e.element === 'explorer:gutter' && typeof d?.first === 'number' && typeof d.last === 'number') await copyLines($, d.first, d.last, e.surface)
}

export async function draw($: EngineInterface, ctx: TabCtx): Promise<TabDraw> {
  const { Box, Button, Text } = ctx.el
  const Input = ctx.el.Input
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
  // A file shown again after a folder page may have changed meanwhile.
  if (wanted.kind === 'file' && state.afterFolder && state.loaded?.path === wanted.path) {
    const st = await statOf($, wanted.path)
    if (!st || st.mtimeMs !== state.loaded.mtimeMs || st.size !== state.loaded.size) state.loaded = undefined
  }
  if (wanted.kind === 'file') state.afterFolder = false
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
  if (place.kind === 'folder') state.afterFolder = true
  const rows = Math.max(0, props.scroll.bodyRows)
  let codeRows = Math.max(0, rows - 2)
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
    const n = folders.begin()
    // A newer draw or a move since the awaits: this page is old, so draw the current one instead.
    const stale = () => !folders.isLatest(n) || current(state.nav).path !== place.path
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
    rowHover.acts = {}
    const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
    for (const r of all.slice(top, top + codeRows)) {
      const icon = iconOf(r.name, r.kind, r)
      const faint = r.dim || r.broken
      const tone = (name: string) => (faint ? HUD.faint : ICON_COLORS()[name] ?? HUD.faint)
      const left = [
        <Text>{' '.repeat(r.x)}</Text>,
        <Text color={HUD.faint}>{r.kind === 'dir' && !r.empty ? (r.open ? '▾' : '▸') : ' '}</Text>,
        <Text> </Text>,
        ...(basic ? [] : [<Text color={tone(icon.color)}>{icon.glyph}</Text>, <Text> </Text>]),
        <Text color={faint ? HUD.faint : undefined}>{printable(r.name)}</Text>,
      ]
      const press = () => {
        if (r.kind === 'file') return openPlace($, { path: r.path })
        if (r.empty) return
        if (!state.expanded.delete(r.path)) state.expanded.add(r.path)
        return update($, file, () => placeOf())
      }
      const key = `x:${fileKey(r.path)}`
      rowHover.acts[key] = press
      body.push(
        // Keyed, its own hover scope: unkeyed, it would light whenever the pointer is anywhere in the tree.
        <Box key={key} flexDirection="column" height={1} hover={{ backgroundColor: LIT }}>
          {Client ? (
            <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: toPieces(left), right: [] }} />
          ) : (
            <Button plain key={r.path} onPress={press}>
              {left}
            </Button>
          )}
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
        state.top = Math.max(0, Math.min((state.top ?? 0) + by, all.length - codeRows))
        return update($, file, () => placeOf())
      },
    })
  } else if (loaded?.unreadable) {
    body = [emptyNote(ctx.el, codeRows, "Can't show this file", <Text color={HUD.faint}>{loaded.missing ? 'It no longer exists.' : 'It is binary, unreadable or over 4 MiB.'}</Text>)]
  } else if (loaded) {
    state.layout = layoutFor(state.layout, loaded, C, state.wrap, lines)
    const { layout } = state.layout
    const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
    const hbar = !!Client && !state.wrap && layout.widest > C
    if (hbar) codeRows = Math.max(0, codeRows - 1)
    state.col = state.wrap ? 0 : Math.max(0, Math.min(state.col, layout.widest - C))
    const line = state.lit?.from
    const asked = state.top ?? (line === undefined ? 0 : Math.max(0, (layout.starts[Math.max(0, Math.min(line, lines.length) - 1)] ?? 0) - Math.floor(codeRows / 2)))
    const win = fileWindow(layout.rows, asked, codeRows)
    state.top = win.top
    const drawn: { row: number; line: number; cell: string; lit: boolean }[] = []
    const code: JSX.Element[] = []
    for (let r = win.top; r < win.last; r++) {
      const i = lineAt(layout, r)
      const seg = r - layout.starts[i]!
      const n = i + 1
      let tokens = state.tokens.get(i)
      if (!tokens) state.tokens.set(i, (tokens = tokenize(lines[i]!)))
      const slice = sliceTokens(tokens, state.wrap ? seg * C : state.col, C)
      const lit = !!state.lit && n >= state.lit.from && n <= state.lit.to
      drawn.push({ row: r, line: n, cell: seg ? ' '.repeat(G) : ` ${String(n).padStart(digits)} `, lit })
      code.push(
        <Box key={seg ? `row:${n}:${seg}` : `row:${n}`} backgroundColor={lit ? LIT : undefined}>
          <Box width={C} flexShrink={0}>
            <Button
              key={`code:${r - win.top}`}
              plain
              onPress={() => {
                state.lit = undefined
                return update($, file, () => placeOf())
              }}
            >
              {slice.length ? slice.map((t, k) => (
                <Text key={k} color={t.kind === 'keyword' ? HUD.label : t.kind === 'string' ? TYPES.feat : t.kind === 'number' ? TYPES.perf : t.kind === 'comment' ? HUD.faint : undefined}>
                  {t.text}
                </Text>
              )) : <Text> </Text>}
            </Button>
          </Box>
          {!Client && <Text color={HUD.faint}>│</Text>}
        </Box>,
      )
    }
    const bar = (axis: 'v' | 'h', cells: number, total: number, top: number) => ({
      axis,
      cells,
      total,
      shown: cells,
      top,
      ...thumbOf(total, cells, top, cells),
      glyph: String.fromCharCode(axis === 'v' ? 0x2590 : 0x2582),
      color: 'promptBorder',
    })
    body.push(
      <Box key="view">
        <Box width={G} flexShrink={0} flexDirection="column">
          {Client ? (
            <Client key="explorer:gutter" module="./explorer-gutter.tsx" height={codeRows} props={{ rows: drawn, colors: { lit: LIT, faint: HUD.faint, claude: 'claude' } }} />
          ) : (
            drawn.map(r => (
              <Button key={`gutter:${r.row}`} plain onPress={press => copyLines($, r.line, r.line, press.surface)}>
                <Text color={HUD.faint} backgroundColor={r.lit ? LIT : undefined}>
                  {r.cell}
                </Text>
              </Button>
            ))
          )}
        </Box>
        <Box flexDirection="column">{code}</Box>
        {Client && <Client key="explorer:vbar" module="./explorer-bar.tsx" width={1} height={codeRows} props={bar('v', codeRows, layout.rows, win.top)} />}
      </Box>,
    )
    if (hbar && Client) {
      body.push(
        <Box key="hview">
          <Box width={G} flexShrink={0} />
          <Client key="explorer:hbar" module="./explorer-bar.tsx" width={C} height={1} props={bar('h', C, layout.widest, state.col)} />
        </Box>,
      )
      zones.push({
        tab: 'Explorer',
        kind: 'list',
        from: 2 + codeRows,
        to: 3 + codeRows,
        offset: 0,
        wheel: by => {
          state.col = Math.max(0, Math.min(state.col + 4 * by, layout.widest - C))
          return update($, file, () => placeOf())
        },
      })
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
  const glyph = (key: string, plain: string, code: number, press: () => unknown) => (
    <Button key={key} plain onPress={press}>
      <Text color="claude">{basic ? plain : String.fromCharCode(code)}</Text>
    </Button>
  )
  const shown = headOf(place.path, state.root, home, W - 8)
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
          <Text>{rootName}</Text>
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
            <Text>{printable(part)}</Text>
          </Button>
        ) : (
          <Text key="last" bold color="claude">
            {printable(part)}
          </Text>
        ),
      )
    })
  }
  const item = (key: string, label: string, act: () => unknown, mark?: string) => (
    <Button
      key={key}
      plain
      onPress={async () => {
        state.menuPinned = false
        await act()
        await update($, file, () => placeOf())
      }}
    >
      <Text>{label.padEnd(LABEL)}</Text>
      <Text color="claude">{mark ?? ' '}</Text>
    </Button>
  )
  const target = () => relOf(place.path)
  const card = (
    <Box
      key="explorer:menu-card"
      position="absolute"
      top={2}
      right={0}
      flexDirection="column"
      borderStyle="round"
      borderColor="promptBorder"
      backgroundColor={CARD}
      paddingX={1}
      display={state.menuPinned ? 'flex' : 'none'}
      hover={state.menuPinned ? undefined : { scope: 'explorer:menu', display: 'flex' }}
    >
      {item('copy-path', 'Copy path', async () => {
        const rel = target()
        if (await copyText($, rel)) notify($, 'copied', rel)
      })}
      {item('copy-abs', 'Copy absolute path', async () => {
        const abs = place.path.replace(/(.)\/$/, '$1')
        if (await copyText($, abs)) notify($, 'copied', abs)
      })}
      {item('mention', 'Mention to Claude', async () => {
        const ref = `${target()}${place.kind === 'folder' ? '/' : ''}`
        await $.prompt.fill({ text: /\s/.test(ref) ? `@"${ref}"` : `@${ref}`, mode: 'append' }).catch(() => undefined)
      })}
      {item('open-editor', 'Open in editor', async () => {
        const has = await $.process.run(['sh', '-c', 'command -v code >/dev/null 2>&1']).catch(() => undefined)
        const launched = await $.process.run(['sh', '-c', 'setsid -f "$0" "$1" </dev/null >/dev/null 2>&1', has?.exitCode === 0 ? 'code' : 'xdg-open', place.path]).catch(() => undefined)
        if (launched?.exitCode === 0) notify($, 'opened', target())
      })}
      <Box marginX={-1}>
        <Text color="promptBorder">{'─'.repeat(LABEL + 1 + 2)}</Text>
      </Box>
      <Button
        key="wrap"
        plain
        onPress={() => {
          const old = state.layout?.layout
          state.wrap = !state.wrap
          if (old && place.kind === 'file') state.top = layoutOf(lines, C, state.wrap).starts[lineAt(old, state.top ?? 0)]
          return update($, file, () => placeOf())
        }}
      >
        <Text>{'Wrap lines'.padEnd(LABEL)}</Text>
        <Text color="claude">{state.wrap ? (basic ? '✓' : String.fromCharCode(0xeab2)) : ' '}</Text>
      </Button>
    </Box>
  )
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
            {state.find?.open && place.kind === 'file' ? (
              <Box key="find" flexShrink={0}>
                {state.find.text && <Text color={HUD.faint}>lines with </Text>}
                <Box width={Math.min(cellsOf(state.find.text || PLACEHOLDER) + 1, W - 8 - (state.find.text ? 11 : 0))} flexShrink={0}>
                  <Input key={FIELD} value={state.find.text} placeholder={PLACEHOLDER} submitLabel="" autoFocus onInput={v => typeFind($, v)} onSubmit={() => {}} />
                </Box>
              </Box>
            ) : state.notice ? (
              <Text>
                <Text color={HUD.faint}>{state.noticeVerb} </Text>
                <Text color="claude">{cutStart(printable(state.notice), W - 8 - (state.noticeVerb?.length ?? 0) - 1)}</Text>
              </Text>
            ) : typeof path === 'string' ? (
              <Text color={HUD.action}>{path}</Text>
            ) : (
              <Box key="parts" flexShrink={0}>{path}</Box>
            )}
          </Box>
          <Box width={3} flexShrink={0} gap={1} justifyContent="flex-end">
            {place.kind === 'file' && glyph('explorer:search', '/', 0xea6d, () => openFind($))}
            <Button key="menu" plain hover={{ scope: 'explorer:menu' }} onPress={() => {
              state.menuPinned = !state.menuPinned
              return update($, file, () => placeOf())
            }}>
              <Text color="claude" inverse={state.menuPinned}>{basic ? '≡' : String.fromCharCode(0xeb94)}</Text>
            </Button>
          </Box>
        </Box>
        <Box marginX={-PAD}>
          <Text color="promptBorder">{'─'.repeat(W + 2 * PAD)}</Text>
        </Box>
        {body}
        {card}
      </Box>
    ),
    zones,
    trace: {},
    rules: [1],
  }
}
