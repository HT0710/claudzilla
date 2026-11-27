import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'

import { FIND_WAIT, filterNames, findIn, leavesField, markCells } from './explorer-find'
import type { FindResult, NameEntry } from './explorer-find'
import { cachedBar, churnText, firstChangeLine, mergeMarks, parseDiff, pressLine, redLit, relocateEdit, reloadDiff, sameMarks } from './explorer-diff'
import type { BarCache, DiffMarks } from './explorer-diff'
import { cellsOf, codeRow, fileWindow, hitsOf, layoutFor, layoutOf, lineAt, rowAt, sliceTokens, thumbOf, toneRows } from './explorer-layout'
import type { Cached, Layout } from './explorer-layout'
import { ageText, editedAt, markViewed, recentSplit, viewedList } from './explorer-recent'
import { MIXED, treeMarks, wordOf } from './explorer-status'
import type { TreeMarks } from './explorer-status'
import { ageOf } from './explorer-ages'
import type { Scan } from './explorer-ages'
import { OPEN_EDITOR_SH, cleanLine, gitDiff, gitStatus, listDir, listNames, loadFile, latestOf, projectRoot, scanAges, statOf } from './explorer-load'
import type { Loaded } from './explorer-load'
import { back, current, forward, navStart, remember, setView, visit } from './explorer-nav'
import type { Nav } from './explorer-nav'
import { tokenize } from './explorer-tokens'
import type { Token } from './explorer-tokens'
import { guideFolders, iconOf, itemsText, langOf, rowScopeOf, scopeOf, treeRows } from './explorer-tree'
import type { Listing } from './explorer-tree'
import { fileKey, printable } from './git-data'
import { mdRows } from './markdown'
import type { MdRow } from './markdown'
import { CARD, DIMMED, FLASH, HUD, LIT, PAD, PILL_BG, STATUS, TYPES, basicGlyphs, clock, emptyNote, mdView, mixHex, readTheme, rowHovers, themeHex, toPieces } from './kit'
import type { TabCtx, TabDraw } from './kit'

// The open place, so a change redraws the pane; the draw applies a place whose rev it has not seen.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as { rev: number; path: string; line?: number; kind?: 'file' | 'folder' } | undefined)

// Bumped per tool call (register.tsx), so a folder page reads git status again after one.
const toolCalls = atom({ plugin: 'margin', key: 'toolCalls' } as const, 0)

// Matches by line, each with its index in the result.
type Spans = Map<number, { start: number; end: number; index: number }[]>

const spansOf = (result: FindResult): Spans => {
  const spans: Spans = new Map()
  result.matches.forEach((m, index) => {
    const list = spans.get(m.line) ?? []
    list.push({ start: m.start, end: m.end, index })
    spans.set(m.line, list)
  })
  return spans
}

type State = {
  nav: Nav
  root?: string
  cwd?: string
  lastFile?: string
  loaded?: Loaded
  // Marks from `git diff HEAD`, set at each load.
  diff?: DiffMarks
  reloadMarks?: DiffMarks
  // The pressed edit, waiting for its file's text.
  editDiff?: { path: string; diff: string }
  // The marks drawn; the layout reads only this, and only showMarks() sets it.
  marks?: DiffMarks
  // Set when the shown marks changed: the next draw keeps the top source line. 'text': the reload changed the text, so lines the reload added do not count.
  remapTop?: boolean | 'text'
  showDiff: boolean
  afterFolder?: boolean
  layout?: Cached
  // The Markdown rows of the loaded file, kept while the file and width stay the same.
  mdCache?: { of: Loaded; width: number; rows: MdRow[] }
  // Change cells of the bar, kept while the layout, marks, Show git diff and cell count stay the same.
  bar?: BarCache
  tokens: Map<number, Token[]>
  expanded: Set<string>
  listed: Map<string, Listing[]>
  // Unset: centre the lit line.
  top?: number
  col: number
  wrap: boolean
  lit?: { from: number; to: number }
  menuPinned: boolean
  infoPinned: boolean
  // `lit`: the lit line find set, so a lit line from elsewhere outlives a find that leaves it.
  find?: { open: boolean; text: string; pending: boolean; result: FindResult; spans: Spans; current: number; lit?: { from: number; to: number } }
  // `lit`: the result Down and Up have lit, an index into `rows`.
  names?: { text: string; entries: NameEntry[]; rows: NameEntry[]; loading?: boolean; capped?: boolean; tree?: number; lit?: number; follow?: boolean }
  // `lit`: the row Down and Up have lit, an index into the filtered list.
  recent?: { text: string; lit?: number; shown?: number }
  toggles: { matchCase: boolean; word: boolean; regex: boolean }
  rev: number
  // The last atom rev the module state has taken.
  applied: number
  notice?: string
  noticeVerb?: string
}

const fresh = (): State => ({ nav: navStart(''), showDiff: true, tokens: new Map(), expanded: new Set(), listed: new Map(), col: 0, wrap: false, menuPinned: false, infoPinned: false, toggles: { matchCase: false, word: false, regex: false }, rev: 0, applied: 0 })
const state = fresh()
const rowHover = rowHovers.Explorer
const guard = latestOf()
// Folder listings count apart from file loads, so folder work never drops a reload.
const folders = latestOf()
const finds = latestOf()
const statuses = latestOf()
// Edit reads count apart from loads, so a press never drops a load.
const edits = latestOf()
// The last git status run, kept while the root and the tool-call count stay the same.
let statusCache: { key: string; changes: Promise<{ path: string; xy: string }[] | undefined>; settled: boolean; redraw?: Promise<unknown> } | undefined
let lastMarks: TreeMarks | undefined
// Age scans by page folder, kept while the tool-call count stays the same.
const scanSeq = new Map<string, number>()
const pageAges = new Map<string, Promise<Scan | undefined>>()
let pageAgesCalls: number | undefined
// Blank cells between the header's centre (path, field, notice) and its buttons.
const GAP = 2
// A row icon's colour name (explorer-tree.ts) to the colour the Git tab draws that name in.
const ICON_COLORS = (): Record<string, string> => ({ claude: 'claude', faint: HUD.faint, refactor: TYPES.refactor!, docs: TYPES.docs!, test: TYPES.test!, feat: TYPES.feat! })

// A closed field leaves the engine's focus ring on the button drawn in its place, with no ui.focus to catch
// (engine 2.1.330, repro in a minimal mod). One pane draw with no buttons drops it, so the pane draws blank once.
export const blankOnce = { next: false }

// Closes find and drops its matches and any pending run; the toggles stay.
function endFind(): void {
  finds.begin()
  const find = state.find
  if (!find) return
  find.text = ''
  find.pending = false
  find.result = { matches: [], bad: false, capped: false }
  find.spans = new Map()
  find.current = 0
  if (find.open) blankOnce.next = true
  find.open = false
  gen++
}

// Closes the name field and drops its text and listing.
function endNames(): void {
  // While text is typed, state.top scrolls the results; the tree's own scroll waits in names.tree.
  if (state.names?.text) state.top = state.names.tree
  if (state.names) blankOnce.next = true
  state.names = undefined
  nameGen++
}

// Closes the Recent field and drops its text.
function endRecent(): void {
  if (state.recent) blankOnce.next = true
  state.recent = undefined
  recentGen++
}

// Remembers the spot, moves through `change`, and restores the spot of an entry it landed on.
function moveTo(change: (nav: Nav) => Nav): boolean {
  const remembered = remember(state.nav, (state.names?.text ? state.names.tree : state.top) ?? 0, state.lit?.from)
  state.nav = change(remembered)
  const entry = current(state.nav)
  if (entry === current(remembered)) return false
  endFlash()
  endFind()
  endNames()
  endRecent()
  if (entry.kind === 'file' && entry.path !== state.loaded?.path) {
    state.diff = state.reloadMarks = state.editDiff = undefined
    showMarks()
  }
  state.remapTop = false
  state.top = entry.top
  state.lit = entry.kind === 'file' && entry.line !== undefined ? { from: entry.line, to: entry.line } : undefined
  state.col = 0
  return true
}

async function gitMarks($: EngineInterface, root: string, abs: string): Promise<DiffMarks | undefined> {
  const diff = await gitDiff($, root, abs)
  return diff === undefined ? undefined : parseDiff(diff)
}

function showMarks(): void {
  state.marks = mergeMarks(state.showDiff ? state.diff : undefined, state.reloadMarks)
}

// Moves the top to the row of its source line after a layout change.
function keepTop(old: Layout, lines: readonly string[], C: number): void {
  state.top = codeRow(layoutOf(lines, C, state.wrap, state.marks?.removed), lineAt(old, state.top ?? 0))
}

// Like showMarks, and the next draw keeps the top source line when the shown marks changed.
function showMarksRemap(): void {
  const before = state.marks
  showMarks()
  if (!sameMarks(before, state.marks)) state.remapTop = true
}

