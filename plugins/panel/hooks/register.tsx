import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tab } from '../types'

const PANE = 'panel'
const PAD = 2
// Activity and Git are deferred: their slots stay below, list them here to show them.
const TABS: Tab[] = ['History']
const MAX_PROMPTS = 100
// \u00a0: the toast wraps at spaces; ↻ keeps to its word.
const GONE = "Can't jump: rewound or compacted out of the chat. ↻\u00a0reuses it."
// HUD colors (claudzilla/claude/hud/hud-filter.pl) the theme has no key for.
const HUD = { label: '#a396d2', faint: '#4f5c68', idle: '#456186', action: '#5d9678', compacted: '#8c7850' }
// Divider lines: their word's HUD color at 60%.
const DIM = { label: '#625a7e', action: '#385a48', compacted: '#544830' }
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
// The chat wraps a paste in <pasted_content> tags; history keeps it bare.
const flat = (text: string) =>
  text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/\s+/g, ' ')
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
// a run reaching the oldest was compacted away, any other was rewound (an Esc-cancel looks the
// same). A compacted prompt the chat still shows stays live, the marker on the first the model
// lost. A capped read (the newest READ_MAX entries) says nothing of prompts older than it holds.
export const gone = (
  prompts: Prompt[],
  chat: string[],
  model: string[],
  notes: string[] = [],
  capped = { chat: false, model: false },
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
    return { isLive: false, marker: inChat.slice(i).some(Boolean) ? 'Rewound' : 'Compacted' }
  })
  // Only the newest compaction is marked, right under the /compact that ran it when one sits above.
  let at = rows.findIndex(row => row.marker === 'Compacted')
  for (let i = at - 1; at > 0 && i >= 0 && !real[i]; i--)
    if (/^\/compact\b/.test(prompts[i]!.typed ?? prompts[i]!.display)) at = i + 1
  return rows.map(({ marker, ...row }, i) =>
    i === at ? { ...row, marker: 'Compacted' } : marker === 'Rewound' ? { ...row, marker } : row,
  )
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
  return { all, prompts, drawnOnly, commands, rows: gone(prompts, sent, model, queued, capped) }
}
// Kept for up to READ_TTL, or until a prompt is sent: a chat scroll redraws the pane many times a
// second, and every read grows with the chat.
const READ_TTL = 1000
let historyRead: { key: string; at: number; reads: ReturnType<typeof readHistory> } | undefined
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
// (see FRESH).
let redrawing = false
const redrawSoon = ($: EngineInterface) => {
  if (redrawing) return
  redrawing = true
  $.clock.after(100, () => {
    redrawing = false
    $.ui.invalidate('ui.render')
  })
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
    if (shown.delete(requestId)) redrawSoon($)
    return
  }
  const where = `${onScreen.first}-${onScreen.last}`
  const moved = shown.get(requestId)?.where !== where
  const at = await $.clock.now()
  keepNewest(shown, requestId, { where, key, at }, SHOWN_MAX)
  if (moved && !pinHolds(pin, at)) pin = undefined
  if (moved) redrawSoon($)
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // A tab saved before it was hidden falls back to the first shown.
    const saved = await read($, tab)
    const current = TABS.includes(saved) ? saved : TABS[0]!
    const flagged = await read($, notices)
    // Divider gets half the side margin on each side.
    const rule = '─'.repeat(e.props.bodyColumns - PAD)
    const select = async (next: Tab) => {
      await update($, tab, () => next)
      await update($, notices, list => list.filter(one => one !== next))
    }

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
    if (current === 'History') {
      // A timer that never fires must not hold off every later redraw.
      redrawing = false
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
          {prompts.length === 0 && <Text color={HUD.faint}>No prompts yet.</Text>}
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
        <Box justifyContent="space-evenly" paddingX={PAD}>
          {TABS.flatMap((one, i) => [
            ...(i > 0 ? [<Text color="promptBorder"> │ </Text>] : []),
            <Button key={one} plain onPress={() => select(one)}>
              <Text bold={one === current} color={one === current ? 'claude' : HUD.idle}>{one}</Text>
              {flagged.includes(one) ? <Text color="warning"> !</Text> : ''}
            </Button>,
          ])}
        </Box>
        <Box paddingX={PAD / 2}>
          <Text color="promptBorder">{rule}</Text>
        </Box>
        <Box flexDirection="column" paddingX={PAD}>
          {body}
        </Box>
      </Box>
    )
  })
}
