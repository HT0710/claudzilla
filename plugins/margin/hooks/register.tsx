import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Check, CheckState, CommitView, Counts, FileView, LogRow, Gh, Intent, Modal, ModalKey, Op, Overview, Pr, PrState, PrView, Spawn, Stage, Step, Tab, Word } from '../types'
import { LOG_FORMAT, age, branches, cutMiddle, fileKey, incomingPrs, ownPrs, parseCommitView, parseHead, parseLog, parseNumstat, parseShortstat, parseStatusZ, parseMerge, parsePrView, parsePrs, parseRebase, printable, sortChecks, stashCount, syncMark, treeRows, worktrees, worst } from './git-data'
import { mdRows } from './markdown'
import { capped, contentFrame, modalFrame, scrollWindow, stackFrame } from './modal'
import type { Frame } from './modal'
import { tracer } from './trace'
import { traceIo } from './trace-io'

const t = tracer('margin')
// The pane's last traced draw: a draw repeats on every scroll and click, so only a change is traced.
let lastPane = ''

const PANE = 'margin'
const PAD = 2
// Top bar: the chat's own state; bottom bar: the files it touches.
const TOP: Tab[] = ['Overview', 'Decisions', 'History']
const BOTTOM: Tab[] = ['File', 'Tree', 'Git']
const TABS = [...TOP, ...BOTTOM]
// The tabs with an alt key: each runs /margin-<tab>.
const KEYS: Partial<Record<Tab, string>> = { Overview: 'o', History: 'h', File: 'l', Git: 'g' }
// Tabs not built yet: drawn dim, their body says when.
const SOON: Tab[] = ['Decisions', 'Tree']
// The bottom bar's rows: its rule and its labels.
const BAR_ROWS = 2
const MAX_PROMPTS = 100
// COMMITS reads this many at a time, the next page once scrolled past: git walks every commit it
// skips (210 ms at 100k), so a read per wheel tick would lag.
const PAGE = 100
// Built-in tools that never change files: their calls leave the Git tab's reads standing.
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
// \u00a0: the toast wraps at spaces; ↻ keeps to its word.
const GONE = "Can't jump: rewound or compacted out of the chat. ↻\u00a0reuses it."
// HUD colors (claudzilla/claude/hud/hud-filter.pl) the theme has no key for; latest, a lighter
// dirty yellow, is the panel's own.
const HUD = { label: '#a396d2', faint: '#4f5c68', idle: '#456186', action: '#5d9678', compacted: '#8c7850', dirty: '#8c7850', churn: '#6e8c6e', latest: '#a8995a' }
// Divider lines: their word's HUD color at 60%.
const DIM = { label: '#625a7e', action: '#385a48', compacted: '#544830' }
// A commit type (claude/rules/git.md's, plus perf) by what it does, one color each: feat adds (green),
// fix repairs (red), refactor reshapes (blue), perf speeds up (orange), docs (yellow), test (cyan),
// chore (the section labels' purple). Any other type stays gray.
const TYPES: Record<string, string> = { feat: '#98c379', fix: '#e06c75', refactor: '#61afef', perf: '#d19a66', docs: '#e5c07b', test: '#56b6c2', chore: HUD.label }
// A changed file's git status letter, one color each from TYPES' palette: modified (yellow), added
// (green), deleted or conflicted (red), renamed or copied (blue), untracked (cyan); any other gray.
const STATUS: Record<string, string> = { M: '#e5c07b', A: '#98c379', D: '#e06c75', U: '#e06c75', R: '#61afef', C: '#61afef', '?': '#56b6c2' }
// A local commit's scope: a light gray under the subject.
const SCOPE = '#808286'
// Ahead and behind: a pair of their own, used for nothing else. Cards and modals sit on CARD; a lit row on LIT.
const AHEAD = '#d4b860'
const BEHIND = '#b48ead'
const CARD = '#030507'
const LIT = '#0f1c28'
// A pushed commit's, or a staged file's: its color at 60%, as DIM's are.
// What sits behind an open modal, and the line next to a shown card: text, rules and borders in one dim colour,
// darker than HUD.faint, so a faint row never goes darker than a plain one (divider.tsx draws its rule in it too).
const DIMMED = '#3a424a'
// A faded background: each colour at half, as an opacity over the black pane; one with no hex to scale, a dark grey.
const FADED = '#555555'
// The active custom theme's colours by key (claude/themes/<name>.json), read once a session, so a theme key fades by
// its own hue. A built-in theme, or a key it leaves to its base, has none and fades to FADED.
// shortcut: a theme switched mid-session fades by the old one until a reload; read again on config.set if it matters.
let themeColors: Record<string, string> = {}
let themeRead: Promise<unknown> | undefined
const readTheme = ($: EngineInterface) =>
  (themeRead ??= (async () => {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value
    if (typeof theme !== 'string' || !theme.startsWith('custom:')) return
    themeColors = JSON.parse(String(await $.fs.read(`${await configDir($)}/themes/${theme.slice(7)}.json`))).overrides ?? {}
  })().catch(() => undefined))
const fade = (_color?: unknown) => DIMMED
// A pill's caps are Texts coloured as its background, so they halve with it.
const PILL_CAPS = new Set(['\ue0b6', '\ue0b4'])
const fadeBg = (color: unknown) => {
  const hex = typeof color === 'string' ? (/^#[0-9a-f]{6}$/i.test(color) ? color : themeColors[color]) : undefined
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)
    ? `#${hex.slice(1).replace(/../g, c => Math.round(parseInt(c, 16) * 0.5).toString(16).padStart(2, '0'))}`
    : FADED
}
// A drawn tree behind a modal, copied node by node: Text and Box colours faded, and Buttons swapped for a Text,
// so nothing there lights or presses. The node keyed `open` (the row that opened the modal) keeps its colours,
// on the lit row, and its Button only runs `close`; a node keyed in `keep` stays as drawn.
const fadeTree = (node: unknown, keep: Set<string>, close: () => unknown, open?: string, inverted = false): any => {
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
type Piece = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; hover?: object; under?: object }
const fadePieces = (pieces: Piece[]) =>
  pieces.map(x => ({ ...x, color: PILL_CAPS.has(x.text) ? fadeBg(x.color) : fade(x.color), ...(x.backgroundColor && { backgroundColor: fadeBg(x.backgroundColor) }) }))
// A row's Texts as a row Client's pieces, each with the styles it inherits.
const toPieces = (node: unknown, style: Omit<Piece, 'text'> = {}): Piece[] => {
  if (Array.isArray(node)) return node.flatMap(child => toPieces(child, style))
  if (typeof node === 'string' || typeof node === 'number') return node === '' ? [] : [{ ...style, text: String(node) }]
  if (!node || typeof node !== 'object' || !('type' in node)) return []
  const el = node as { type: string; props?: Record<string, any>; children?: unknown }
  const { color, backgroundColor, dimColor, bold } = el.type === 'Text' ? (el.props ?? {}) : {}
  const own = Object.fromEntries(Object.entries({ color, backgroundColor, dimColor, bold }).filter(([, v]) => v !== undefined))
  return toPieces(el.children ?? el.props?.children, { ...style, ...own })
}
const dim = (hex: string) => `#${hex.slice(1).replace(/../g, c => Math.round(parseInt(c, 16) * 0.6).toString(16).padStart(2, '0'))}`

const tab = atom({ plugin: 'margin', key: 'tab' } as const, 'Overview' as Tab)
// Content hooks flag tabs here.
const notices = atom({ plugin: 'margin', key: 'notices' } as const, [] as Tab[])
// Bumped per prompt so the History list redraws.
const submitted = atom({ plugin: 'margin', key: 'submitted' } as const, 0)
// Bumped per tool call so the Git tab redraws.
const toolCalls = atom({ plugin: 'margin', key: 'toolCalls' } as const, 0)
// As the row Clients posted: `left`, the top row the pointer last left, until a row is entered; `at`, the row it is on.
// The left row's card, and any card over the same rows, is not drawn: hover alone keeps a card lit under the pointer,
// and a hidden card under a resting pointer is revealed once the card over it goes. Every other card is drawn hidden,
// so hover reveals it with its row.
const rowPointer = atom({ plugin: 'margin', key: 'rowPointer' } as const, { left: null, at: null } as { left: string | null; at: string | null })
// Rows the Git tab's CHANGES zone takes, as the divider was dragged; -1 until it is.
const split = atom({ plugin: 'margin', key: 'split' } as const, -1)
// The first row each Git zone shows, as the wheel moved it.
const scrolled = atom({ plugin: 'margin', key: 'scrolled' } as const, { changes: 0, commits: 0 })
// The History list's, on a key of its own: a reload keeps what older code stored under `scrolled`.
const historyTop = atom({ plugin: 'margin', key: 'historyTop' } as const, 0)
// Rows the Overview's TOPICS take, as their divider was dragged; -1 until it is. Then the first topic shown.
const topicsSplit = atom({ plugin: 'margin', key: 'topicsSplit' } as const, -1)
const topicsTop = atom({ plugin: 'margin', key: 'topicsTop' } as const, 0)

const EMPTY_INTENT: Intent = { wants: '', plan: '', steps: [], at: 0, ended: false }
// Claude's last intent report.
const intent = atom({ plugin: 'margin', key: 'intent' } as const, EMPTY_INTENT)
// Agents the main loop started, kept past their end: no event says one finished, the list does.
const spawns = atom({ plugin: 'margin', key: 'spawns' } as const, [] as Spawn[])
// Bumped per user prompt: tells this turn's agents from earlier ones.
const turns = atom({ plugin: 'margin', key: 'turns' } as const, 0)
// What the File tab shows: the last one, the whole text.
const file = atom({ plugin: 'margin', key: 'file' } as const, undefined as FileView)
// The step whose agents all show, past the 3 each shows folded; -1 for none.
const expanded = atom({ plugin: 'margin', key: 'expanded' } as const, -1)
// The Git tab's open modal, or none; a top of -1 opens the branch modal on the current branch.
const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)
// While `git fetch origin` runs from the branch row.
const fetching = atom({ plugin: 'margin', key: 'fetching' } as const, false)
// While a rebase or merge action runs: a press in that time starts no second one.
let gitActing = false
let rerunning = false
// The branch modal's tree: by the branch each was made from, or by prefix; merged branches shown or not.
const branchView = atom({ plugin: 'margin', key: 'branchView' } as const, { by: 'base' as 'base' | 'prefix' | 'worktrees', showMerged: false })
// GitHub's PRs for this repo, read on a timer off the draw path; each PR's modal details once opened.
const gh = atom({ plugin: 'margin', key: 'gh' } as const, { at: 0, remote: '', prs: [] } as Gh)
const prViews = atom({ plugin: 'margin', key: 'prViews' } as const, {} as Record<number, PrView>)
// Each opened commit: its row as COMMITS drew it, so the modal outlives a scroll, and its body and files once read.
const commitViews = atom({ plugin: 'margin', key: 'commitViews' } as const, {} as Record<string, { row: LogRow; view?: CommitView }>)
// The agent whose transcript the main view shows, as the pane last drew: a press on its row goes back.
let viewing: string | undefined

const EMPTY_OVERVIEW: Overview = { topics: [], running: false }
// TOPICS: what this chat is about, read from its prompts alone.
const overview = atom({ plugin: 'margin', key: 'overview' } as const, EMPTY_OVERVIEW)

// Claude reports its own intent through this tool; the rule says when.
const INTENT_TOOL = 'mcp__margin__intent'
const INTENT_RULE = [
  'Intent reporting: the user watches a side panel showing your reading of their request and your plan.',
  `Call the \`${INTENT_TOOL}\` tool with wants, plan and steps at the start of every turn that answers a user prompt, as the first block of your message, before any other tool call in it.`,
  'Then ping it as {"now": n}, n the 1-based step, as the first block of the message that starts a new step, and only then, as a ping splits the chat\'s tool rows;',
  'send wants, plan and steps again only when your plan changes. Never call it alone just to mark the last step done:',
  'your answer closes it. Do not mention the tool in your reply. Write wants, plan and steps in the language the user writes in.',
  "When a step spawns agents, list each Agent call's description in that step's agents, exactly as you pass it, and keep listing them when you redraft.",
].join(' ')
// An answer closed every step; an interrupt left some open, for pings to pick back up.
const isAnswered = (now: Intent) => now.ended && now.steps.every(step => step.status === 'completed')
// Background agents Claude started: each one's result comes back as a task notification.
const runningAgents = async ($: EngineInterface) =>
  (await $.agent.list().catch(() => []))
    .filter(agent => agent.parentId === undefined && agent.spawnedBy === undefined && agent.teammateId === undefined && ['pending', 'running', 'waiting'].includes(agent.status))
// A plugin's agent is dropped once the list names its plugin; one the list lost keeps its last status.
const refreshSpawns = async ($: EngineInterface) => {
  const listed = new Map((await $.agent.list().catch(() => [])).map(agent => [agent.id, agent]))
  await update($, spawns, now =>
    now.flatMap(one => {
      const agent = listed.get(one.id)
      return !agent ? [one] : agent.spawnedBy !== undefined ? [] : [{ ...one, status: agent.status }]
    }),
  )
}
const INTENT_SPEC = {
  name: 'intent',
  // The rule rides here, not in prompt.compose: the sec-default guard skips a user mod's system prompt edits.
  description: `Report how you read the user request and your plan, for the side panel. Returns nothing useful. ${INTENT_RULE}`,
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      wants: { type: 'string', description: 'what the user wants, 1-2 lines; full report only' },
      plan: { type: 'string', description: 'your approach, 1-2 lines; full report only' },
      now: { type: 'integer', minimum: 1, description: 'progress ping: the 1-based step you are working on' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            status: { enum: ['pending', 'in_progress', 'completed'] },
            agents: { type: 'array', items: { type: 'string' }, description: "each Agent call's description for this step, exactly as passed" },
          },
          required: ['text', 'status'],
        },
      },
    },
  },
} as const
const OVERVIEW_ASK = [
  'These are the prompts a user sent in one coding-assistant chat, oldest first.',
  'Group them into topics: the pieces of work the chat covered, oldest first, the newest work last.',
  'Reply with only the topics, one per line, each starting "- ", at most 8 words.',
  'Write them in the language the user writes in.',
].join(' ')
// Regrouped from scratch, every read reworded every line; kept whole, broad topics swallowed new work
// and went stale. Earlier lines stay, the last one follows the newest prompts (replayed over past chats).
const OVERVIEW_KEEP = [
  'Topics are pieces of work, not one-off questions or tool checks.',
  'Current topics, shown to the user: keep every line but the last word for word, in order.',
  'The last is the current work: reword it to fit the newest prompts, or keep it and add a new last topic when they start a different piece of work:',
].join(' ')
// Bounds the reply on a long chat; replays merged cleanly at 10 and 20.
const OVERVIEW_CAP = 30
const OVERVIEW_TOKENS = 2000
// Exact counts: told only "at the limit", Opus sent 32 topics back unchanged.
const overviewMerge = (count: number) =>
  [
    'Topics are pieces of work, not one-off questions or tool checks.',
    `There are ${count} current topics, shown to the user; the reply must have at most ${OVERVIEW_CAP} lines,`,
    'so combine the most closely related topics into fewer lines, keep the newest few lines word for word, in order,',
    'and reword the last to fit the newest prompts or add a new last topic when they start a different piece of work:',
  ].join(' ')
// A reply replaces the list, so one that drops what the user saw is refused.
const keptTopics = (shown: string[], topics: string[], merging: boolean) =>
  merging
    ? topics.length <= OVERVIEW_CAP && shown.slice(-4, -1).every(topic => topics.includes(topic))
    : shown.slice(0, -1).every((topic, i) => topics[i] === topic)
export const parseTopics = (text: string) =>
  text
    .split('\n')
    .flatMap(line => /^\s*[-•*]\s+(.+)$/.exec(line)?.[1]?.trim() ?? [])
// A newer run's seq drops an older answer; stale marks a read the hidden tab still owes, as on load.
let overviewSeq = 0
let overviewStale = true
const overviewShown = async ($: EngineInterface) =>
  (await read($, tab)) === 'Overview' && (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
// Reads only while the tab shows, so its cost follows use.
const readOverview = async ($: EngineInterface) => {
  overviewStale = true
  if (!(await overviewShown($).catch(() => false))) return
  overviewStale = false
  const seq = ++overviewSeq
  // Newest first from history; a paste can be long, its head says enough.
  const prompts = (await pastPrompts($)).filter(prompt => !isCommand(prompt)).slice(0, MAX_PROMPTS).reverse()
  if (!prompts.length) return
  await update($, overview, now => ({ ...now, running: true }))
  try {
    const { topics: shown } = await read($, overview)
    const merging = shown.length >= OVERVIEW_CAP
    const keep = shown.length ? `\n${merging ? overviewMerge(shown.length) : OVERVIEW_KEEP}\n${shown.map(topic => `- ${topic}`).join('\n')}` : ''
    const prompt = `${OVERVIEW_ASK}${keep}\n\nPrompts:\n${prompts.map(one => `- ${flat(one.display).slice(0, 300)}`).join('\n')}`
    const reply = await $.model.complete({ model: 'opus', prompt, effort: 'low', maxTokens: OVERVIEW_TOKENS, timeoutMs: 20_000 })
    if (seq !== overviewSeq) {
      t.event('overview.read', { dropped: 'newer read started' }, 'debug')
      return
    }
    const topics = reply.isAnswered ? parseTopics(reply.text) : []
    // A cut reply loses its last lines, the current topic among them.
    const failed = !reply.isAnswered
      ? reply.reason
      : !topics.length
        ? 'unreadable'
        : reply.usage.output_tokens >= OVERVIEW_TOKENS
          ? 'cut short'
          : keptTopics(shown, topics, merging)
            ? undefined
            : 'dropped topics'
    t.event('overview.read', { prompts: prompts.length, topics: topics.length, failed })
    await update($, overview, now => (failed ? { ...now, running: false, failed } : { topics, running: false }))
  } catch (err) {
    t.error('overview.read', err)
    // complete rejects on a request the engine refuses to send (a blocked model).
    if (seq === overviewSeq) await update($, overview, now => ({ ...now, running: false, failed: 'error' }))
  }
}

// `typed`: history's own text, set when a paste placeholder in it was swapped for the paste.
export type Prompt = { display: string; timestamp: number; typed?: string }

// Claude Code's own folder: CLAUDE_CONFIG_DIR moves it.
const configDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`

const PASTE = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g
// A pasted "/x" is sent as a prompt; only a typed one runs. A path ("/home/…") is a prompt too.
const isCommand = (prompt: Prompt) => /^\/[\w:-]+(\s|$)/.test(prompt.typed ?? prompt.display)
// A ! shell command is "!cmd" in history, wrapped in bash-input tags in the chat.
const shell = (text: string) => text.replace(/^<bash-input>([\s\S]*)<\/bash-input>$/, '!$1')

// History keeps a long paste as a placeholder, its text inline or, longer still, in paste-cache.
const unpaste = async ($: EngineInterface, dir: string, row: any): Promise<string> => {
  let text: string = row.display
  for (const [tag, id] of row.display.matchAll(PASTE)) {
    const paste = row.pastedContents?.[id]
    const body =
      paste?.content ??
      (paste?.contentHash
        ? await $.fs.read(`${dir}/paste-cache/${paste.contentHash}.txt`).then(String, () => undefined)
        : undefined)
    if (typeof body === 'string') text = text.replace(tag, () => body)
  }
  return text
}

// This chat's prompts from Claude Code's prompt history, keyed by session id:
// the session's cwd follows a shell `cd`, so a folder match drifts.
// grep takes only this chat's lines, as the history of every chat outgrows what $.fs.read takes
// (4 MiB); read whole where no process runs (desktop).
// -a: a crash can leave NUL bytes, and grep then takes the file for binary and prints no line.
const pastPrompts = async ($: EngineInterface): Promise<Prompt[]> => {
  const [dir, sessionId] = await Promise.all([configDir($), $.session.id()])
  const path = `${dir}/history.jsonl`
  let text: string
  try {
    text = (await $.process.run(['grep', '-a', '-F', '--', `"sessionId":"${sessionId}"`, path])).stdout
  } catch {
    try {
      text = String(await $.fs.read(path))
    } catch {
      return []
    }
  }
  const prompts: Prompt[] = []
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line)
      // /quit, /exit, /resume and /clear only leave this chat, /rewind only opens its picker, /margin
      // only toggles this pane.
      if (row.sessionId === sessionId && typeof row.display === 'string' && !/^\/(quit|exit|resume|clear|rewind|margin)\b/.test(row.display)) {
        const display = await unpaste($, dir, row)
        const typed = display === row.display ? {} : { typed: row.display }
        prompts.push({ display, timestamp: Number(row.timestamp), ...typed })
      }
    } catch {
      // blank or partly written line
    }
  }

  return prompts.reverse()
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayName = (day: Date) => `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`
// By local calendar day: "Today", else "Sat 10 Oct".
export const dayLabel = (ms: number, now: Date) =>
  new Date(ms).toDateString() === now.toDateString() ? 'Today' : dayName(new Date(ms))
// The chat wraps a paste in <pasted_content> tags; history keeps it bare. A control character (a
// pasted escape sequence) would get the whole pane refused, so it reads as a space.
const flat = (text: string) =>
  text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/[\s\x00-\x1f\x7f]+/g, ' ')
    .trim()

// A prompt typed while a turn runs reaches the chat as a queued note, never a user message, so
// it is remembered here per session: one key each, for the newest MID_TURN_SESSIONS sessions, as
// the store caps at 4 MiB.
const MID_TURN_SESSIONS = 50
// How the engine tells the model of a note, right before its text.
const MID_TURN_SAYS = 'user sent a new message while you were working:\n'
const midTurnKey = async ($: EngineInterface) => `midTurn:${await $.session.id()}`
const midTurn = async ($: EngineInterface) => {
  const kept = await $.store.get(await midTurnKey($)).catch(() => undefined)
  return Array.isArray(kept) ? kept.filter((text): text is string => typeof text === 'string') : []
}

// Which prompts (newest first) are still matched by `texts`, a repeated prompt's newest copies first.
const found = (prompts: Prompt[], texts: string[]) => {
  const left = new Map<string, number>()
  for (const text of texts) left.set(flat(text), (left.get(flat(text)) ?? 0) + 1)
  return prompts.map(prompt => {
    const n = left.get(flat(prompt.display)) ?? 0
    if (n) left.set(flat(prompt.display), n - 1)
    return n > 0
  })
}

// $.session.messages reads at most the newest 4096 entries.
const READ_MAX = 4096

// Which prompts (newest first) are still in the chat, with a marker opening each run of gone ones:
// a run reaching the oldest was compacted away if the chat ever was (`compacted`), else rewound like
// any other (an Esc-cancel looks the same). A compacted prompt the chat still shows stays live, the
// marker on the first the model lost. A capped read (the newest READ_MAX entries) says nothing of prompts
// older than it holds.
export const gone = (
  prompts: Prompt[],
  chat: string[],
  model: string[],
  notes: string[] = [],
  capped = { chat: false, model: false },
  compacted = true,
): { isLive: boolean; marker?: 'Rewound' | 'Compacted' }[] => {
  // A slash command is never in the chat as typed, nor a paste whose text paste-cache dropped,
  // so each takes the state of the run around it.
  const real = prompts.map(prompt => !isCommand(prompt) && !/\[Pasted text #\d+/.test(prompt.display))
  // A stored mid-turn note is never a chat message: it counts while a prompt sent before it does,
  // which a reload after a compaction drops along with it.
  const oldest = found(prompts, chat).lastIndexOf(true)
  // A /rewind drops the note from what the model is sent, never from the store: with that read whole
  // and no compaction, a note counts only while the model still holds it.
  // shortcut: matches the engine's mid-turn wording; if it changes, mid-turn prompts show dim. Upgrade
  // to a mod API field for mid-turn messages if one ships.
  const isModelWhole = model.length > 0 && !capped.model && !compacted
  const kept = notes.filter(note => {
    const at = prompts.findIndex(prompt => flat(prompt.display) === flat(note))
    return at >= 0 && at < oldest && (!isModelWhole || model.some(text => text.includes(`${MID_TURN_SAYS}${note}\n\n`)))
  })
  const inChat = found(prompts, chat.concat(kept)).map((hit, i) => hit && real[i])
  const inModel = found(prompts, model).map((hit, i) => hit && real[i])
  // An empty read failed; a chat reloaded after a compaction holds no prompt until one is typed.
  if (!chat.length) return prompts.map(() => ({ isLive: true }))
  // Compaction drops the oldest part, so only prompts older than any the model sees count; a model
  // holding none (right after /compact) lost them all.
  const seen = inModel.lastIndexOf(true)
  const cut = model.length && !capped.model ? inChat.findIndex((hit, i) => i > seen && hit && !inModel[i]) : -1
  let isOpen = false
  const rows = prompts.map((_, i): { isLive: boolean; marker?: 'Rewound' | 'Compacted' } => {
    if (capped.chat && i > oldest) return { isLive: true }
    if (!real[i]) {
      const older = inChat.findIndex((_, j) => j > i && real[j])
      return { isLive: !(isOpen && (older < 0 || !inChat[older])) }
    }
    if (inChat[i]) {
      isOpen = false
      return i === cut ? { isLive: true, marker: 'Compacted' } : { isLive: true }
    }
    if (isOpen) return { isLive: false }
    isOpen = true
    return { isLive: false, marker: !compacted || inChat.slice(i).some(Boolean) ? 'Rewound' : 'Compacted' }
  })
  // Only the newest compaction is marked, right under the /compact that ran it when one sits above.
  let at = rows.findIndex(row => row.marker === 'Compacted')
  for (let i = at - 1; at > 0 && i >= 0 && !real[i]; i--)
    if (/^\/compact\b/.test(prompts[i]!.typed ?? prompts[i]!.display)) at = i + 1
  return rows.map(({ marker, ...row }, i) =>
    i === at ? { ...row, marker: 'Compacted' } : marker === 'Rewound' ? { ...row, marker } : row,
  )
}
// Each host's commit and branch page paths, as its router writes them (Codeberg's: Gitea's). A host not
// listed gets no links: a guessed path would open a wrong page.
const WEB_PATHS: Record<string, { commit: string; branch: string }> = {
  'github.com': { commit: 'commit', branch: 'tree' },
  'gitlab.com': { commit: '-/commit', branch: '-/tree' },
  'codeberg.org': { commit: 'commit', branch: 'src/branch' },
  'git.sr.ht': { commit: 'commit', branch: 'tree' },
}
// A remote's web pages: "git@github.com:o/r.git", "https://user@host/o/r", "ssh://git@host:22/o/r".
export const gitWeb = (remote: string) => {
  const url = remote.trim()
  const [, host = '', path = ''] =
    /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url) ?? /^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/.exec(url) ?? []
  const paths = WEB_PATHS[host.toLowerCase()]
  if (!paths) return undefined
  const base = `https://${host.toLowerCase()}/${path}`
  return {
    commit: (sha: string) => `${base}/${paths.commit}/${sha}`,
    // Slashes kept: "release/1.5" is one branch.
    branch: (name: string) => `${base}/${paths.branch}/${name.split('/').map(encodeURIComponent).join('/')}`,
  }
}
// The History tab's reads, and which prompts they leave live.
const readHistory = async ($: EngineInterface) => {
  const all = await pastPrompts($)
  const prompts = all.slice(0, MAX_PROMPTS)
  // A failed read marks nothing (see gone) instead of blanking the tab.
  const queued = await midTurn($)
  const chatRead = await $.session.messages().catch(() => [])
  const sent = chatRead
    .filter(message => message.role === 'user' && !message.toolResults?.length && message.text)
    .map(message => shell(message.text))
  // A mid-turn prompt is never a chat message, nor most slash commands (/compact is): reachable
  // once drawn. One sent as a turn ended landed as a normal message instead.
  const landed = new Set(sent.map(flat))
  const drawnOnly = new Set(queued.map(flat).filter(text => !landed.has(text)))
  const commands = new Set(sent.flatMap(text => typedCommand(text) ?? []))
  // What the model is sent: the last compaction's summary in place of what it replaced.
  // Each text block alone, as reminders ride in the same message; of tool results only those a
  // mid-turn note rides in, as any other could read as a prompt.
  const modelRead = await $.session.messages({ as: 'api' }).catch(() => [])
  const model = modelRead
    .filter(message => message.role === 'user')
    .flatMap(message =>
      message.content.flatMap(block =>
        typeof block.text === 'string'
          ? [shell(block.text)]
          : typeof block.content === 'string' && block.content.includes(MID_TURN_SAYS)
            ? [block.content]
            : [],
      ),
    )
  const capped = { chat: chatRead.length >= READ_MAX, model: modelRead.length >= READ_MAX }
  // A compaction leaves a compact_boundary row in the chat's file; grep exits 1 on none. A failed
  // read counts as compacted.
  const boundary = await chatPath($)
    .then(path => $.process.run(['grep', '-a', '-F', '-q', '--', '"subtype":"compact_boundary"', path]))
    .catch(() => undefined)
  return { all, prompts, drawnOnly, commands, rows: gone(prompts, sent, model, queued, capped, boundary?.exitCode !== 1) }
}
// Kept for up to READ_TTL, or until a prompt is sent: a chat scroll redraws the pane many times a
// second, and every read grows with the chat.
const READ_TTL = 1000
let historyRead: { key: string; at: number; reads: ReturnType<typeof readHistory> } | undefined