function clearReload(): void {
  if (!state.reloadMarks) return
  state.reloadMarks = undefined
  showMarksRemap()
}

const FLASH_MS = 1500
const FLASH_STEPS = 12
// The rows flashing now: each step mixes the flash colour toward the row's diff colour. gen drops the timers of a flash that ended or restarted.
let flashing: { path: string; lines: ReadonlySet<number>; step: number } | undefined
let flashGen = 0

// Flashes the given new-side lines (1-based) of a file; an empty list ends the flash. Called from a draw, so the first frame is that draw's own (a draw may not write state).
export async function flashRows($: EngineInterface, path: string, lines: readonly number[]): Promise<void> {
  const gen = ++flashGen
  await readTheme($)
  if (gen !== flashGen) return
  if (!lines.length) return endFlash()
  flashing = { path, lines: new Set(lines), step: 0 }
  const tick = async () => {
    if (gen !== flashGen || !flashing) return
    if (++flashing.step < FLASH_STEPS) $.clock.after(FLASH_MS / FLASH_STEPS, tick)
    else flashing = undefined
    await update($, file, () => placeOf())
  }
  $.clock.after(FLASH_MS / FLASH_STEPS, tick)
}

export function endFlash(): void {
  flashing = undefined
  flashGen++
}

// The open place at a new revision the draw has already taken.
function placeOf() {
  const here = current(state.nav)
  return { rev: (state.applied = ++state.rev), path: here.path, line: state.lit?.from, kind: here.kind }
}

// Reads the file fresh and flashes the pressed edit's added rows; a file changed since its load waits for the poll's reload. Returns the line to centre on.
async function applyEdit($: EngineInterface): Promise<number | undefined> {
  const mine = state.editDiff!
  if (state.loaded!.unreadable) return void (state.editDiff = undefined)
  const n = edits.begin()
  const text = await $.fs.read(mine.path).then(String, () => undefined)
  if (!edits.isLatest(n) || state.editDiff !== mine || current(state.nav).path !== mine.path || state.loaded?.path !== mine.path) return
  if (text === undefined) {
    state.editDiff = undefined
    endFlash()
    return
  }
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
  const seen = state.loaded.lines
  if (lines.length !== seen.length || lines.some((t, i) => cleanLine(t) !== seen[i])) return
  state.editDiff = undefined
  state.top = state.lit = undefined
  const found = relocateEdit(mine.diff, lines)
  if (!found) {
    $.ui.toast('The file changed since this edit, so its rows are not flashed')
    endFlash()
    return firstChangeLine(mine.diff) ?? 1
  }
  const added = [...found.marks.added]
  await flashRows($, mine.path, added)
  return added.length ? Math.min(...added) : found.first
}

export function showPlace(place: { path: string; line?: number; kind?: 'file' | 'folder'; diff?: string }): number {
  const { diff, ...at } = place
  // A line or an edit points into the source, and the file may not be loaded yet, so the path decides.
  const source = (at.line !== undefined || diff !== undefined) && /\.md$/i.test(at.path)
  moveTo(nav => visit(nav, { ...at, kind: at.kind ?? 'file', ...(source && { md: false }) }))
  if (diff !== undefined) {
    state.editDiff = { path: place.path, diff }
    endFlash()
  }
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
  statusCache = undefined
  pageAges.clear()
  await update($, file, () => placeOf())
}

// The age scan for a page: one run per page, a subfolder page reuses a whole ancestor scan, and a capped one is never reused.
async function scanFor($: EngineInterface, page: string): Promise<Scan | undefined> {
  const calls = await read($, toolCalls)
  if (calls !== pageAgesCalls) (pageAges.clear(), (pageAgesCalls = calls))
  const own = pageAges.get(page)
  if (own) return own
  for (const [folder, run] of [...pageAges]) {
    if (!page.startsWith(`${folder}/`)) continue
    const scan = await run
    if (scan && !scan.capped) return scan
  }
  const n = (scanSeq.get(page) ?? 0) + 1
  scanSeq.set(page, n)
  // Only a newer scan of this same page makes a result stale.
  const run = scanAges($, page).then(r => {
    if (scanSeq.get(page) === n) return r
    return undefined
  })
  pageAges.set(page, run)
  return run
}

// Marks for the tree below `root`, with every listed folder known so a submodule takes a dot; none outside a repo.
// With `at`, an unsettled status returns the last settled marks and redraws once it lands, if that file is still shown.
// The redraw rides a timer because a state write is denied while a render is dispatching.
async function statusFor($: EngineInterface, root: string, at?: string): Promise<TreeMarks | undefined> {
  const key = `${root}:${await read($, toolCalls)}:${state.loaded?.mtimeMs}`
  if (statusCache?.key !== key) {
    const n = statuses.begin()
    const run = gitStatus($, root).then(r => (statuses.isLatest(n) ? r : undefined))
    const cache = { key, changes: run, settled: false } as NonNullable<typeof statusCache>
    statusCache = cache
    void run.then(() => (cache.settled = true))
  }
  if (at && !statusCache.settled) {
    statusCache.redraw ??= statusCache.changes.then(() => void $.clock.after(0, () => (current(state.nav).path === at ? void update($, file, () => placeOf()) : undefined)))
    return lastMarks
  }
  const changes = await statusCache.changes
  const dirs = new Set<string>()
  for (const [folder, entries] of state.listed) for (const e of entries) if (e.kind === 'dir') dirs.add(`${folder}/${e.name}`)
  return (lastMarks = changes && treeMarks(root, changes, dirs))
}

export async function reloadPlace($: EngineInterface, edit?: { oldText: string; newText: string; replaceAll: boolean }): Promise<void> {
  const place = current(state.nav)
  if (place.kind === 'folder') return relistPage($)
  const n = guard.begin()
  const root = state.root ?? (state.root = await projectRoot($))
  const prev = state.loaded?.path === place.path && !state.loaded.unreadable ? state.loaded.lines : undefined
  const [loaded, diff] = await Promise.all([loadFile($, place.path), gitMarks($, root, place.path)])
  if (guard.isLatest(n)) {
    state.loaded = loaded
    state.diff = diff
    const same = prev && prev.length === loaded.lines.length && prev.every((t, i) => t === loaded.lines[i])
    if (!same) state.reloadMarks = loaded.unreadable ? undefined : reloadDiff(prev, loaded.lines, edit)
    if (!same) endFlash()
    showMarksRemap()
    if (!same && state.reloadMarks && state.remapTop) state.remapTop = 'text'
    state.tokens = new Map()
    rerunFind()
    // Before the redraw below: flashRows draws nothing itself.
    if (!same && state.reloadMarks) await flashRows($, place.path, [...state.reloadMarks.added])
  }
  await update($, file, () => placeOf())
}

// Runs find again on a reloaded file at once, keeping the view; the current match is the first at or after the old line.
function rerunFind(): void {
  const find = state.find
  if (!find?.open || !find.text || !state.loaded) return
  const was = find.result.matches[find.current]
  finds.begin()
  find.pending = false
  find.result = findIn(state.loaded.lines, { text: find.text, ...state.toggles })
  find.spans = spansOf(find.result)
  const same = was ? find.result.matches.findIndex(m => m.line === was.line && m.start === was.start) : -1
  const at = same >= 0 || !was ? same : find.result.matches.findIndex(m => m.line >= was.line)
  find.current = Math.max(at, 0)
  litFind(find, find.result.matches[find.current])
}

// Lights `m` for find, or with none clears the lit line only when find set it.
function litFind(find: NonNullable<State['find']>, m: { line: number } | undefined): void {
  if (m) state.lit = find.lit = { from: m.line, to: m.line }
  else {
    if (state.lit === find.lit) state.lit = undefined
    find.lit = undefined
  }
}

// Reloads the open file when its stamp changed or it is gone.
export async function checkOpenFile($: EngineInterface): Promise<boolean> {
  const place = current(state.nav)
  if (place.kind !== 'file' || state.loaded?.path !== place.path) return false
  const st = await statOf($, place.path)
  if (!(st ? st.mtimeMs !== state.loaded.mtimeMs || st.size !== state.loaded.size : !state.loaded.missing)) return false
  await reloadPlace($)
  return true
}

export async function changedOnDisk($: EngineInterface, call: { tool: string } & Record<string, unknown>): Promise<void> {
  if (!state.root) return
  const here = current(state.nav)
  const target = call.tool === 'NotebookEdit' ? call.notebook_path : call.file_path
  // Listings kept for other pages go stale too; the next folder draw relists only what is on screen.
  if (call.tool === 'Write' || call.tool === 'NotebookEdit' || call.tool === 'Bash') state.listed.clear()
  if (here.kind === 'file' && (call.tool === 'Edit' || call.tool === 'Write' || call.tool === 'NotebookEdit') && target === here.path) {
    const edit = call.tool === 'Edit' && typeof call.old_string === 'string' && typeof call.new_string === 'string' ? { oldText: call.old_string, newText: call.new_string, replaceAll: call.replace_all === true } : undefined
    return reloadPlace($, edit)
  }
  if (here.kind === 'folder' && (call.tool === 'Write' || call.tool === 'Bash')) await relistPage($)
  if (call.tool === 'Bash' && !(await checkOpenFile($)) && here.kind === 'file' && current(state.nav).path === here.path && state.loaded?.path === here.path) {
    // A commit or checkout moves no mtime but changes the git marks.
    const n = guard.begin()
    const diff = await gitMarks($, state.root, here.path)
    if (!guard.isLatest(n) || current(state.nav).path !== here.path || sameMarks(diff, state.diff)) return
    state.diff = diff
    showMarksRemap()
    await update($, file, () => placeOf())
  }
}

