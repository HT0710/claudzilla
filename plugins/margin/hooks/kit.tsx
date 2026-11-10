import { atom, update } from 'claude-code'
import type { Elements, EngineInterface, RenderPropsOf, RenderSurface } from 'claude-code'

import type { FileView, Intent, Modal, Overview, Tab } from '../types'
import { printable } from './git-data'
import { scrollWindow } from './modal'
import type { Frame } from './modal'
import { DEFAULTS } from './palette'
import type { Palette } from './palette'

export { capped, contentFrame, modalFrame, scrollWindow, stackFrame } from './modal'
export type { Frame } from './modal'

const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)

export type Split = { rows: number; min: number; max: number }
export type Zone = {
  tab: Tab
  kind: 'modal' | 'divider' | 'list'
  // Rows `from` up to `to` of the tab's tree; a pointer row counts from the engine's window, so `offset` is added to it.
  from: number
  to: number
  // The engine's scroll offset when drawn; 0 where the engine does not scroll the tab.
  offset: number
  // A modal layer's columns; any column elsewhere.
  columns?: [number, number]
  // Takes a notch no zone is under, or one with no pointer: History's list, Git's COMMITS.
  fallback?: boolean
  // A divider's name for WHEEL_HOLD.
  hold?: 'git'
  // The store update, made in the draw (R5): `$` and the atoms stay in the drawing file.
  wheel: (by: number) => Promise<unknown>
}

export const WHEEL_HOLD = 1000
// A stored split moved by `by` rows, from the rows drawn while it is unset, kept to the drawn bounds.
export const nudge = (stored: number, { rows, min, max }: Split, by: number) =>
  Math.max(min, Math.min((stored >= 0 ? Math.max(min, Math.min(stored, max)) : rows) + by, max))

// The zones as last drawn. Draws run at the same time and Git reads before it draws, so a draw start keeps its own
// tab's zones and a finished draw replaces them.
let zones: Zone[] = []
export const drawnZones = (): readonly Zone[] => zones
export const keepZones = (tab: Tab) => {
  zones = zones.filter(z => z.tab === tab)
}
export const setZones = (tab: Tab, drawn: Zone[]) => {
  zones = [...zones.filter(z => z.tab !== tab), ...drawn]
}
export const modalOpen = () => zones.some(z => z.kind === 'modal')