// The Git tab's reads, in the session's folder, which follows a shell `cd`. No optional locks: a
// status run beside the model's own git command must not hold index.lock.
const readGit = ($: EngineInterface) =>
  Promise.all([
    // quotePath off: a non-ASCII path reads as itself, not octal escapes.
    // Untracked folders file by file: each row opens a file.
    $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain', '-b', '-z', '--untracked-files=all']).catch(() => undefined),
    // Staged and unstaged lines together, a rename under its new name.
    $.process.run(['git', '--no-optional-locks', 'diff', 'HEAD', '--numstat', '-z', '-M']).catch(() => undefined),
    // Local only: commits no remote has.
    $.process.run(['git', 'rev-list', 'HEAD', '--not', '--remotes']).catch(() => undefined),
    $.process.run(['git', 'rev-list', '--count', 'HEAD']).catch(() => undefined),
    $.process.run(['git', 'remote', 'get-url', 'origin']).catch(() => undefined),
    // The git dir's files, and the shared one's in a linked worktree: the newer FETCH_HEAD is the last fetch.
    $.process
      .run(['git', 'rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', '--show-toplevel'])
      .then(async run => {
        if (run.exitCode) return undefined
        // No top level in the answer: the files sit beside .git.
        const [dir = '', common = dir, root = dir.replace(/\/\.git(\/.*)?$/, '')] = run.stdout.trim().split('\n')
        const [files, shared] = await Promise.all([dir, common].map(one => $.fs.list(one).catch(() => [])))
        const fetched = [...files!, ...(common === dir ? [] : shared!)].filter(one => one.name === 'FETCH_HEAD').map(one => one.mtimeMs)
        return { dir, root, files: files!, fetchedAt: fetched.length ? Math.max(...fetched) : undefined }
      })
      .catch(() => undefined),
    $.process.run(['git', 'stash', 'list', '--format=%gs']).catch(() => undefined),
    $.process.run(['git', 'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)']).catch(() => undefined),
    $.process.run(['git', 'worktree', 'list', '--porcelain']).catch(() => undefined),
  ])
// Kept until a tool call or a prompt may have changed the repo, or the tab is picked again: a chat
// scroll or a drag redraws the pane many times a second. `signal`: the draw that started the runs.
let gitRead: { key: string; signal: AbortSignal; runs: ReturnType<typeof readGit> } | undefined
// One page of COMMITS from its first, with a page more: a window of up to PAGE rows starting in the
// page fits whole. Kept as gitRead is, per page.
const readLog = ($: EngineInterface, page: number) =>
  $.process.run(['git', 'log', '--decorate=full', `--skip=${page * PAGE}`, `-${2 * PAGE}`, `--format=${LOG_FORMAT}`]).catch(() => undefined)
let logRead: { key: string; signal: AbortSignal; run: ReturnType<typeof readLog> } | undefined
// The commit card's file and line counts, per commit, read for the rows drawn only: a commit's never change.
// A merge counts against its first parent.
type Stat = { files: number; add: number; del: number }
const stats = new Map<string, Stat>()
const readStats = async ($: EngineInterface, shas: string[]) => {
  const missing = shas.filter(sha => !stats.has(sha))
  if (missing.length) {
    const run = await $.process.run(['git', 'log', '--no-walk', '--shortstat', '--diff-merges=first-parent', '--format=%x1e%H', ...missing]).catch(() => undefined)
    if (run?.exitCode === 0) for (const [sha, one] of parseShortstat(run.stdout)) stats.set(sha, one)
  }
  return stats
}
// Untracked files' line counts, as `wc -l -c` gives them: only the rows drawn, and none for a file over 1 MiB.
const WC_MAX = 1 << 20
let wcRead: { key: string; run: Promise<Map<string, Counts>> } | undefined
// find picks regular files up to 1 MiB before wc reads any: a huge file or a link to a device is never read.
const readWc = ($: EngineInterface, root: string, paths: string[]) =>
  $.process
    .run(['find', ...paths.map(path => `${root}/${path}`), '-maxdepth', '0', '-type', 'f', '-size', `-${WC_MAX / 1024 + 1}k`, '-exec', 'wc', '-l', '-c', '--', '{}', '+'])
    .then(run => {
      const out = new Map<string, Counts>()
      for (const line of run.stdout.split('\n')) {
        // Full paths only: wc's own "total" line names none.
        const [, lines, path] = /^\s*(\d+)\s+\d+\s+(.*)$/.exec(line) ?? []
        if (path?.startsWith(`${root}/`) && paths.includes(path.slice(root.length + 1))) out.set(path.slice(root.length + 1), { add: Number(lines), del: 0 })
      }
      return out
    })
    .catch(() => new Map<string, Counts>())
// The Git tab as last drawn: rows above `commitsAt` scroll CHANGES, the rest COMMITS, each up to its
// last offset. Unset while another tab shows: the engine scrolls that one. `divider`: CHANGES' rows as drawn and
// the rows a drag can give it; the divider is row `commitsAt`.
let gitZones: { commitsAt: number; changes: number; commits: number; divider: Split } | undefined
type Split = { rows: number; min: number; max: number }
// The divider the last notch moved, with its pointer row and time: it moves off the pointer, so notches on that
// row less than WHEEL_HOLD ms apart keep moving it.
let wheeling: { zone: 'git' | 'topics'; row: number; at: number } | undefined
const WHEEL_HOLD = 1000
// A stored split moved by `by` rows, from the rows drawn while it is unset, kept to the drawn bounds.
const nudge = (stored: number, { rows, min, max }: Split, by: number) =>
  Math.max(min, Math.min((stored >= 0 ? Math.max(min, Math.min(stored, max)) : rows) + by, max))
// The open modal's layers as last drawn, in tab-body cells: the wheel scrolls the top layer when over it.
type Layer = { frame: Frame; top: number; end: number }
let modalZone: { m: Layer; s?: Layer } | undefined
// What a press on each top row's Client does, as the last Git tab draw set it.
let rowActs: Record<string, () => unknown> = {}
// What a click on each back-to-top line does, as the last draw set it.
const topActs: Record<string, () => unknown> = {}
// The tab rows each top row's card spans, from its top to its end, and each top row's own, as the last Git tab draw set them.
let cardSpan: Record<string, [number, number]> = {}
let rowLines: Record<string, number> = {}
// A row's leave, held LEAVE_HOLD ms: a move onto the next row posts its enter just after, and a draw between the two
// drops the cards under the left row's card for a frame. An enter in time takes it in; else it lands alone.
const LEAVE_HOLD = 30
let leaving: { row: string; n: number } | undefined
let leaves = 0
// The branch modal's own read, kept as gitRead is: the default branch.
let branchRead: { key: string; signal: AbortSignal; run: Promise<{ exitCode: number; stdout: string } | undefined> } | undefined
// Each other linked worktree's count of uncommitted files, by path, kept as gitRead is; read only while the worktrees view
// shows, as a status per worktree would hold back every draw.
let treeRead: { key: string; signal: AbortSignal } | undefined
// Each linked worktree's uncommitted files, null when its status failed.
const treeStatus = new Map<string, number | null>()
// The shown PR's local reads, kept per repo change and base: behind and ahead of the base, conflicting files.
let prRead: { key: string; signal: AbortSignal; run: Promise<({ stdout: string } | undefined)[]> } | undefined
// The rebase or merge in progress, kept as gitRead is.
let opRead: { key: string; signal: AbortSignal; run: Promise<Op | undefined> } | undefined
// Whether install.sh chose basic glyphs: read once a session.
let basicGlyphs: Promise<boolean> | undefined
// The History list's last offset as last drawn; unset as gitZones is.
let historyEnd: number | undefined
// The Overview's TOPICS as last drawn, with a report under them: rows `from` to `to` of the tree, up to
// offset `end`; `offset`, the engine's window then, as a pointer's row counts from it.
// Its divider is row `to`.
let topicsZone: { from: number; to: number; end: number; offset: number; divider: Split } | undefined
// The last offset of a zone `rows` tall over `n` rows: one more as, once scrolled, the back-to-top line
// takes a row, unless it would be the zone's only one.
const zoneEnd = (n: number, rows: number) => (n > rows ? n - rows + (rows > 1 ? 1 : 0) : 0)
// Counts UTF-16 units, not cells: a wide glyph (CJK, emoji) can still overflow by one.
// A commit row's key: hover scopes take at most 64 characters, so a SHA-256 id goes by its first 40.
const commitKey = (sha: string) => `c:${sha.slice(0, 40)}`
const fit = (text: string, room: number) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)

// The chat's own file holds every prompt's message id, drawn or not; searched with grep, as it
// outgrows what $.fs.read takes whole. A repeated prompt resolves to the copy sent nearest the
// history entry's time.
// Found by session id, not rebuilt from the root: Claude Code cuts a long root's folder name and
// hashes it, and /cd or a worktree move changes the root. Kept once found.
const chatPaths = new Map<string, string>()
const chatPath = async ($: EngineInterface) => {
  const [dir, sessionId] = await Promise.all([configDir($), $.session.id()])
  if (!chatPaths.has(sessionId)) {
    const { stdout } = await $.process.run(['find', `${dir}/projects`, '-maxdepth', '2', '-name', `${sessionId}.jsonl`])
    const path = stdout.split('\n')[0]
    if (path) chatPaths.set(sessionId, path)
  }
  return chatPaths.get(sessionId) ?? ''
}
// -a: as in pastPrompts.
const transcriptId = async ($: EngineInterface, prompt: Prompt) => {
  try {
    const path = await chatPath($)
    if (isCommand(prompt)) {
      // -A1: the output line follows its command's row.
      const name = `<command-name>${prompt.display.split(/\s/, 1)[0]}</command-name>`
      const { stdout } = await $.process.run(['grep', '-a', '-F', '-A1', '--', name, path])
      return nearestCommandId(stdout, prompt)
    }
    const patterns = needles(prompt.typed ?? prompt.display).flatMap(text => ['-e', text])
    const { stdout } = await $.process.run(['grep', '-a', '-F', ...patterns, '--', path])
    return nearestId(stdout, prompt)
  } catch {
    return undefined
  }
}

// How a prompt's row in the chat file opens, JSON-escaped: its first line up to any paste, as the
// chat wraps a paste in tags; one opening with a paste, by that tag. A prompt sent with an image
// opens a text block.
export const needles = (typed: string) => {
  const first = typed.split(/\n|\[Pasted text #/)[0]
  const head = JSON.stringify(first?.startsWith('!') ? `<bash-input>${first.slice(1)}` : first || '\n\n<pasted_content id=').slice(0, -1)
  return [`"content":${head}`, `"text":${head}`]
}

// A prompt's text: the content itself, or the text blocks beside an image; a tool result is none.
const promptText = (content: unknown) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || !content.length || content.some(block => !['text', 'image'].includes(block?.type))) return
  return content.flatMap(block => (block.type === 'text' ? [String(block.text)] : [])).join('\n')
}

// The ids the chat file's last rows may be drawn under, newest first: a line's tool calls and
// results (a tool row's), then its own (a message row's).
export const lastRowIds = (tail: string) => [
  ...new Set(
    tail
      .split('\n')
      .reverse()
      .flatMap(line => {
        try {
          const row = JSON.parse(line)
          const blocks: { id?: unknown; tool_use_id?: unknown }[] = Array.isArray(row.message?.content) ? row.message.content : []
          return [...blocks.map(block => block.id ?? block.tool_use_id).reverse(), row.uuid].filter((id): id is string => typeof id === 'string')
        } catch {
          // blank or partly written line
          return []
        }
      }),
  ),
]
export const nearestId = (text: string, prompt: Prompt) => {
  let best: { id: string; gap: number } | undefined
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line)
      const text = promptText(row.message?.content)
      if (row.type !== 'user' || text === undefined || flat(shell(text)) !== flat(prompt.display)) continue
      const gap = Math.abs(Date.parse(row.timestamp) - prompt.timestamp)
      if (!best || gap < best.gap) best = { id: row.uuid, gap }
    } catch {
      // blank or partly written line
    }
  }

  return best?.id
}

// A slash command is stored as its own row, then its output line's, which is the row the chat
// draws; a repeated command resolves to the run nearest the history entry's time.
// A command row's "/name args", flattened; undefined for any other text.
const typedCommand = (text: string) => {
  const name = /<command-name>(.*?)<\/command-name>/.exec(text)?.[1]
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? ''
  return name ? flat(`${name} ${args}`) : undefined
}

export const nearestCommandId = (text: string, prompt: Prompt) => {
  const rows = text.split('\n').flatMap(line => {
    try {
      return [JSON.parse(line)]
    } catch {
      return [] // blank, partly written, or grep's -- separator
    }
  })
  let best: { id: string; gap: number } | undefined
  for (const row of rows) {
    const content = row.content ?? row.message?.content
    if (typeof content !== 'string') continue
    if (typedCommand(content) !== flat(prompt.display)) continue
    const output = rows.find(next => next.parentUuid === row.uuid)
    const gap = Math.abs(Date.parse(row.timestamp) - prompt.timestamp)
    if (output && (!best || gap < best.gap)) best = { id: output.uuid, gap }
  }

  return best?.id
}