const FIELD = 'explorer:find'
// Bumped on each submit: the engine drops a redrawn value equal to the last one it had, so a new key remounts the field.
let gen = 0
let nameGen = 0
let recentGen = 0
// A focused Input needs the text cells plus cursor, gap, enter mark, space and its submit word (measured live). Under the
// cap it sizes itself, so a key the engine draws before the redraw stays centred; past it a fixed width keeps it inside the header.
const capWidth = (text: string, submit: string, cap: number) => (cellsOf(text) + 5 + submit.length > cap ? cap : undefined)
// Blank cells before the field. Label, text and Enter hint sit centred in the path's room (`mid`); once they outgrow it they
// are held at the left gap and grow into the hidden buttons' cells (`room`); once the label has dropped they pin right.
export const fieldPad = (label: string, text: string, submit: string, mid: number, room: number): number => {
  const width = cellsOf(label) + cellsOf(text) + 5 + submit.length
  return Math.max(0, label ? Math.min(Math.floor((mid - width) / 2), room - width) : room - width)
}
const PLACEHOLDER = 'type text to find'
const NAME = 'explorer:name'
const NAME_PLACEHOLDER = 'type a name'
const RECENT = 'explorer:recent'
const RECENT_UP = `${RECENT}:up`
const RECENT_DOWN = `${RECENT}:down`
const RECENT_PLACEHOLDER = 'type a file name'
const RECENT_LABEL = 'file named '
const recentKey = (): string => (recentGen ? `${RECENT}:${recentGen}` : RECENT)

// The pane's base open arguments; register adds Escape handling.
export const paneBase = { id: 'margin', title: 'Margin', columns: 40 } as const

// Whether the open pane was last sent closeOnEscape; register owns the rule, a field open here sends it.
export const escapeSent = { value: false }

// The ring moves only while the pane holds the keys; the open asks for them first.
async function takeKeys($: EngineInterface, key: string): Promise<void> {
  escapeSent.value = fieldTakesEscape()
  await $.ui.open({ ...paneBase, ...(escapeSent.value && { closeOnEscape: true as const }), focus: true }).catch(() => undefined)
  await $.ui.focus({ requestId: 'margin', key }).catch(() => undefined)
}

// Whether a find, name or Recent field is open.
export const fieldOpen = (): boolean => !!(state.find?.open || state.names || state.recent)

// The text of the open field; empty when none is open.
export const fieldText = (): string => (state.find?.open ? state.find.text : (state.names ?? state.recent)?.text) ?? ''

// Whether Escape closes the open field: the name and Recent fields always, the find field only while empty.
export const fieldTakesEscape = (): boolean => (state.find?.open ? !state.find.text : !!(state.names || state.recent))

// Whether the menu or info card is pinned.
export const menuPinned = (): boolean => state.menuPinned || state.infoPinned

// Unpins the menu and info cards; false when neither was pinned.
export async function unpinMenu($: EngineInterface): Promise<boolean> {
  if (!state.menuPinned && !state.infoPinned) return false
  state.menuPinned = state.infoPinned = false
  await update($, file, () => placeOf())
  return true
}

// The drawn key of the name field.
const NAME_UP = `${NAME}:up`
const NAME_DOWN = `${NAME}:down`
const nameKey = (): string => (nameGen ? `${NAME}:${nameGen}` : NAME)
const findKey = (): string => (gen ? `${FIELD}:${gen}` : FIELD)

// Closes the find or name field when it has no text; with `e`, only when focus left it.
export async function closeEmptyField($: EngineInterface, e?: { element?: string }): Promise<boolean> {
  // A Recent row's own press opens the file, which closes the field; closing first would drop the row.
  if (e?.element?.startsWith('row:x:recent:')) return false
  if (state.find?.open && !state.find.text && (!e || leavesField(e, findKey()))) {
    state.find = undefined
    blankOnce.next = true
    gen++
  } else if (state.names && !state.names.text && (!e || leavesField(e, nameKey()))) endNames()
  else if (state.recent && !state.recent.text && (!e || leavesField(e, recentKey()))) endRecent()
  else return false
  await update($, file, () => placeOf())
  return true
}

// Escape: closes the name or Recent field with its text, or an empty find field.
export async function closeOnEscape($: EngineInterface): Promise<boolean> {
  if (!state.find?.open && (state.names || state.recent)) {
    endNames()
    endRecent()
    await update($, file, () => placeOf())
    return true
  }
  return closeEmptyField($)
}

async function openNames($: EngineInterface): Promise<void> {
  state.menuPinned = state.infoPinned = false
  // One field at a time: Recent and the name search share the header.
  endRecent()
  const folder = current(state.nav).path
  let capped = false
  const listing = listNames($, folder, () => (capped = true))
  // Drawn and focused before the listing returns, so keys typed meanwhile reach the field, not the prompt.
  const names = (state.names ??= { text: '', entries: [], rows: [] })
  names.loading = true
  await update($, file, () => placeOf())
  await takeKeys($, nameKey())
  const entries = await listing
  if (state.names !== names || current(state.nav).path !== folder) return
  names.entries = entries
  names.capped = capped
  names.rows = filterNames(entries, names.text)
  names.loading = false
  await update($, file, () => placeOf())
}

function typeName($: EngineInterface, text: string): void {
  if (!state.names) return
  if (text && !state.names.text) state.names.tree = state.top
  else if (!text && state.names.text) state.top = state.names.tree
  state.names.text = text
  state.names.rows = filterNames(state.names.entries, text)
  state.names.lit = undefined
  if (text) state.top = 0
  $.ui.invalidate('ui.render')
}

// Down and Up while the name field has results: a ring move toward a stand-in beside the field steps the lit
// result instead, so the field keeps the keys. False for any other element.
export async function stepName($: EngineInterface, element: string | undefined): Promise<boolean> {
  const by = element === NAME_DOWN ? 1 : element === NAME_UP ? -1 : 0
  if (!by || !state.names) return false
  // No text: the tree shows, not the results, so nothing lights.
  const lit = state.names.text ? Math.min((state.names.lit ?? -1) + by, state.names.rows.length - 1) : -1
  state.names.lit = lit < 0 ? undefined : lit
  state.names.follow = true
  await update($, file, () => placeOf())
  return true
}

// Opens the lit result, or the top one, which ends the name search through the move.
async function submitName($: EngineInterface): Promise<void> {
  // Still listing: Enter would find nothing, so it waits for a press once rows are in.
  if (state.names?.loading) return
  nameGen++
  const top = state.names?.rows[state.names.lit ?? 0]
  if (top) await openPlace($, { path: `${current(state.nav).path.replace(/\/$/, '')}/${top.path}`, kind: top.kind === 'dir' ? 'folder' : undefined })
  // No match: only a redraw puts the new key, and so the text, on screen.
  else $.ui.invalidate('ui.render')
}

async function openRecent($: EngineInterface): Promise<void> {
  state.menuPinned = state.infoPinned = false
  endNames()
  state.recent ??= { text: '' }
  await update($, file, () => placeOf())
  await takeKeys($, recentKey())
}

function typeRecent($: EngineInterface, text: string): void {
  if (!state.recent) return
  state.recent.text = text
  state.recent.lit = undefined
  $.ui.invalidate('ui.render')
}

// The remembered files the field lists, in row order.
async function recentRows($: EngineInterface, text: string): Promise<string[]> {
  const { today, earlier } = recentSplit(viewedList(), await $.clock.now(), text)
  return [...today, ...earlier].map(r => r.path)
}

// Down and Up from the Recent field: the first Down lights the top row. False for any other element.
export async function stepRecent($: EngineInterface, element: string | undefined): Promise<boolean> {
  const by = element === RECENT_DOWN ? 1 : element === RECENT_UP ? -1 : 0
  if (!by || !state.recent) return false
  const lit = Math.min((state.recent.lit ?? -1) + by, Math.min((await recentRows($, state.recent.text)).length, state.recent.shown ?? Infinity) - 1)
  if (state.recent) state.recent.lit = lit < 0 ? undefined : lit
  await update($, file, () => placeOf())
  return true
}