export const PAD = 2
// The bottom bar's rows: its rule and its labels.
export const BAR_ROWS = 2
// HUD colors (claudzilla/claude/hud/hud-filter.pl) the theme has no key for; latest, a lighter
// dirty yellow, is the panel's own.
export const HUD = {} as Record<'label' | 'faint' | 'idle' | 'action' | 'compacted' | 'dirty' | 'churn' | 'latest', string>
// Divider lines: their word's HUD color at 60%.
export const DIM = {} as Record<'label' | 'action' | 'compacted', string>
// A commit type (claude/rules/git.md's, plus perf) by what it does, one color each: feat adds (green),
// fix repairs (red), refactor reshapes (blue), perf speeds up (orange), docs (yellow), test (cyan),
// chore (the section labels' purple). Any other type stays gray.
export const TYPES: Record<string, string> = {}
// A changed file's git status letter, one color each from TYPES' palette: modified (yellow), added
// (green), deleted or conflicted (red), renamed or copied (blue), untracked (cyan); any other gray.
export const STATUS: Record<string, string> = {}
// A local commit's scope: a light gray under the subject.
export let SCOPE: string
// Ahead and behind: a pair of their own, used for nothing else. Cards and modals sit on CARD; a lit row on LIT.
export let AHEAD: string
export let BEHIND: string
export let CARD: string
export let LIT: string
// A pushed commit's, or a staged file's: its color at 60%, as DIM's are.
// What sits behind an open modal, and the line next to a shown card: text, rules and borders in one dim colour,
// darker than HUD.faint, so a faint row never goes darker than a plain one (divider.tsx draws its rule in it too).
export let DIMMED: string
// A faded background: each colour at half, as an opacity over the black pane; one with no hex to scale, a dark grey.
export let FADED: string
// A pill's background by its colour's name.
export const PILL_BG = {} as Palette['margin']['pill']
// Fills the holders above from a palette; DIM and chore follow its final colours.
export function applyPalette(p: Palette): void {
  const { label, faint, idle, action, dirty, churn } = p.shared
  Object.assign(HUD, { label, faint, idle, action, dirty, churn, compacted: p.margin.compacted, latest: p.margin.latest })
  Object.assign(DIM, { label: dim(HUD.label), action: dim(HUD.action), compacted: dim(HUD.compacted) })
  Object.assign(TYPES, p.margin.types, { chore: p.shared.label })
  Object.assign(STATUS, p.margin.status)
  SCOPE = p.shared.muted
  AHEAD = p.margin.ahead
  BEHIND = p.margin.behind
  CARD = p.margin.card
  LIT = p.shared.lit
  DIMMED = p.margin.hairline
  FADED = p.margin.faded
  Object.assign(PILL_BG, p.margin.pill)
}
// The active custom theme's colours by key (claude/themes/<name>.json), read once a session, so a theme key fades by
// its own hue. A built-in theme, or a key it leaves to its base, has none and fades to FADED.
// shortcut: a theme switched mid-session fades by the old one until a reload; read again on config.set if it matters.
let themeColors: Record<string, string> = {}
let themeRead: Promise<unknown> | undefined
export function readTheme($: EngineInterface): Promise<unknown> {
  return (themeRead ??= (async () => {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value
    if (typeof theme !== 'string' || !theme.startsWith('custom:')) return
    themeColors = JSON.parse(String(await $.fs.read(`${await configDir($)}/themes/${theme.slice(7)}.json`))).overrides ?? {}
  })().catch(() => undefined))
}
export const fade = (_color?: unknown) => DIMMED
// A pill's caps are Texts coloured as its background, so they halve with it.
export const PILL_CAPS = new Set(['\ue0b6', '\ue0b4'])
export const fadeBg = (color: unknown) => {
  const hex = typeof color === 'string' ? (/^#[0-9a-f]{6}$/i.test(color) ? color : themeColors[color]) : undefined
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)
    ? `#${hex.slice(1).replace(/../g, c => Math.round(parseInt(c, 16) * 0.5).toString(16).padStart(2, '0'))}`
    : FADED
}
// A drawn tree behind a modal, copied node by node: Text and Box colours faded, and Buttons swapped for a Text,
// so nothing there lights or presses. The node keyed `open` (the row that opened the modal) keeps its colours,
// on the lit row, and its Button only runs `close`; a node keyed in `keep` stays as drawn.
export const fadeTree = (node: unknown, keep: Set<string>, close: () => unknown, open?: string, inverted = false): any => {
  // Flat: a tree refuses nested arrays.
  if (Array.isArray(node)) return node.flatMap(child => fadeTree(child, keep, close, open, inverted))
  if (!node || typeof node !== 'object' || !('type' in node)) return node
  const el = node as { type: string; key?: string; props?: Record<string, unknown>; children?: unknown }
  const key = (el.props?.key ?? el.key) as string | undefined
  if (key && keep.has(key)) return node
  const invert = inverted || (!!key && key === open)
  const kids = (children: unknown) => fadeTree(children, keep, close, open, invert)
  // A row Client fades its pieces itself, or draws lit as the open row.
  // The engine holds a module path as it resolved it: "hooks/row.tsx".
  if (el.type === 'Client' && String(el.props?.module).endsWith('row.tsx')) {
    const p = el.props!.props as { left: Piece[]; right: Piece[] }
    return { ...el, props: { ...el.props, props: invert ? { ...p, open: LIT } : { ...p, faded: true, left: fadePieces(p.left), right: fadePieces(p.right) } } }
  }
  if (el.type === 'Button') {
    const text = kids(el.children ?? el.props?.children ?? el.props?.label)
    // A Text in its place, not its Texts loose: in a space-between row they would spread apart.
    return h(invert ? 'Button' : 'Text', invert ? { key: `open:${key}`, plain: true, onPress: close } : {}, ...[text].flat())
  }
  // The engine colours a Code's tokens, so faded it is plain text.
  if (el.type === 'Code' && !invert) return h('Text', { color: DIMMED, wrap: 'truncate-end' }, String(el.props?.source ?? ''))
  const props = { ...el.props }
  if (invert) {
    if (el.type === 'Text') props.backgroundColor = LIT
  } else {
    if (el.type === 'Text') props.color = PILL_CAPS.has(String(props.children ?? el.children)) ? fadeBg(props.color) : fade(props.color)
    if (props.backgroundColor !== undefined) props.backgroundColor = fadeBg(props.backgroundColor)
    if (props.borderColor !== undefined) props.borderColor = fade(props.borderColor)
  }
  if (props.children !== undefined) props.children = kids(props.children)
  // Faded, nothing lights: a modal under a stacked one keeps its file rows dark.
  return { ...el, props, ...(!invert && { hover: undefined }), ...(el.children !== undefined && { children: kids(el.children) }) }
}
export type Piece = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; hover?: object; under?: object; inverse?: boolean }
export const fadePieces = (pieces: Piece[]) =>
  pieces.map(x => ({ ...x, color: PILL_CAPS.has(x.text) ? fadeBg(x.color) : fade(x.color), ...(x.backgroundColor && { backgroundColor: fadeBg(x.backgroundColor) }) }))
