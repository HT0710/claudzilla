import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tab } from '../types'

const PANE = 'panel'
const PAD = 2
// Activity is deferred: its slot stays below, list it here to show it.
const TABS: Tab[] = ['History', 'Git']
const MAX_PROMPTS = 100
// COMMITS reads this many at a time, the next page once scrolled past: git walks every commit it
// skips (210 ms at 100k), so a read per wheel tick would lag.
const PAGE = 100
// Built-in tools that never change files: their calls leave the Git tab's reads standing.
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])
// \u00a0: the toast wraps at spaces; ↻ keeps to its word.
const GONE = "Can't jump: rewound or compacted out of the chat. ↻\u00a0reuses it."
// HUD colors (claudzilla/claude/hud/hud-filter.pl) the theme has no key for.
const HUD = { label: '#a396d2', faint: '#4f5c68', idle: '#456186', action: '#5d9678', compacted: '#8c7850', dirty: '#8c7850', churn: '#6e8c6e' }
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
// A pushed commit's, or a staged file's: its color at 60%, as DIM's are.
const dim = (hex: string) => `#${hex.slice(1).replace(/../g, c => Math.round(parseInt(c, 16) * 0.6).toString(16).padStart(2, '0'))}`
const SECTIONS = [
  ['SUMMARY', '1-2 rows'],
  ['SECTION 1', 'list, grow'],
  ['SECTION 2', 'last N'],
]

const tab = atom({ plugin: 'panel', key: 'tab' } as const, 'History' as Tab)
// Content hooks flag tabs here.
const notices = atom({ plugin: 'panel', key: 'notices' } as const, [] as Tab[])
// Bumped per prompt so the History list redraws.
const submitted = atom({ plugin: 'panel', key: 'submitted' } as const, 0)
// Bumped per tool call so the Git tab redraws.
const toolCalls = atom({ plugin: 'panel', key: 'toolCalls' } as const, 0)
// Rows the Git tab's CHANGES zone takes, as the divider was dragged; -1 until it is.
const split = atom({ plugin: 'panel', key: 'split' } as const, -1)
// The first row each Git zone shows, as the wheel moved it.
const scrolled = atom({ plugin: 'panel', key: 'scrolled' } as const, { changes: 0, commits: 0 })

// `typed`: history's own text, set when a paste placeholder in it was swapped for the paste.
export type Prompt = { display: string; timestamp: number; typed?: string }