// Opens the lit row, or the top one; the open file is the top row, so it only closes the field.
async function submitRecent($: EngineInterface): Promise<void> {
  recentGen++
  const at = state.recent?.lit ?? 0
  const path = at < (state.recent?.shown ?? Infinity) ? (await recentRows($, state.recent?.text ?? ''))[at] : undefined
  if (!path) return $.ui.invalidate('ui.render')
  if (path !== current(state.nav).path) return openPlace($, { path })
  endRecent()
  await update($, file, () => placeOf())
}

async function openFind($: EngineInterface): Promise<void> {
  state.find ??= { open: true, text: '', pending: false, result: { matches: [], bad: false, capped: false }, spans: new Map(), current: 0 }
  state.find.open = true
  state.menuPinned = state.infoPinned = false
  // Matches run on source lines, so find needs the source view.
  // The path decides, as in showPlace: the file may not be loaded yet.
  const here = current(state.nav)
  if (/\.md$/i.test(here.path) && here.kind === 'file' && here.md !== false) {
    state.nav = setView(state.nav, false)
    state.top = 0
  }
  await update($, file, () => placeOf())
  await takeKeys($, findKey())
}

// Runs the find on the loaded lines and lights the first match.
async function runFind($: EngineInterface): Promise<void> {
  const find = state.find
  if (!find) return
  find.pending = false
  if (state.loaded?.path !== current(state.nav).path) return
  find.result = findIn(state.loaded.lines, { text: find.text, ...state.toggles })
  find.spans = spansOf(find.result)
  find.current = 0
  const first = find.result.matches[0]
  litFind(find, first)
  if (first) state.top = undefined
  await update($, file, () => placeOf())
}

function typeFind($: EngineInterface, text: string): void {
  const find = state.find
  if (!find) return
  find.text = text
  const n = finds.begin()
  if (!text) {
    find.pending = false
    find.result = { matches: [], bad: false, capped: false }
    find.spans = new Map()
    find.current = 0
    litFind(find, undefined)
  } else {
    find.pending = true
    $.clock.after(FIND_WAIT, async () => {
      if (!finds.isLatest(n) || !state.find?.open) return
      await runFind($)
    })
  }
  $.ui.invalidate('ui.render')
}

// Steps to the next or previous match, wrapping; a pending run flushes first and stays on match 1.
async function stepFind($: EngineInterface, by: 1 | -1): Promise<void> {
  const find = state.find
  if (!find?.open) return
  if (find.pending) {
    finds.begin()
    return runFind($)
  }
  const total = find.result.matches.length
  // No match: only a redraw puts a field re-keyed by Enter, and so its text, on screen.
  if (!total) return $.ui.invalidate('ui.render')
  find.current = (find.current + by + total) % total
  litFind(find, find.result.matches[find.current])
  state.top = undefined
  await update($, file, () => placeOf())
}

async function toggleFind($: EngineInterface, flag: keyof State['toggles']): Promise<void> {
  state.toggles[flag] = !state.toggles[flag]
  finds.begin()
  if (state.find?.text) return runFind($)
  await update($, file, () => placeOf())
}