// Transcript row ids by prompt text, learned as rows draw (a render hook may not write $.state).
// Empty after a reload until rows redraw; a repeated prompt maps to the row drawn last.
const rowIds = new Map<string, string>()
// Redraws within 100 ms, once however many rows moved or drew meanwhile. It redraws every chat row
// this plugin hooks too, which is what makes the rows that did not move say where they are again
// (see FRESH). Due by the clock, not a flag: a timer dropped with the draw that set it holds off
// nothing past its 100 ms.
let due = -Infinity
const redrawSoon = async ($: EngineInterface) => {
  const at = await $.clock.now().catch(() => undefined)
  if (at === undefined || at < due) return
  due = at + 100
  $.clock.after(100, () => idle().then(() => $.ui.invalidate('ui.render')))
}
// Each draw finishes only after the one started before it: once an older draw finished after a
// newer one, the terminal dropped every click on the pane until the next redraw. A draw that never
// settled would hold back the ones after it.
let lastDraw: Promise<unknown> = Promise.resolve()
export const ordered = <T,>(draw: () => Promise<T>) => {
  const before = lastDraw
  const result = draw().finally(() => before)
  lastDraw = result.catch(err => {
    t.error('pane.draw.rejected', err)
    return undefined
  })
  return result
}
// Settles once no pane draw runs: a redraw started during one drops it, and the reads it awaits.
const idle = async () => {
  for (let draw = lastDraw; ; draw = lastDraw) {
    await draw
    if (draw === lastDraw) return
  }
}
// Every PR of this repo in one gh call, off the draw path: with checks it takes seconds. A failed call (no gh,
// logged out, no GitHub remote) keeps what was read before.
const GH_FIELDS = 'number,title,state,isDraft,headRefName,baseRefName,isCrossRepository,author,createdAt,mergedAt,closedAt,additions,deletions,changedFiles,mergeable,statusCheckRollup,url'
// Kept with the origin it came from: after a shell cd into another repo, the draw shows none of it.
const readGh = async ($: EngineInterface) => {
  const [run, origin] = await Promise.all([
    $.process.run(['gh', 'pr', 'list', '--state', 'all', '--limit', '50', '--json', GH_FIELDS]).catch(() => undefined),
    $.process.run(['git', 'remote', 'get-url', 'origin']).catch(() => undefined),
  ])
  const remote = origin?.exitCode === 0 ? origin.stdout.trim() : ''
  if (run?.exitCode !== 0) return
  // Written only when it changed: each write draws the pane, and a tab press's second draw drops the next click.
  const prs = parsePrs(run.stdout)
  const was = await read($, gh)
  if (was.remote === remote && JSON.stringify(prs) === JSON.stringify(was.prs)) return
  const at = await $.clock.now()
  await update($, gh, () => ({ at, remote, prs }))
}
// One commit's body and files, read each time its modal opens. A merge lists its files against its first parent.
const readCommitView = async ($: EngineInterface, sha: string) => {
  const show = (...argv: string[]) => $.process.run(['git', 'show', ...argv, sha]).then(run => (run.exitCode === 0 ? run.stdout : undefined), () => undefined)
  const [message, nameStatus, numstat] = await Promise.all([
    show('-s', '--format=%B'),
    show('--format=', '--name-status', '-z', '-M', '--diff-merges=first-parent'),
    show('--format=', '--numstat', '-z', '-M', '--diff-merges=first-parent'),
  ])
  if (message === undefined) return
  const view = parseCommitView(message, nameStatus ?? '', numstat ?? '')
  await update($, commitViews, all => (all[sha] ? { ...all, [sha]: { ...all[sha], view } } : all))
}
// One PR's description, commits and files, read when its modal opens; with a failed check's job, its last log lines.
const readPrView = async ($: EngineInterface, n: number, failed?: { name: string; job: string }) => {
  const [run, log] = await Promise.all([
    $.process.run(['gh', 'pr', 'view', String(n), '--json', 'body,commits,files']).catch(() => undefined),
    failed ? $.process.run(['gh', 'run', 'view', '--job', failed.job, '--log-failed']).catch(() => undefined) : undefined,
  ])
  const view = run?.exitCode === 0 ? parsePrView(run.stdout) : undefined
  if (!view) return
  // Each line: job, step, then a timestamp before the text.
  const lines = (log?.exitCode === 0 ? log.stdout.split('\n') : [])
    .filter(line => line.trim())
    .slice(-3)
    .map(line => printable(line.split('\t').at(-1)!.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[\d;]*[A-Za-z]/g, '')))
  await update($, prViews, all => ({ ...all, [n]: { ...view, ...(failed && lines.length && { log: { check: failed.name, lines } }) } }))
}
// Reruns each failed run of a PR's checks, then reads the PR list again.
const rerunFailed = async ($: EngineInterface, runs: string[]) => {
  if (rerunning) return
  rerunning = true
  try {
    let started = true
    for (const id of runs) {
      const run = await $.process.run(['gh', 'run', 'rerun', id, '--failed']).catch(() => undefined)
      if (run?.exitCode !== 0) {
        started = false
        $.ui.toast(`gh run rerun failed: ${(run?.stderr ?? '').split('\n')[0]}`)
      }
    }
    if (started) $.ui.toast('Rerun started')
    await readGh($)
  } finally {
    rerunning = false
  }
}
// A rebase or merge in progress, from the git dir's files; none otherwise.
const readOp = async ($: EngineInterface, dir: string, names: string[], branch: string): Promise<Op | undefined> => {
  const rebasing = names.includes('rebase-merge')
  // A cherry-pick or revert stops as a merge does, on one commit.
  const verb = names.includes('CHERRY_PICK_HEAD') ? 'cherry-pick' : names.includes('REVERT_HEAD') ? 'revert' : undefined
  if (!rebasing && !verb && !names.includes('MERGE_HEAD')) return undefined
  const file = (name: string) => $.fs.read(`${dir}/${name}`).then(String, () => '')
  const git = (...argv: string[]) => $.process.run(['git', ...argv]).then(run => run.stdout, () => '')
  const [numstat, cached, unmerged] = await Promise.all([git('diff', '--numstat'), git('diff', '--cached', '--numstat'), git('diff', '--name-only', '--diff-filter=U')])
  if (rebasing) {
    const [headName, onto, done, todo] = await Promise.all(['head-name', 'onto', 'done', 'git-rebase-todo'].map(name => file(`rebase-merge/${name}`)))
    const op = parseRebase({ headName, onto, done, todo, numstat, cached, unmerged })
    // The base by name: a local branch at onto first, else a remote one, else its short id.
    const at = (await git('branch', '-a', '--points-at', op.onto, '--format=%(refname:short)')).split('\n').filter(name => name && !name.startsWith('('))
    return { ...op, onto: at.find(name => !name.startsWith('origin/')) ?? at[0] ?? op.onto.slice(0, 7) }
  }
  const at = verb === 'cherry-pick' ? 'CHERRY_PICK_HEAD' : verb === 'revert' ? 'REVERT_HEAD' : 'MERGE_HEAD'
  const [msg, sha, log] = await Promise.all([file('MERGE_MSG'), file(at), git('log', '--format=%h%x09%s%x09%ct', ...(verb ? ['-1', at] : ['HEAD..MERGE_HEAD']))])
  const op = parseMerge({ msg, sha, log, numstat, cached, unmerged, head: branch })
  return verb ? { ...op, verb, from: op.sha } : op
}
const pick = async ($: EngineInterface, next: Tab) => {
  if (next !== 'Git' && (await read($, modal))) await setModal($, () => null)
  // Picking Git reads the repo afresh: it may have changed outside this chat.
  if (next === 'Git') gitRead = logRead = undefined
  await update($, tab, () => next)
  if (next === 'Overview' && overviewStale && (await isPlaced($))) $.clock.after(0, () => readOverview($))
  // Each write draws the pane; a second draw could land before the first, and the terminal
  // then dropped the next click.
  if ((await read($, notices)).includes(next)) await update($, notices, list => list.filter(one => one !== next))
  if (next === 'Git') await readGh($)
}
const tabCommand = (name: string) => `margin-${name.toLowerCase()}`
// A pane waiting for room is not shown: the person's open places it.
const isPlaced = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
const closePane = ($: EngineInterface) => $.ui.close({ id: PANE })
// The pane's open arguments. While a Git modal is open the pane takes Escape as a close, which ui.close turns
// into closing the modal: the engine reports Escape and the pane's close mark alike.
const paneArgs = async ($: EngineInterface) => ({ id: PANE, title: 'Margin', columns: 40, ...((await read($, modal)) && { closeOnEscape: true as const }) })
// Every open and close of a Git modal goes here, so Escape follows it; an open pane gets the new arguments.
const setModal = async ($: EngineInterface, change: (m: Modal | null) => Modal | null) => {
  const was = !!(await read($, modal))
  const now = !!(await update($, modal, change))
  if (was === now || !(await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE)) return
  await $.ui.open(await paneArgs($)).catch(() => undefined)
}
const openPane = async ($: EngineInterface) => {
  await $.store.set('open', true).catch(() => undefined)
  const opened = await $.ui.open(await paneArgs($))
  // No output text: a key toggles often, and a chat row per toggle is noise.
  if (!opened.isPlaced) $.ui.toast('Margin waits: terminal too narrow.')
  // Reopened on Overview: read what the closed pane missed.
  else if (overviewStale) $.clock.after(0, () => readOverview($))
}
// Rows the panel shows dim until they draw, as only a drawn row can be jumped to: drawing one
// redraws the panel.
const awaited = new Set<string>()
const learn = ($: EngineInterface, key: string, requestId: string) => {
  rowIds.set(key, requestId)
  if (awaited.delete(key)) redrawSoon($)
}

// Chat rows on screen, by id: where on screen, what the chat file knows them by (a tool group by its
// first call), and when they last reported. Only the fullscreen layout says; elsewhere this stays empty.
// Rows a long jump unmounted never say they left: past SHOWN_MAX, the longest silent go, as a
// screen never holds that many.
const shown = new Map<string, { where: string; key: string; at: number }>()
const SHOWN_MAX = 200
// Sets `key` as `map`'s newest entry, then drops the oldest past `max`.
export const keepNewest = <K, V>(map: Map<K, V>, key: K, value: V, max: number) => {
  map.delete(key)
  map.set(key, value)
  if (map.size > max) map.delete(map.keys().next().value!)
}
// A move redraws every row, each saying where it is now; rows a long jump unmounted say nothing
// again, so only the rows reported with the newest count.
const FRESH = 100
// A clicked prompt, by its time, stays lit through its own jump: until a row moves after `after`.
let pin: { timestamp: number; after: number } | undefined
const SETTLE = 300
const pinPrompt = (timestamp: number, now: number) => {
  pin = { timestamp, after: now + SETTLE }
}
// A pin outlasts the moves its own jump makes, reported up to `after`.
export const pinHolds = (pinned: { after: number } | undefined, at: number) => !!pinned && at <= pinned.after

// Only a move redraws, or the redraw it causes would report again forever. A row growing, as a
// reply streams in, has not moved.
type Seen = { first: number; last: number } | null | undefined
const see = async ($: EngineInterface, requestId: string, onScreen: Seen, key = requestId) => {
  if (onScreen === undefined) return
  if (!onScreen) {
    if (shown.delete(requestId)) await redrawSoon($)
    return
  }
  const where = `${onScreen.first}-${onScreen.last}`
  const moved = shown.get(requestId)?.where !== where
  const at = await $.clock.now()
  keepNewest(shown, requestId, { where, key, at }, SHOWN_MAX)
  if (moved && !pinHolds(pin, at)) pin = undefined
  if (moved) await redrawSoon($)
}

// When the chat file stamped each row, by its uuid or a tool call's id: grep -o's pattern, then its
// output read back. A row's "uuid" sits right before its "timestamp", right after on a command's
// output row; a tool call's "id" comes before its row's "timestamp".
export const stampPattern = (keys: string[]) => {
  const calls = keys.filter(key => key.startsWith('toolu_')).join('|')
  const rows = keys.filter(key => !key.startsWith('toolu_')).join('|')
  return [
    ...(rows ? [`"uuid":"(${rows})","timestamp":"[^"]+"`, `"timestamp":"[^"]+","uuid":"(${rows})"`] : []),
    ...(calls ? [`"id":"(${calls})".*"timestamp":"[^"]+"`] : []),
  ].join('|')
}
export const readStamps = (printed: string) => {
  const times = new Map<string, number>()
  for (const line of printed.split('\n')) {
    const idFirst = /^"(?:uuid|id)":"([^"]+)".*"timestamp":"([^"]+)"$/.exec(line)
    const stampFirst = /^"timestamp":"([^"]+)","uuid":"([^"]+)"$/.exec(line)
    const [key, at] = idFirst ? [idFirst[1], idFirst[2]] : stampFirst ? [stampFirst[2], stampFirst[1]] : []
    if (key && Number.isFinite(Date.parse(at!))) times.set(key, Date.parse(at!))
  }
  return times
}
// A row's stamp never changes: searched for until found, then kept.
const stamps = new Map<string, number>()
// A row the chat file does not hold yet (mid-turn: the reply streaming in, a running tool) is
// looked for again at most once per READ_TTL, as each look greps the whole file.
const looked = new Map<string, number>()
const rowTimes = async ($: EngineInterface, keys: string[]) => {
  const now = await $.clock.now()
  const missing = keys.filter(key => !stamps.has(key) && /^[\w-]+$/.test(key) && now - (looked.get(key) ?? -Infinity) >= READ_TTL)
  for (const key of missing) keepNewest(looked, key, now, SHOWN_MAX)
  if (missing.length) {
    try {
      // -a: as in pastPrompts.
      const { stdout } = await $.process.run(['grep', '-a', '-o', '-E', '--', stampPattern(missing), await chatPath($)])
      for (const [key, at] of readStamps(stdout)) stamps.set(key, at)
    } catch {
      // no file yet
    }
  }
  return new Map(keys.flatMap(key => (stamps.has(key) ? [[key, stamps.get(key)!] as const] : [])))
}

// History stamps a prompt up to ~0.3 s after the chat stamps its row.
const SLACK = 500
// The prompt (index, newest first) to light: the newest whose turn the chat rows on screen show.
// Nothing on screen known: the newest.
export const inView = (prompts: Prompt[], times: number[]) =>
  times.length ? prompts.findIndex(prompt => prompt.timestamp <= Math.max(...times) + SLACK) : 0
// A clicked prompt while its pin holds, else the one in view.
export const litPrompt = (prompts: Prompt[], times: number[], pinned?: { timestamp: number }) => {
  const at = pinned ? prompts.findIndex(prompt => prompt.timestamp === pinned.timestamp) : -1
  return at >= 0 ? at : inView(prompts, times)
}