// Claude Code's own folder: CLAUDE_CONFIG_DIR moves it.
const configDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`

const PASTE = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g
// A pasted "/x" is sent as a prompt; only a typed one runs. A path ("/home/…") is a prompt too.
const isCommand = (prompt: Prompt) => /^\/[\w:-]+(\s|$)/.test(prompt.typed ?? prompt.display)

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
      // /quit, /exit, /resume and /clear only leave this chat, /rewind only opens its picker, /panel
      // only toggles this pane.
      if (row.sessionId === sessionId && typeof row.display === 'string' && !/^\/(quit|exit|resume|clear|rewind|panel)\b/.test(row.display)) {
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
  const kept = notes.filter(note => {
    const at = prompts.findIndex(prompt => flat(prompt.display) === flat(note))
    return at >= 0 && at < oldest
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
// `git status --porcelain -b`'s first line, "## main...origin/main [ahead 1, behind 2]": "main ↑1 ↓2".
export const branchLine = (head: string) =>
  head
    .replace(/^## /, '')
    .replace(/\.\.\.\S+/, '')
    // Inside the brackets only: a branch may be named "go-ahead".
    .replace(/ \[(.*)\]$/, (_, track: string) => ` ${track.replace('ahead ', '↑').replace(', behind ', ' ↓').replace('behind ', '↓')}`)
// The History tab's reads, and which prompts they leave live.
const readHistory = async ($: EngineInterface) => {
  const all = await pastPrompts($)
  const prompts = all.slice(0, MAX_PROMPTS)
  // A failed read marks nothing (see gone) instead of blanking the tab.
  const queued = await midTurn($)
  const chatRead = await $.session.messages().catch(() => [])
  const sent = chatRead
    .filter(message => message.role === 'user' && !message.toolResults?.length && message.text)
    .map(message => message.text)
  // A mid-turn prompt is never a chat message, nor most slash commands (/compact is): reachable
  // once drawn. One sent as a turn ended landed as a normal message instead.
  const landed = new Set(sent.map(flat))
  const drawnOnly = new Set(queued.map(flat).filter(text => !landed.has(text)))
  const commands = new Set(sent.flatMap(text => typedCommand(text) ?? []))
  // What the model is sent: the last compaction's summary in place of what it replaced.
  // Each text block alone, as reminders ride in the same message.
  const modelRead = await $.session.messages({ as: 'api' }).catch(() => [])
  const model = modelRead
    .filter(message => message.role === 'user')
    .flatMap(message => message.content.flatMap(block => (typeof block.text === 'string' ? [block.text] : [])))
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
    $.process.run(['git', '--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain', '-b']).catch(() => undefined),
    $.process.run(['git', '--no-optional-locks', 'diff', '--shortstat']).catch(() => undefined),
    // Local only: commits no remote has.
    $.process.run(['git', 'rev-list', 'HEAD', '--not', '--remotes']).catch(() => undefined),
    $.process.run(['git', 'rev-list', '--count', 'HEAD']).catch(() => undefined),
  ])
// Kept until a tool call or a prompt may have changed the repo, or the tab is picked again: a chat
// scroll or a drag redraws the pane many times a second. `signal`: the draw that started the runs.
let gitRead: { key: string; signal: AbortSignal; runs: ReturnType<typeof readGit> } | undefined
// One page of COMMITS from its first, with a page more: a window of up to PAGE rows starting in the
// page fits whole. Kept as gitRead is, per page.
const readLog = ($: EngineInterface, page: number) =>
  $.process.run(['git', 'log', `--skip=${page * PAGE}`, `-${2 * PAGE}`, '--format=%H %h %s']).catch(() => undefined)
let logRead: { key: string; signal: AbortSignal; run: ReturnType<typeof readLog> } | undefined
// The Git tab as last drawn: rows above `commitsAt` scroll CHANGES, the rest COMMITS, each up to its
// last offset. Unset while another tab shows: the engine scrolls that one.
let gitZones: { commitsAt: number; changes: number; commits: number } | undefined
// Counts UTF-16 units, not cells: a wide glyph (CJK, emoji) can still overflow by one.
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
  const head = JSON.stringify(typed.split(/\n|\[Pasted text #/)[0] || '\n\n<pasted_content id=').slice(0, -1)
  return [`"content":${head}`, `"text":${head}`]
}

// A prompt's text: the content itself, or the text blocks beside an image; a tool result is none.
const promptText = (content: unknown) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || !content.length || content.some(block => !['text', 'image'].includes(block?.type))) return
  return content.flatMap(block => (block.type === 'text' ? [String(block.text)] : [])).join('\n')
}

export const nearestId = (text: string, prompt: Prompt) => {
  let best: { id: string; gap: number } | undefined
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line)
      const text = promptText(row.message?.content)
      if (row.type !== 'user' || text === undefined || flat(text) !== flat(prompt.display)) continue
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
  lastDraw = result.catch(() => undefined)
  return result
}
// Settles once no pane draw runs: a redraw started during one drops it, and the reads it awaits.
const idle = async () => {
  for (let draw = lastDraw; ; draw = lastDraw) {
    await draw
    if (draw === lastDraw) return
  }
}
const pick = async ($: EngineInterface, next: Tab) => {
  // Picking Git reads the repo afresh: it may have changed outside this chat.
  if (next === 'Git') gitRead = logRead = undefined
  await update($, tab, () => next)
  // Each write draws the pane; a second draw could land before the first, and the terminal
  // then dropped the next click.
  if ((await read($, notices)).includes(next)) await update($, notices, list => list.filter(one => one !== next))
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // immediate: alt+h mid-turn opens the pane now, not once the turn ends; it prints nothing.
    await $.command.register({ name: 'panel', description: 'Toggle the side panel', immediate: true })
    // Keys come back in the order first set: the oldest sessions' notes go.
    const notes = (await $.store.keys().catch(() => [])).filter(key => key.startsWith('midTurn:'))
    await Promise.all(notes.slice(0, -MID_TURN_SESSIONS).map(key => $.store.delete(key).catch(() => undefined)))

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    const panes = await $.ui.panes()
    if (panes.some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })

      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: 'Panel', columns: 40 })
    // No output text: alt+h toggles often, and a chat row per toggle is noise.
    if (!opened.isPlaced) $.ui.toast('Panel waits: terminal too narrow.')

    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (e.turnId) {
      const texts = [...(await midTurn($)), e.text].slice(-MAX_PROMPTS)
      await $.store.set(await midTurnKey($), texts).catch(() => undefined)
    }
    await update($, submitted, n => n + 1)

    return result
  })

  // Tabs switch here, not in their onPress: mid-turn, a click landing as a redraw swaps the tree
  // reached this hook but lost its onPress.
  on('ui.press', { requestId: PANE }, async ($, e, next) => {
    const picked = TABS.find(one => one === e.element)
    if (!picked) return next(e)
    await pick($, picked)

    return { element: e.element }
  })

  // The Git tab's divider, dragged: it stops at the CHANGES title; the render clamps the rest to the pane.
  on('ui.message', async ($, e, next) => {
    const rows = (e.data as { split?: unknown } | undefined)?.split
    if (e.requestId !== PANE || e.element !== 'divider' || typeof rows !== 'number') return next(e)
    await update($, split, () => Math.max(0, rows))

    return {}
  })

  // The wheel over the Git tab scrolls the zone under it, not the pane; keys, with no pointer, COMMITS.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const zones = gitZones
    if (!zones) return next(e)
    const zone = (e.pointer?.row ?? Infinity) < zones.commitsAt ? 'changes' : 'commits'
    await update($, scrolled, top => ({ ...top, [zone]: Math.max(0, Math.min(top[zone] + e.by, zones[zone])) }))

    return {}
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

    return next(e)
  })

  // A group's own id is not in the chat file; its first call's is.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    await see($, e.requestId, e.props.onScreen, e.props.calls[0]?.tool_use_id)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => ordered(async () => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
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
      $.ui.toast("Can't jump: not found in the chat. ↻\u00a0reuses it.")
    }
    const reuse = async (display: string) => {
      const { isFilled } = await $.prompt.fill({ text: display })
      if (!isFilled) $.ui.toast('The prompt box did not take it.')
    }
    // /rewind takes no target, so this opens its picker; the person picks the message there.
    const rewind = () => $.command.run({ command: 'rewind' }).catch(() => $.ui.toast('Could not open /rewind.'))

    let body
    // Kept while a Git draw reads: a wheel tick meanwhile still scrolls its zone.
    if (current !== 'Git') gitZones = undefined
    if (current === 'History') {
      const key = `${await $.session.id()}:${await read($, submitted)}`
      const at = await $.clock.now()
      if (historyRead?.key !== key || at - historyRead.at >= READ_TTL) historyRead = { key, at, reads: readHistory($) }
      const { all, prompts, drawnOnly, commands, rows } = await historyRead.reads
      // "↻ " and "HH:MM  " come before the text; padding it to the edge makes the whole row the jump button.
      const room = e.props.bodyColumns - 2 * PAD - 9
      const now = new Date()
      const days = prompts.map(prompt => dayLabel(prompt.timestamp, now))
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
      body = (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Button key="rewind" plain onPress={rewind}>
              <Text color={HUD.action}>⟲ rewind</Text>
            </Button>
            <Text color={HUD.faint}>
              {prompts.length}
              {all.length > MAX_PROMPTS ? '+' : ''} {all.length === 1 ? 'prompt' : 'prompts'} this session
            </Text>
          </Box>
          {/* The rows under the tabs, their rule and the header. */}
          {prompts.length === 0 &&
            emptyNote(
              e.props.scroll.bodyRows - 3,
              'No prompts yet',
              <Text color={HUD.faint}>Sent prompts show here.</Text>,
              <Box>
                <Text color={HUD.faint}>Click to jump, </Text>
                <Text color={HUD.idle}>↻</Text>
                <Text color={HUD.faint}> to reuse.</Text>
              </Box>,
            )}
          {prompts.map((prompt, i) => (
            <Box flexDirection="column">
              {days[i] !== days[i - 1] && divider(days[i] ?? '', '─', HUD.label, DIM.label)}
              {/* Rewound shares the rewind button's green. */}
              {rows[i]?.marker === 'Rewound' && divider('Rewound', '~', HUD.action, DIM.action)}
              {rows[i]?.marker === 'Compacted' && divider('Compacted', '=', HUD.compacted, DIM.compacted)}
              <Box>
                <Button key={`reuse:${i}`} plain onPress={() => reuse(prompt.display)}>
                  <Text color={HUD.idle}>↻ </Text>
                </Button>
                <Button key={`jump:${i}`} plain onPress={() => (rows[i]?.isLive ? jump(prompt) : $.ui.toast(GONE))}>
                  <Text color={HUD.faint}>{clock(prompt.timestamp)}  </Text>
                  <Text color={!rows[i]?.isLive || !isReachable(prompt) ? HUD.faint : i === lit ? 'claude' : compacted >= 0 && i >= compacted ? HUD.faint : undefined}>
                    {fit(flat(prompt.display), room).padEnd(room)}
                  </Text>
                </Button>
              </Box>
            </Box>
          ))}
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
      const [status, diff, unpushed, count] = runs
      const local = unpushed?.exitCode === 0 ? new Set(unpushed.stdout.split('\n').filter(Boolean)) : undefined
      const total = count?.exitCode === 0 ? count.stdout.trim() : ''
      // As the HUD statusline's churn: unstaged lines added and removed, "+144 -6".
      const [ins, del] = [/(\d+) insertion/, /(\d+) deletion/].map(re => re.exec(diff?.stdout ?? '')?.[1])
      const churn = [ins && `+${ins}`, del && `-${del}`].filter(Boolean).join(' ')
      const [head, ...files] = status?.exitCode === 0 ? status.stdout.split('\n').filter(Boolean) : []
      // As the HUD statusline's dirty count: "!4 ?1", tracked changes then untracked files.
      const untracked = files.filter(line => line.startsWith('??')).length
      const dirty = [files.length > untracked && `!${files.length - untracked}`, untracked && `?${untracked}`].filter(Boolean).join(' ')
      // The body less 3 columns: a path gets room + 1 after its status letter and a space; a commit's
      // subject room + 2 less its hash.
      const room = e.props.bodyColumns - 2 * PAD - 3
      const bodyRule = '─'.repeat(room + 3)
      // Rows left once the tabs, their rule, the branch, the rule under it, both headers and the
      // divider are drawn. CHANGES takes what it needs up to half, or what the divider was dragged
      // to, none at least (the divider right under its title); COMMITS the rest, a row at least.
      const free = e.props.scroll.bodyRows - 7
      const dragged = await read($, split)
      const changesRows = Math.max(0, Math.min(dragged >= 0 ? dragged : Math.min(files.length, Math.ceil(free / 2)), free - 1))
      // With no changes, no CHANGES header or divider: COMMITS takes their rows too.
      const commitsRows = Math.max(1, files.length ? free - changesRows : free + 2)
      const changed = `${files.length} changed`
      // Clamped here too: a list shrinks, or the divider grows its zone, after the wheel moved it.
      const top = await read($, scrolled)
      const changesFrom = Math.max(0, Math.min(top.changes, files.length - changesRows))
      const commitsFrom = Math.max(0, Math.min(top.commits, (Number(total) || Infinity) - commitsRows))
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
      const commits = log?.exitCode === 0 ? log.stdout.split('\n').filter(Boolean) : []
      // CHANGES' rows end under its last file: the tabs, their rule, the branch, its rule and the header.
      // Only a live draw sets them: a dropped one finishing after another tab drew would take its wheel.
      if (!next.signal.aborted)
        gitZones = !head
          ? undefined
          : {
              commitsAt: files.length && changesRows ? 5 + changesRows : 0,
              changes: Math.max(0, files.length - changesRows),
              commits: Math.max(0, (Number(total) || page * PAGE + commits.length) - commitsRows),
            }
      body = !head ? (
        // The rows under the tabs and their rule. No answer at all: git is not on PATH, or the surface
        // runs no command.
        status ? (
          emptyNote(
            e.props.scroll.bodyRows - 2,
            'Not a git repository',
            <Text color={HUD.faint}>Branch, changes and commits</Text>,
            <Text color={HUD.faint}>show here inside a repo.</Text>,
          )
        ) : (
          emptyNote(
            e.props.scroll.bodyRows - 2,
            "Git can't run here",
            <Text color={HUD.faint}>It needs git on PATH,</Text>,
            <Text color={HUD.faint}>in a terminal session.</Text>,
          )
        )
      ) : (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            {/* The HUD statusline's branch glyph and green; cut to stay on one row beside the count. */}
            <Text color={HUD.action}>⎇ {fit(branchLine(head), e.props.bodyColumns - 2 * PAD - changed.length - 3)}</Text>
            <Text color={HUD.faint}>{changed}</Text>
          </Box>
          {/* History's day-line purple. */}
          <Text color={DIM.label}>{bodyRule}</Text>
          {files.length > 0 && (
            <Box justifyContent="space-between">
              <Text bold color={HUD.label}>CHANGES</Text>
              <Box>
                <Text color={HUD.dirty}>{dirty}</Text>
                <Text color={HUD.churn}>{churn && `  ${churn}`}</Text>
              </Box>
            </Box>
          )}
          {files.length > 0 && changesRows > 0 && (
            <Box flexDirection="column" height={changesRows}>
              {/* One letter: the worktree's while it has unstaged changes, bright; else the index's, staged, dim.
                  A conflict is U whatever git pairs it with (UU, AA, DD, UD...); a rename shows its new name. */}
              {files.slice(changesFrom, changesFrom + changesRows).map(line => {
                const xy = line.slice(0, 2)
                const isConflict = xy.includes('U') || xy === 'AA' || xy === 'DD'
                const isStaged = !isConflict && line[1] === ' '
                const letter = isConflict ? 'U' : isStaged ? line[0]! : line[1]!
                const color = STATUS[letter] ?? HUD.faint
                return (
                  <Box>
                    <Text color={isStaged ? dim(color) : color}>{letter}</Text>
                    <Text color={isStaged ? HUD.faint : undefined}> {fit(line.slice(3).split(' -> ').pop()!, room + 1)}</Text>
                  </Box>
                )
              })}
            </Box>
          )}
          {/* Only the terminal and desktop draw a Client: elsewhere the rule stays put. */}
          {files.length > 0 &&
            (Client ? (
              <Client key="divider" module="./divider.tsx" props={{ split: changesRows }} height={1} />
            ) : (
              <Text color={DIM.label}>{bodyRule}</Text>
            ))}
          {commits.length > 0 && (
            <Box justifyContent="space-between">
              <Text bold color={HUD.label}>COMMITS</Text>
              {/* CHANGES' colors: local in the dirty count's yellow, as neither is pushed; total in the churn's green. */}
              <Box>
                {local && <Text color={HUD.dirty}>{`${local.size} local`}</Text>}
                {total ? <Text color={HUD.churn}>{`${local ? '  ' : ''}${total} total`}</Text> : null}
              </Box>
            </Box>
          )}
          {/* Local commits bright, pushed ones dim; the type colored by what it does (TYPES). */}
          {commits.slice(commitsFrom - page * PAGE, commitsFrom - page * PAGE + commitsRows).map(line => {
            const [full = '', hash = '', ...subject] = line.split(' ')
            const isLocal = !!local?.has(full)
            // A control character in any text gets the whole pane refused.
            const shown = fit(subject.join(' ').replace(/[\x00-\x1f\x7f]/g, ' '), room + 2 - hash.length)
            // "type(scope)!: rest"; a subject cut inside the type part shows plain.
            const [, type, scope, tail, rest] = /^(\w+)(?:\(([^)]*)\))?(!?: )(.*)$/.exec(shown) ?? []
            const known = type ? TYPES[type] : undefined
            const typeColor = !known ? HUD.faint : isLocal ? known : dim(known)
            return (
              <Box>
                <Text color={HUD.faint}>{hash}</Text>
                {type
                  ? [
                      <Text color={typeColor}> {type}</Text>,
                      ...(scope === undefined
                        ? []
                        : [<Text color={HUD.faint}>(</Text>, <Text color={isLocal ? SCOPE : HUD.faint}>{scope}</Text>]),
                      <Text color={HUD.faint}>{scope === undefined ? tail : `)${tail}`}</Text>,
                      <Text color={isLocal ? undefined : HUD.faint}>{rest}</Text>,
                    ]
                  : <Text color={isLocal ? undefined : HUD.faint}> {shown}</Text>}
              </Box>
            )
          })}
        </Box>
      )
    } else {
      body = SECTIONS.map(([title, hint], i) => (
        <Box flexDirection="column" marginBottom={i < SECTIONS.length - 1 ? 1 : 0}>
          <Box justifyContent="space-between">
            <Text bold color={HUD.label}>{title}</Text>
            <Text color={HUD.faint}>{hint}</Text>
          </Box>
          <Text color={HUD.faint}>  {current} slot</Text>
        </Box>
      ))
    }

    return (
      <Box flexDirection="column">
        {/* Equal slots, the last taking the odd column: a separator lands where the Git divider's grip does. */}
        <Box paddingX={PAD}>
          {TABS.flatMap((one, i) => {
            const slots = e.props.bodyColumns - 2 * PAD - 3 * (TABS.length - 1)
            const width = i < TABS.length - 1 ? Math.floor(slots / TABS.length) : slots - Math.floor(slots / TABS.length) * (TABS.length - 1)
            // The name centered in spaces across the slot: a Button presses and lights as wide as it draws.
            // The tab shown is no Button, lit across its slot as a focused one is.
            const notice = flagged.includes(one) ? ' !' : ''
            const left = Math.max(0, Math.floor((width - one.length - notice.length) / 2))
            const right = Math.max(0, width - left - one.length - notice.length)
            return [
              ...(i > 0 ? [<Text color="promptBorder"> │ </Text>] : []),
              <Box key={`tab:${one}`} width={width}>
                {one === current ? (
                  <Text bold inverse color="claude">{`${' '.repeat(left)}${one}${notice}${' '.repeat(right)}`}</Text>
                ) : (
                  <Button key={one} plain onPress={() => pick($, one)}>
                    <Text color={HUD.idle}>{`${' '.repeat(left)}${one}`}</Text>
                    {notice ? <Text color="warning">{notice}</Text> : ''}
                    <Text color={HUD.idle}>{' '.repeat(right)}</Text>
                  </Button>
                )}
              </Box>,
            ]
          })}
        </Box>
        <Box paddingX={PAD / 2}>
          <Text color="promptBorder">{rule}</Text>
        </Box>
        <Box flexDirection="column" paddingX={PAD}>
          {body}
        </Box>
      </Box>
    )
  }))
}