async function closeFind($: EngineInterface): Promise<void> {
  const find = state.find
  if (!find) return
  litFind(find, undefined)
  endFind()
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

// Width of a menu label column; the mark column adds 1.
const LABEL = 18
// The menu's rows above its divider.
const MENU_ITEMS = 4

// The path as the header shows it: from the project root's name, else from ~, else whole; cut from the start to fit.
function headOf(path: string, root: string, home: string | undefined, room: number): string {
  const name = root.slice(root.lastIndexOf('/') + 1)
  const shown = root && path.startsWith(`${root}/`) ? `${name}/${path.slice(root.length + 1)}` : root.length > 1 && path === root ? name : home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path
  return cutStart(printable(shown), room)
}

// A readable `.md` file, which the tab can draw as Markdown.
function mdFile(path: string, loaded: Loaded | undefined): boolean {
  return !!loaded && !loaded.unreadable && loaded.path === path && /\.md$/i.test(path)
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

// Text kept from its start to fit room cells.
function fitStart(text: string, room: number): string {
  let head = ''
  for (const ch of text) {
    if (cellsOf(head + ch) > room) break
    head += ch
  }
  return head
}

// The text a field is drawn with, fixed per key: a redraw lands after later keys, and a changed value would replace them.
const seeds = new Map<string, string>()
// A field remounts under its old key after another tab drew or the pane closed, so the seed is dropped then.
export const resetSeeds = (): void => seeds.clear()
function seedOf(key: string, text: string): string {
  if (!seeds.has(key)) {
    seeds.clear()
    seeds.set(key, text)
  }
  return seeds.get(key) ?? text
}

// A capped Input puts the terminal cursor past its cut text, off the header (engine 2.1.330, measured live), so typing
// stops before the cap: room is the header minus label, cursor, gap, enter mark, space and submit word. A new key
// remounts the field, because the engine drops a redrawn value equal to the last one it had.
function fitField($: EngineInterface, text: string, room: number, prev: string, remount: () => void): string {
  // A pane narrowed under the typed text keeps that text and refuses only growth.
  let head = fitStart(text, Math.max(room, cellsOf(prev)))
  // A key typed mid-text would push the end off, so it is refused instead. A paste over the whole text still cuts.
  if (head !== text && prev && !text.startsWith(prev)) {
    let a = 0
    while (a < prev.length && text[a] === prev[a]) a++
    if (text.endsWith(prev.slice(a))) head = prev
  }
  if (head !== text) {
    remount()
    $.ui.invalidate('ui.render')
  }
  return head
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
    if (e.element === 'explorer:vbar') {
      endFlash()
      state.top = d.top
    } else state.col = d.top
    await update($, file, () => placeOf())
    return
  }
  if (e.element === 'explorer:gutter' && typeof d?.first === 'number' && typeof d.last === 'number') {
    clearReload()
    endFlash()
    await copyLines($, d.first, d.last, e.surface)
  }
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
    if (!st || st.mtimeMs !== state.loaded.mtimeMs || st.size !== state.loaded.size) {
      state.loaded = undefined
    }
  }
  if (wanted.kind === 'file') state.afterFolder = false
  if (wanted.kind === 'file' && wanted.path !== state.loaded?.path) {
    const n = guard.begin()
    const [loaded, diff] = await Promise.all([loadFile($, wanted.path), gitMarks($, state.root, wanted.path)])
    const here = current(state.nav)
    if (guard.isLatest(n) && here.kind === 'file' && here.path === wanted.path) {
      state.loaded = loaded
      state.diff = diff
      state.reloadMarks = undefined
      showMarks()
      state.tokens = new Map()
    }
  }
  let focus: number | undefined
  if (state.editDiff && state.loaded?.path === state.editDiff.path) focus = await applyEdit($)
  const place = current(state.nav)
  if (place.kind === 'file') markViewed(place.path, await $.clock.now())
  if (place.kind === 'folder') state.afterFolder = true
  const rows = Math.max(0, props.scroll.bodyRows)
  const findOpen = !!state.find?.open && place.kind === 'file'
  let codeRows = Math.max(0, rows - 2 - (findOpen ? 2 : 0))
  const W = props.bodyColumns - 2 * PAD
  const home = await $.env.get('HOME').catch(() => undefined)
  const basic = await basicGlyphs($)
  let fileMark: string | undefined
  let inRepo = false
  if (place.kind === 'file' && state.root && place.path.startsWith(`${state.root}/`)) {
    const status = await statusFor($, state.root, place.path)
    inRepo = !!status
    fileMark = status?.files.get(place.path)
    if (current(state.nav).path !== place.path) return draw($, ctx)
  }
  // After the awaits above: a reload during it must not leave old lines drawn with new marks.
  const loaded = place.kind === 'file' && state.loaded?.path === place.path ? state.loaded : undefined
  const isMd = mdFile(place.path, loaded)
  const viewMd = isMd && place.kind === 'file' && place.md !== false
  // The header's right buttons: search, info and menu on a file page, plus the Markdown switch on a readable .md file, search and menu on a folder page.
  const hdrRight = place.kind === 'file' ? (isMd ? 7 : 5) : 3
  // The header centre's room: the width less the buttons (5 left, hdrRight right) and a 2-cell gap on each side.
  const MID = W - 5 - hdrRight - 2 * GAP
  const lines = loaded?.lines ?? []
  const digits = String(lines.length).length
  const G = digits + 3
  const C = W - G - 1
  let body: JSX.Element[] = []
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
  const zones: TabDraw['zones'] = []
  const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
  // `lead`: one guide scope per indent column, null for a blank; `group`: the guide line the pointer on this row lights.
  // Guide cells are absolute, so a pointer on one reaches the Client below and a press in the indent hits the row.
  const put = (path: string, left: JSX.Element[], right: JSX.Element[], press: () => unknown, lit = false, lead: (string | null)[] = [], group?: string, prefix = '') => {
    const key = `x:${prefix}${fileKey(path)}`
    rowHover.acts[key] = press
    body.push(
      // Keyed: the guide group is its own scope, and the row's highlight has another on the inner Box, so a lit guide never lights a row.
      <Box key={key} flexDirection="column" height={1} hover={group ? { scope: group } : undefined} backgroundColor={lit ? LIT : undefined}>
        <Box flexDirection="column" height={1} hover={{ scope: rowScopeOf(path), backgroundColor: LIT }}>
          {Client ? (
            <Box flexDirection="column" height={1}>
              <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: toPieces([<Text>{' '.repeat(lead.length)}</Text>, ...left]), right: toPieces(right) }} />
              {lead.map((scope, c) =>
                scope ? (
                  <Box position="absolute" left={c} top={0} width={1} hover={{ scope }}>
                    <Box display="none" hover={{ scope, display: 'flex' }}>
                      {/* A lit │ takes the press the Client below would get, so it runs the row's press itself. */}
                      <Button plain key={`lead:${key}:${c}`} onPress={press}>
                        <Text color={DIMMED}>│</Text>
                      </Button>
                    </Box>
                  </Box>
                ) : null,
              )}
            </Box>
          ) : (
            <Box justifyContent="space-between" gap={2}>
              <Button plain key={path} onPress={press}>
                {[<Text>{' '.repeat(lead.length)}</Text>, ...left]}
              </Button>
              {right.length ? <Box flexShrink={0}>{right}</Box> : null}
            </Box>
          )}
        </Box>
      </Box>,
    )
  }
  if (place.kind === 'folder' && !state.recent) {
    const n = folders.begin()
    // A newer draw or a move since the awaits: this page is old, so draw the current one instead.
    const stale = () => !folders.isLatest(n) || current(state.nav).path !== place.path
    if (!state.listed.has(place.path)) state.listed.set(place.path, await listDir($, place.path))
    if (stale()) return draw($, ctx)
    let all = treeRows(place.path, state.expanded, state.listed)
    const hits = state.names?.text ? state.names.rows : undefined
    while (!hits) {
      const top = Math.max(0, Math.min(state.top ?? 0, all.length - codeRows))
      const todo = all.slice(top, top + codeRows).filter(r => r.kind === 'dir' && !state.listed.has(r.path))
      if (!todo.length) break
      await Promise.all(todo.map(async r => void state.listed.set(r.path, await listDir($, r.path))))
      if (stale()) return draw($, ctx)
      all = treeRows(place.path, state.expanded, state.listed)
    }
    const inRoot = !!state.root && (place.path === state.root || place.path.startsWith(`${state.root}/`))
    const marks = inRoot ? await statusFor($, state.root!) : undefined
    if (stale()) return draw($, ctx)
    const scan = hits ? undefined : await scanFor($, place.path)
    const now = await $.clock.now()
    if (stale()) return draw($, ctx)
    // A file's letter, or a closed folder's dot.
    const markOf = (path: string, kind: 'file' | 'dir', open = false): JSX.Element[] => {
      const letter = kind === 'file' ? marks?.files.get(path) : open ? undefined : marks?.folders.get(path)
      if (!letter) return []
      return [kind === 'file' ? <Text color={STATUS[letter] ?? HUD.faint}>{letter}</Text> : <Text color={letter === MIXED ? 'text' : STATUS[letter] ?? HUD.faint}>●</Text>]
    }
    const total = hits ? hits.length : all.length
    const lit = hits ? state.names?.lit : undefined
    // Only a step pulls the lit row into view, so the wheel and the bar still move the list.
    if (lit !== undefined && state.names?.follow) state.top = Math.max(Math.min(state.top ?? 0, lit), lit - codeRows + 1)
    if (state.names) state.names.follow = false
    state.top = Math.max(0, Math.min(state.top ?? 0, total - codeRows))
    const top = state.top
    if (!total) body = [<Text key="empty" color={HUD.faint}>{hits ? (state.names?.loading ? 'listing…' : 'no match') : 'empty'}</Text>]
    rowHover.acts = {}
    for (const [i, hit] of (hits?.slice(top, top + codeRows) ?? []).entries()) {
      const name = hit.path.slice(hit.path.lastIndexOf('/') + 1)
      const parent = hit.path.slice(0, Math.max(0, hit.path.length - name.length - 1))
      const icon = iconOf(name, hit.kind, { open: false, empty: false })
      const abs = `${place.path.replace(/\/$/, '')}/${hit.path}`
      put(
        hit.path,
        [
          <Text> </Text>,
          <Text> </Text>,
          ...(basic ? [] : [<Text color={ICON_COLORS()[icon.color] ?? HUD.faint}>{icon.glyph}</Text>, <Text> </Text>]),
          <Text>{printable(name)}</Text>,
          ...(parent ? [<Text color={HUD.faint}>{` ${printable(parent)}`}</Text>] : []),
        ],
        markOf(abs, hit.kind),
        () => openPlace($, { path: abs, kind: hit.kind === 'dir' ? 'folder' : undefined }),
        top + i === lit,
      )
    }
    const countW = Math.max(0, ...all.map(r => (r.kind === 'dir' && state.listed.has(r.path) ? itemsText(state.listed.get(r.path)!.length).length : 0)))
    for (const r of hits ? [] : all.slice(top, top + codeRows)) {
      const icon = iconOf(r.name, r.kind, r)
      const faint = r.dim || r.broken
      const tone = (name: string) => (faint ? HUD.faint : ICON_COLORS()[name] ?? HUD.faint)
      const folders = guideFolders(r.path, place.path)
      // One cell per indent column: an open folder sits every 2nd column, with its line there; else a blank.
      const lead = Array.from({ length: r.x }, (_, c) => (c % 2 === 0 && c / 2 < folders.length ? scopeOf(folders[c / 2]!) : null))
      const group = r.kind === 'dir' && r.open ? scopeOf(r.path) : folders.length ? scopeOf(folders[folders.length - 1]!) : undefined
      const left = [
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
      const n = r.kind === 'dir' ? state.listed.get(r.path)?.length : undefined
      const mark = markOf(r.path, r.kind, r.open)
      const at = ageOf(scan, r.path)
      // Count, 2 spaces, age (3 cells, blank without scan data), 2 spaces, then the mark cell: one blank cell when the row has no mark.
      const right = [<Text color={HUD.faint}>{(n === undefined ? '' : itemsText(n)).padEnd(countW)}</Text>, <Text>{'  '}</Text>, <Text color={HUD.faint}>{at === undefined ? '   ' : ageText(at, now)}</Text>, <Text>{'  '}</Text>, ...(mark.length ? mark : [<Text> </Text>])]
      put(r.path, left, right, press, false, lead, group)
    }
    zones.push({
      tab: 'Explorer',
      kind: 'list',
      from: 2,
      to: 2 + codeRows,
      offset: 0,
      fallback: true,
      wheel: by => {
        state.top = Math.max(0, Math.min((state.top ?? 0) + by, total - codeRows))
        return update($, file, () => placeOf())
      },
    })
  } else if (state.recent) {
    // Drops a folder draw still awaiting its listing, so it cannot paint over this one.
    folders.begin()
    const now = await $.clock.now()
    const { today, earlier } = recentSplit(viewedList(), now, state.recent.text)
    const inRoot = !!state.root && place.path.startsWith(`${state.root}/`)
    const marks = inRoot ? await statusFor($, state.root!) : undefined
    const open = current(state.nav).path
    rowHover.acts = {}
    const putRecent = (path: string, at: number, lit: boolean) => {
      const press = () => {
        if (path !== open) return openPlace($, { path })
        endRecent()
        return update($, file, () => placeOf())
      }
      const name = path.slice(path.lastIndexOf('/') + 1)
      const dir = relOf(path.slice(0, Math.max(0, path.length - name.length - 1)))
      const folder = dir === '.' ? '' : dir
      const icon = iconOf(name, 'file', { open: false, empty: false })
      const here = path === open
      const letter = marks?.files.get(path)
      const left = [
        <Text> </Text>,
        <Text> </Text>,
        ...(basic ? [] : [<Text color={ICON_COLORS()[icon.color] ?? HUD.faint}>{icon.glyph}</Text>, <Text> </Text>]),
        <Text bold={here || undefined} color={here ? 'claude' : undefined}>{printable(name)}</Text>,
        ...(folder ? [<Text color={HUD.faint}>{` ${printable(folder)}`}</Text>] : []),
      ]
      const right = [<Text color={letter ? STATUS[letter] ?? HUD.faint : undefined}>{letter ?? ' '}</Text>, <Text>{'  '}</Text>, <Text>{ageText(here ? now : at, now)}</Text>]
      put(path, left, right, press, lit, [], undefined, 'recent:')
    }
    let n = 0
    let room = codeRows
    for (const [label, group] of [['today', today], ['earlier', earlier]] as const) {
      if (!group.length || room < 2) continue
      body.push(<Text key={`recent:${label}`} color={HUD.faint}>{label}</Text>)
      room--
      for (const r of group.slice(0, room)) putRecent(r.path, r.at, n++ === state.recent.lit)
      room -= Math.min(group.length, room)
    }
    // Down and Enter reach only the rows drawn.
    state.recent.shown = n
    if (!n) body = [<Text key="empty" color={HUD.faint}>no match</Text>]
  } else if (loaded?.unreadable) {
    body = [emptyNote(ctx.el, codeRows, "Can't show this file", <Text color={HUD.faint}>{loaded.missing ? 'It no longer exists.' : 'It is binary, unreadable or over 4 MiB.'}</Text>)]
  } else if (loaded && viewMd) {
    if (state.mdCache?.of !== loaded || state.mdCache.width !== C) state.mdCache = { of: loaded, width: C, rows: mdRows(lines.join('\n'), C - 1) }
    const mdr = state.mdCache.rows
    state.remapTop = false
    const win = fileWindow(mdr.length, state.top ?? 0, codeRows)
    state.top = win.top
    body.push(
      <Box key="view">
        <Box flexDirection="column" width={C + G} flexShrink={0} height={codeRows}>{mdView(ctx.el, mdr.slice(win.top, win.last))}</Box>
        {Client && <Client key="explorer:vbar" module="./explorer-bar.tsx" width={1} height={codeRows} props={bar('v', codeRows, mdr.length, win.top)} />}
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
        state.top = fileWindow(mdr.length, (state.top ?? 0) + by, codeRows).top
        return update($, file, () => placeOf())
      },
    })
  } else if (loaded) {
    const was = state.layout?.layout
    state.layout = layoutFor(state.layout, loaded, C, state.wrap, lines, state.marks?.removed)
    const { layout } = state.layout
    if (state.remapTop && state.top !== undefined && was) {
      let at = lineAt(was, state.top)
      if (state.remapTop === 'text') {
        const marks = state.reloadMarks
        for (let n = 1, old = -1, found = !marks; !found && n <= lines.length; n++) {
          const cut = marks!.removed.get(n)?.length ?? 0
          // A top line inside a removed block lands on the line after it.
          if (at > old && at <= old + cut) [at, found] = [n - 1, true]
          else if (!marks!.added.has(n) && (old += cut + 1) === at) [at, found] = [n - 1, true]
          else if (marks!.added.has(n)) old += cut
        }
      }
      state.top = layout.starts[Math.max(0, Math.min(at, lines.length - 1))] ?? 0
    }
    state.remapTop = false
    const Client = 'Client' in ctx.el ? ctx.el.Client : undefined
    const hbar = !!Client && !state.wrap && layout.widest > C
    if (hbar) codeRows = Math.max(0, codeRows - 1)
    state.col = state.wrap ? 0 : Math.max(0, Math.min(state.col, layout.widest - C))
    const line = state.lit?.from ?? focus
    const asked = state.top ?? (line === undefined ? 0 : Math.max(0, codeRow(layout, Math.max(0, Math.min(line, lines.length) - 1)) - Math.floor(codeRows / 2)))
    const win = fileWindow(layout.rows, asked, codeRows)
    state.top = win.top
    const drawn: { row: number; line: number; before?: number; cell: string; lit: boolean; hit?: boolean; tone?: 'add' | 'del'; bg?: string }[] = []
    const code: JSX.Element[] = []
    const kindColor = (t: Token) => (t.kind === 'keyword' ? HUD.label : t.kind === 'string' ? TYPES.feat : t.kind === 'number' ? TYPES.perf : t.kind === 'comment' ? HUD.faint : undefined)
    for (let r = win.top; r < win.last; r++) {
      const at = rowAt(layout, r)
      const seg = at.seg
      const del = at.kind === 'del'
      const n = del ? 0 : at.index + 1
      let tokens: Token[] | undefined
      if (del) tokens = tokenize(at.text)
      else {
        tokens = state.tokens.get(at.index)
        if (!tokens) state.tokens.set(at.index, (tokens = tokenize(lines[at.index]!)))
      }
      const on = !del && findOpen ? state.find!.spans.get(n) : undefined
      const slice = sliceTokens(tokens, state.wrap ? seg * C : state.col, C, on && hitsOf(lines[n - 1]!, on.map(m => ({ ...m, current: m.index === state.find!.current }))))
      const tone = del ? 'del' : state.marks?.added.has(n) ? 'add' : undefined
      const lit = !!state.lit && (del ? redLit(at.before, state.lit.from, state.lit.to) : n >= state.lit.from && n <= state.lit.to)
      const diffBg = tone === 'add' ? 'diffAdded' : tone === 'del' ? 'diffRemoved' : undefined
      const end = diffBg === undefined ? undefined : themeHex(diffBg)
      const flash = !del && flashing?.path === place.path && flashing.lines.has(n) ? (end ? mixHex(FLASH, end, flashing.step / FLASH_STEPS) : FLASH) : undefined
      const bg = flash ?? diffBg
      const cell = seg ? ' '.repeat(G) : del ? `${' '.repeat(digits + 1)}− ` : ` ${String(n).padStart(digits)}${tone === 'add' ? '+' : ' '} `
      drawn.push({ row: r, line: n, ...(del && { before: at.before }), cell, lit, hit: !seg && !!on, ...(tone && { tone }), ...(flash && { bg: flash }) })
      code.push(
        <Box key={del ? `del:${r}` : seg ? `row:${n}:${seg}` : `row:${n}`} backgroundColor={lit ? LIT : bg}>
          <Box width={C} flexShrink={0}>
            <Button
              key={`code:${r - win.top}`}
              plain
              onPress={() => {
                state.lit = undefined
                clearReload()
                endFlash()
                state.editDiff = undefined
                return update($, file, () => placeOf())
              }}
            >
              {slice.length || lit || bg ? slice.map((t, k) => (
                <Text key={k} backgroundColor={t.hit === 'current' ? 'warning' : t.hit ? PILL_BG.yellow : lit ? LIT : bg} color={t.hit === 'current' ? 'inverseText' : t.hit ? STATUS.M : del ? HUD.faint : kindColor(t)}>
                  {t.text}
                </Text>
              )) : <Text> </Text>}
              {/* The row Box's background does not reach under its Texts, so a lit or diff row paints its own cells. */}
              {(lit || bg) && <Text backgroundColor={lit ? LIT : bg}>{' '.repeat(Math.max(0, C - cellsOf(slice.map(t => t.text).join(''))))}</Text>}
            </Button>
          </Box>
          {!Client && <Text color={HUD.faint}>│</Text>}
        </Box>,
      )
    }
    const matched: number[] = []
    if (findOpen)
      for (const n of state.find!.spans.keys())
        for (let r = codeRow(layout, n - 1); r < layout.starts[n]!; r++) matched.push(r)
    const b = (state.bar = cachedBar(state.bar, { layout, reload: state.reloadMarks, diff: state.diff, showDiff: state.showDiff, cells: codeRows }, { add: STATUS.A, del: STATUS.D, mixed: STATUS.M }))
    const found = markCells(layout.rows, codeRows, matched)
    const marks = matched.length ? b.marks.map((m, i) => m ?? (found[i] ? 'warning' : null)) : b.marks
    body.push(
      <Box key="view">
        <Box width={G} flexShrink={0} flexDirection="column">
          {Client ? (
            <Client key="explorer:gutter" module="./explorer-gutter.tsx" height={codeRows} props={{ rows: drawn, colors: { lit: LIT, faint: HUD.faint, claude: 'claude', warning: 'warning', add: STATUS.A, del: STATUS.D, addBg: 'diffAdded', delBg: 'diffRemoved' } }} />
          ) : (
            drawn.map(r => (
              <Button key={`gutter:${r.row}`} plain onPress={press => (pressLine(r) !== undefined ? (clearReload(), endFlash(), copyLines($, r.line, r.line, press.surface)) : undefined)}>
                <Text color={r.hit ? 'warning' : r.tone === 'add' ? STATUS.A : r.tone === 'del' ? STATUS.D : HUD.faint} backgroundColor={r.lit ? LIT : r.bg ?? (r.tone === 'add' ? 'diffAdded' : r.tone === 'del' ? 'diffRemoved' : undefined)}>
                  {r.cell}
                </Text>
              </Button>
            ))
          )}
        </Box>
        <Box flexDirection="column">{code}</Box>
        {Client && <Client key="explorer:vbar" module="./explorer-bar.tsx" width={1} height={codeRows} props={{ ...bar('v', codeRows, layout.rows, win.top), marks }} />}
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
          endFlash()
          state.editDiff = undefined
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
        clearReload()
        endFlash()
        state.editDiff = undefined
        return update($, file, () => placeOf())
      },
    })
  }
  const glyph = (key: string, plain: string, code: number, press: () => unknown) => (
    <Button key={key} plain onPress={press}>
      <Text color="claude">{basic ? plain : String.fromCharCode(code)}</Text>
    </Button>
  )
  const shown = headOf(place.path, state.root, home, MID)
  const inRoot = state.root !== '/' && (place.path === state.root || place.path.startsWith(`${state.root}/`))
  // The path's last part opens the Recent field; the name search stays on the `/` button.
  const last = (name: string) => (
    <Button key="explorer:path-last" plain onPress={() => openRecent($)}>
      <Text bold color="claude">{name}</Text>
    </Button>
  )
  let path: JSX.Element[] | string = shown
  if (inRoot) {
    const parts = place.path === state.root ? [] : place.path.slice(state.root.length + 1).split('/')
    const names = [state.root.slice(state.root.lastIndexOf('/') + 1), ...parts].map(printable)
    // Cut at a folder name, so each folder still shown stays a link; a last name too long keeps the plain cut.
    const label = (from: number) => `${from ? '…/' : ''}${names.slice(from).join('/')}`
    let from = 0
    while (from < names.length - 1 && cellsOf(label(from)) > MID) from++
    if (cellsOf(label(from)) <= MID) {
      const openFolder = (dir: string) => () => update($, file, () => (showFolder(dir), placeOf()))
      const links: JSX.Element[] = from
        ? [
            <Button key="cut" plain onPress={openFolder(state.root)}>
              <Text color={HUD.faint}>…</Text>
            </Button>,
          ]
        : []
      let at = state.root
      names.forEach((name, i) => {
        if (i) at += `/${parts[i - 1]}`
        if (i < from) return
        if (i > 0) links.push(<Text key={`sep:${i}`} color="promptBorder">/</Text>)
        links.push(
          i < names.length - 1 ? (
            <Button key={at} plain onPress={openFolder(at)}>
              <Text>{name}</Text>
            </Button>
          ) : (
            last(name)
          ),
        )
      })
      path = links
    }
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
  let findBar: JSX.Element | undefined
  if (findOpen && state.find) {
    const { text, result } = state.find
    const total = result.matches.length
    const live = !!text && !result.bad && total > 0
    const dim = (s: string) => <Text color={live ? undefined : HUD.faint}>{s}</Text>
    const toggle = (flag: keyof State['toggles'], name: string, plain: string, code: number) => (
      <Button key={`explorer:find:${name}`} plain onPress={() => toggleFind($, flag)}>
        <Text color="claude" inverse={state.toggles[flag]}>{basic ? plain : String.fromCharCode(code)}</Text>
      </Button>
    )
    const count = !text ? '' : result.bad ? 'bad pattern' : !total ? 'no matches' : `${result.capped ? `${total}+` : total}`
    const shownCount = !text ? undefined : result.bad ? <Text color="error">bad pattern</Text> : !total ? <Text color="warning">no matches</Text> : (
      <Text>
        <Text color="warning">{String(state.find.current + 1)}</Text>
        <Text> </Text>
        <Text color={HUD.faint}>of</Text>
        <Text> </Text>
        <Text>{result.capped ? `${total}+` : String(total)}</Text>
      </Text>
    )
    const toggles = basic ? 'Aa'.length + 1 + 'W'.length + 1 + '.*'.length : 5
    const countCells = !text ? 0 : result.bad || !total ? count.length : `${state.find.current + 1} of ${count}`.length
    const group = (words: boolean) => 1 + (words ? 5 : 0) + 2 + countCells + (countCells ? 2 : 0) + (words ? 5 : 0) + 1
    const words = toggles + 2 + group(true) + 2 + 1 <= W
    findBar = (
      <Box key="explorer:find-bar" flexShrink={0}>
        <Box key="explorer:find:left" width={toggles} flexShrink={0}>
          {toggle('matchCase', 'case', 'Aa', 0xeab1)}
          <Text> </Text>
          {toggle('word', 'word', 'W', 0xeb7e)}
          <Text> </Text>
          {toggle('regex', 'regex', '.*', 0xeb38)}
        </Box>
        <Box key="explorer:find:mid" flexGrow={1} justifyContent="center">
          <Button key="explorer:find:prev" plain onPress={() => stepFind($, -1)}>
            {dim('‹')}
            {words && dim(' ')}
            {words && dim('prev')}
          </Button>
          <Text>  </Text>
          {shownCount}
          {shownCount && <Text>  </Text>}
          <Button key="explorer:find:next" plain onPress={() => stepFind($, 1)}>
            {words && dim('next')}
            {words && dim(' ')}
            {dim('›')}
          </Button>
        </Box>
        {/* As wide as the toggles, so the middle centres on the pane. */}
        <Box key="explorer:find:right" width={toggles} flexShrink={0} justifyContent="flex-end">
          <Button key="explorer:find:close" plain onPress={() => closeFind($)}>
            <Text color="claude">✕</Text>
          </Button>
        </Box>
      </Box>
    )
  }
  const target = () => relOf(place.path)
  // The card is 9 rows at top 2; a shorter body lifts it beside the menu button and drops the divider.
  const short = rows < 11
  const churn = churnText(state.diff).split(' ')
  const editedMs = editedAt(place.path)
  const infoRow = (k: string, value: JSX.Element[]) => (
    <Box key={`info:${k}`}>
      <Text color={HUD.faint}>{k.padEnd(8)}</Text>
      {value}
    </Box>
  )
  // The rail rows of the cards' bottom borders: both cards sit at row 1.
  const infoBottom = inRepo ? 7 : 5
  const infoCard = (
    <Box
      key="explorer:info-card"
      position="absolute"
      top={short ? 0 : 1}
      right={short ? hdrRight : -PAD}
      display={state.infoPinned ? 'flex' : 'none'}
      hover={state.infoPinned || state.menuPinned ? undefined : { scope: 'explorer:info', display: 'flex' }}
    >
      <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" backgroundColor={CARD} paddingX={1}>
        {inRepo && infoRow('git', fileMark ? [<Text color={STATUS[fileMark] ?? HUD.faint}>{`${fileMark} ${wordOf(fileMark)}`}</Text>] : [<Text>clean</Text>])}
        {inRepo &&
          infoRow('changes', [
            <Box gap={1}>
              {churn.map(part => (
                <Text color={part[0] === '+' ? STATUS.A : part[0] === '\u2212' ? STATUS.D : undefined}>{part}</Text>
              ))}
            </Box>,
          ])}
        {infoRow('edited', [<Text>{editedMs === undefined ? '\u2014' : `Claude \u00b7 ${clock(editedMs)}`}</Text>])}
        {infoRow('type', [<Text>{langOf(place.path.slice(place.path.lastIndexOf('/') + 1))}</Text>])}
        {infoRow('lines', [<Text>{String(lines.length)}</Text>])}
      </Box>
      {/* The left corner joins the rule as a tee; the right border is covered so the rail, one column on, reads as the edge. */}
      {!short && (
        <Box position="absolute" top={0} left={0}>
          <Text color="promptBorder">┬</Text>
        </Box>
      )}
      {!short && (
        <Box position="absolute" top={0} right={0}>
          <Text color="promptBorder">─</Text>
        </Box>
      )}
      {!short && <Box position="absolute" top={1} bottom={1} right={0} width={1} backgroundColor={CARD} />}
      {!short && (
        <Box position="absolute" bottom={0} right={0}>
          <Text color="promptBorder">─</Text>
        </Box>
      )}
    </Box>
  )
  const card = (
    <Box
      key="explorer:menu-card"
      position="absolute"
      top={short ? 0 : 1}
      right={short ? hdrRight : -PAD}
      display={state.menuPinned ? 'flex' : 'none'}
      hover={state.menuPinned || state.infoPinned ? undefined : { scope: 'explorer:menu', display: 'flex' }}
    >
      <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" backgroundColor={CARD} paddingX={1}>
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
          const launched = await $.process.run(['sh', '-c', OPEN_EDITOR_SH, 'sh', place.path]).catch(() => undefined)
          if (launched?.exitCode === 0) notify($, 'opened', target())
          else notify($, 'failed to open', target())
        })}
        {!short && (
          <Box marginX={-1}>
            <Text color="promptBorder">{'─'.repeat(LABEL + 1 + 2)}</Text>
          </Box>
        )}
        <Button
          key="wrap"
          plain
          onPress={() => {
            const old = state.layout?.layout
            state.wrap = !state.wrap
            if (old && place.kind === 'file' && loaded && !loaded.unreadable && !viewMd) keepTop(old, lines, C)
            return update($, file, () => placeOf())
          }}
        >
          <Text>{'Wrap lines'.padEnd(LABEL)}</Text>
          <Text color="claude">{state.wrap ? (basic ? '✓' : String.fromCharCode(0xeab2)) : ' '}</Text>
        </Button>
        <Button
          key="show-diff"
          plain
          onPress={() => {
            const old = state.layout?.layout
            state.showDiff = !state.showDiff
            showMarks()
            if (old && place.kind === 'file' && loaded && !loaded.unreadable && !viewMd) keepTop(old, lines, C)
            return update($, file, () => placeOf())
          }}
        >
          <Text>{'Show git diff'.padEnd(LABEL)}</Text>
          <Text color="claude">{state.showDiff ? (basic ? '✓' : String.fromCharCode(0xeab2)) : ' '}</Text>
        </Button>
      </Box>
      {/* The left corner joins the rule as a tee; the right border is covered so the rail, one column on, reads as the edge. */}
      {!short && (
        <Box position="absolute" top={0} left={0}>
          <Text color="promptBorder">┬</Text>
        </Box>
      )}
      {!short && (
        <Box position="absolute" top={0} right={0}>
          <Text color="promptBorder">─</Text>
        </Box>
      )}
      {!short && <Box position="absolute" top={1} bottom={1} right={0} width={1} backgroundColor={CARD} />}
      {/* The divider's last cell sits on the covered border column, so it is drawn over the cover. */}
      {!short && (
        <Box position="absolute" top={MENU_ITEMS + 1} right={0}>
          <Text color="promptBorder">─</Text>
        </Box>
      )}
      {!short && (
        <Box position="absolute" bottom={0} right={0}>
          <Text color="promptBorder">─</Text>
        </Box>
      )}
    </Box>
  )
  const editing = (state.find?.open && place.kind === 'file') || (state.names && place.kind === 'folder') || state.recent
  // The stand-ins beside the name field that Down and Up move the ring to, so stepName can catch them.
  // Drawn as long as the field is: one drawn in later before the field drops the ring off it.
  const stepping = !!(state.names || state.recent)
  // A closed field reopens under the same key, so it seeds afresh.
  if (!editing) seeds.clear()
  // A field's room: the path's, plus the cells of the right buttons it hides.
  const ROOM = MID + hdrRight
  // The label gives way once the text no longer fits beside it.
  const labelFor = (text: string, label: string, placeholder: string) => (!text ? `${placeholder} ` : cellsOf(text) > ROOM - cellsOf(label) - 9 ? '' : label)
  const findLabel = labelFor(state.find?.text ?? '', 'lines with ', PLACEHOLDER)
  const nameLabel = labelFor(state.names?.text ?? '', state.names?.capped ? 'named (capped) ' : 'named ', NAME_PLACEHOLDER)
  const recentLabel = labelFor(state.recent?.text ?? '', RECENT_LABEL, RECENT_PLACEHOLDER)
  const recentL = ' '.repeat(fieldPad(recentLabel, state.recent?.text ?? '', 'open', MID, ROOM))
  const findL = ' '.repeat(fieldPad(findLabel, state.find?.text ?? '', 'next', MID, ROOM))
  const nameL = ' '.repeat(fieldPad(nameLabel, state.names?.text ?? '', 'open', MID, ROOM))
  return {
    body: (
      <Box flexDirection="column" height={rows} flexShrink={0}>
        <Box>
          <Box width={5} flexShrink={0} gap={1}>
            {glyph('back', '‹', 0xea9b, () => goBack($))}
            {glyph('forward', '›', 0xea9c, () => goForward($))}
            {glyph('refresh', '↻', 0xeb37, () => ((statusCache = undefined), reloadPlace($)))}
          </Box>
          <Box key="path" flexGrow={1} justifyContent={editing ? 'flex-start' : 'center'} marginX={GAP}>
            {state.find?.open && place.kind === 'file' ? (
              <Box key="find" flexShrink={0}>
                <Text>{findL}</Text>
                <Text color={HUD.faint}>{findLabel}</Text>
                <Box width={capWidth(state.find.text, 'next', ROOM - (state.find.text ? cellsOf(findLabel) : 0))} flexShrink={0}>
                  <Input key={findKey()} value={seedOf(findKey(), state.find.text)} submitLabel="next" autoFocus onInput={v => typeFind($, fitField($, v, ROOM - 9, state.find?.text ?? '', () => gen++))} onSubmit={() => (gen++, stepFind($, 1))} />
                </Box>
              </Box>
            ) : state.recent ? (
              <Box key="recent" flexShrink={0}>
                <Text>{recentL}</Text>
                <Text color={HUD.faint}>{recentLabel}</Text>
                <Box width={capWidth(state.recent.text, 'open', ROOM - (state.recent.text ? cellsOf(recentLabel) : 0))} flexShrink={0}>
                  <Button plain key={RECENT_UP} onPress={() => undefined}><Text>{''}</Text></Button>
                  <Input key={recentKey()} value={seedOf(recentKey(), state.recent.text)} submitLabel="open" autoFocus onInput={v => typeRecent($, fitField($, v, ROOM - 9, state.recent?.text ?? '', () => recentGen++))} onSubmit={() => submitRecent($)} />
                  <Button plain key={RECENT_DOWN} onPress={() => undefined}><Text>{''}</Text></Button>
                </Box>
              </Box>
            ) : state.names && place.kind === 'folder' ? (
              <Box key="names" flexShrink={0}>
                <Text>{nameL}</Text>
                <Text color={HUD.faint}>{nameLabel}</Text>
                <Box width={capWidth(state.names.text, 'open', ROOM - (state.names.text ? cellsOf(nameLabel) : 0))} flexShrink={0}>
                  {stepping && <Button plain key={NAME_UP} onPress={() => undefined}><Text>{''}</Text></Button>}
                  <Input key={nameKey()} value={seedOf(nameKey(), state.names.text)} submitLabel="open" autoFocus onInput={v => typeName($, fitField($, v, ROOM - 9, state.names?.text ?? '', () => nameGen++))} onSubmit={() => submitName($)} />
                  {stepping && <Button plain key={NAME_DOWN} onPress={() => undefined}><Text>{''}</Text></Button>}
                </Box>
              </Box>
            ) : state.notice ? (
              <Text>
                <Text color={HUD.faint}>{state.noticeVerb} </Text>
                <Text color="claude">{cutStart(printable(state.notice), MID - (state.noticeVerb?.length ?? 0) - 1)}</Text>
              </Text>
            ) : typeof path === 'string' ? (
              path.endsWith('/') ? (
                <Text color={HUD.action}>{path}</Text>
              ) : (
                <Box key="parts" flexShrink={0}>
                  <Text color={HUD.action}>{path.slice(0, path.lastIndexOf('/') + 1)}</Text>
                  {last(path.slice(path.lastIndexOf('/') + 1))}
                </Box>
              )
            ) : (
              <Box key="parts" flexShrink={0}>{path}</Box>
            )}
          </Box>
          {!editing && (
            <Box key="explorer:header-right" width={hdrRight} flexShrink={0} gap={1} justifyContent="flex-end">
              {isMd && (
                <Button key="explorer:markdown" plain onPress={() => {
                  state.nav = setView(state.nav, !viewMd)
                  state.top = state.col = 0
                  if (!viewMd) state.lit = undefined
                  return update($, file, () => placeOf())
                }}>
                  <Text color="claude" inverse={viewMd}>{basic ? 'M' : String.fromCharCode(0xeb1d)}</Text>
                </Button>
              )}
              {glyph('explorer:search', '/', 0xea6d, () => (place.kind === 'file' ? openFind($) : openNames($)))}
              {place.kind === 'file' && (
                <Button key="info" plain hover={state.menuPinned ? undefined : { scope: 'explorer:info' }} onPress={() => {
                  state.infoPinned = !state.infoPinned
                  state.menuPinned = false
                  return update($, file, () => placeOf())
                }}>
                  <Text color={fileMark ? STATUS[fileMark] ?? 'claude' : 'claude'} inverse={state.infoPinned}>{basic ? 'i' : String.fromCharCode(0xea74)}</Text>
                </Button>
              )}
              <Button key="menu" plain hover={state.infoPinned ? undefined : { scope: 'explorer:menu' }} onPress={() => {
                state.menuPinned = !state.menuPinned
                state.infoPinned = false
                return update($, file, () => placeOf())
              }}>
                <Text color="claude" inverse={state.menuPinned}>{basic ? '≡' : String.fromCharCode(0xeb94)}</Text>
              </Button>
            </Box>
          )}
        </Box>
        <Box marginX={-PAD}>
          <Text color="promptBorder">{'─'.repeat(W + 2 * PAD)}</Text>
        </Box>
        {body}
        {findBar && (
          <Box key="explorer:find-rule" marginX={-PAD}>
            <Text color="promptBorder">{'─'.repeat(W + 2 * PAD)}</Text>
          </Box>
        )}
        {findBar}
        {card}
        {place.kind === 'file' && infoCard}
      </Box>
    ),
    zones,
    trace: {},
    rules: [1, ...(short ? [] : state.menuPinned ? [MENU_ITEMS + 5] : state.infoPinned && place.kind === 'file' ? [infoBottom] : [])],
    tees: short || state.menuPinned || state.infoPinned ? [] : [{ row: MENU_ITEMS + 5, scope: 'explorer:menu' }, ...(place.kind === 'file' ? [{ row: infoBottom, scope: 'explorer:info' }] : [])],
  }
}