const WORKING = ['running', 'waiting', 'idle']
// Lines kept each side of the clicked one, and each line's length: the draws repeat on every scroll, so they
// window a slice, not the file.
const FILE_SPAN = 200
const FILE_LINE = 500
// The File tab's view from a read: `text` empty stands for a file it cannot show (unreadable or binary).
export const fileView = (path: string, line: number, read: string | undefined): NonNullable<FileView> => {
  if (read === undefined || read.includes('\0')) return { path, line, first: 1, text: '' }
  const all = read.replace(/\r?\n$/, '').split(/\r?\n/)
  const from = Math.max(0, Math.min(line - 1 - FILE_SPAN, all.length - (2 * FILE_SPAN + 1)))
  // Code refuses control characters (ESC in a log, ^L in a source): each shows as a space; tabs stay.
  const kept = all.slice(from, from + 2 * FILE_SPAN + 1).map(one => one.slice(0, FILE_LINE).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' '))
  return { path, line, first: from + 1, text: kept.join('\n') }
}
// `rows` lines of the view with the clicked one in the middle, clamped to the slice's ends.
export const fileWindow = (view: { line: number; first: number; text: string }, rows: number) => {
  const all = view.text.split('\n')
  const at = Math.max(0, Math.min(view.line - view.first - Math.floor(rows / 2), all.length - rows))
  return { first: view.first + at, lines: all.slice(at, at + rows), mark: view.line - view.first - at }
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
// Agents under each step: by the description Claude listed, never by position, as a redraft reorders steps.
// An earlier turn's agent fills a listed entry only while it works: a finished one would show old work as new.
export const hang = (steps: Step[], spawns: Spawn[], turn: number): AgentRow[][] => {
  const left = spawns.filter(one => one.turn === turn || (one.turn < turn && WORKING.includes(one.status)))
  const rows = steps.map(step =>
    (step.agents ?? []).map(description => {
      const i = left.findIndex(one => same(one.description, description))
      if (i < 0) return { description, status: 'planned' as const }
      const [one] = left.splice(i, 1)
      return { id: one.id, description: one.description, status: one.status }
    }),
  )
  const current = steps.findIndex(step => step.status === 'in_progress')
  for (const one of left.filter(one => one.turn === turn)) {
    const at = steps.findIndex(step => step.text === one.step)
    rows[at >= 0 ? at : current >= 0 ? current : steps.length - 1]?.push({ id: one.id, description: one.description, status: one.status })
  }
  return rows
}

export const register: Register = (on, options) => {
  // Off: Claude is never asked, so its prompt and tools stay as without the panel.
  const isIntentOn = options.intent !== false

  on('engine.create', async (_$, e, next) => {
    const built = await next(e)
    // Calls on `built` only: it is refused as an argument. Not through /margin: its hook skips a run the plugin's own code raises
    // ("command.run skipped: re-entry"). The open overlaps /margin's on purpose.
    const show = async ({ path, line }: { path: string; line: number }) => {
      const text = await built.fs.read(path).then(String, () => undefined)
      await built.state.set({ plugin: 'margin', key: 'file' } as const, fileView(path, line, text))
      await built.state.set({ plugin: 'margin', key: 'tab' } as const, 'File')
      if (!(await built.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)) {
        await built.store.set('open', true).catch(() => undefined)
        const opened = await built.ui.open({ id: PANE, title: 'Margin', columns: 40 })
        if (!opened.isPlaced) built.ui.toast('Margin waits: terminal too narrow.')
      }
    }

    return { ...built, margin: { show } }
  })

  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    // A reload drops the module's runs; the atom stays, maybe mid-run, and would show reading… for good.
    await update($, overview, now => (now.running ? { ...now, running: false } : now))
    // immediate: a key mid-turn opens the pane now, not once the turn ends; it prints nothing.
    await $.command.register({ name: 'margin', description: 'Toggle the margin', immediate: true })
    // GitHub's PRs while the Git tab shows; its redraw also ages the fetch time.
    $.clock.every(60_000, () => {
      void (async () => {
        if ((await read($, tab)) === 'Git' && (await isPlaced($))) await readGh($)
      })()
    })
    for (const name of Object.keys(KEYS)) await $.command.register({ name: tabCommand(name), description: `Margin: ${name} tab`, immediate: true })
    // Keys come back in the order first set: the oldest sessions' notes go.
    const notes = (await $.store.keys().catch(() => [])).filter(key => key.startsWith('midTurn:'))
    await Promise.all(notes.slice(0, -MID_TURN_SESSIONS).map(key => $.store.delete(key).catch(() => undefined)))
    if (isIntentOn) await $.tool.register(INTENT_SPEC).catch(() => undefined)
    // Opens as the last session left it; never asked yet, open. Below 144 columns (110 once asked) it waits for room.
    if (e.isInteractive && (await $.store.get('open').catch(() => undefined)) !== false) await $.ui.open(await paneArgs($)).catch(() => undefined)
    // A reload or resume with the tab open: read now, not at the next prompt. After the open: before it, no pane to read for.
    $.clock.after(0, () => readOverview($))

    return next(e)
  })

  // An unload (reload, crash) is no one closing it.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Escape, or the close mark, while a Git modal is open: its top layer closes and the pane stays.
    if (e.origin.kind === 'person' && (await read($, modal))) {
      await setModal($, m => (m?.sub ? { ...m, sub: undefined } : null))
      // Answered without next: the pane stays open.
      return { deny: 'closed the Git modal' } as never
    }
    if (e.origin.kind !== 'unload') await $.store.set('open', false).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'margin' }, async $ => {
    if (await isPlaced($)) await closePane($)
    else await openPane($)

    return {}
  })

  for (const name of Object.keys(KEYS)) {
    on('command.describe', { command: tabCommand(name) }, ($, e, next) => next({ ...e, isHidden: true }))
    on('command.run', { command: tabCommand(name) }, async $ => {
      const placed = await isPlaced($)
      const shown = await read($, tab)
      if (placed && (TABS.includes(shown) ? shown : TABS[0]) === name) await closePane($)
      else {
        await pick($, name as Tab)
        if (!placed) await openPane($)
      }

      return {}
    })
  }

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    const result = await next(e)
    if (e.turnId) {
      const texts = [...(await midTurn($)), e.text].slice(-MAX_PROMPTS)
      await $.store.set(await midTurnKey($), texts).catch(() => undefined)
    }
    // The new prompt lists first: back to the top to show it.
    await update($, historyTop, () => 0)
    await update($, topicsTop, () => 0)
    await update($, submitted, n => n + 1)
    // A background task's result carries the last request on: Claude pings its report, not a new one, so it reopens.
    if (e.origin.kind === 'task-notification') {
      await refreshSpawns($)
      await update($, intent, now => (now.wants ? { ...now, ended: false, agents: undefined } : { ...now, agents: undefined }))
    } else if (!e.command && !e.isMeta) {
      // One typed over a running turn joins it.
      if (!e.turnId) await update($, turns, n => n + 1)
      $.clock.after(0, () => readOverview($))
      // Last turn's answered report is not this turn's: shown as it was, it read as current. Dimmed, planning… until Claude
      // reports; with intent off no report comes, so it just goes.
      await update($, intent, now =>
        !isIntentOn ? (isAnswered(now) ? EMPTY_INTENT : now)
        : isAnswered(now) ? { ...now, ended: false, waiting: true } : !now.wants ? { ...EMPTY_INTENT, waiting: true } : { ...now, agents: undefined },
      )
    }

    return result
  })

  // Claude skips a report only to close its last steps, and its answer is often the last one: an answer
  // closes them all; an interrupted or failed turn keeps the steps as Claude left them.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refreshSpawns($)
    const close = e.reason === 'answer'
    if (e.agentId === undefined) {
      // A turn that ends while a background agent runs is not answered yet, even one started before the prompt:
      // a follow-up prompt often carries the same plan on. The agent's result reopens it.
      const agents = close ? (await runningAgents($)).length : 0
      if (agents) {
        // Waiting shows whether or not Claude reported this turn; with intent off there is no status row to show it.
        await update($, intent, now => (now.wants || now.waiting ? { ...now, agents } : now))
        return result
      }
      const at = await $.clock.now()
      // No report this turn: done if answered; stopped has no steps to keep, so it shows nothing.
      await update($, intent, now =>
        now.waiting
          ? close
            ? { ...EMPTY_INTENT, ended: true, at }
            : EMPTY_INTENT
          : now.wants
            ? { ...now, ended: true, at, steps: close ? now.steps.map(step => ({ ...step, status: 'completed' as const })) : now.steps }
            : now,
      )
    }

    return result
  })

  if (isIntentOn) {
    // A subagent's report is answered, not drawn: the tab follows the main conversation.
    on('tool.call', { tool: new RegExp(`^${INTENT_TOOL}$`) }, async ($, e) => {
      const report = e as unknown as Partial<Pick<Intent, 'wants' | 'plan' | 'steps'>> & { agentId?: string; now?: unknown }
      if (report.agentId !== undefined) return { result: 'ok' }
      // A ping moves this turn's marks: done before it, in progress at it. One after an answer, every step
      // done or dimmed for a new prompt, is dropped; one after an interrupt picks the report back up, as Claude carries on with pings alone.
      if (report.wants === undefined && typeof report.now === 'number') {
        const current = report.now - 1
        const status = (i: number): Step['status'] => (i < current ? 'completed' : i === current ? 'in_progress' : 'pending')
        await update($, intent, now =>
          isAnswered(now) || now.waiting || !now.steps.length ? now : { ...now, ended: false, agents: undefined, steps: now.steps.map((step, i) => ({ ...step, status: status(i) })) },
        )
      } else {
        const at = await $.clock.now()
        const turn = await read($, turns)
        // A report missing ASK or PLAN keeps the last ones, or the tab goes blank.
        await update($, intent, now => ({
          wants: flat(String(report.wants ?? now.wants)),
          plan: flat(String(report.plan ?? now.plan)),
          steps: Array.isArray(report.steps)
            ? report.steps.map(step => ({ ...step, text: flat(String(step.text)), agents: Array.isArray(step.agents) ? step.agents.map(one => flat(String(one))) : undefined }))
            : [],
          at,
          ended: false,
          turn,
        }))
        await update($, expanded, () => -1)
      }

      return { result: 'ok' }
    })

    // Main-loop agents only: a subagent's or a teammate would read as Claude's own step work. A workflow's
    // are left out too: the list never names them, so their rows would stay not started.
    on('agent.spawn', async ($, e, next) => {
      const result = await next(e)
      const id = result.agentId
      if (!id || e.parentAgentId !== undefined || e.isTeammate || e.workflow) return result
      // A resumed agent keeps its record: only its status moves.
      if (!(await read($, spawns)).some(one => one.id === id)) {
        const shown = await read($, intent)
        const turn = await read($, turns)
        const step = shown.steps.find(one => one.status === 'in_progress')?.text ?? ''
        await update($, spawns, now => [...now, { id, description: e.description, step, turn, status: 'pending' }])
        // Whether Claude listed it: how often it does is the later consistency check.
        t.event('agent.spawn', { listed: shown.steps.some(one => one.agents?.some(listed => same(listed, e.description))) })
      }
      await refreshSpawns($)

      return result
    })
  }

  // Tabs switch here, not in their onPress: mid-turn, a click landing as a redraw swaps the tree
  // reached this hook but lost its onPress.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    // An open modal takes every press: its own act; any other closes the top layer and does nothing else.
    // A tab press closes it whole and switches.
    // The open row's own Button (`open:`) closes the whole modal through its onPress.
    if (modalZone && !/^([ms]|open):/.test(e.element ?? '')) {
      const isTab = TABS.some(one => one === e.element)
      await setModal($, m => (m?.sub && !isTab ? { ...m, sub: undefined } : null))
      if (!isTab) return { element: e.element }
    }
    // Agent rows redraw mid-turn too: their fold and their transcript take the tabs' route.
    if (e.element === 'main' || e.element?.startsWith('view:')) {
      const id = e.element.slice(5)
      const shown = await $.ui.view(e.element === 'main' || viewing === id ? {} : { agentId: id })
      if (shown.deny) $.ui.toast(shown.deny)

      return { element: e.element }
    }
    if (e.element === 'less' || e.element?.startsWith('more:')) {
      await update($, expanded, () => (e.element === 'less' ? -1 : Number(e.element!.slice(5))))

      return { element: e.element }
    }
    const picked = TABS.find(one => one === e.element)
    if (!picked) return next(e)
    await pick($, picked)

    return { element: e.element }
  })

  // A divider, dragged or clicked, or a back-to-top line clicked: the render clamps a divider to keep 1 row on either side.
  on('ui.message', async ($, e, next) => {
    // A row Client: the pointer entered or left it, or it was pressed.
    if (e.requestId === PANE && typeof e.element === 'string' && e.element.startsWith('row:')) {
      const row = e.element.slice(4)
      const data = e.data as { hover?: boolean; press?: boolean } | undefined
      // A row under the left row's card is entered as the pointer lands on that card: its card stays undrawn.
      const under = (left: string | null) => {
        const span = left ? cardSpan[left] : undefined
        return !!span && rowLines[row]! >= span[0] && rowLines[row]! < span[1]
      }
      if (data?.hover) {
        const held = leaving?.row
        leaving = undefined
        await update($, rowPointer, ({ left }) => ({ left: under(held ?? left) ? (held ?? left) : null, at: row }))
      } else if (data?.hover === false) {
        const n = ++leaves
        leaving = { row, n }
        void $.clock.after(LEAVE_HOLD, async () => {
          if (leaving?.n !== n) return
          leaving = undefined
          await update($, rowPointer, ({ at }) => ({ left: row, at: at === row ? null : at }))
        })
      }
      // A press opens a modal, behind which faded rows post no leave: forget the left row first.
      if (data?.press) {
        leaving = undefined
        await update($, rowPointer, () => ({ left: null, at: null }))
        await rowActs[row]?.()
      }
      return {}
    }
    if (e.requestId === PANE && (e.data as { top?: unknown } | undefined)?.top) {
      await topActs[e.element]?.()
      return {}
    }
    const rows = (e.data as { split?: unknown } | undefined)?.split
    if (e.requestId !== PANE || (e.element !== 'divider' && e.element !== 'now') || typeof rows !== 'number') return next(e)
    if (e.element === 'divider') await update($, split, () => Math.max(0, rows))
    else await update($, topicsSplit, () => Math.max(0, rows))

    return {}
  })

  // The wheel over the Git tab scrolls the zone under it, not the pane; keys, with no pointer, COMMITS.
  // Over History, its list, under the header.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    // Over an open modal's top layer, its list; anywhere else, nothing. Rows count under the tabs and their rule.
    const layered = modalZone
    if (layered) {
      const row = (e.pointer?.row ?? -Infinity) - 2
      const column = e.pointer?.column ?? -Infinity
      const layer = layered.s ?? layered.m
      if (row >= layer.frame.top && row < layer.frame.top + layer.frame.height && column >= layer.frame.left && column < layer.frame.left + layer.frame.width) {
        const top = Math.max(0, Math.min(layer.top + e.by, layer.end))
        await update($, modal, m => (!m ? m : layered.s ? (m.sub ? { ...m, sub: { ...m.sub, top } } : m) : { ...m, top }))
      }
      return {}
    }
    const end = historyEnd
    if (end !== undefined) {
      // From the row drawn: a rewind may have shrunk the list under the offset stored.
      await update($, historyTop, top => Math.max(0, Math.min(Math.min(top, end) + e.by, end)))
      return {}
    }
    const topics = topicsZone
    const row = (e.pointer?.row ?? -Infinity) + (topics?.offset ?? 0)
    // Over a divider, or still wheeling it, up gives the zone above it rows. A clock that fails holds nothing.
    const now = await $.clock.now().catch(() => -Infinity)
    const held = (zone: 'git' | 'topics') => wheeling?.zone === zone && e.pointer?.row === wheeling.row && now - wheeling.at < WHEEL_HOLD
    const hold = (zone: 'git' | 'topics') => (wheeling = { zone, row: e.pointer!.row, at: now })
    if (topics && (row === topics.to || held('topics'))) {
      hold('topics')
      await update($, topicsSplit, rows => nudge(rows, topics.divider, -e.by))
      return {}
    }
    if (topics && row >= topics.from && row < topics.to) {
      await update($, topicsTop, top => Math.max(0, Math.min(Math.min(top, topics.end) + e.by, topics.end)))
      return {}
    }
    const zones = gitZones
    if (!zones) return next(e)
    if (zones.commitsAt && (e.pointer?.row === zones.commitsAt || held('git'))) {
      hold('git')
      await update($, split, rows => nudge(rows, zones.divider, -e.by))
      return {}
    }
    const zone = (e.pointer?.row ?? Infinity) < zones.commitsAt ? 'changes' : 'commits'
    await update($, scrolled, top => ({ ...top, [zone]: Math.max(0, Math.min(top[zone] + e.by, zones[zone])) }))

    return {}
  })

  // /clear starts the conversation over: no report.
  on('session.end', async ($, e, next) => {
    t.event('margin.end', { reason: e.reason })
    await t.flush(traceIo($))
    if (e.reason === 'clear') {
      // A read still running answers for the old chat.
      overviewSeq++
      await update($, intent, () => EMPTY_INTENT)
      await update($, spawns, () => [])
      await update($, overview, () => EMPTY_OVERVIEW)
    }

    return next(e)
  })

  // A tool call may change the repo; the built-in read-only ones never do, and each reread is 5 git runs.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!READ_ONLY.has(e.tool)) await update($, toolCalls, n => n + 1)

    return result
  })

  // A compaction changes which prompts are live: redraw now, not at the next prompt. The engine
  // stores the compacted chat only after this hook returns.
  // ponytail: fixed wait (the store lagged 8 ms when measured); poll $.session.messages if it lags more.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(500, () => $.ui.invalidate('ui.render'))

    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    learn($, flat(e.props.text), e.requestId)
    await see($, e.requestId, e.props.onScreen)

    return next(e)
  })

  // A slash command's only row in the chat is its output line, keyed as history shows the command.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    learn($, flat(`/${e.props.command} ${e.props.args}`), e.requestId)
    await see($, e.requestId, e.props.onScreen)

    return next(e)
  })

  // A long reply fills the screen with no prompt row: its rows say whose turn is in view.
  on('ui.render', { component: ['AssistantMessage', 'ToolUse', 'ToolResult'] }, async ($, e, next) => {
    await see($, e.requestId, e.props.onScreen)
    // The intent report shows in the panel, not as a chat row.
    if (e.component !== 'AssistantMessage' && e.props.tool === INTENT_TOOL) {
      const { Box } = $.ui.resolve(e)

      return <Box />
    }

    return next(e)
  })

  // A group's own id is not in the chat file; its first call's is.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await see($, e.requestId, e.props.onScreen, e.props.calls[0]?.tool_use_id)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => ordered(async () => {
    const draw = t.span('pane.draw')
    // What the tab drew, or hid and why: set by the tab's branch below.
    let zones: Record<string, unknown> = {}
    // Kept in the entry but out of the change key: a wheel tick moves these alone.
    let scroll: Record<string, unknown> = {}
    const elements = $.ui.resolve(e)
    const { Box, Button, Code, Link, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    // A rule with ↑ in it: back to a scrolled zone's top. Drawn by the divider's Client, so the whole row is the
    // target and only ↑ lights. Unshrunk, as the topics under it: a zone's last row wrapping past its edge would
    // squeeze it out. A column, as a row Box sizes the Client to its content: ↑ alone, no rule.
    const topLine = (key: string, onPress: () => unknown, faded?: boolean) => {
      topActs[key] = onPress
      if (Client)
        return (
          <Box flexShrink={0} flexDirection="column">
            <Client key={key} module="./divider.tsx" props={{ top: true, split: 0, min: 0, max: 0, faded: !!faded }} height={1} />
          </Box>
        )
      // Elsewhere only the symbol is the button, the Button heating the scope and the Text's hover taking the color:
      // a Button lights as wide as it draws.
      const fill = Math.max(0, e.props.bodyColumns - 2 * PAD - 3)
      return (
        <Box flexShrink={0}>
          <Text color="promptBorder">{'─'.repeat(Math.floor(fill / 2))} </Text>
          <Button key={key} plain hover={{ scope: key, color: 'claude' }} onPress={onPress}>
            <Text bold color="promptBorder" hover={{ scope: key, color: 'claude' }}>↑</Text>
          </Button>
          <Text color="promptBorder"> {'─'.repeat(Math.ceil(fill / 2))}</Text>
        </Box>
      )
    }
    // A tab saved before it was hidden falls back to the first shown.
    const saved = await read($, tab)
    const current = TABS.includes(saved) ? saved : TABS[0]!
    const flagged = await read($, notices)
    // Divider gets half the side margin on each side.
    const rule = '─'.repeat(e.props.bodyColumns - PAD)
    // A tab with nothing to list: a framed note, centered in `rows`.
    const emptyNote = (rows: number, title: string, ...lines: JSX.Element[]) => (
      <Box height={Math.max(0, rows)} justifyContent="center" alignItems="center">
        <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor="promptBorder" paddingX={2} paddingY={1}>
          <Text bold color={HUD.label}>{title}</Text>
          <Text> </Text>
          {lines}
        </Box>
      </Box>
    )

    // Tries the transcript's id first, then the drawn row's, until one scrolls. The pin's settle
    // starts again once the scroll lands, as the search before it can be slow.
    const jump = async (prompt: Prompt) => {
      pinPrompt(prompt.timestamp, await $.clock.now())
      const ids = [await transcriptId($, prompt), rowIds.get(flat(prompt.display))]
      for (const requestId of new Set(ids)) {
        if (!requestId) continue
        const moved = await $.ui.scroll({ to: { requestId }, block: 'start' }).catch(() => ({ deny: 'failed' }))
        if (!moved.deny) {
          pinPrompt(prompt.timestamp, await $.clock.now())
          return
        }
      }
      pin = undefined
      t.event('pane.jump', { found: false, tried: ids.filter(Boolean).length }, 'warn')
      $.ui.toast("Can't jump: not found in the chat. ↻\u00a0reuses it.")
    }
    const reuse = async (display: string) => {
      const { isFilled } = await $.prompt.fill({ text: display })
      if (!isFilled) $.ui.toast('The prompt box did not take it.')
    }
    // /rewind takes no target, so this opens its picker; the person picks the message there.
    const rewind = () => $.command.run({ command: 'rewind' }).catch(() => $.ui.toast('Could not open /rewind.'))
    // The chat scrolls only to a row, never to its end: its newest row that is drawn, a tool group's
    // calls not being drawn under their own ids.
    const latest = async () => {
      // By bytes, under process.run's 4 MiB: a line holding an image may be MBs, and a cut keeps the head.
      const tail = await $.process.run(['tail', '-c', '4000000', await chatPath($)]).catch(() => undefined)
      for (const requestId of lastRowIds(tail?.stdout ?? '').slice(0, 10)) {
        const moved = await $.ui.scroll({ to: { requestId }, block: 'end' }).catch(() => ({ deny: 'failed' }))
        if (!moved.deny) return
      }
      $.ui.toast("Can't scroll to the chat's end.")
    }

    let body
    // Kept while a Git draw reads: a wheel tick meanwhile still scrolls its zone.
    if (current !== 'Git') {
      gitZones = undefined
      modalZone = undefined
    }
    if (current !== 'History') historyEnd = undefined
    if (current !== 'Overview') topicsZone = undefined
    if (current === 'Decisions') {
      body = emptyNote(
        e.props.scroll.bodyRows - BAR_ROWS - 2,
        'Coming in v1.8',
        <Text color={HUD.faint}>Choices made in this chat</Text>,
        <Text color={HUD.faint}>and why they were made.</Text>,
      )
    } else if (current === 'Tree') {
      body = emptyNote(
        e.props.scroll.bodyRows - BAR_ROWS - 2,
        'Coming in v1.8',
        <Text color={HUD.faint}>The repo's files as a tree,</Text>,
        <Text color={HUD.faint}>each one opens in File.</Text>,
      )
    } else if (current === 'File') {
      const view = await read($, file)
      const rows = Math.max(0, e.props.scroll.bodyRows - BAR_ROWS - 2)
      if (!view) {
        body = emptyNote(rows, 'No file open', <Text color={HUD.faint}>Click a file path in</Text>, <Text color={HUD.faint}>a reply to show it here.</Text>)
      } else if (!view.text) {
        // The box's border and padding take 6 columns of the body.
        body = emptyNote(
          rows,
          "Can't show this file",
          <Text color={HUD.faint}>{fit(view.path, e.props.bodyColumns - 2 * PAD - 6)}</Text>,
          <Text color={HUD.faint}>It is binary or unreadable.</Text>,
        )
      } else {
        // The header row and its rule, as Overview's and Git's first rows.
        const room = Math.max(1, rows - 2)
        const { first, lines, mark } = fileWindow(view, room)
        const cwd = await $.session.cwd().catch(() => '')
        const home = await $.env.get('HOME').catch(() => undefined)
        // As the reply wrote it: from the working directory, else from ~.
        const shown = cwd && view.path.startsWith(`${cwd}/`) ? view.path.slice(cwd.length + 1) : home && view.path.startsWith(`${home}/`) ? `~/${view.path.slice(home.length + 1)}` : view.path
        const width = e.props.bodyColumns - 2 * PAD
        const at = `line ${view.line}`
        // A cut takes the path's start, never the line beside it.
        const fits = Math.max(1, width - at.length - 1)
        const head = shown.length > fits ? `…${shown.slice(1 - fits)}` : shown
        body = (
          <Box flexDirection="column" height={rows} flexShrink={0}>
            {/* As Git's branch row: the path in the action color, the line faint on the right. */}
            <Box justifyContent="space-between">
              <Text color={HUD.action}>{head}</Text>
              <Text color={HUD.faint}>{at}</Text>
            </Box>
            <Text color="promptBorder">{'─'.repeat(width)}</Text>
            <Box height={room} flexShrink={0}>
              <Text color="claude">{lines.map((_, i) => (i === mark ? '▶' : ' ')).join('\n')}</Text>
              <Code source={lines.join('\n')} path={view.path} startLine={first} wrap="truncate-end" />
            </Box>
          </Box>
        )
      }
    } else if (current === 'History') {
      const key = `${await $.session.id()}:${await read($, submitted)}`
      const at = await $.clock.now()
      if (historyRead?.key !== key || at - historyRead.at >= READ_TTL) historyRead = { key, at, reads: readHistory($) }
      const { all, prompts, drawnOnly, commands, rows } = await historyRead.reads
      // "↻ " and "HH:MM  " come before the text; padding it to the edge makes the whole row the jump button.
      const room = e.props.bodyColumns - 2 * PAD - 9
      const now = new Date()
      const days = prompts.map(prompt => dayLabel(prompt.timestamp, now))
      // The longest count that fits beside "⟲ rewind  ⤓ latest " (19 columns); none in the narrowest pane.
      const count = `${prompts.length}${all.length > MAX_PROMPTS ? '+' : ''} ${all.length === 1 ? 'prompt' : 'prompts'}`
      const counted = [`${count} this session`, count, ''].find(text => !text || text.length + 19 <= room + 9)
      const isReachable = (prompt: Prompt) => {
        const key = flat(prompt.display)
        if ((!isCommand(prompt) && !drawnOnly.has(key)) || rowIds.has(key) || commands.has(key)) return true
        awaited.add(key)
        return false
      }
      // Rows under the Compacted line still jump while the chat shows them, dim as the model lost them.
      const compacted = rows.findIndex(row => row.marker === 'Compacted')
      // The prompt being read lights even if compacted: it is on screen.
      const times = await rowTimes($, [...new Set([...shown.values()].map(row => row.key))])
      const known = [...shown.values()].filter(row => times.has(row.key))
      const newest = Math.max(...known.map(row => row.at))
      const lit = litPrompt(prompts, known.filter(row => row.at >= newest - FRESH).map(row => times.get(row.key)!), pin)
      // `line` left and right of " label ", across the row (room + 9 columns).
      const flanks = (label: string, line: string) => {
        const fill = Math.max(0, room + 7 - label.length)
        return [line.repeat(Math.floor(fill / 2)), line.repeat(Math.ceil(fill / 2))]
      }
      // A day is a plain line; Rewound a broken one, Compacted a pressed-together one.
      const divider = (label: string, line: string, word: string, dim: string) => (
        <Box>
          <Text color={dim}>{flanks(label, line)[0]} </Text>
          <Text color={word}>{label}</Text>
          <Text color={dim}> {flanks(label, line)[1]}</Text>
        </Box>
      )
      // One element per row, dividers too, so the list scrolls by rows under the header.
      // A ! command's ! in the shell prompt's color, faint as its row.
      const row = (prompt: Prompt, color: string | undefined) => {
        const text = fit(flat(prompt.display), room).padEnd(room)
        if (!text.startsWith('!')) return <Text color={color}>{text}</Text>
        return [<Text color={color === HUD.faint ? color : 'bashBorder'}>!</Text>, <Text color={color}>{text.slice(1)}</Text>]
      }
      const lines = prompts.flatMap((prompt, i) => [
        ...(days[i] !== days[i - 1] ? [divider(days[i] ?? '', '─', HUD.label, DIM.label)] : []),
        // Rewound shares the rewind button's green.
        ...(rows[i]?.marker === 'Rewound' ? [divider('Rewound', '~', HUD.action, DIM.action)] : []),
        ...(rows[i]?.marker === 'Compacted' ? [divider('Compacted', '=', HUD.compacted, DIM.compacted)] : []),
        <Box>
          <Button key={`reuse:${i}`} plain onPress={() => reuse(prompt.display)}>
            <Text color={HUD.idle}>↻ </Text>
          </Button>
          <Button key={`jump:${i}`} plain onPress={() => (rows[i]?.isLive ? jump(prompt) : $.ui.toast(GONE))}>
            <Text color={HUD.faint}>{clock(prompt.timestamp)}  </Text>
            {row(prompt, !rows[i]?.isLive || !isReachable(prompt) ? HUD.faint : i === lit ? 'claude' : compacted >= 0 && i >= compacted ? HUD.faint : undefined)}
          </Button>
        </Box>,
      ])
      // The rows under the tabs, their rule and the header, less the back-to-top line once scrolled.
      // Clamped: the list shrinks after a rewind.
      const listRows = Math.max(0, e.props.scroll.bodyRows - BAR_ROWS - 3)
      const end = zoneEnd(lines.length, listRows)
      const from = Math.min(await read($, historyTop), end)
      const hasTop = from > 0 && listRows > 1
      if (!next.signal.aborted) historyEnd = end
      zones = { zones: prompts.length ? 'list' : 'empty', prompts: prompts.length, rows: lines.length, listRows }
      scroll = { from, backToTop: hasTop }
      body = (
        <Box flexDirection="column">
          {prompts.length > 0 && (
            <Box justifyContent="space-between">
              <Box>
                <Button key="rewind" plain onPress={rewind}>
                  <Text color={HUD.action}>⟲ rewind</Text>
                </Button>
                <Text>  </Text>
                <Button key="latest" plain onPress={latest}>
                  <Text color={HUD.latest}>⤓ latest</Text>
                </Button>
              </Box>
              {counted && <Text color={HUD.faint}>{counted}</Text>}
            </Box>
          )}
          {/* The rows under the tabs and their rule. */}
          {prompts.length === 0 &&
            emptyNote(
              e.props.scroll.bodyRows - BAR_ROWS - 2,
              'No prompts yet',
              <Text color={HUD.faint}>What you've asked Claude.</Text>,
              <Box>
                <Text color={HUD.faint}>Click to jump, </Text>
                <Text color={HUD.idle}>↻</Text>
                <Text color={HUD.faint}> to reuse.</Text>
              </Box>,
            )}
          {hasTop && topLine('top', () => update($, historyTop, () => 0))}
          {lines.slice(from, from + listRows - (hasTop ? 1 : 0))}
        </Box>
      )
    } else if (current === 'Git') {
      const key = `${await read($, submitted)}:${await read($, toolCalls)}`
      if (gitRead?.key !== key) gitRead = { key, signal: next.signal, runs: readGit($) }
      let runs = await gitRead.runs
      // A draw dropped mid-read (a newer one began, the pane closed) takes the git runs still going down
      // with it: any of them unanswered, the draw on screen reads again.
      if (runs.some(run => !run) && gitRead.signal.aborted && !next.signal.aborted) {
        gitRead = { key, signal: next.signal, runs: readGit($) }
        runs = await gitRead.runs
      }
      const [status, diff, unpushed, count, remote, gitDir, stash, refs, worktreeRun] = runs
      const now = await $.clock.now()
      await readTheme($)
      const basic = await (basicGlyphs ??= configDir($)
        .then(dir => $.fs.exists(`${dir}/.claudzilla-basic-glyphs`))
        .catch(() => false))
      const open = await read($, modal)
      const isFetching = await read($, fetching)
      const web = remote?.exitCode === 0 ? gitWeb(remote.stdout) : undefined
      const local = unpushed?.exitCode === 0 ? new Set(unpushed.stdout.split('\n').filter(Boolean)) : undefined
      const total = count?.exitCode === 0 ? count.stdout.trim() : ''
      const { head, changes } = status?.exitCode === 0 ? parseStatusZ(status.stdout) : { head: undefined, changes: [] }
      const files = changes
      const counts = diff?.exitCode === 0 ? parseNumstat(diff.stdout) : new Map<string, Counts>()
      const summed = changes.reduce((n, c) => {
        const one = counts.get(c.path)
        return one && one !== 'bin' ? { add: n.add + one.add, del: n.del + one.del } : n
      }, { add: 0, del: 0 })
      // As gitRead: a run a dropped draw took down is read again by the live one.
      const dropped = (cached?: { key: string; signal: AbortSignal }, at = key) => cached?.key !== at || (cached.signal.aborted && !next.signal.aborted)
      if (dropped(opRead))
        opRead = { key, signal: next.signal, run: head && gitDir ? readOp($, gitDir.dir, gitDir.files.map(one => one.name), parseHead(head).name) : Promise.resolve(undefined) }
      const op = await opRead.run
      // During a rebase git has no current branch: its name comes from head-name.
      const branchName = op?.head || parseHead(head ?? '').name
      const blocked = !!op && op.conflicts.length > 0 && !op.resolved
      const ghNow = await read($, gh)
      const prs = remote?.exitCode === 0 && ghNow.remote === remote.stdout.trim() ? ghNow.prs : []
      // This branch's PR: one open, else the newest that ended. Two or more open share a summary row.
      const own = head ? ownPrs(prs, branchName) : []
      const incoming = head ? incomingPrs(prs, branchName) : []
      const isOpen = (one?: Pr) => one?.state === 'open' || one?.state === 'draft'
      // Two or more open PRs out of this branch, or, on a branch with none open, the PRs coming into it: one summary row.
      const summary = own.length > 1 ? { out: true, list: own } : !isOpen(own[0]) && incoming.length ? { out: false, list: incoming } : undefined
      const pr = !summary && own.length === 1 ? own[0] : undefined
      // Every worktree, the main one first. In a linked one the branch name takes ⧉.
      const worktreeList = worktreeRun?.exitCode === 0 ? worktreeRun.stdout : ''
      const trees = worktrees(worktreeList)
      const linked = trees.findIndex(t => t.path === gitDir?.root) > 0
      const prKey = pr && `${key}:${pr.base}:${pr.conflicting}`
      if (prKey && dropped(prRead, prKey))
        prRead = {
          key: prKey,
          signal: next.signal,
          run: Promise.all([
            $.process.run(['git', 'rev-list', '--count', `HEAD..origin/${pr.base}`]).catch(() => undefined),
            $.process.run(['git', 'rev-list', '--count', `origin/${pr.base}..HEAD`]).catch(() => undefined),
            // Exits 1 on a conflict, the files still listed: the tree id, then a name a line.
            pr.conflicting ? $.process.run(['git', 'merge-tree', '--write-tree', '--name-only', 'HEAD', `origin/${pr.base}`]).catch(() => undefined) : Promise.resolve(undefined),
          ]),
        }
      const [behindRun, aheadRun, treeRun] = pr ? await prRead!.run : []
      const behind = Number(behindRun?.stdout.trim()) || 0
      const prCommits = Number(aheadRun?.stdout.trim()) || 0
      // Rows behind an open modal: dim, with no hover, card or link. A modal with nothing to show is not open.
      const dimmed = !!open && (open.key === 'branch' || (open.key === 'pr' && !!pr && pr.n === open.n) || (open.key === 'rebase' && !!op) || (open.key === 'prs' && !!summary) || (open.key === 'commit' && !!open.sha))
      // Its subject gone, it closes: left open, it would swallow the next Escape and come back with the next subject.
      // A failed read says nothing about the subject.
      if (open && !dimmed && !next.signal.aborted && status?.exitCode === 0 && gitDir && (open.key === 'rebase' || remote?.exitCode === 0))
        $.clock.after(0, () => setModal($, m => (m?.key === open.key ? null : m)))
      // The row that opened the modal: a commit's is keyed by its sha.
      const openRow = open?.key === 'commit' ? commitKey(open.sha ?? '') : open?.key
      const conflictFiles = treeRun ? treeRun.stdout.split('\n\n')[0]!.split('\n').slice(1).filter(Boolean).map(printable) : []
      // The body less 3 columns: a path gets room + 1 after its status letter and a space; a commit's
      // subject room + 2 less its hash.
      const room = e.props.bodyColumns - 2 * PAD - 3
      const bodyRule = '─'.repeat(room + 3)
      // A header's counts, each only where it fits after its 7-letter title and a space: the
      // narrowest pane drops them from the right.
      const fits = (...counts: string[]) => 8 + counts.join('').length <= room + 3
      const aheadCount = local?.size ? `↑${local.size}` : ''
      const totalCount = total ? `${aheadCount ? '  ' : ''}${total} total` : ''
      // The branch row, the rebase row and the PR row; the rows above CHANGES grow with them.
      const topRows = 1 + (op ? 1 : 0) + (pr || summary ? 1 : 0)
      // Rows left once the tabs, their rule, the branch, the rule under it, both headers and the
      // divider are drawn. CHANGES takes what it needs up to half, or what the divider was dragged
      // to; COMMITS the rest. Dragged, each side keeps 1 row, COMMITS first in a short pane.
      const free = e.props.scroll.bodyRows - BAR_ROWS - 6 - topRows
      const dragged = await read($, split)
      const changesMax = Math.max(0, free - 1)
      const changesMin = Math.min(1, changesMax)
      const changesRows = dragged >= 0 ? Math.max(changesMin, Math.min(dragged, changesMax)) : Math.min(files.length, Math.ceil(free / 2), changesMax)
      // With no changes, no CHANGES header or divider: COMMITS takes their rows too.
      const commitsRows = Math.max(1, files.length ? free - changesRows : free + 2)
      // Clamped here too: a list shrinks, or the divider grows its zone, after the wheel moved it.
      const top = await read($, scrolled)
      const changesFrom = Math.min(top.changes, zoneEnd(files.length, changesRows))
      const commitsFrom = Math.min(top.commits, total ? zoneEnd(Number(total), commitsRows) : Infinity)
      // Rows each zone lists under its back-to-top line, there once scrolled.
      const changesShown = changesRows - (changesFrom > 0 && changesRows > 1 ? 1 : 0)
      const commitsShown = commitsRows - (commitsFrom > 0 && commitsRows > 1 ? 1 : 0)
      const page = Math.floor(commitsFrom / PAGE)
      const logKey = `${key}:${page}`
      if (head && logRead?.key !== logKey) logRead = { key: logKey, signal: next.signal, run: readLog($, page) }
      let log = head ? await logRead!.run : undefined
      // As the runs above: a read a dropped draw took down with it is read again.
      if (head && !log && logRead!.signal.aborted && !next.signal.aborted) {
        logRead = { key: logKey, signal: next.signal, run: readLog($, page) }
        log = await logRead.run
      }
      // An empty repo's log fails: no commits to list.
      const commits = log?.exitCode === 0 ? parseLog(log.stdout) : []
      // CHANGES' rows end under its last file: the tabs, their rule, the branch, its rule and the header.
      // Only a live draw sets them: a dropped one finishing after another tab drew would take its wheel.
      if (!next.signal.aborted)
        gitZones = !head
          ? undefined
          : {
              commitsAt: files.length && changesRows ? 4 + topRows + changesRows : 0,
              changes: zoneEnd(files.length, changesRows),
              commits: zoneEnd(Number(total) || page * PAGE + commits.length, commitsRows),
              divider: { rows: changesRows, min: changesMin, max: changesMax },
            }
      zones = {
        zones: !head ? (status ? 'not a repo' : 'no git answer') : !files.length ? 'commits only' : changesRows ? 'changes+commits' : 'changes hidden: no rows',
        changes: files.length, changesRows, commits: commits.length, commitsRows, total: Number(total) || 0,
      }
      // Mid-rebase git status names no branch: the branch's own ref gives its upstream and track, as status would.
      const ref = op ? (refs?.stdout ?? '').split('\n').map(line => line.split('\t')).find(([name]) => name === branchName) : undefined
      const headLine = ref?.[1] ? `## ${branchName}...${ref[1]}${ref[2] ? ` ${ref[2]}` : ''}` : (head ?? '')
      const hd = { ...parseHead(headLine), name: branchName }
      // The upstream by its remote alone, unless its branch name differs from this one.
      const tracked = /\.\.\.(\S+)/.exec(headLine)?.[1]
      const upstreamName = tracked && (tracked.slice(tracked.indexOf('/') + 1) === hd.name ? tracked.split('/')[0]! : tracked)
      const MARKS = { behind: ['↓', BEHIND], diverged: ['↕', BEHIND], gone: ['✗', HUD.faint] } as const
      const mark = syncMark(hd)
      const stashes = stashCount(stash?.stdout ?? '', hd.name)
      const remoteUrl = remote?.exitCode === 0 ? remote.stdout.trim() : ''
      const fetchedAt = gitDir?.fetchedAt
      const stale = fetchedAt === undefined || now - fetchedAt >= 60 * 60e3
      const fetchLabel = `${basic ? '↻' : '\uf46a'} ${fetchedAt === undefined ? 'never' : age(fetchedAt, now)}`
      // The fetch row's width as drawn: while a fetch runs it reads "◌ fetching".
      const fetchWidth = isFetching ? 10 : [...fetchLabel].length
      const branchLabel = `⎇ ${fit(hd.name, e.props.bodyColumns - 2 * PAD - fetchWidth - 5 - (linked ? 2 : 0))}`
      const fetchedText = fetchedAt === undefined ? 'never' : `${clock(fetchedAt)} ${new Date(fetchedAt).toDateString() === new Date(now).toDateString() ? 'today' : dayName(new Date(fetchedAt))}`
      const fetchNow = async () => {
        await update($, fetching, () => true)
        const run = await $.process.run(['git', 'fetch', 'origin']).catch(() => undefined)
        await update($, fetching, () => false)
        if (run?.exitCode !== 0) $.ui.toast(`git fetch failed: ${(run?.stderr ?? '').split('\n')[0]}`)
        // As a tool call that may change the repo: the tab reads git again.
        await update($, toolCalls, n => n + 1)
        await readGh($)
      }
      const openModal = async (key: ModalKey, row?: LogRow) => {
        if (row) await update($, commitViews, all => ({ ...all, [row.full]: { ...all[row.full], row } }))
        await setModal($, () => ({ key, top: key === 'branch' ? -1 : 0, ...(row && { sha: row.full }), ...(key === 'pr' && { n: pr?.n }) }))
        if (row) await readCommitView($, row.full)
        const failed = pr?.checks.find(c => c.state === 'bad' && c.job)
        if (key === 'pr' && pr) await readPrView($, pr.n, failed && { name: failed.name, job: failed.job! })
      }
      // Behind a modal only the row that opened it presses, and closes it.
      // The COMMITS rows drawn, and the tab row the first of them sits on: under CHANGES, its divider and the COMMITS
      // header, past the back-to-top line once scrolled.
      const shownCommits = commits.slice(commitsFrom - page * PAGE, commitsFrom - page * PAGE + commitsShown)
      const commitsAt0 = topRows + 2 + (files.length ? changesRows + 2 : 0) + (commitsShown < commitsRows ? 1 : 0)
      const commitStats = shownCommits.length ? await readStats($, shownCommits.map(c => c.full)) : stats
      // The CHANGES rows drawn: a deleted file has nothing to open, so no act; untracked ones count their lines.
      const shownChanges = changes.slice(changesFrom, changesFrom + changesShown)
      const root = gitDir?.root ?? ''
      const untrackedShown = shownChanges.filter(c => c.letter === '?').map(c => c.path)
      const wcKey = `${key}:${untrackedShown.join('\0')}`
      if (untrackedShown.length && wcRead?.key !== wcKey) wcRead = { key: wcKey, run: readWc($, root, untrackedShown) }
      const lineCounts = untrackedShown.length ? await wcRead!.run : new Map<string, Counts>()
      // As the File tab's show: the file read whole, the tab switched. `path`: from the repo's top. A file no longer
      // in the working tree, as a commit's may be, says so instead of opening empty.
      const openFile = async (path: string) => {
        const text = await $.fs.read(`${root}/${path}`).then(String, () => undefined)
        if (text === undefined) return void $.ui.toast(`Not in the working tree: ${printable(path)}`)
        await update($, file, () => fileView(`${root}/${path}`, 1, text))
        await pick($, 'File')
      }
      rowActs = dimmed
        ? { [openRow!]: () => setModal($, () => null) }
        : {
            branch: () => openModal('branch'), fetch: () => !isFetching && fetchNow(), rebase: () => openModal('rebase'), pr: () => openModal('pr'), prs: () => openModal('prs'),
            ...Object.fromEntries(shownChanges.filter(c => c.word !== 'deleted').map(c => [fileKey(c.path), () => openFile(c.path)])),
            ...Object.fromEntries(shownCommits.map(c => [commitKey(c.full), () => openModal('commit', c)])),
          }
      // A top row: a row Client where the surface draws one, else a Button whose card shows on hover. `width`: a row
      // sharing its line, held to its text.
      // An action row (fetch runs, opens nothing) inverts under the pointer, as a button does; a row that opens a
      // modal lights.
      const act = (key: string) => key === 'fetch' && !dimmed
      const piecesOf = (key: string, node: any[]) =>
        act(key) ? toPieces(node).map(x => ({ ...x, hover: { scope: `card:${key}`, inverse: true } })) : dimOn(key, toPieces(node))
      const topRow = (key: string, left: any[], right: any[], cardEl: null, width?: number) =>
        Client ? (
          <Box flexDirection="column" height={1} hover={dimmed ? undefined : { scope: `card:${key}`, ...(!act(key) && key in rowActs && { backgroundColor: LIT }) }} {...(width !== undefined && { width, flexShrink: 0 })}>
            <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: piecesOf(key, left), right: piecesOf(key, right), ...(!dimmed && { line: `line:${lineOf(key)}` }) }} />
            {cardEl}
          </Box>
        ) : (
          <Box key={`hov:${key}`} hover={hoverOf(`card:${key}`)} justifyContent="space-between" height={1} overflow="hidden" {...(width !== undefined && { flexShrink: 0 })}>
            <Button key={`git:${key}`} plain onPress={() => rowActs[key]?.()}>
              {left}
            </Button>
            <Box flexShrink={0}>{right}</Box>
            {cardEl}
          </Box>
        )
      // A row's hover card, drawn last so it paints over the rows under it, and shown while its row's scope is
      // hovered. `row`: the row it hangs under, counted from the tab's top.
      const cards: JSX.Element[] = []
      const pointer = await read($, rowPointer)
      // While a card shows, the line between its row and the card dims, still live to the pointer: the next top row
      // line, or the rule under the last. Branch and fetch share a line.
      const topLines = [['branch', 'fetch'], ...(op ? [['rebase']] : []), ...(pr ? [['pr']] : summary ? [['prs']] : [])]
      // The CHANGES and COMMITS rows drawn, each a line of its own: its tab row and its card's rows. A card that would
      // pass the tab's bottom opens upward, so the line above it dims instead of the line below.
      const lower = [
        ...shownChanges.map((c, i) => ({ key: fileKey(c.path), zone: 'changes', at: topRows + 2 + (changesShown < changesRows ? 1 : 0) + i, n: 1 })),
        ...shownCommits.map((c, j) => ({ key: commitKey(c.full), zone: 'commits', at: commitsAt0 + j, n: 1 + (c.refs.length || c.tags.length ? 1 : 0) + (commitStats.has(c.full) ? 1 : 0) })),
      ]
      const upOf = (at: number, n: number) => at + 4 + n > tabRows
      const lines = [...topLines, ...lower.map(l => [l.key])]
      // The engine dims it, the plugin's redraw too slow (measured ~60 ms behind the lit row): each line's row Clients
      // join group `line:<n>`, and the next line's pieces fade while it is hovered. Nested in the row's Text, a piece
      // follows that group without heating it, so the pointer on it leaves it bright.
      const lineOf = (key: string) => lines.findIndex(line => line.includes(key))
      const faded = (scope: string, x: Piece) => ({ scope, color: PILL_CAPS.has(x.text) ? fadeBg(x.color) : fade(x.color), ...(x.backgroundColor && { backgroundColor: fadeBg(x.backgroundColor) }) })
      // A lower row fades for the row above it in its zone when that card opens down, and for the row below when that
      // card opens up; the second rides on a nested Text (`under`), as a Text takes one hover.
      const dimOn = (key: string, pieces: Piece[]) => {
        const i = lineOf(key)
        if (dimmed || i < 1) return pieces
        if (i < topLines.length) return pieces.map(x => ({ ...x, hover: faded(`line:${i - 1}`, x) }))
        const k = i - topLines.length
        const [prev, here, after] = [lower[k - 1], lower[k]!, lower[k + 1]]
        const fromAbove = prev && prev.zone === here.zone && !upOf(prev.at, prev.n)
        const fromBelow = after && after.zone === here.zone && upOf(after.at, after.n)
        return pieces.map(x => ({ ...x, ...(fromAbove && { hover: faded(`line:${i - 1}`, x) }), ...(fromBelow && { under: faded(`line:${i + 1}`, x) }) }))
      }
      // Shown on hover, one row below its row: a step down lands on the next row, not on the card. A card under the
      // pointer keeps its group lit, so with row Clients the card of the row last left is not drawn: a jump past the
      // next row onto the card is the row's leave.
      rowLines = Object.fromEntries(lines.flatMap((line, i) => line.map(key => [key, i])))
      const spans = cardSpan
      cardSpan = {}
      const gone = pointer.left && spans[pointer.left]
      // `anchor`: where its item sits on the row: left, right, or the whole row, centred under it.
      const card = (scope: string, row: number, anchor: 'left' | 'right' | 'center', ...rows: JSX.Element[]) => {
        const key = scope.slice(5)
        // As wide as its widest row, border and padding included, up to the 75% cap.
        // A file card's pills are all it says: it may pass the cap to show them whole.
        const width = Math.min(key.startsWith('f:') ? e.props.bodyColumns - 4 : cardWidth, cardContent(rows) + 4)
        const place = anchor === 'left' ? { left: 0 } : anchor === 'right' ? { right: 0 } : { left: Math.floor((e.props.bodyColumns - width) / 2) - PAD }
        // Its border and rows, from row + 2.
        const top = upOf(row, rows.length) ? row - rows.length - 3 : row + 2
        const span = (cardSpan[key] = [top, top + 2 + rows.length])
        const over = !!gone && span[0] < gone[1] && gone[0] < span[1]
        if (!dimmed && (!Client || key === pointer.at || (key !== pointer.left && !over)))
          cards.push(
            <Box position="absolute" top={top} {...place} width={width} display="none" hover={{ scope, display: 'flex' }} flexDirection="column" borderStyle="round" borderColor="promptBorder" backgroundColor={CARD} paddingX={1}>
              {kvAligned(rows)}
            </Box>,
          )
        return null
      }
      const hoverOf = (scope: string) => (dimmed ? undefined : { scope })
      // A card row: a faint label, its info, and a count or mark at the far right. Labels take the card's longest
      // and 2 more; under a title row they sit one column in. One row: the info is kept and the far-right text is cut.
      const kv = (label: string, info: JSX.Element | string, right?: JSX.Element): JSX.Element => {
        const row = kvRow(label, info, right)
        kvArgs.set(row, [label, info, right])
        return row
      }
      // A card's kv rows share one info column, so every far-right text starts past the same column. A row with a
      // far-right text keeps its info whole; a row with none (refs) widens the column only as far as the 75% cap
      // leaves room beside the far-right texts, and is cut with … at its end, so a long branch name cuts no count.
      const kvArgs = new WeakMap<object, [string, JSX.Element | string, JSX.Element | undefined]>()
      const infoLength = (info: JSX.Element | string) => (typeof info === 'string' ? info : toPieces(info).map(x => x.text).join('')).length
      const textLength = (node: unknown) => toPieces(node).map(x => x.text).join('').length
      const insetOf = (rows: JSX.Element[]) => (rows.some(r => !kvArgs.get(r)) ? 1 : 0)
      const labelOf = (rows: JSX.Element[]) => 2 + Math.max(0, ...rows.map(r => kvArgs.get(r)?.[0].length ?? 0))
      const sharedInfo = (rows: JSX.Element[]) => {
        const args = rows.map(r => kvArgs.get(r)).filter(Boolean) as [string, JSX.Element | string, JSX.Element | undefined][]
        const withRight = args.filter(a => a[2])
        const kept = Math.max(0, ...withRight.map(a => infoLength(a[1])))
        const right = withRight.length ? 2 + Math.max(...withRight.map(a => textLength(a[2]))) : 0
        return Math.max(kept, Math.min(Math.max(0, ...args.map(a => infoLength(a[1]))), cardWidth - 4 - labelOf(rows) - insetOf(rows) - right))
      }
      // The widest row: a kv row at the card's shared info width, any other by its text, 2 more when split by
      // space-between.
      const cardContent = (rows: JSX.Element[]) => {
        const info = sharedInfo(rows)
        const label = labelOf(rows) + insetOf(rows)
        return Math.max(0, ...rows.map(r => {
          const args = kvArgs.get(r)
          if (args) return label + info + (args[2] ? 2 + textLength(args[2]) : 0)
          return textLength(r) + ((r as any)?.props?.justifyContent === 'space-between' ? 2 : 0)
        }))
      }
      const kvAligned = (rows: JSX.Element[]) => {
        const width = sharedInfo(rows)
        const inset = insetOf(rows)
        const label = labelOf(rows)
        const room = cardWidth - 4 - label - inset
        return rows.map(r => {
          const args = kvArgs.get(r)
          if (!args) return r
          // A row short of room for a far-right text that would fit leaves the shared column, down to its own value.
          const left = args[2] ? room - 2 - textLength(args[2]) : width
          return kvRow(...args, left >= infoLength(args[1]) ? Math.min(width, left) : width, inset, label)
        })
      }
      const kvRow = (label: string, info: JSX.Element | string, right?: JSX.Element, infoWidth?: number, inset = 1, labelWidth = label.length + 2) => (
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
      // Against the upstream: ✓ in sync, ↑ unpushed, ↓ unpulled, both when diverged; local never pushed, gone deleted.
      const syncOf = (b: { upstream: string; ahead: number; behind: number }) =>
        b.upstream !== 'ok' ? <Text color={HUD.faint}>{b.upstream}</Text>
        : !b.ahead && !b.behind ? <Text color={HUD.action}>✓</Text>
        : (
          <Text>
            {b.ahead ? <Text color={AHEAD}>{`↑${b.ahead}`}</Text> : ''}
            {b.ahead && b.behind ? ' ' : ''}
            {b.behind ? <Text color={BEHIND}>{`↓${b.behind}`}</Text> : ''}
          </Text>
        )
      const sync = syncOf(hd)
      // Overview's marks: done, failed, running; skipped faint.
      const GLYPHS: Record<CheckState, [string, string]> = { ok: ['✓', HUD.action], bad: ['✗', TYPES.fix!], run: ['◌', 'claude'], skip: ['–', HUD.faint] }
      const glyph = (state: CheckState) => <Text color={GLYPHS[state][1]}>{GLYPHS[state][0]}</Text>
      // A branch prefix in its commit type's colour (feat/ green, fix/ red); any other prefix faint.
      const prefixColor = (prefix: string) => TYPES[prefix.replace(/\/$/, '')] ?? HUD.faint
      // A commit's refs as the branch modal draws names: the current branch bold in the action colour; else a remote's
      // name faint, a type prefix in its colour, the rest plain. Tags in warning. Two spaces apart.
      const refTexts = (refs: LogRow['refs'], tags: string[]) =>
        [
          ...refs.map(({ remote, branch }) => {
            if (!remote && branch === hd.name) return [<Text bold color={HUD.action}>{branch}</Text>]
            const at = branch.indexOf('/')
            return [
              ...(remote ? [<Text color={HUD.faint}>{`${remote}/`}</Text>] : []),
              ...(at < 0 ? [<Text>{branch}</Text>] : [<Text color={prefixColor(branch.slice(0, at + 1))}>{branch.slice(0, at + 1)}</Text>, <Text>{branch.slice(at + 1)}</Text>]),
            ]
          }),
          ...tags.map(tag => [<Text color="warning">{tag}</Text>]),
        ].flatMap((pieces, i) => (i ? [<Text>{'  '}</Text>, ...pieces] : pieces))
      // The tab body the modals sit in, under the tabs and their rule.
      const tabRows = e.props.scroll.bodyRows - 2 - BAR_ROWS
      // The divider fades in the last CHANGES row's group while its card hangs down, only when it is the line right
      // under that row: past empty zone rows the card never reaches it.
      const lastChange = lower.filter(l => l.zone === 'changes').at(-1)
      const underLast = lastChange && lastChange.at + 1 === topRows + 2 + changesRows
      const lastChangeLine = lastChange && underLast && !upOf(lastChange.at, lastChange.n) ? `line:${topLines.length + lower.indexOf(lastChange)}` : undefined
      const layers: { m?: Layer; s?: Layer } = {}
      // One modal layer: actions and ✕, a divider, pinned rows, the list's window with its cues.
      // A layer with no pinned rows merges its top cue into the divider. `centre`: the row to open on, when top < 0.
      const drawLayer = (layer: 'm' | 's', f: Frame, at: { top: number; left: number }, acts: JSX.Element[], pin: JSX.Element[], rows: JSX.Element[], top: number, centre = 0) => {
        const inner = f.width - 4
        const room = f.height - 4 - pin.length
        const merged = !pin.length
        const start = top >= 0 ? top : Math.max(0, centre - Math.floor(scrollWindow(rows.length, 0, room, merged).shown / 2))
        const w = scrollWindow(rows.length, start, room, merged)
        layers[layer] = { frame: f, top: w.top, end: scrollWindow(rows.length, Infinity, room, merged).top }
        const setTop = (to: number) =>
          update($, modal, m => (!m ? m : layer === 's' ? (m.sub ? { ...m, sub: { ...m.sub, top: to } } : m) : { ...m, top: to }))
        const mid = ` ${w.above} more `
        const fill = Math.max(0, inner - 2 - mid.length)
        // ── ↑ N more ──: back to the top; the arrow bold in the border colour, the count faint.
        const up = (
          <Box>
            <Text color="promptBorder">{`${'─'.repeat(Math.floor(fill / 2))} `}</Text>
            <Button key={`${layer}:up`} plain onPress={() => setTop(0)}>
              <Text bold color="promptBorder">↑</Text>
            </Button>
            <Text color={HUD.faint}>{mid}</Text>
            <Text color="promptBorder">{'─'.repeat(Math.ceil(fill / 2))}</Text>
          </Box>
        )
        // ↓ N more turns the page: the first row not shown becomes the top row.
        const down = (
          <Box justifyContent="center">
            <Button key={`${layer}:down`} plain onPress={() => setTop(w.top + w.shown)}>
              <Text bold color="promptBorder">↓</Text>
            </Button>
            <Text color={HUD.faint}>{` ${w.below} more`}</Text>
          </Box>
        )
        const close = () => setModal($, m => (layer === 's' && m ? { ...m, sub: undefined } : null))
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
      // A commit subject as COMMITS colours it: the type in its colour, the scope grey, the rest plain.
      const subjectTexts = (text: string, room = Infinity, bold = false) => {
        const shown = fit(text.replace(/[\x00-\x1f\x7f]/g, ' '), room)
        const [, type, scope, tail, rest] = /^(\w+)(?:\(([^)]*)\))?(!?: )(.*)$/.exec(shown) ?? []
        if (!type) return [<Text bold={bold}>{shown}</Text>]
        return [
          <Text bold={bold} color={TYPES[type] ?? HUD.faint}>{type}</Text>,
          ...(scope === undefined ? [] : [<Text bold={bold} color={HUD.faint}>(</Text>, <Text bold={bold} color={SCOPE}>{scope}</Text>]),
          <Text bold={bold} color={HUD.faint}>{scope === undefined ? tail : `)${tail}`}</Text>,
          <Text bold={bold}>{rest}</Text>,
        ]
      }
      const PILL: Record<PrState | Stage | Word, [string, string]> = {
        open: ['#1d3a2a', 'success'], draft: ['#2a2e33', SCOPE], merged: ['#2e2640', HUD.label], closed: ['#3a2030', 'error'],
        staged: ['#1d3a2a', 'success'], 'not staged': ['#2a2e33', SCOPE],
        modified: ['#3a3220', STATUS.M!], added: ['#1d3a2a', STATUS.A!], deleted: ['#3a2030', STATUS.D!], renamed: ['#1c2f44', STATUS.R!], untracked: ['#173538', STATUS['?']!], conflict: ['#3a2030', STATUS.U!],
      }
      // A state pill: the rounded ends in its background colour around the word.
      const pill = (state: PrState | Stage | Word) => [
        <Text color={PILL[state][0]}>{''}</Text>,
        <Text backgroundColor={PILL[state][0]} color={PILL[state][1]}>{state}</Text>,
        <Text color={PILL[state][0]}>{''}</Text>,
      ]
      const CI: Record<CheckState, [string, string]> = { bad: ['✗ CI failed', TYPES.fix!], run: ['◌ CI running', 'claude'], ok: ['✓ CI passed', HUD.action], skip: ['✓ CI passed', HUD.action] }
      // Lines added and removed; a side that is 0 is left out, as the mockup draws it: "+8", "−9".
      const churnText = (add: number, del: number) => [add || !del ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ')
      const churnOf = (add: number, del: number) => (
        <Text>
          {add || !del ? <Text color="success">{`+${add}`}</Text> : null}
          {(add || !del) && del ? ' ' : null}
          {del ? <Text color="error">{`−${del}`}</Text> : null}
        </Text>
      )
      // A changed file's parts, for a CHANGES row and every modal file list: its mark, its path cut in the middle so
      // the file name stays, and its line counts at the right (`bin` for a binary file). `room`: the path's columns
      // with no counts; counts take theirs and a 2-column gap.
      const changeParts = (mark: JSX.Element[], path: string, counts: Counts | undefined, room: number, pathColor?: string) => {
        const used = counts === 'bin' ? 3 : counts ? churnText(counts.add, counts.del).length : 0
        return {
          left: [...mark, <Text color={pathColor}>{` ${cutMiddle(printable(path), room - (used ? used + 2 : 0))}`}</Text>],
          right: counts === 'bin' ? <Text color={HUD.faint}>bin</Text> : counts ? churnOf(counts.add, counts.del) : undefined,
        }
      }
      // A modal's file row: lit under the pointer, a press opens the file in the File tab. `layer`: the modal's key
      // prefix, m or s for the stacked one. A deleted file neither lights nor opens.
      // A row Client, as a CHANGES row, so it lights where a Button would invert; a surface with no Client gets the
      // Button.
      const fileRow = (mark: JSX.Element, path: string, add: number, del: number, width: number, layer: 'm' | 's', deleted = false) => {
        const { left, right } = changeParts([mark], path, { add, del }, width - 3)
        if (deleted) return line(left, right)
        const key = `${layer}f:${fileKey(path)}`
        rowActs[key] = () => openFile(path)
        return (
          // Keyed, its own hover scope: unkeyed, it would light whenever the pointer is anywhere in the modal.
          // A column, as a CHANGES row's: the Client stretches across, so its counts end at the far right.
          <Box key={`${layer}:row:${path}`} flexDirection="column" height={1} hover={{ backgroundColor: LIT }}>
            {Client ? (
              <Client key={`row:${key}`} module="./row.tsx" height={1} props={{ left: toPieces(left), right: right ? toPieces(right) : [] }} />
            ) : (
              <Box justifyContent="space-between" gap={2}>
                <Button key={`${layer}:file:${path}`} plain onPress={() => openFile(path)}>
                  <Text wrap="truncate-end">{left}</Text>
                </Button>
                {right ? <Box flexShrink={0}>{right}</Box> : null}
              </Box>
            )}
          </Box>
        )
      }
      // A count in normal text: each standalone number in the claude colour; faint text stays faint. IDs (#n,
      // shas), times (11h), churn (+7) and numbers inside names are not counts: a number touching a letter, #, + or
      // − stays.
      const counted = (text: string) =>
        text.split(/(?<![\w#+−.\/-])(\d+)(?![\w.\/-])/).map((part, i) => (part ? <Text color={i % 2 ? 'claude' : undefined}>{part}</Text> : null))
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
      // A hover card's widest: 75% of the body.
      const cardWidth = Math.floor(e.props.bodyColumns * 0.75)
      const opRows = op ? 1 : 0
      const prRow = (() => {
        if (!pr) return null
        const ended = pr.state === 'merged' || pr.state === 'closed'
        const w = worst(pr.checks)
        const passed = pr.checks.filter(c => c.state === 'ok').length
        // The check that needs attention: the first failed one, else the first running.
        const current = pr.checks.find(c => c.state === 'bad') ?? pr.checks.find(c => c.state === 'run')
        const changes = kv('changes', <Text>{counted(`${prCommits ? `${plural(prCommits, 'commit')} · ` : ''}${plural(pr.files, 'file')}`)}</Text>, churnOf(pr.additions, pr.deletions))
        const title = <Box>{subjectTexts(pr.title, cardWidth - 4, true)}</Box>
        // A merged or closed PR: when and where it ended replaces base and checks, which no longer matter.
        const rows = ended
          ? [title, kv(pr.state, <Text><Text color={HUD.faint}>into</Text>{` ${pr.base}`}</Text>, <Text color={HUD.faint}>{`${age(pr.at, now)} ago`}</Text>), changes]
          : [
              title,
              kv(
                'base',
                pr.conflicting ? <Text><Text color={TYPES.fix}>✗</Text> conflicts</Text>
                : behind ? <Text><Text color="warning">↓</Text>{counted(` ${behind} behind`)}</Text>
                : <Text><Text color={HUD.action}>✓</Text> up to date</Text>,
                pr.conflicting && conflictFiles.length ? <Text color={HUD.faint}>{plural(conflictFiles.length, 'file')}</Text> : undefined,
              ),
              kv('checks', <Text>{glyph(w)}{counted(` ${passed} of ${pr.checks.length} passed`)}</Text>, current && <Text color={GLYPHS[current.state][1]}>{current.name}</Text>),
              changes,
            ]
        return topRow(
          'pr',
          [
            <Text dimColor={ended}>  </Text>,
            basic ? '' : <Text color="claude" dimColor={ended}>{' '}</Text>,
            <Text color="claude" dimColor={ended}>{`#${pr.n}`}</Text>,
            <Text color={HUD.faint} dimColor={ended}> into </Text>,
            <Text dimColor={ended}>{pr.base}</Text>,
            ended ? '' : pr.conflicting ? <Text color={TYPES.fix} dimColor={ended}> ✗</Text> : behind ? <Text color="warning" dimColor={ended}> !</Text> : '',
          ],
          [!ended && pr.checks.length ? <Text color={CI[w][1]}>{`${CI[w][0]} `}</Text> : null, ...pill(pr.state)],
          card('card:pr', opRows + 1, 'center', ...rows),
        )
      })()
      // The rebase or merge row: what runs, onto what, and what it waits on.
      const opRow = op && (() => {
        const rebase = op.kind === 'rebase'
        const stop = rebase ? op.steps[op.at] : undefined
        const right =
          rebase && op.edit ? [<Text color="warning">edit</Text>, <Text color={HUD.faint}>{` ${stop?.sha ?? ''}`}</Text>]
          : blocked ? [<Text color={TYPES.fix}>{`✗ ${plural(op.conflicts.length, 'conflict')}`}</Text>]
          : [<Text color={HUD.action}>✓ ready</Text>]
        const names = op.conflicts.map(c => c.path.slice(c.path.lastIndexOf('/') + 1)).join(', ')
        // The card adds where it stopped and the files to fix; the modal's actions say what to do.
        const rows = [
          rebase
            ? kv('step', <Text>{counted(`${op.at + 1} of ${op.steps.length}`)}</Text>, <Text color={HUD.faint}>{stop?.sha ?? ''}</Text>)
            : kv('incoming', <Text>{counted(plural(op.incoming.length, 'commit'))}</Text>, <Text color={HUD.faint}>{op.sha}</Text>),
          ...((rebase && op.edit) || !op.conflicts.length
            ? []
            : [
                kv(
                  op.resolved ? 'resolved' : 'conflict',
                  fit(names, cardWidth - 24),
                  op.conflicts.length > 1 ? <Text color={HUD.faint}>{plural(op.conflicts.length, 'file')}</Text> : churnOf(op.conflicts[0]!.additions, op.conflicts[0]!.deletions),
                ),
              ]),
        ]
        return (
          topRow(
            'rebase',
            [
              <Text>  </Text>,
              <Text color="warning">{rebase ? '↺ ' : ' '}</Text>,
              <Text>{rebase ? 'rebasing ' : op.verb === 'cherry-pick' ? 'cherry-picking ' : op.verb === 'revert' ? 'reverting ' : 'merging '}</Text>,
              rebase ? <Text color={HUD.faint}>onto </Text> : '',
              <Text>{rebase ? op.onto : op.from}</Text>,
            ],
            [right].flat(),
            card('card:rebase', 1, 'center', ...rows),
          )
        )
      })()
      // A summary row: two or more PRs on one row, the count and the worst CI; each PR in its card and modal.
      const summaryRow = summary && (() => {
        const bad = summary.list.filter(p => worst(p.checks) === 'bad').length
        const run = summary.list.filter(p => worst(p.checks) === 'run').length
        const right = bad ? <Text color={TYPES.fix}>{`✗ ${bad} failing`}</Text>
          : run ? <Text color="claude">{`◌ ${run} running`}</Text>
          : <Text color={HUD.action}>✓ all passed</Text>
        const item = (p: Pr) => (
          <Box justifyContent="space-between">
            <Box>
              <Text color="claude">{` #${p.n} `}</Text>
              {summary.out ? [<Text color={HUD.faint}>into </Text>, <Text>{p.base}</Text>] : subjectTexts(p.title, cardWidth - 20)}
            </Box>
            <Box>
              {glyph(worst(p.checks))}
              <Text> </Text>
              {pill(p.state)}
            </Box>
          </Box>
        )
        // A card shows at most 8 rows; past that the last counts the rest, and the modal lists them all.
        const rows = summary.list.length > 8 ? [...summary.list.slice(0, 7).map(item), <Text color={HUD.faint}>{` … ${summary.list.length - 7} more`}</Text>] : summary.list.map(item)
        return (
          topRow(
            'prs',
            [
              <Text>  </Text>,
              <Text color="claude">{summary.out ? '↗ ' : '↘ '}</Text>,
              <Text>{counted(`${summary.list.length} PRs `)}</Text>,
              <Text color={HUD.faint}>{summary.out ? 'out' : 'into '}</Text>,
              summary.out ? '' : <Text>{branchName}</Text>,
            ],
            [right].flat(),
            card('card:prs', opRows + 1, 'center', ...rows),
          )
        )
      })()
      const home = trees.length > 1 ? await $.env.get('HOME').catch(() => undefined) : undefined
      const parent = trees[0]?.path.replace(/[^/]+$/, '') ?? ''
      // Beside the main worktree as ../, else under home as ~.
      const where = (path: string) => (parent !== '/' && path.startsWith(parent) ? `../${path.slice(parent.length)}` : home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
      // Cut from the start: a worktree's last folder tells it apart.
      const endOf = (path: string, room: number) => (path.length <= room ? path : `…${path.slice(1 - room)}`)
      const modalRows = (want: number) => modalFrame(e.props.bodyColumns, tabRows, want)
      if (open?.key === 'branch' && dropped(branchRead))
        branchRead = {
          key,
          signal: next.signal,
          run: $.process.run(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => undefined),
        }
      const defaultRun = open?.key === 'branch' ? await branchRead!.run : undefined
      const view = await read($, branchView)
      const showTrees = open?.key === 'branch' && view.by === 'worktrees' && trees.length > 1
      // Off the draw, each count landing on its own: a slow worktree holds back no other draw.
      if (showTrees && dropped(treeRead)) {
        const { signal } = next
        treeRead = { key, signal }
        for (const t of trees.slice(1).filter(t => !t.gone && t.path !== root))
          $.clock.after(0, () =>
            $.process
              .run(['git', '--no-optional-locks', '-C', t.path, 'status', '--porcelain'], { timeoutMs: 5000 })
              .then(
                r => (r.exitCode ? null : r.stdout.split('\n').filter(Boolean).length),
                () => null,
              )
              .then(count => {
                // A run lost with a dropped draw says nothing about the worktree: the next draw reads it again.
                if (count === null && signal.aborted) return
                treeStatus.set(t.path, count)
                $.ui.invalidate('ui.render')
              }),
          )
      }
      const views = await read($, prViews)
      const commitViewsNow = await read($, commitViews)
      // The branch modal: the tree of local branches, the current one lit; it opens on it. Rows only inform.
      const branchModal = () => {
        const defaultName = (defaultRun?.exitCode === 0 && defaultRun.stdout.trim().replace(/^origin\//, '')) || 'main'
        const list = branches(refs?.exitCode === 0 ? refs.stdout : '', prs, worktreeList, defaultName)
        // The worktrees view only while there is a linked worktree; else base.
        const by = showTrees ? 'worktrees' : view.by === 'worktrees' ? 'base' : view.by
        const tree = by === 'worktrees' ? [] : treeRows(list, by, view.showMerged)
        const merged = by === 'worktrees' ? 0 : list.filter(b => b.pr?.state === 'merged').length
        const linkedTrees = trees.slice(1)
        // Columns: sync, the PR with its mark, age. Each as wide as its widest cell, 2 columns apart and 2 past the
        // widest name, so they read with it; a column no row fills is dropped.
        const shown = tree.flatMap(r => (r.branch ? [r.branch] : []))
        const cols = [
          Math.max(0, ...shown.map(b => toPieces(syncOf(b)).map(x => x.text).join('').length)),
          Math.max(0, ...shown.map(b => (b.pr ? `#${b.pr.n}`.length + 2 : 0))),
          Math.max(0, ...shown.map(b => age(b.at, now).length)),
        ]
        const colsWidth = cols.filter(Boolean).reduce((n, w) => n + w + 2, 0)
        // ⎇ on the current branch and ⧉ on a worktree's, each 2 columns.
        const marks = (name?: string, worktree?: boolean) => (name === hd.name ? 2 : 0) + (worktree ? 2 : 0)
        const widestBranch = Math.max(0, ...tree.map(r => r.guide.length + r.label.length + marks(r.branch?.name, r.branch?.worktree)))
        const synced = new Map(list.map(b => [b.name, b]))
        // The worktrees view's columns: sync, then changed files or gone.
        const treeCells = linkedTrees.map(t => {
          const b = t.branch ? synced.get(t.branch) : undefined
          const changed = t.path === root ? files.length : treeStatus.get(t.path)
          return [
            !t.gone && b ? syncOf(b) : null,
            t.gone ? <Text color={HUD.faint}>gone</Text> : changed === null ? <Text color="warning">? changed</Text> : changed ? <Text color={HUD.faint}>{`${changed} changed`}</Text> : null,
          ]
        })
        const treeCols = [0, 1].map(i => Math.max(0, ...treeCells.map(cells => textLength(cells[i]))))
        const treeColsWidth = treeCols.filter(Boolean).reduce((n, w) => n + w + 2, 0)
        const widestTree = Math.max(0, ...linkedTrees.map(t => t.branch?.length ?? 8 + where(t.path).length))
        const viewNames = ['base', 'prefix', ...(trees.length > 1 ? (['worktrees'] as const) : [])] as const
        // The actions row needs each label, 2 between, then the ✕; the merged row its words and `show`.
        const actsWidth = viewNames.reduce((n, one) => n + one.length + 4, 1)
        const mergedWidth = merged ? `${merged} merged hidden`.length + 6 : 0
        const rowsWidth = by === 'worktrees' ? widestTree + treeColsWidth : widestBranch + colsWidth
        // As wide as its rows, not the pane: columns sit with the names and the frame leaves no blank right side.
        const f = contentFrame(modalRows(4 + (by === 'worktrees' ? linkedTrees.length : tree.length) + (merged ? 2 : 0)), Math.max(actsWidth, mergedWidth, rowsWidth))
        const inner = f.width - 4
        const room = inner - colsWidth
        const treeNameCol = Math.min(room, widestBranch)
        // Sync and changes kept whole, the name cut to the rest. Only a detached one's path shows, as its id names no
        // folder; it takes what is left, and under 4 columns shows not at all.
        const left = inner - treeColsWidth
        // Sync and changes follow the widest name: with no path to fill it, the far right leaves a gulf.
        const nameCol = Math.min(left, widestTree)
        const worktreeRow = (t: (typeof trees)[number], i: number) => {
          const name = fit(t.branch ?? t.head.slice(0, 7), left)
          const pathRoom = left - name.length - 1
          const at = name.indexOf('/')
          const label = t.path === root ? [<Text bold color={HUD.action}>{name}</Text>]
            : !t.branch ? [<Text color={HUD.faint}>{name}</Text>]
            : at < 0 ? [<Text>{name}</Text>]
            : [<Text color={prefixColor(name.slice(0, at + 1))}>{name.slice(0, at + 1)}</Text>, <Text>{name.slice(at + 1)}</Text>]
          return (
            <Box gap={2} backgroundColor={t.path === root ? LIT : undefined}>
              <Box width={nameCol} flexShrink={0}>
                {label}
                {!t.branch && pathRoom >= 4 ? <Text color={HUD.faint}>{` ${endOf(printable(where(t.path)), pathRoom)}`}</Text> : null}
              </Box>
              {treeCells[i]!.flatMap((cell, c) => (treeCols[c] ? [<Box width={treeCols[c]} justifyContent="flex-end">{cell}</Box>] : []))}
            </Box>
          )
        }
        const rows = by === 'worktrees' ? linkedTrees.map(worktreeRow) : tree.map(r => {
          const b = r.branch
          const isCurrent = b?.name === hd.name
          const at = r.label.indexOf('/')
          const rest = room - r.guide.length - marks(b?.name, b?.worktree)
          const label = isCurrent
            ? [<Text bold color={HUD.action}>⎇ </Text>, <Text bold color={HUD.action}>{fit(r.label, rest)}</Text>]
            : r.heading || at < 0
              ? [<Text color={r.heading ? prefixColor(r.heading) : undefined}>{fit(r.label, rest)}</Text>]
              : [<Text color={prefixColor(r.label.slice(0, at + 1))}>{r.label.slice(0, at + 1)}</Text>, <Text>{fit(r.label.slice(at + 1), rest - at - 1)}</Text>]
          return (
            <Box gap={2} backgroundColor={isCurrent ? LIT : undefined}>
              <Box width={b ? treeNameCol : undefined} flexShrink={0}>
                {r.guide ? <Text color={HUD.faint}>{r.guide}</Text> : null}
                {label}
                {b?.worktree ? <Text color={HUD.faint}> ⧉</Text> : null}
              </Box>
              {b
                ? [
                    syncOf(b),
                    b.pr ? (
                      <Text>
                        <Text color={HUD.faint}>{`#${b.pr.n} `}</Text>
                        {b.pr.state === 'merged' ? <Text color={HUD.label}>{'\uf419'}</Text> : glyph(worst(b.pr.checks))}
                      </Text>
                    ) : null,
                    <Text color={HUD.faint}>{age(b.at, now)}</Text>,
                  ].flatMap((cell, i) => (cols[i] ? [<Box width={cols[i]} justifyContent="flex-end">{cell}</Box>] : []))
                : null}
            </Box>
          )
        })
        if (merged)
          rows.push(
            <Text color="promptBorder">{'─'.repeat(inner)}</Text>,
            <Box justifyContent="space-between">
              <Text color={HUD.faint}>{`${merged} merged${view.showMerged ? '' : ' hidden'}`}</Text>
              <Button key="m:merged" plain onPress={() => update($, branchView, v => ({ ...v, showMerged: !v.showMerged }))}>
                <Text color="claude">{view.showMerged ? 'hide' : 'show'}</Text>
              </Button>
            </Box>,
          )
        // The chosen view is plain text; only the other is a button, and switching opens on the current branch again.
        const acts = viewNames.map(one => {
          const label = `${one === 'base' ? '\uf419' : one === 'prefix' ? '\uea83' : '⧉'} ${one}`
          return by === one ? (
            <Text color="claude">{label}</Text>
          ) : (
            <Button key={`m:by:${one}`} plain dimColor onPress={() => Promise.all([update($, branchView, v => ({ ...v, by: one })), update($, modal, m => m && { ...m, top: -1 })])}>
              {label}
            </Button>
          )
        })
        const here = by === 'worktrees' ? linkedTrees.findIndex(t => t.path === root) : tree.findIndex(r => r.branch?.name === hd.name)
        return drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top, here)
      }
      const inner = modalRows(0).width - 4
      // A row too wide for its layer (a stacked modal is narrower than the rows it reuses) is cut at the left side's
      // end, as one string, 2 columns before the right side: every row breaks at the same column.
      const line = (left: JSX.Element | JSX.Element[], right?: JSX.Element) => (
        <Box justifyContent="space-between" gap={2}>
          <Text wrap="truncate-end">{left}</Text>
          {right ? <Box flexShrink={0}>{right}</Box> : null}
        </Box>
      )
      const heading = (label: string, right?: JSX.Element) => line(<Text bold color={HUD.label}>{label}</Text>, right)
      const rule = <Text color="promptBorder">{'─'.repeat(inner)}</Text>
      const showAll = (label: string) => (
        <Box>
          <Text>  </Text>
          <Button key={`m:all:${label}`} plain onPress={() => update($, modal, m => m && { ...m, sub: { key: label, top: 0 } })}>
            <Text color="claude">show all</Text>
          </Button>
        </Box>
      )
      // A check: its mark and name, its run time at the right.
      const checkLine = (c: Check) => line([<Text> </Text>, glyph(c.state), <Text>{` ${c.name}`}</Text>], <Text color={c.state === 'run' ? 'claude' : HUD.faint}>{c.time}</Text>)
      // `full`: the rows a stacked modal shows at its own width, where they wrap to it.
      type Section = { label: string; right?: JSX.Element; rows: JSX.Element[]; shown?: JSX.Element[]; from?: number; full?: (inner: number) => JSX.Element[] }
      // A modal of sections under a head: each list capped, "show all" opening it whole in a stacked modal.
      const sectionModal = (head: JSX.Element[], sections: Section[], acts: JSX.Element[], subActs: (label: string) => JSX.Element[]) => {
        const rows = [
          ...head,
          ...sections.flatMap(one => {
            const cap = capped(one.rows, one.from)
            return [rule, heading(one.label, one.right), ...(one.shown ?? cap.rows), ...(cap.more ? [showAll(one.label)] : [])]
          }),
        ]
        const f = modalRows(4 + rows.length)
        const sub = open?.sub && sections.find(one => one.label === open.sub!.key)
        // As for a modal: a stacked one whose list has gone closes.
        if (open?.sub && !sub && !next.signal.aborted) $.clock.after(0, () => setModal($, m => (m?.sub?.key === open.sub!.key ? { ...m, sub: undefined } : m)))
        // The stacked modal is drawn after the modal, not in it, so the modal's border never paints over it.
        const stacked = sub && (() => {
          const width = stackFrame(e.props.bodyColumns, tabRows, f, 0).width - 4
          const all = sub.full?.(width) ?? sub.rows
          const sf = stackFrame(e.props.bodyColumns, tabRows, f, 5 + all.length)
          return drawLayer('s', sf, { top: sf.top, left: sf.left - PAD }, subActs(sub.label), [heading(sub.label, sub.right)], all, open!.sub!.top)
        })()
        return [drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top), stacked || null]
      }
      // A Markdown body 1 column in, numbers in counted()'s colour, code spans in the colour the engine gives them,
      // fence lines through the engine's highlighter.
      const mdBody = (body: string, width: number) =>
          mdRows(body, width - 1).map(r =>
            'code' in r ? (
              <Box paddingLeft={1}>
                <Code source={r.code || ' '} language={r.language} wrap="truncate-end" />
              </Box>
            ) : (
              <Text>
                {' '.repeat(1 + r.indent)}
                {r.spans.map(sp =>
                  sp.href ? (
                    <Link href={sp.href}>
                      <Text>{sp.text}</Text>
                    </Link>
                  ) : sp.code ? (
                    <Text color="permission">{sp.text}</Text>
                  ) : (
                    <Text bold={sp.bold} italic={sp.italic}>
                      {counted(sp.text)}
                    </Text>
                  ),
                )}
              </Text>
            ),
          )
      const VERB: Record<PrState, string> = { open: 'opened', draft: 'drafted', merged: 'merged', closed: 'closed' }
      // The PR modal: title and who and when, then its sections, each capped with "show all" opening it stacked.
      const prModal = () => {
        if (!pr) return null
        const view = views[pr.n]
        // A merged or closed PR's checks have all finished.
        const ended = pr.state === 'merged' || pr.state === 'closed'
        const checks = sortChecks(ended ? pr.checks.map(c => (c.state === 'run' ? { ...c, state: 'ok' as const, time: '' } : c)) : pr.checks)
        const passed = checks.filter(c => c.state === 'ok').length
        // The body 1 column in, numbers in counted()'s colour, code spans in the colour the engine gives them, fence
        // lines through the engine's highlighter.
        const descRows = (width: number) => mdBody(view?.body ?? '', width)
        const desc = descRows(inner)
        // A failed check's last log lines, red-edged under its row at the name's column: the row names the check.
        const logged = view?.log && checks.find(c => c.name === view.log!.check)
        const withLog = (list: Check[]) =>
          list.flatMap(c => [checkLine(c), ...(c === logged ? view!.log!.lines.map(text => line([<Text>   </Text>, <Text color={TYPES.fix}>▎</Text>, <Text color={HUD.faint}>{text}</Text>])) : [])])
        const files = (width: number, layer: 'm' | 's' = 's') =>
          (view?.files ?? []).map(f => fileRow(<Text color={STATUS[f.status] ?? HUD.faint}>{` ${f.status}`}</Text>, f.path, f.additions, f.deletions, width, layer, f.status === 'D'))
        const sections: Section[] = [
          ...(desc.length
            ? [{
                label: 'DESCRIPTION',
                rows: desc,
                full: descRows,
              }]
            : []),
          {
            label: 'CHECKS',
            right: <Text color={HUD.faint}>{`${passed} of ${checks.length} passed`}</Text>,
            // Counted and capped by check; the log rides under its check, in the modal and stacked.
            rows: checks.map(checkLine),
            shown: withLog(capped(checks).rows),
            full: () => withLog(checks),
          },
          ...(view
            ? [
                {
                  label: 'COMMITS',
                  right: <Text color={HUD.faint}>{`${view.commits.length} total`}</Text>,
                  rows: view.commits.map(c => line([<Text> </Text>, ...subjectTexts(c.subject)], <Text color={HUD.faint}>{`${age(c.at, now)} ago`}</Text>)),
                },
                {
                  label: 'FILES',
                  right: (
                    <Text>
                      <Text color={HUD.faint}>{`${view.files.length} total  `}</Text>
                      {churnOf(view.files.reduce((n, f) => n + f.additions, 0), view.files.reduce((n, f) => n + f.deletions, 0))}
                    </Text>
                  ),
                  rows: files(inner, 'm'),
                  full: files,
                },
              ]
            : []),
        ]
        const failedRuns = [...new Set(checks.filter(c => c.state === 'bad' && c.run).map(c => c.run!))]
        const rerun = (layer: 'm' | 's') => (
          <Button key={`${layer}:rerun`} plain onPress={() => rerunFailed($, failedRuns)}>
            <Text color="claude">{'\uebc0 rerun'}</Text>
          </Button>
        )
        // Each action its icon and one word in the accent, as the mockup's buttons; github is a link, so the terminal
        // opens the page.
        const acts = [
          <Link href={pr.url}>
            <Text color="claude">{'\uf408 github'}</Text>
          </Link>,
          <Button key="m:copy" plain onPress={press => $.ui.copy({ text: pr.url, surface: press.surface })}>
            <Text color="claude">{'\uf44c copy'}</Text>
          </Button>,
          ...(failedRuns.length ? [rerun('m')] : []),
        ]
        return sectionModal(
          [
            line(subjectTexts(pr.title, Infinity, true)),
            line([<Text color="claude">{` #${pr.n}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{pr.author}</Text>], <Text color={HUD.faint}>{`${VERB[pr.state]} ${age(pr.at, now)} ago`}</Text>),
            ...(pr.conflicting && conflictFiles.length
              ? [line([<Text color={TYPES.fix}> ✗</Text>, <Text>{` conflicts in ${conflictFiles.map(path => path.slice(path.lastIndexOf('/') + 1)).join(', ')}`}</Text>])]
              : []),
          ],
          sections,
          acts,
          label => (label === 'CHECKS' && failedRuns.length ? [rerun('s')] : []),
        )
      }
      // The commit modal: the subject, who and when, its refs; then its body and files, each capped with "show all".
      const commitModal = () => {
        const opened = open?.sha ? commitViewsNow[open.sha] : undefined
        if (!opened) return null
        const { row, view } = opened
        const files = (width: number, layer: 'm' | 's' = 's') =>
          (view?.files ?? []).map(f => fileRow(<Text color={STATUS[f.status] ?? HUD.faint}>{` ${f.status}`}</Text>, f.path, f.additions, f.deletions, width, layer, f.status === 'D'))
        const sections: Section[] = [
          ...(view?.body ? [{ label: 'DESCRIPTION', rows: mdBody(view.body, inner), full: (width: number) => mdBody(view.body, width) }] : []),
          ...(view
            ? [{
                label: 'FILES',
                right: (
                  <Text>
                    <Text color={HUD.faint}>{`${view.files.length} total  `}</Text>
                    {churnOf(view.files.reduce((n, f) => n + f.additions, 0), view.files.reduce((n, f) => n + f.deletions, 0))}
                  </Text>
                ),
                rows: files(inner, 'm'),
                full: files,
              }]
            : []),
        ]
        // A page only for a commit some remote surely has: not when the unpushed list failed.
        const href = local && !local.has(row.full) && web?.commit(row.full)
        const acts = [
          ...(href
            ? [
                <Link href={href}>
                  <Text color="claude">{'\uf408 github'}</Text>
                </Link>,
              ]
            : []),
          <Button key="m:copy" plain onPress={press => $.ui.copy({ text: row.full, surface: press.surface })}>
            <Text color="claude">{'\uf44c copy'}</Text>
          </Button>,
        ]
        return sectionModal(
          [
            line(subjectTexts(row.subject, Infinity, true)),
            line([<Text color="claude">{` ${row.short}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{row.author}</Text>], <Text color={HUD.faint}>{`${age(row.at, now)} ago`}</Text>),
            ...(row.refs.length || row.tags.length ? [line([<Text> </Text>, ...refTexts(row.refs, row.tags)])] : []),
          ],
          sections,
          acts,
          () => [],
        )
      }
      // The rebase or merge modal: the commit it stopped on, the steps with Overview's marks, the files to fix.
      const rebaseModal = () => {
        if (!op) return null
        const rebase = op.kind === 'rebase'
        const ready = !blocked
        const runGit = async (argv: string[]) => {
          if (gitActing) return
          gitActing = true
          try {
            // No editor: continue and commit keep the message git wrote.
            const run = await $.process.run(['git', '-c', 'core.editor=true', ...argv]).catch(() => undefined)
            if (run?.exitCode !== 0) $.ui.toast(`git ${argv[0]} failed: ${(run?.stderr ?? '').split('\n')[0]}`)
            // Closed: a rebase that ended must not open it again at the next one; a new stop is a click away.
            await setModal($, () => null)
            await update($, toolCalls, n => n + 1)
          } finally {
            gitActing = false
          }
        }
        // abort throws work away (red); continue and commit go forward (green) once nothing blocks them.
        // abort and skip lose work, and sit side by side: the first press asks, the second runs.
        const act = (word: string, icon: string, argv: string[]) => {
          const asks = word === 'abort' || word === 'skip'
          // Held for this step only: the rebase may move on while the modal stays open.
          const ask = `${word}:${rebase ? op.at : ''}`
          const asking = open?.armed === ask
          return (
            <Button key={`m:${word}`} plain onPress={() => (asks && !asking ? setModal($, m => m && { ...m, armed: ask }) : runGit(argv))}>
              {/* The mockup's buttons: abort throws work away (error); continue and commit go forward (success) once
                  nothing blocks them; else the accent. */}
              <Text color={word === 'abort' || asking ? 'error' : ready && (word === 'continue' || word === 'commit') ? 'success' : 'claude'}>{`${icon} ${word}${asking ? '?' : ''}`}</Text>
            </Button>
          )
        }
        const acts = rebase
          ? [act('continue', '', ['rebase', '--continue']), act('skip', '', ['rebase', '--skip']), act('abort', '', ['rebase', '--abort'])]
          : [act('commit', '', ['commit', '--no-edit']), act('abort', '', [op.verb ?? 'merge', '--abort'])]
        const mark = (m: 'done' | 'stop' | 'todo') =>
          m === 'done' ? <Text color={HUD.action}>✓</Text>
          : m === 'todo' ? <Text color={HUD.faint}>○</Text>
          : blocked ? <Text color={TYPES.fix}>✗</Text>
          : <Text color={HUD.dirty}>■</Text>
        const conflicts = (width: number, layer: 'm' | 's' = 's') =>
          op.conflicts.map(c => fileRow(<Text color={op.resolved ? HUD.action : TYPES.fix}>{` ${op.resolved ? 'M' : 'U'}`}</Text>, c.path, c.additions, c.deletions, width, layer))
        const commits: Section = rebase
          ? {
              label: 'COMMITS',
              right: <Text color={HUD.faint}>{`${op.steps.length} total`}</Text>,
              rows: op.steps.map(st =>
                line(
                  [<Text> </Text>, mark(st.mark), <Text> </Text>, ...(st.mark === 'todo' ? [<Text color={HUD.faint}>{st.subject}</Text>] : subjectTexts(st.subject))],
                  <Text color={HUD.faint}>{st.sha}</Text>,
                ),
              ),
              from: op.at - 1,
            }
          : {
              label: 'COMMITS',
              right: <Text color={HUD.faint}>{`${op.incoming.length} total`}</Text>,
              rows: op.incoming.map(c => line([<Text> </Text>, ...subjectTexts(c.subject)], <Text color={HUD.faint}>{`${age(c.at, now)} ago`}</Text>)),
            }
        const files: Section[] = op.conflicts.length
          ? [{
              label: op.resolved ? 'RESOLVED' : 'CONFLICTS',
              right: <Text color={HUD.faint}>{`${op.conflicts.length} total`}</Text>,
              rows: conflicts(inner, 'm'),
              full: conflicts,
            }]
          : []
        const stop = rebase ? op.steps[op.at] : undefined
        const head = rebase
          ? [
              line(subjectTexts(stop?.subject ?? '', Infinity, true)),
              line(<Text color="claude">{` ${stop?.sha ?? ''}`}</Text>, <Text color={HUD.faint}>{`step ${op.at + 1} of ${op.steps.length}${op.edit ? ', stopped to edit' : ''}`}</Text>),
            ]
          : [
              line(<Text bold>{op.verb ? (op.incoming[0]?.subject ?? op.from) : `Merge branch '${op.from}' into ${op.head}`}</Text>),
              line(<Text color="claude">{` ${op.sha}`}</Text>, <Text color={HUD.faint}>{plural(op.incoming.length, 'incoming commit')}</Text>),
            ]
        return sectionModal(head, [commits, ...files], acts, () => [])
      }
      // The summary modal: each PR as two rows between dividers; a PR opens its own details stacked over it.
      const summaryModal = () => {
        if (!summary) return null
        const label = `${summary.list.length} PRs`
        const block = (p: Pr) => [
          <Box justifyContent="space-between">
            <Button key={`m:pr:${p.n}`} plain onPress={() => update($, modal, m => m && { ...m, sub: { key: `pr:${p.n}`, top: 0 } })}>
              <Text color="claude">{` #${p.n} `}</Text>
              {subjectTexts(p.title, inner - 22)}
            </Button>
            <Box>
              {glyph(worst(p.checks))}
              <Text> </Text>
              {pill(p.state)}
            </Box>
          </Box>,
          line([<Text>{`  ${p.author}`}</Text>, <Text color={HUD.faint}>{' from '}</Text>, <Text color={HUD.faint}>{p.head}</Text>], <Text color={HUD.faint}>{`${age(p.at, now)} ago`}</Text>),
        ]
        const join = (blocks: JSX.Element[][]) => blocks.flatMap((b, i) => (i ? [rule, ...b] : b))
        const blocks = summary.list.map(block)
        const cap = capped(blocks)
        const rows = [...join(cap.rows), ...(cap.more ? [showAll(label)] : [])]
        const f = modalRows(4 + rows.length)
        const sub = open?.sub
        const subPr = sub?.key.startsWith('pr:') ? summary.list.find(p => `pr:${p.n}` === sub.key) : undefined
        const at = (sf: Frame) => ({ top: sf.top, left: sf.left - PAD })
        // A PR stacked: its title pinned, who and when, its checks.
        const stacked = !sub ? undefined
          : subPr ? (() => {
              const checks = sortChecks(subPr.checks)
              const runs = [...new Set(checks.filter(c => c.state === 'bad' && c.run).map(c => c.run!))]
              const subRows = [
                line([<Text color="claude">{` #${subPr.n}`}</Text>, <Text color={HUD.faint}>{' by '}</Text>, <Text>{subPr.author}</Text>], <Text color={HUD.faint}>{`${VERB[subPr.state]} ${age(subPr.at, now)} ago`}</Text>),
                rule,
                heading('CHECKS', <Text color={HUD.faint}>{`${checks.filter(c => c.state === 'ok').length} of ${checks.length} passed`}</Text>),
                ...checks.map(checkLine),
              ]
              const sf = stackFrame(e.props.bodyColumns, tabRows, f, 5 + subRows.length)
              const acts = [
                <Link href={subPr.url}>
                  <Text>{' github'}</Text>
                </Link>,
                ...(runs.length
                  ? [
                      <Button key="s:rerun" plain onPress={() => rerunFailed($, runs)}>
                        <Text>{' rerun'}</Text>
                      </Button>,
                    ]
                  : []),
              ]
              return drawLayer('s', sf, at(sf), acts, [line(subjectTexts(subPr.title, Infinity, true))], subRows, sub.top)
            })()
          : sub.key === label ? (() => {
              const all = join(blocks)
              const sf = stackFrame(e.props.bodyColumns, tabRows, f, 5 + all.length)
              return drawLayer('s', sf, at(sf), [], [heading(label.toUpperCase())], all, sub.top)
            })()
          : undefined
        const pulls = summary.list[0]!.url.replace(/\/pull\/\d+$/, '/pulls')
        const acts = [
          <Link href={pulls}>
            <Text>{' github'}</Text>
          </Link>,
        ]
        return [drawLayer('m', f, { top: f.top, left: f.left - PAD }, acts, [], rows, open!.top), stacked ?? null]
      }
      const modalBox = !dimmed ? null : open?.key === 'commit' ? commitModal() : open?.key === 'prs' ? summaryModal() : open?.key === 'branch' ? branchModal() : open?.key === 'pr' ? prModal() : open?.key === 'rebase' ? rebaseModal() : null
      // Only a live draw sets them, as gitZones.
      if (!next.signal.aborted) modalZone = layers.m ? { m: layers.m, s: layers.s } : undefined
      body = !head ? (
        // The rows under the tabs and their rule. No answer at all: git is not on PATH, or the surface
        // runs no command.
        status ? (
          emptyNote(
            e.props.scroll.bodyRows - BAR_ROWS - 2,
            'Not a git repository',
            <Text color={HUD.faint}>Branch, changes and commits</Text>,
            <Text color={HUD.faint}>show here inside a repo.</Text>,
          )
        ) : (
          emptyNote(
            e.props.scroll.bodyRows - BAR_ROWS - 2,
            "Git can't run here",
            <Text color={HUD.faint}>It needs git on PATH,</Text>,
            <Text color={HUD.faint}>in a terminal session.</Text>,
          )
        )
      ) : (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            {/* The HUD statusline's branch glyph and green; one mark after it only when the branch needs you. */}
            {topRow(
              'branch',
              [<Text color={HUD.action}>{branchLabel}</Text>, linked && <Text color={HUD.faint}> ⧉</Text>, mark && <Text color={MARKS[mark][1]}>{` ${MARKS[mark][0]}`}</Text>],
              [],
              card('card:branch', 0, 'left', upstreamName ? kv('upstream', upstreamName, sync) : kv('upstream', hd.upstream), ...(stashes ? [kv('stash', <Text>{counted(`${stashes} on this branch`)}</Text>)] : [])),
              [...branchLabel].length + (linked ? 2 : 0) + (mark ? 2 : 0),
            )}
            {topRow(
              'fetch',
              [isFetching ? <Text color="claude">◌ fetching</Text> : <Text color={stale ? 'warning' : HUD.faint}>{fetchLabel}</Text>],
              [],
              card(
                'card:fetch',
                0,
                'right',
                kv('fetched', <Text color={stale ? 'warning' : undefined}>{fetchedText}</Text>),
                // The URL cut in the middle to the card: border and padding, the label ("fetched" and 2), "origin  ".
                ...(remoteUrl ? [kv('remote', <Text>origin  <Text color={HUD.faint}>{cutMiddle(remoteUrl, cardWidth - 4 - 9 - 8)}</Text></Text>)] : []),
              ),
              fetchWidth,
            )}
          </Box>
          {opRow}
          {prRow}
          {summaryRow}
          {/* The primer pane's rule color, as every margin rule but History's day lines. */}
          <Text>
            <Text color="promptBorder" hover={dimmed ? undefined : { scope: `line:${topLines.length - 1}`, color: fade('promptBorder') }}>
              {bodyRule}
            </Text>
          </Text>
          {files.length > 0 && (
            <Box justifyContent="space-between">
              <Text bold color={HUD.label}>CHANGES</Text>
              <Box>
                {fits(`${files.length} files`) && <Text color={HUD.faint}>{`${files.length} files`}</Text>}
                {(summed.add || summed.del) && fits(`${files.length} files`, `  +${summed.add} −${summed.del}`) ? (
                  <Text>
                    {'  '}
                    {churnOf(summed.add, summed.del)}
                  </Text>
                ) : null}
              </Box>
            </Box>
          )}
          {files.length > 0 && changesRows > 0 && (
            <Box flexDirection="column" height={changesRows}>
              {changesShown < changesRows && topLine('top:changes', () => update($, scrolled, top => ({ ...top, changes: 0 })), dimmed)}
              {shownChanges.map((c, i) => {
                const color = STATUS[c.letter] ?? HUD.faint
                // Two columns in, the letter, then the path and counts as every file list draws them.
                const { left, right } = changeParts([<Text>  </Text>, <Text color={c.dim ? dim(color) : color}>{c.letter}</Text>], c.path, counts.get(c.path) ?? lineCounts.get(c.path), room - 3, c.dim ? HUD.faint : undefined)
                const status = <Text wrap="truncate-end">{[c.word, ...c.stage].flatMap((s, j) => [...(j ? [<Text> </Text>] : []), ...pill(s)])}</Text>
                return topRow(
                  fileKey(c.path),
                  left,
                  right ? [right] : [],
                  card(`card:${fileKey(c.path)}`, topRows + 2 + (changesShown < changesRows ? 1 : 0) + i, 'center', status),
                )
              })}
            </Box>
          )}
          {/* Only the terminal and desktop draw a Client: elsewhere the rule stays put. */}
          {files.length > 0 &&
            (Client ? (
              <Client key="divider" module="./divider.tsx" props={{ split: changesRows, min: changesMin, max: changesMax, faded: dimmed, ...(!dimmed && lastChangeLine && { line: lastChangeLine }) }} height={1} />
            ) : (
              <Text color="promptBorder">{bodyRule}</Text>
            ))}
          {commits.length > 0 && (
            <Box justifyContent="space-between">
              <Text bold color={HUD.label}>COMMITS</Text>
              {/* Unpushed is ahead, gold as everywhere; the total faint. */}
              <Box>
                {aheadCount && fits(aheadCount) && <Text color={AHEAD}>{aheadCount}</Text>}
                {totalCount && fits(aheadCount, totalCount) && <Text color={HUD.faint}>{totalCount}</Text>}
              </Box>
            </Box>
          )}
          {commitsShown < commitsRows && topLine('top:commits', () => update($, scrolled, top => ({ ...top, commits: 0 })), dimmed)}
          {/* Local commits bright, pushed ones dim; the type colored by what it does (TYPES). */}
          {shownCommits.map(({ full, short, author, at, refs, tags, subject: text }, j) => {
            const isLocal = !!local?.has(full)
            const when = age(at, now)
            // A control character in any text gets the whole pane refused. Two columns in, the age 2 after.
            const shown = fit(text.replace(/[\x00-\x1f\x7f]/g, ' '), room - when.length - 1)
            // "type(scope)!: rest"; a subject cut inside the type part shows plain.
            const [, type, scope, tail, rest] = /^(\w+)(?:\(([^)]*)\))?(!?: )(.*)$/.exec(shown) ?? []
            const known = type ? TYPES[type] : undefined
            const typeColor = !known ? HUD.faint : isLocal ? known : dim(known)
            const left = type
              ? [
                  <Text>  </Text>,
                  <Text color={typeColor}>{type}</Text>,
                  ...(scope === undefined ? [] : [<Text color={HUD.faint}>(</Text>, <Text color={isLocal ? SCOPE : HUD.faint}>{scope}</Text>]),
                  <Text color={HUD.faint}>{scope === undefined ? tail : `)${tail}`}</Text>,
                  <Text color={isLocal ? undefined : HUD.faint}>{rest}</Text>,
                ]
              : [<Text>  </Text>, <Text color={isLocal ? undefined : HUD.faint}>{shown}</Text>]
            const stat = commitStats.get(full)
            // The author gives way first: the age and counts stay whole. `commit` or `changes`, and 2 more, sets the label.
            const authorRoom = cardWidth - 4 - (stat ? 9 : 8) - 2 - when.length - short.length - 4
            return topRow(
              commitKey(full),
              left,
              [<Text color={HUD.faint}>{when}</Text>],
              card(
                `card:${commitKey(full)}`,
                commitsAt0 + j,
                'center',
                kv('commit', <Text><Text color="claude">{short}</Text><Text color={HUD.faint}>{' by '}</Text><Text>{fit(author, Math.max(1, authorRoom))}</Text></Text>, <Text color={HUD.faint}>{when}</Text>),
                ...(refs.length || tags.length ? [kv('refs', <Text>{refTexts(refs, tags)}</Text>)] : []),
                ...(stat ? [kv('changes', <Text>{counted(plural(stat.files, 'file'))}</Text>, churnOf(stat.add, stat.del))] : []),
              ),
            )
          })}
          {cards}
          {modalBox}
        </Box>
      )
      // Behind an open modal everything fades but the row that opened it; under a stacked modal the modal fades too.
      if (head && dimmed) body = fadeTree(body, new Set([layers.s ? 'stack' : 'modal']), () => setModal($, () => null), `${Client ? 'row' : 'hov'}:${openRow}`)
    } else {
      const shown = await read($, intent)
      const about = await read($, overview)
      const agentRows = hang(shown.steps, await read($, spawns), shown.turn ?? -1)
      const open = await read($, expanded)
      viewing = e.props.view?.agentId
      const width = e.props.bodyColumns - 2 * PAD
      // Only the first read builds the list; every later one updates the topics shown.
      const aboutHint = about.running ? (about.topics.length ? 'updating…' : 'reading…') : about.failed ? `couldn't read: ${about.failed}` : ''
      const done = shown.steps.filter(step => step.status === 'completed').length
      const stepCount = shown.steps.length ? `${done}/${shown.steps.length} steps` : ''
      const topicCount = about.topics.length ? `${about.topics.length} topic${about.topics.length === 1 ? '' : 's'}` : ''
      // Ended with every step closed: an answer; else interrupted or failed, as Claude left it.
      // Working is lit as History lights the prompt in view; done is the branch row's green; stopped Git's dirty amber.
      // Waiting on agents takes plan mode's teal: the theme's other blues are working and the tabs.
      const [state, stateColor] = !shown.ended
        ? shown.agents
          ? [`◌ waiting on ${shown.agents} agent${shown.agents === 1 ? '' : 's'}`, 'planMode']
          : ['● working', 'claude']
        : done === shown.steps.length
          ? [`✓ done ${clock(shown.at)}`, HUD.action]
          : [`■ stopped ${clock(shown.at)}`, HUD.dirty]
      const MARK = { completed: '✓', in_progress: '●', pending: '○' }
      // The marks scan as progress on their own; done text stays readable, a step back; the current step is lit.
      // Last turn's report, waiting on this turn's, is dimmed whole.
      const MARK_SHADE = { completed: HUD.action, in_progress: 'claude', pending: HUD.faint }
      const TEXT_SHADE = { completed: SCOPE, in_progress: 'claude', pending: undefined }
      // An agent marks as its step would: working lit, not started faint, ended its outcome; ended text a step back.
      const AGENT_MARK: Record<AgentRow['status'], [string, string]> = {
        planned: ['○', HUD.faint], pending: ['◌', HUD.faint], running: ['◌', 'claude'], waiting: ['◌', 'claude'], idle: ['◌', 'claude'],
        completed: ['✓', HUD.action], failed: ['✗', TYPES.fix], killed: ['■', HUD.dirty],
      }
      const agentText = (status: AgentRow['status']) => (WORKING.includes(status) ? undefined : status === 'planned' || status === 'pending' ? HUD.faint : SCOPE)
      const shade = (color?: string) => (shown.waiting ? HUD.faint : color)
      const hasAbout = about.topics.length > 0 || about.running || !!about.failed
      const hasReport = !!(shown.wants || shown.waiting || shown.ended)
      const LABEL = 7
      // Purple inline label, the text wrapping under itself.
      const labelled = (label: string, text: string, color?: string) => (
        <Box key={label}>
          {/* A fixed column: beside wrapping text, a padded label shrank and lost its gap. */}
          <Box width={LABEL} flexShrink={0}>
            <Text bold color={HUD.label}>{label}</Text>
          </Box>
          <Text wrap="wrap" color={color}>{text}</Text>
        </Box>
      )
      // A part after ASK opens under a rule from the text column to the edge.
      const partRule = (label: string) => (
        <Box key={`rule:${label}`} paddingLeft={LABEL}>
          <Text color="promptBorder">{'─'.repeat(Math.max(0, width - LABEL))}</Text>
        </Box>
      )
      // Newest first, the newest lit as History lights the prompt in view. With a report under them, TOPICS
      // take a zone of their own: the rows their wrapped lines need up to half of those left once the tabs,
      // their rule, the status row, its rule, the TOPICS header and their divider are drawn, or what the
      // divider was dragged to, keeping 1 row on either side; the wheel scrolls them in it.
      const topics = about.topics.map((topic, i) => ({ topic, i })).reverse()
      // shortcut: counts cells as if the text filled each row; a word wrap or a wide glyph takes more, so at
      // the scroll's end the oldest topic's last line can sit past the zone. Upgrade: count wrapped words.
      const lines = (topic: string) => Math.max(1, Math.ceil(topic.length / Math.max(1, width - 2)))
      const free = e.props.scroll.bodyRows - BAR_ROWS - 6
      const draggedTopics = await read($, topicsSplit)
      const needed = topics.reduce((sum, one) => sum + lines(one.topic), 0)
      const topicsMax = Math.max(0, free - 1)
      const topicsMin = Math.min(1, topicsMax)
      const topicsRows = draggedTopics >= 0 ? Math.max(topicsMin, Math.min(draggedTopics, topicsMax)) : Math.min(needed, Math.ceil(free / 2), topicsMax)
      // The last offset: the fewest oldest topics that fill the zone, less the back-to-top line once scrolled.
      const endRows = needed > topicsRows && topicsRows > 1 ? topicsRows - 1 : topicsRows
      let topicsEnd = topics.length
      for (let rows = 0; topicsEnd > 0 && rows + lines(topics[topicsEnd - 1]!.topic) <= endRows; topicsEnd--) rows += lines(topics[topicsEnd - 1]!.topic)
      // The oldest alone may take more rows than the zone: it still shows, cut by its edge.
      topicsEnd = Math.min(topicsEnd, Math.max(0, topics.length - 1))
      const zoned = !!shown.wants && hasAbout
      const topicsFrom = zoned ? Math.min(await read($, topicsTop), topicsEnd) : 0
      const hasTopicsTop = topicsFrom > 0 && topicsRows > 1
      if (!next.signal.aborted) topicsZone = zoned
          ? { from: 5, to: 5 + topicsRows, end: topicsEnd, offset: e.props.scroll.offset, divider: { rows: topicsRows, min: topicsMin, max: topicsMax } }
          : undefined
      // In a zone, the topics that start in it, the last one cut by its edge.
      let shownTopics = topics.slice(topicsFrom)
      if (zoned) {
        let used = 0
        shownTopics = shownTopics.filter(one => {
          const starts = used < topicsRows - (hasTopicsTop ? 1 : 0)
          used += lines(one.topic)
          return starts
        })
      }
      zones = {
        zones: !hasReport && !hasAbout ? 'empty' : zoned ? 'report+topics zone' : hasReport ? 'report' : 'topics',
        steps: shown.steps.length, topics: about.topics.length, topicsRows, reading: about.running, failed: about.failed,
      }
      // Rows a text takes wrapped at w: words packed greedily, one past the width broken, as Text wraps.
      // shortcut: counts characters, not cells; CJK and emoji take two, so the count runs short. Upgrade: string-width.
      const wrapRows = (text: string, w: number) =>
        text.split('\n').reduce((sum, para) => {
          let rows = 1
          let at = 0
          for (const word of para.split(' ')) {
            const need = at ? at + 1 + word.length : word.length
            if (need <= w) at = need
            else {
              if (at) rows++
              for (at = word.length; at > w; at -= w) rows++
            }
          }
          return sum + rows
        }, 0)
      // The body never scrolls (its bars stay pinned): STEPS gets the rows left under PLAN, the last one a "… N more"
      // when they run out. The status row and its rule, TOPICS' header, zone and divider, ASK, PLAN and their rules.
      const stepRoom =
        e.props.scroll.bodyRows - 2 - BAR_ROWS - (hasReport ? 2 : 0) - (zoned ? 2 + topicsRows : 0) -
        wrapRows(shown.wants, Math.max(1, width - LABEL)) - wrapRows(shown.plan, Math.max(1, width - LABEL)) - 2
      const topicRows = shownTopics.map(({ topic, i }) => (
        <Box key={`topic:${i}`} paddingLeft={2} flexShrink={0}>
          <Text wrap="wrap" color={i === about.topics.length - 1 ? 'claude' : SCOPE}>{topic}</Text>
        </Box>
      ))
      body =
        !hasReport && !hasAbout ? (
          // The rows under the tabs and their rule.
          emptyNote(
            e.props.scroll.bodyRows - BAR_ROWS - 2,
            'Nothing here yet',
            <Text color={HUD.faint}>What Claude is doing and</Text>,
            <Text color={HUD.faint}>what this chat is about.</Text>,
          )
        ) : (
          <Box flexDirection="column">
            {hasReport && [
              // A TOPICS read in progress takes the step count's place: the TOPICS header counts them instead.
              // Before Claude's report, planning… holds it, and the TOPICS header keeps the hint.
              <Box key="state" justifyContent="space-between">
                <Text color={stateColor}>{state}</Text>
                <Text color={HUD.faint}>{shown.waiting ? (shown.agents ? '' : 'planning…') : about.running ? aboutHint : stepCount}</Text>
              </Box>,
              <Text key="rule" color="promptBorder">{'─'.repeat(width)}</Text>,
            ]}
            {hasAbout && [
              <Box key="session" justifyContent="space-between">
                <Text bold color={HUD.label}>TOPICS</Text>
                {/* Cut to one row beside its title: the zone under it starts on a fixed row. */}
                <Text color={HUD.faint}>{fit((hasReport && !shown.waiting && about.running ? '' : aboutHint) || topicCount, Math.max(1, width - 7))}</Text>
              </Box>,
              ...(zoned
                ? [
                    <Box key="topics" flexDirection="column" height={topicsRows} overflow="hidden">
                      {hasTopicsTop && topLine('top:topics', () => update($, topicsTop, () => 0))}
                      {topicRows}
                    </Box>,
                  ]
                : topicRows),
            ]}
            {/* Only the terminal and desktop draw a Client: elsewhere the divider stays put. */}
            {zoned &&
              (Client ? (
                <Client key="now" module="./divider.tsx" props={{ split: topicsRows, min: topicsMin, max: topicsMax }} height={1} />
              ) : (
                <Text key="now" color="promptBorder">{'─'.repeat(width)}</Text>
              ))}
            {shown.wants && [
              labelled('ASK', shown.wants, shade()),
              partRule('PLAN'),
              labelled('PLAN', shown.plan, shade()),
              shown.steps.length > 0 && partRule('STEPS'),
              shown.steps.length > 0 && (
                <Box key="steps">
                  <Box width={LABEL} flexShrink={0}>
                    <Text bold color={HUD.label}>STEPS</Text>
                  </Box>
                  <Box flexDirection="column">
                    {((rows: unknown[]) =>
                      rows.length <= stepRoom
                        ? rows
                        : [
                            ...rows.slice(0, Math.max(0, stepRoom - 1)),
                            <Text key="cut" color={shade(HUD.faint)}>{`… ${rows.length - Math.max(0, stepRoom - 1)} more`}</Text>,
                          ])(shown.steps.flatMap((step, i) => {
                      const all = agentRows[i] ?? []
                      // Past 3, the rest fold into a count, so a fan-out does not push later steps out of view.
                      const folds = all.length > 3
                      const rows = folds && open !== i ? all.slice(0, 3) : all
                      const hidden = all.slice(rows.length)
                      const counts = ['◌', '✗', '■', '○', '✓']
                        .map(glyph => [glyph, hidden.filter(row => AGENT_MARK[row.status][0] === glyph).length] as const)
                        .flatMap(([glyph, n]) => (n ? `${n} ${glyph}` : []))
                        .join(' ')
                      // In an agent's transcript, that agent's step leads back to the main conversation.
                      const stepLine = [
                        <Text key="mark" color={shade(MARK_SHADE[step.status])}>{MARK[step.status]} </Text>,
                        <Text key="text" color={shade(TEXT_SHADE[step.status])}>{fit(step.text, width - LABEL - 2)}</Text>,
                      ]
                      // A spawned agent's row opens its transcript; the one in view is lit across the row, as the shown tab is.
                      const agentLine = (row: AgentRow, tree: string) => {
                        const [glyph, color] = AGENT_MARK[row.status]
                        const text = fit(row.description, width - LABEL - 4)
                        const line =
                          row.id && row.id === viewing
                            ? <Text bold inverse color={shade('claude')}>{`${tree}${glyph} ${text}`.padEnd(width - LABEL)}</Text>
                            : [
                                <Text key="tree" color={shade(HUD.faint)}>{tree}</Text>,
                                <Text key="mark" color={shade(color)}>{glyph} </Text>,
                                <Text key="text" color={shade(agentText(row.status))}>{text}</Text>,
                              ]
                        return row.id ? (
                          <Button key={`view:${row.id}`} plain onPress={() => $.ui.view(viewing === row.id ? {} : { agentId: row.id })}>
                            {line}
                          </Button>
                        ) : (
                          line
                        )
                      }
                      const toggle = (key: string, label: string, to: number) => (
                        <Button key={key} plain onPress={() => update($, expanded, () => to)}>
                          <Text color={shade(HUD.faint)}>└ </Text>
                          <Text color={shade(HUD.faint)}>{label}</Text>
                        </Button>
                      )
                      return [
                        <Box key={`step:${i}`}>
                          {all.some(row => row.id && row.id === viewing) ? (
                            <Button key="main" plain onPress={() => $.ui.view({})}>
                              {stepLine}
                            </Button>
                          ) : (
                            stepLine
                          )}
                        </Box>,
                        ...rows.map((row, j) => (
                          <Box key={`agent:${i}:${j}`}>{agentLine(row, j === rows.length - 1 && !folds ? '└ ' : '├ ')}</Box>
                        )),
                        folds && (hidden.length ? toggle(`more:${i}`, `… ${hidden.length} more  ${counts}`, i) : toggle('less', '… less', -1)),
                      ].filter(Boolean)
                    }))}
                  </Box>
                </Box>
              ),
            ]}
          </Box>
        )
    }

    // Equal slots, the last taking the odd column.
    const bar = (tabs: Tab[]) => (
      <Box paddingX={PAD}>
        {tabs.flatMap((one, i) => {
          const slots = e.props.bodyColumns - 2 * PAD - 3 * (tabs.length - 1)
          const width = i < tabs.length - 1 ? Math.floor(slots / tabs.length) : slots - Math.floor(slots / tabs.length) * (tabs.length - 1)
          // The name centered in spaces across the slot: a Button presses and lights as wide as it draws.
          // The tab shown is no Button, lit across its slot as a focused one is.
          const notice = flagged.includes(one) ? ' !' : ''
          // Cut, not wrapped: a wrapped bar grows and pushes the bottom bar out of the pane.
          const name = one.slice(0, Math.max(0, width - notice.length))
          const left = Math.max(0, Math.floor((width - name.length - notice.length) / 2))
          const right = Math.max(0, width - left - name.length - notice.length)
          // The key's letter keeps the title's case; cut off with the name, it draws no underline.
          const at = KEYS[one] ? name.toLowerCase().indexOf(KEYS[one]!) : -1
          const title = at < 0 ? [name] : [name.slice(0, at), <Text underline>{name[at]}</Text>, name.slice(at + 1)]
          return [
            ...(i > 0 ? [<Text color="promptBorder"> │ </Text>] : []),
            <Box key={`tab:${one}`} width={width}>
              {one === current ? (
                <Text bold inverse color="claude">{' '.repeat(left)}{title}{`${notice}${' '.repeat(right)}`}</Text>
              ) : (
                <Button key={one} plain onPress={() => pick($, one)}>
                  <Text color={SOON.includes(one) ? HUD.faint : HUD.idle}>{' '.repeat(left)}{title}</Text>
                  {notice ? <Text color="warning">{notice}</Text> : ''}
                  <Text color={SOON.includes(one) ? HUD.faint : HUD.idle}>{' '.repeat(right)}</Text>
                </Button>
              )}
            </Box>,
          ]
        })}
      </Box>
    )

    const key = `${current}|${e.props.bodyColumns}|${e.props.scroll.bodyRows}|${JSON.stringify(zones)}`
    if (key !== lastPane) {
      lastPane = key
      draw.end({ tab: current, columns: e.props.bodyColumns, bodyRows: e.props.scroll.bodyRows, ...zones, ...scroll })
    }
    return (
      <Box flexDirection="column">
        {bar(TOP)}
        <Box paddingX={PAD / 2}>
          <Text color="promptBorder">{rule}</Text>
        </Box>
        {/* Cut at the bar, never past it: the pane never scrolls, so the bottom bar stays put; Overview's ⇕ shares the room. */}
        <Box key="body" flexDirection="column" paddingX={PAD} height={Math.max(0, e.props.scroll.bodyRows - 2 - BAR_ROWS)} flexShrink={0} overflow="hidden">
          {/* Unshrinkable: a tall tab is cut at the bottom, not squeezed row by row. */}
          <Box flexDirection="column" flexShrink={0}>
            {body}
          </Box>
        </Box>
        <Box paddingX={PAD / 2}>
          <Text color="promptBorder">{rule}</Text>
        </Box>
        {bar(BOTTOM)}
      </Box>
    )
  }))
}