// A row's Texts as a row Client's pieces, each with the styles it inherits.
export const toPieces = (node: unknown, style: Omit<Piece, 'text'> = {}): Piece[] => {
  if (Array.isArray(node)) return node.flatMap(child => toPieces(child, style))
  if (typeof node === 'string' || typeof node === 'number') return node === '' ? [] : [{ ...style, text: String(node) }]
  if (!node || typeof node !== 'object' || !('type' in node)) return []
  const el = node as { type: string; props?: Record<string, any>; children?: unknown }
  const { color, backgroundColor, dimColor, bold, inverse } = el.type === 'Text' ? (el.props ?? {}) : {}
  const own = Object.fromEntries(Object.entries({ color, backgroundColor, dimColor, bold, inverse }).filter(([, v]) => v !== undefined))
  return toPieces(el.children ?? el.props?.children, { ...style, ...own })
}
export const dim = (hex: string) => `#${hex.slice(1).replace(/../g, c => Math.round(parseInt(c, 16) * 0.6).toString(16).padStart(2, '0'))}`
applyPalette(DEFAULTS)
// Claude Code's own folder: CLAUDE_CONFIG_DIR moves it.
export async function configDir($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
}

export type Els = Elements[RenderSurface]
// `typed`: history's own text, set when a paste placeholder in it was swapped for the paste.
export type Prompt = { display: string; timestamp: number; typed?: string }
// Counts UTF-16 units, not cells: a wide glyph (CJK, emoji) can still overflow by one.
export const fit = (text: string, room: number) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)
// Lines kept each side of the clicked one, and each line's length: the draws repeat on every scroll, so they
// window a slice, not the file.
const FILE_SPAN = 200
const FILE_LINE = 500
// The File tab's view from a read: `text` empty stands for a file it cannot show (unreadable or binary).
export const fileView = (raw: string, line: number, read: string | undefined): NonNullable<FileView> => {
  // Drawn only, and Text and Code refuse control characters: a path from git can hold one.
  const path = printable(raw)
  if (read === undefined || read.includes('\0')) return { path, line, first: 1, text: '' }
  const all = read.replace(/\r?\n$/, '').split(/\r?\n/)
  const from = Math.max(0, Math.min(line - 1 - FILE_SPAN, all.length - (2 * FILE_SPAN + 1)))
  // Code refuses control characters (ESC in a log, ^L in a source): each shows as a space; tabs stay.
  const kept = all.slice(from, from + 2 * FILE_SPAN + 1).map(one => one.slice(0, FILE_LINE).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' '))
  return { path, line, first: from + 1, text: kept.join('\n') }
}
export const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayName = (day: Date) => `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`
// What a tab's draw gets from the Pane draw: values, elements and closures that take no `$` (loader rules).
export type TabCtx = {
  props: RenderPropsOf['Pane']
  signal: AbortSignal
  el: Els
  pick: (tab: Tab) => Promise<void>
  setModal: (change: (m: Modal | null) => Modal | null) => Promise<void>
}
export type TabDraw = {
  body: JSX.Element
  // Set as the tab's zones when the draw finishes unaborted.
  zones: Zone[]
  // Spread into the pane.draw trace entry.
  trace: Record<string, unknown>
  // In the trace entry but out of its change key: a wheel tick moves these alone.
  scroll?: Record<string, unknown>
  // Behind an open modal: what keeps its colours, and the row that opened it.
  fade?: { keep: Set<string>; open?: string }
}
export type UseKind = 'files' | 'memory' | 'web' | 'skills' | 'other'
export const USE_KINDS: UseKind[] = ['files', 'memory', 'web', 'skills', 'other']
// `names`: full values (path, URL, query, pattern, MCP tool), newest first, at most 50. `agentOf`: an agent-only
// name's agent id. `sourceOf`: an `other` name's source, `search` for a web search. Both keyed only by kept names.
export type UseEntry = { main: number; agents: number; names: string[]; fromAgents: string[]; agentOf?: Record<string, string>; sourceOf?: Record<string, string> }
export type Used = { kinds: Partial<Record<UseKind, UseEntry>>; last?: Used['kinds']; stale: string[]; seen: string[] }
export const EMPTY_USED: Used = { kinds: {}, stale: [], seen: [] }
export const EMPTY_INTENT: Intent = { wants: '', steps: [], at: 0, ended: false }
export const EMPTY_OVERVIEW: Overview = { topics: [], running: false }
export type Win = { top: number; shown: number; above: number; below: number }
// The Git modal's scroll cues, `inner` columns wide. `up`: ── ↑ N more ──, back to the top; the arrow bold in the
// border colour, the count faint. `down`: ↓ N more turns the page, the first row not shown becoming the top row;
// uncounted, as COMMITS' past the pages read. Unshrunk: a zone's last row wrapping past its edge would squeeze them out.
export const cues = (el: Els, key: string, inner: number, w: Win, setTop: (to: number) => unknown, counted = true, ruled = true): { up: JSX.Element; down: JSX.Element } => {
  const { Box, Button, Text } = el
  const mid = ` ${w.above} more `
  const fill = Math.max(0, inner - 2 - mid.length)
  const head = ` ${w.above} more`
  const tail = counted ? ` ${w.below} more` : ' more'
  return {
    up: (
      <Box key={`${key}:up-row`} flexShrink={0}>
        {ruled ? <Text color="promptBorder">{`${'─'.repeat(Math.floor(fill / 2))} `}</Text> : <Text>{' '.repeat(Math.max(0, Math.floor((inner - 1 - head.length) / 2)))}</Text>}
        <Button key={`${key}:up`} plain onPress={() => setTop(0)}>
          <Text bold color="promptBorder">↑</Text>
        </Button>
        <Text color={HUD.faint}>{ruled ? mid : head}</Text>
        {ruled && <Text color="promptBorder">{'─'.repeat(Math.ceil(fill / 2))}</Text>}
      </Box>
    ),
    down: (
      // Centred by a pad, not justifyContent: beside the STEPS label a centred Button was not drawn.
      <Box key={`${key}:down-row`} flexShrink={0}>
        <Text>{' '.repeat(Math.max(0, Math.floor((inner - 1 - tail.length) / 2)))}</Text>
        <Button key={`${key}:down`} plain onPress={() => setTop(w.top + w.shown)}>
          <Text bold color="promptBorder">↓</Text>
        </Button>
        <Text color={HUD.faint}>{tail}</Text>
      </Box>
    ),
  }
}
// A count in normal text: each standalone number in the claude colour; faint text stays faint. IDs (#n,
// shas), times (11h), churn (+7) and numbers inside names are not counts: a number touching a letter, #, + or
// − stays.
export const counted = (el: Els, text: string) =>
  text.split(/(?<![\w#+−.\/-])(\d+)(?![\w.\/-])/).map((part, i) => (part ? <el.Text color={i % 2 ? 'claude' : undefined}>{part}</el.Text> : null))
// A tab with nothing to list: a framed note, centered in `rows`.
export const emptyNote = (el: Els, rows: number, title: string, ...lines: JSX.Element[]): JSX.Element => {
  const { Box, Text } = el
  return (
    <Box height={Math.max(0, rows)} justifyContent="center" alignItems="center">
      <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor="promptBorder" paddingX={2} paddingY={1}>
        <Text bold color={HUD.label}>{title}</Text>
        <Text> </Text>
        {lines}
      </Box>
    </Box>
  )
}
// A list zone's window over `n` rows, its cues as a modal's: a zone too short for them still scrolls, bare.
// Its last offset: the window at `top` Infinity.
export const zoneWindow = (n: number, top: number, room: number) => {
  const rows = Math.max(0, room)
  return rows < 3 ? { top: Math.max(0, Math.min(top, n - rows)), shown: Math.min(rows, n), above: 0, below: 0 } : scrollWindow(n, top, rows, false)
}
// A row too wide for its layer (a stacked modal is narrower than the rows it reuses) is cut at the left side's
// end, as one string, 2 columns before the right side: every row breaks at the same column.
export const line = (el: Els, left: JSX.Element | JSX.Element[], right?: JSX.Element) => {
  const { Box, Text } = el
  return (
    <Box justifyContent="space-between" gap={2}>
      <Text wrap="truncate-end">{left}</Text>
      {right ? <Box flexShrink={0}>{right}</Box> : null}
    </Box>
  )
}
export const heading = (el: Els, label: string, right?: JSX.Element) => {
  const { Text } = el
  return line(el, <Text bold color={HUD.label}>{label}</Text>, right)
}
// The open modal's layers as last drawn, in tab-body cells: the wheel scrolls the top layer when over it.
export type Layer = { frame: Frame; top: number; end: number }
// As the last draw of a tab set them: `acts`, what a press on each top row's Client does; `spans`, the tab rows each
// top row's card spans, from its top to its end; `lines`, each top row's own.
export type RowHover = { acts: Record<string, () => unknown>; spans: Record<string, [number, number]>; lines: Record<string, number> }
// Each tab's own: a stale draw of one never clears the other's.
export const rowHovers: Record<'Git' | 'Overview', RowHover> = { Git: { acts: {}, spans: {}, lines: {} }, Overview: { acts: {}, spans: {}, lines: {} } }
export const hoverOf = (row: string): RowHover => (row.startsWith('o:') ? rowHovers.Overview : rowHovers.Git)
// What the Git draw's row and card closures read from its scope.
export type RowCtx = {
  el: Els
  hover: RowHover
  // Behind an open modal: no hover, card or link.
  dimmed: boolean
  // rowPointer as this draw read it.
  pointer: { left: string | null; at: string | null }
  // The left row's card span from the last draw.
  gone: [number, number] | undefined
  // Drawn last, over the rows.
  cards: JSX.Element[]
  columns: number
  // A hover card's widest: 75% of the body.
  cardWidth: number
  // A card that would pass the tab's bottom opens upward.
  up: (at: number, n: number) => boolean
}
export type LayerCtx = { el: Els; layers: { m?: Layer; s?: Layer }; setModal: (change: (m: Modal | null) => Modal | null) => Promise<void> }
export const row = (rc: RowCtx, key: string, left: any[], right: any[], o: { pieces: (key: string, node: any[]) => Piece[]; line: number; act: boolean; width?: number }): JSX.Element => {
  const { Box, Button } = rc.el
  const Client = 'Client' in rc.el ? rc.el.Client : undefined
  return Client ? (
    <Box flexDirection="column" height={1} hover={rc.dimmed ? undefined : { scope: `card:${key}`, ...(!o.act && key in rc.hover.acts && { backgroundColor: LIT }) }} {...(o.width !== undefined && { width: o.width, flexShrink: 0 })}>
      <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: o.pieces(key, left), right: o.pieces(key, right), ...(!rc.dimmed && { line: `line:${o.line}` }) }} />
    </Box>
  ) : (
    <Box key={`hov:${key}`} hover={rc.dimmed ? undefined : { scope: `card:${key}` }} justifyContent="space-between" height={1} overflow="hidden" {...(o.width !== undefined && { flexShrink: 0 })}>
      <Button key={`git:${key}`} plain onPress={() => rc.hover.acts[key]?.()}>
        {left}
      </Button>
      <Box flexShrink={0}>{right}</Box>
    </Box>
  )
}
// `anchor`: where its item sits on the row: left, right, or the whole row, centred under it.
export const card = (rc: RowCtx, scope: string, at: number, anchor: 'left' | 'right' | 'center', ...rows: JSX.Element[]): null => {
  const { Box } = rc.el
  const Client = 'Client' in rc.el ? rc.el.Client : undefined
  const key = scope.slice(5)
  // As wide as its widest row, border and padding included, up to the 75% cap.
  // A file card may pass the cap to show its pills whole.
  const width = Math.min(key.startsWith('f:') ? rc.columns - 4 : rc.cardWidth, cardContent(rc, rows) + 4)
  const place = anchor === 'left' ? { left: 0 } : anchor === 'right' ? { right: 0 } : { left: Math.floor((rc.columns - width) / 2) - PAD }
  // Its border and rows, from at + 2.
  const top = rc.up(at, rows.length) ? at - rows.length - 3 : at + 2
  const span = (rc.hover.spans[key] = [top, top + 2 + rows.length])
  const over = !!rc.gone && span[0] < rc.gone[1] && rc.gone[0] < span[1]
  if (!rc.dimmed && (!Client || key === rc.pointer.at || (key !== rc.pointer.left && !over)))
    rc.cards.push(
      <Box position="absolute" top={top} {...place} width={width} display="none" hover={{ scope, display: 'flex' }} flexDirection="column" borderStyle="round" borderColor="promptBorder" backgroundColor={CARD} paddingX={1}>
        {kvAligned(rc, rows)}
      </Box>,
    )
  return null
}
// A card row: a faint label, its info, and a count or mark at the far right. Labels take the card's longest
// and 2 more; under a title row they sit one column in. One row: the info is kept and the far-right text is cut.
export const kv = (rc: RowCtx, label: string, info: JSX.Element | string, right?: JSX.Element): JSX.Element => {
  const row = kvRow(rc.el, label, info, right)
  kvArgs.set(row, [label, info, right])
  return row
}
// A card's kv rows share one info column, so every far-right text starts past the same column. A row with a
// far-right text keeps its info whole; a row with none (refs) widens the column only as far as the 75% cap
// leaves room beside the far-right texts, and is cut with … at its end, so a long branch name cuts no count.
const kvArgs = new WeakMap<object, [string, JSX.Element | string, JSX.Element | undefined]>()
const infoLength = (info: JSX.Element | string) => (typeof info === 'string' ? info : toPieces(info).map(x => x.text).join('')).length
export const textLength = (node: unknown) => toPieces(node).map(x => x.text).join('').length
const insetOf = (rows: JSX.Element[]) => (rows.some(r => !kvArgs.get(r)) ? 1 : 0)
const labelOf = (rows: JSX.Element[]) => 2 + Math.max(0, ...rows.map(r => kvArgs.get(r)?.[0].length ?? 0))
const sharedInfo = (rc: RowCtx, rows: JSX.Element[]) => {
  const args = rows.map(r => kvArgs.get(r)).filter(Boolean) as [string, JSX.Element | string, JSX.Element | undefined][]
  const withRight = args.filter(a => a[2])
  const kept = Math.max(0, ...withRight.map(a => infoLength(a[1])))
  const right = withRight.length ? 2 + Math.max(...withRight.map(a => textLength(a[2]))) : 0
  return Math.max(kept, Math.min(Math.max(0, ...args.map(a => infoLength(a[1]))), rc.cardWidth - 4 - labelOf(rows) - insetOf(rows) - right))
}
// The widest row: a kv row at the card's shared info width, any other by its text, 2 more when split by
// space-between.
const cardContent = (rc: RowCtx, rows: JSX.Element[]) => {
  const info = sharedInfo(rc, rows)
  const label = labelOf(rows) + insetOf(rows)
  return Math.max(0, ...rows.map(r => {
    const args = kvArgs.get(r)
    if (args) return label + info + (args[2] ? 2 + textLength(args[2]) : 0)
    return textLength(r) + ((r as any)?.props?.justifyContent === 'space-between' ? 2 : 0)
  }))
}
const kvAligned = (rc: RowCtx, rows: JSX.Element[]) => {
  const width = sharedInfo(rc, rows)
  const inset = insetOf(rows)
  const label = labelOf(rows)
  const room = rc.cardWidth - 4 - label - inset
  return rows.map(r => {
    const args = kvArgs.get(r)
    if (!args) return r
    // A row short of room for a far-right text that would fit leaves the shared column, down to its own value.
    const left = args[2] ? room - 2 - textLength(args[2]) : width
    return kvRow(rc.el, ...args, left >= infoLength(args[1]) ? Math.min(width, left) : width, inset, label)
  })
}
const kvRow = (el: Els, label: string, info: JSX.Element | string, right?: JSX.Element, infoWidth?: number, inset = 1, labelWidth = label.length + 2) => {
  const { Box, Text } = el
  return (
    <Box justifyContent="space-between" gap={2} height={1} overflow="hidden">
      <Box flexShrink={0} {...(infoWidth !== undefined && { width: labelWidth + inset + infoWidth })}>
        <Text wrap="truncate-end">
          <Text color={HUD.faint}>{`${inset ? ' ' : ''}${label.padEnd(labelWidth)}`}</Text>
          {typeof info === 'string' ? <Text>{info}</Text> : info}
        </Text>
      </Box>
      <Text wrap="truncate-end">{right ?? ' '}</Text>
    </Box>
  )
}
// One modal layer: actions and ✕, a divider, pinned rows, the list's window with its cues.
// A layer with no pinned rows merges its top cue into the divider. `centre`: the row to open on, when top < 0.
export function drawLayer($: EngineInterface, lc: LayerCtx, layer: 'm' | 's', f: Frame, at: { top: number; left: number }, acts: JSX.Element[], pin: JSX.Element[], rows: JSX.Element[], top: number, centre = 0): JSX.Element {
  const { Box, Button, Text } = lc.el
  const inner = f.width - 4
  const room = f.height - 4 - pin.length
  const merged = !pin.length
  const start = top >= 0 ? top : Math.max(0, centre - Math.floor(scrollWindow(rows.length, 0, room, merged).shown / 2))
  const w = scrollWindow(rows.length, start, room, merged)
  lc.layers[layer] = { frame: f, top: w.top, end: scrollWindow(rows.length, Infinity, room, merged).top }
  const setTop = (to: number) =>
    update($, modal, m => (!m ? m : layer === 's' ? (m.sub ? { ...m, sub: { ...m.sub, top: to } } : m) : { ...m, top: to }))
  const { up, down } = cues(lc.el, layer, inner, w, setTop)
  const close = () => lc.setModal(m => (layer === 's' && m ? { ...m, sub: undefined } : null))
  // Every row one row tall, as the window counts them: a row too wide is cut, never wrapped.
  const one = (row: JSX.Element) => (
    <Box flexDirection="column" height={1} overflow="hidden" flexShrink={0}>
      {row}
    </Box>
  )
  return (
    <Box key={layer === 'm' ? 'modal' : 'stack'} position="absolute" top={at.top} left={at.left} width={f.width} height={f.height} flexDirection="column" borderStyle="round" borderColor="promptBorder" backgroundColor={CARD} paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={2}>{acts}</Box>
        <Button key={`${layer}:x`} plain onPress={close}>
          <Text>✕</Text>
        </Button>
      </Box>
      {merged && w.above ? up : <Text color="promptBorder">{'─'.repeat(inner)}</Text>}
      {pin.map(one)}
      {!merged && w.above ? up : null}
      {rows.slice(w.top, w.top + w.shown).map(one)}
      {w.below ? down : null}
    </Box>
  )
}
// The open modal's top layer as a zone: a notch over it scrolls it.
export function modalZone($: EngineInterface, tab: Tab, layers: { m?: Layer; s?: Layer }): Zone | undefined {
  const topLayer = layers.s ?? layers.m
  if (!topLayer) return
  const sub = !!layers.s
  const { frame } = topLayer
  // Rows count under the tabs and their rule.
  return {
    tab, kind: 'modal', from: frame.top + 2, to: frame.top + 2 + frame.height, offset: 0, columns: [frame.left, frame.left + frame.width],
    wheel: by => {
      const top = Math.max(0, Math.min(topLayer.top + by, topLayer.end))
      return update($, modal, m => (!m ? m : sub ? (m.sub ? { ...m, sub: { ...m.sub, top } } : m) : { ...m, top }))
    },
  }
}
