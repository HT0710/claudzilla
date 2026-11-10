import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CommitView, LogRow, Gh, Intent, Modal, PrView, Spawn, Step, Tab, Take } from '../types'
import { parseCommitView, parsePrView, parsePrs, printable } from './git-data'
import { BAR_ROWS, EMPTY_INTENT, EMPTY_OVERVIEW, EMPTY_USED, HUD, PAD, WHEEL_HOLD, applyPalette, configDir, clock, dim, drawnZones, emptyNote as kitEmptyNote, fadeTree, fileView, fit, hoverOf, keepZones, modalOpen, readersOf, setZones } from './kit'
import type { Prompt, Readers, TabCtx, TabDraw, UseEntry, UseKind, Used, Zone } from './kit'
import { capped } from './modal'
import { readPalette } from './palette'
import { draw as drawFile } from './tab-file'
import { draw as drawGit, resetGitReads } from './tab-git'
import { draw as drawHistory } from './tab-history'
import { draw as drawOverview, resetStepsHeld, same } from './tab-overview'
import { tracer } from './trace'
import { traceIo } from './trace-io'

export { zoneWindow } from './kit'
export { fileWindow } from './tab-file'
export { gitWeb } from './tab-git'
export { fileView } from './kit'
export { dayLabel, inView, litPrompt } from './tab-history'
export { hang, wrapLines } from './tab-overview'
export { EMPTY_USED, USE_KINDS } from './kit'
export type { Used, UseKind } from './kit'

const t = tracer('margin')
// The pane's last traced draw: a draw repeats on every scroll and click, so only a change is traced.
let lastPane = ''

const PANE = 'margin'
// Top bar: the chat's own state; bottom bar: the files it touches.
const TOP: Tab[] = ['Overview', 'Decisions', 'History']
const BOTTOM: Tab[] = ['File', 'Tree', 'Git']
const TABS = [...TOP, ...BOTTOM]
// The tabs with an alt key: each runs /margin-<tab>.
const KEYS: Partial<Record<Tab, string>> = { Overview: 'o', History: 'h', File: 'l', Git: 'g' }
// Tabs not built yet: drawn dim, their body says when.
const SOON: Tab[] = ['Decisions', 'Tree']
const MAX_PROMPTS = 100
// Built-in tools that never change files: their calls leave the Git tab's reads standing.
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

const USE_NAMES = 50
const OWN_PLUGINS = ['ballot', 'byline', 'folio', 'herald', 'ledger', 'margin', 'primer']
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

// The kind, full name and source a tool call counts under; none for any other call.
export const useOf = (call: { tool: string } & Record<string, unknown>): { kind: UseKind; name: string; source?: string } | undefined => {
  const { tool } = call
  if (tool === 'Read') {
    const path = str(call.file_path)
    if (!path) return undefined
    return { kind: /\/\.claude\/projects\/[^/]+\/memory\//.test(path) ? 'memory' : 'files', name: path }
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const name = str(call.pattern)
    return name && { kind: 'other', name, source: tool.toLowerCase() }
  }
  if (tool === 'WebSearch') {
    const name = str(call.query)
    return name && { kind: 'web', name, source: 'search' }
  }
  if (tool === 'WebFetch') {
    const url = str(call.url)
    if (!url) return undefined
    try {
      // Drawn as a link: a web page's only, never the raw string.
      const u = new URL(url)
      if (!/^https?:$/.test(u.protocol)) return undefined
      return { kind: 'web', name: u.href }
    } catch {
      return undefined
    }
  }
  if (tool === 'Skill') {
    const name = str(call.skill)
    return name && { kind: 'skills', name }
  }
  if (tool.startsWith('mcp__')) {
    const [server, ...rest] = tool.slice(5).split('__')
    const name = rest.join('__')
    if (!name || OWN_PLUGINS.includes(server)) return undefined
    const arg = server === 'context7' ? (str(call.libraryName) ?? str(call.query)) : server === 'codegraph' ? str(call.query) : undefined
    return { kind: 'other', name: arg ?? name, source: server.replace(/^claude_ai_/, '') }
  }
  return undefined
}

// shortcut: an agent spawned before the prompt that first calls after it still counts; read spawn times from `spawns` to fix.
export const recordUse = (used: Used, call: { tool: string } & Record<string, unknown>): Used => {
  const use = useOf(call)
  const id = str(call.agentId)
  if (!use || (id && used.stale.includes(id))) return used
  const was = used.kinds[use.kind] ?? { main: 0, agents: 0, names: [], fromAgents: [] }
  // Stored before fromAgents, agentOf and sourceOf existed.
  const fromAgents = was.fromAgents ?? []
  const agentOf = was.agentOf ?? {}
  const sourceOf = was.sourceOf ?? {}
  const names = [use.name, ...was.names.filter(n => n !== use.name)].slice(0, USE_NAMES)
  // A name stays an agent's until Claude uses it too.
  const agentOnly = id && (!was.names.includes(use.name) || fromAgents.includes(use.name))
  const keptFrom = [...(agentOnly ? [use.name] : []), ...fromAgents.filter(n => n !== use.name && names.includes(n))]
  const keep = <T,>(rec: Record<string, T>, own?: [string, T]) =>
    Object.fromEntries([...(own ? [own] : []), ...Object.entries(rec).filter(([n]) => n !== use.name && names.includes(n))])
  const reader = id ?? 'main'
  const prev = readersOf(was)
  const mine = prev.find(([r]) => r === reader)?.[1] ?? []
  const read: [string, number][] = [[use.name, (mine.find(([n]) => n === use.name)?.[1] ?? 0) + 1], ...mine.filter(([n]) => n !== use.name)]
  const byReader: Readers = (prev.some(([r]) => r === reader) ? prev : [...prev, [reader, []] as Readers[number]]).map(([r, ns]): Readers[number] => [r, (r === reader ? read : ns).filter(([n]) => names.includes(n))])
  // A page fetched under this reader's latest search; its first parent stays.
  const latest = mine.find(([n]) => sourceOf[n] === 'search')?.[0]
  const pages = (was.parentOf ?? []).map(([r, ps]): [string, [string, string][]] => [r, ps.filter(([u]) => names.includes(u))])
  const mineP = pages.find(([r]) => r === reader)?.[1] ?? []
  const parentOf: NonNullable<UseEntry['parentOf']> =
    use.kind === 'web' && !use.source && latest && !mineP.some(([u]) => u === use.name)
      ? [...pages.filter(([r]) => r !== reader), [reader, [...mineP, [use.name, latest]]]]
      : pages
  const kind = {
    main: was.main + (id ? 0 : 1),
    agents: was.agents + (id ? 1 : 0),
    names,
    fromAgents: keptFrom,
    agentOf: keep(agentOf, agentOnly && id ? [use.name, id] : undefined),
    sourceOf: keep(sourceOf, use.source ? [use.name, use.source] : undefined),
    byReader,
    parentOf,
  }
  return { ...used, kinds: { ...used.kinds, [use.kind]: kind }, seen: id && !used.seen.includes(id) ? [...used.seen, id] : used.seen }
}

// A new prompt: agents met so far become stale, counts restart.
export const resetUsed = (used: Used): Used => ({ kinds: {}, last: used.kinds, stale: [...used.stale, ...used.seen], seen: [] })

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
// The History list's, on a key of its own: a reload keeps what older code stored under `scrolled`.
const historyTop = atom({ plugin: 'margin', key: 'historyTop' } as const, 0)
// The first STEPS row shown, and whether it follows the step in progress: the wheel or a cue there stops that until
// the next prompt.
const stepsTop = atom({ plugin: 'margin', key: 'stepsTop' } as const, 0)
const stepsFollow = atom({ plugin: 'margin', key: 'stepsFollow' } as const, true)

// What this turn's tool calls read or fetched, by kind.
const used = atom({ plugin: 'margin', key: 'used' } as const, EMPTY_USED)
// Claude's last intent report.
const intent = atom({ plugin: 'margin', key: 'intent' } as const, EMPTY_INTENT)
// Agents the main loop started, kept past their end: no event says one finished, the list does.
const spawns = atom({ plugin: 'margin', key: 'spawns' } as const, [] as Spawn[])
// Bumped per user prompt: tells this turn's agents from earlier ones.
const turns = atom({ plugin: 'margin', key: 'turns' } as const, 0)
// The step whose agents all show, past the 3 each shows folded; -1 for none.
const expanded = atom({ plugin: 'margin', key: 'expanded' } as const, -1)
// The Git tab's open modal, or none; a top of -1 opens the branch modal on the current branch.
const modal = atom({ plugin: 'margin', key: 'modal' } as const, null as Modal | null)
let rerunning = false
// GitHub's PRs for this repo, read on a timer off the draw path; each PR's modal details once opened.
const gh = atom({ plugin: 'margin', key: 'gh' } as const, { at: 0, remote: '', prs: [] } as Gh)
const prViews = atom({ plugin: 'margin', key: 'prViews' } as const, {} as Record<number, PrView>)
// Each opened commit: its row as COMMITS drew it, so the modal outlives a scroll, and its body and files once read.
const commitViews = atom({ plugin: 'margin', key: 'commitViews' } as const, {} as Record<string, { row: LogRow; view?: CommitView }>)
// The agent whose transcript the main view shows, as the pane last drew: a press on its row goes back.
let viewing: string | undefined

// TOPICS: what this chat is about, read from its prompts alone.
const overview = atom({ plugin: 'margin', key: 'overview' } as const, EMPTY_OVERVIEW)

// Claude reports its own intent through this tool; the rule says when.
const INTENT_TOOL = 'mcp__margin__intent'
const INTENT_RULE = [
  'Intent reporting: the user watches a side panel showing your reading of their request and your take on it.',
  `Call the \`${INTENT_TOOL}\` tool with wants, take and steps at the start of every turn that answers a user prompt, as the first block of your message, before any other tool call in it.`,
  'Then ping it as {"now": n}, n the 1-based step, as the first block of the message that starts a new step, and only then, as a ping splits the chat\'s tool rows;',
  'send wants, take and steps again only when your reading or steps change. Never call it alone just to mark the last step done:',
  'your answer closes it. Do not mention the tool in your reply. Write wants, take and steps in the language the user writes in.',
  "When a step spawns agents, list each Agent call's description in that step's agents, exactly as you pass it, and keep listing them when you redraft.",
  'take is your reaction to the ask, given before any work; never the answer. On a work ask: your stance on doing it as asked. On a question with no work: how sure you are and what you will check, or a premise you doubt; never your expected answer, even when context already holds it: name the source, not what it says.',
  'Bad: "plausible: wording invites a mini-answer". Good: "check rule: will read the take rule".',
  "stance: fine = you would do it as asked; concern = you would do it but see a real risk or a better way; against = you'd want the user to reconsider before you act: the ask as stated is irreversible, bypasses a safeguard (review, CI, backup, confirmation), or breaks a stated rule. Pick against over concern whenever one of these holds, even if you would still do it after confirming; unsure = you cannot judge yet.",
  'label: required, 1 to 3 words, at most 16 characters. On a question with no work: a verb and its target, such as "check labels", "read session", "count names". Examples: fine "clear", "small fix"; concern "risky", "overkill", "check first"; against "breaks rule", "data loss"; unsure "needs repro", "unclear goal". Bad: "naming q", "design q", "answer", "question": they name the question type, not your take. No mood words such as "excited" or "happy".',
  'why: optional, one clause, about 60 characters at most: the reason. With unsure, the why names the input you will check (a file, a command or the session), never a finding.',
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
  description: `Report how you read the user request and your take on it, for the side panel. Returns nothing useful. ${INTENT_RULE}`,
  isDeferred: false,
  inputSchema: {
    type: 'object',
    properties: {
      wants: { type: 'string', description: 'what the user wants, 1-2 lines; full report only' },
      take: {
        type: 'object',
        description: 'your reaction to the ask, before any work; full report only',
        properties: {
          stance: { enum: ['fine', 'concern', 'against', 'unsure'] },
          label: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['stance', 'label'],
      },
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
const PROMPTS_ARE = 'These are the prompts a user sent in one coding-assistant chat, oldest first.'
const SESSION_LINE =
  'Reply with one line starting "> ": what the whole session is about, high level, in one short sentence of at most 15 words, with no file names, branches, PR numbers or step details,'
const IN_LANGUAGE = 'Write them in the language the user writes in.'
const OVERVIEW_ASK = [
  PROMPTS_ARE,
  'Group them into topics: the pieces of work the chat covered, oldest first, the newest work last.',
  SESSION_LINE,
  'then only the topics, one per line, each starting "- ", at most 8 words.',
  IN_LANGUAGE,
].join(' ')
// Regrouped from scratch, every read reworded every line; kept whole, broad topics swallowed new work
// and went stale. Sent back whole, Opus could still drop or reword them, so it now answers only the last
// one and the code keeps the rest: about 70% less output, 0 of 18 bad replies (replayed over past chats).
const LATEST_ASK = [
  PROMPTS_ARE,
  SESSION_LINE,
  'Reply with only the session line, then the last topic: reworded to fit the newest prompts, or kept word for word',
  'and followed by a new last topic when they start a different piece of work, so one or two lines each starting "- ", at most 8 words.',
  IN_LANGUAGE,
].join(' ')
const OVERVIEW_KEEP = [
  'Topics are pieces of work, not one-off questions or tool checks.',
  'Current topics, shown to the user, oldest first; all but the last stay as they are:',
].join(' ')
// Written fresh, the summary was reworded every read; sent back, it held until the work changed (replayed over past chats).
const SESSION_KEEP =
  'Current session line, shown to the user: keep it word for word unless the newest prompts change what the whole session is about; then write a new one:'
// Bounds the reply on a long chat; replays merged cleanly at 10 and 20.
const OVERVIEW_CAP = 30
// Below the cap, so a merge always shrinks the list: asked for at most 30, Opus sent 30 back unmerged.
const MERGE_TO = 20
const OVERVIEW_TOKENS = 2000
// Exact counts: told only "at the limit", Opus sent 32 topics back unchanged.
const overviewMerge = (count: number) =>
  [
    'Topics are pieces of work, not one-off questions or tool checks.',
    `There are ${count} current topics, shown to the user; the reply must have at most ${MERGE_TO} lines,`,
    'so combine the most closely related topics into fewer lines, keep the newest few lines word for word, in order,',
    'and reword the last to fit the newest prompts or add a new last topic when they start a different piece of work:',
  ].join(' ')
// A merge replaces the list, so one that drops the newest lines the user saw is refused.
const keptTopics = (shown: string[], topics: string[]) =>
  topics.length <= MERGE_TO && shown.slice(-4, -1).every(topic => topics.includes(topic))
export const parseTopics = (text: string) =>
  text
    .split('\n')
    .flatMap(line => /^\s*[-•*]\s+(.+)$/.exec(line)?.[1]?.trim() ?? [])
export const parseSummary = (text: string) => /^[ \t]*>[ \t]+(\S.*)$/m.exec(text)?.[1]?.trim()
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
    const { topics: shown, summary: was } = await read($, overview)
    const merging = shown.length >= OVERVIEW_CAP
    // The first read and a merge get the whole list back; any other read only the last topic or two.
    const latest = shown.length > 0 && !merging
    const keep = (was ? `\n${SESSION_KEEP}\n> ${was}` : '') + (shown.length ? `\n${merging ? overviewMerge(shown.length) : OVERVIEW_KEEP}\n${shown.map(topic => `- ${topic}`).join('\n')}` : '')
    const prompt = `${latest ? LATEST_ASK : OVERVIEW_ASK}${keep}\n\nPrompts:\n${prompts.map(one => `- ${flat(one.display).slice(0, 300)}`).join('\n')}`
    const reply = await $.model.complete({ model: 'opus', prompt, effort: 'low', maxTokens: OVERVIEW_TOKENS, timeoutMs: 20_000 })
    if (seq !== overviewSeq) {
      t.event('overview.read', { dropped: 'newer read started' }, 'debug')
      return
    }
    const got = reply.isAnswered ? parseTopics(reply.text) : []
    const kept = latest ? shown.slice(0, -1) : []
    // An echo of the kept topics is dropped only when exact: one reworded on the way back would add a near-copy.
    const echoed = kept.length > 0 && kept.every((topic, i) => got[i] === topic)
    const fresh = [...new Set(echoed ? got.slice(kept.length) : got)]
    const topics = [...kept, ...fresh]
    const summary = reply.isAnswered ? parseSummary(reply.text) : undefined
    // A cut reply loses its last lines, the current topic among them.
    const failed = !reply.isAnswered
      ? reply.reason
      : !fresh.length
        ? 'unreadable'
        : reply.usage.output_tokens >= OVERVIEW_TOKENS
          ? 'cut short'
          : (latest ? fresh.length <= 2 : !merging || keptTopics(shown, topics))
            ? undefined
            : 'dropped topics'
    t.event('overview.read', { prompts: prompts.length, topics: topics.length, failed })
    await update($, overview, now => (failed ? { ...now, running: false, failed } : { topics, summary: summary ?? now.summary, running: false }))
  } catch (err) {
    t.error('overview.read', err)
    // complete rejects on a request the engine refuses to send (a blocked model).
    if (seq === overviewSeq) await update($, overview, now => ({ ...now, running: false, failed: 'error' }))
  }
}

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

// The chat wraps a paste in <pasted_content> tags; history keeps it bare. A control character (a
// pasted escape sequence) would get the whole pane refused, so it reads as a space.
const flat = (text: string) =>
  text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/[\s\x00-\x1f\x7f]+/g, ' ')
    .trim()

const STANCES = ['fine', 'concern', 'against', 'unsure']
const readTake = (raw: { stance?: unknown; label?: unknown; why?: unknown } | undefined): Take | undefined => {
  if (!raw || !STANCES.includes(raw.stance as string)) return undefined
  const label = typeof raw.label === 'string' ? flat(raw.label) : ''
  if (!label) return undefined
  const why = typeof raw.why === 'string' ? flat(raw.why) : ''
  return { stance: raw.stance as Take['stance'], label, ...(why && { why }) }
}

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

// The divider the last notch moved, with its pointer row and time: it moves off the pointer, so notches on that
// row less than WHEEL_HOLD ms apart keep moving it.
let wheeling: { zone: 'git'; row: number; at: number } | undefined
// A row's leave, held LEAVE_HOLD ms: a move onto the next row posts its enter just after, and a draw between the two
// drops the cards under the left row's card for a frame. An enter in time takes it in; else it lands alone.
const LEAVE_HOLD = 30
let leaving: { row: string; n: number } | undefined
let leaves = 0

// The chat's own file holds every prompt's message id, drawn or not; searched with grep, as it
// outgrows what $.fs.read takes whole. A repeated prompt resolves to the copy sent nearest the
// history entry's time.
// Found by session id, not rebuilt from the root: Claude Code cuts a long root's folder name and
// hashes it, and /cd or a worktree move changes the root. Kept once found.
const chatPaths = new Map<string, string>()
// Each skill's SKILL.md, as the engine reported it when the skill loaded.
const skillPaths = new Map<string, string>()
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
// (see FRESH in tab-history.tsx). Due by the clock, not a flag: a timer dropped with the draw that set it holds off
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
const pick = async ($: EngineInterface, next: Tab) => {
  if (next !== (await read($, tab)) && (await read($, modal))) await setModal($, () => null)
  // Picking Git reads the repo afresh: it may have changed outside this chat.
  if (next === 'Git') resetGitReads()
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
      const placed = (await built.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
      // As setModal: the open pane drops closeOnEscape.
      if ((await built.state.get({ plugin: 'margin', key: 'modal' } as const)).value) {
        await built.state.set({ plugin: 'margin', key: 'modal' } as const, null)
        if (placed) await built.ui.open({ id: PANE, title: 'Margin', columns: 40 }).catch(() => undefined)
      }
      await built.state.set({ plugin: 'margin', key: 'tab' } as const, 'File')
      if (!placed) {
        await built.store.set('open', true).catch(() => undefined)
        const opened = await built.ui.open({ id: PANE, title: 'Margin', columns: 40 })
        if (!opened.isPlaced) built.ui.toast('Margin waits: terminal too narrow.')
      }
    }

    return { ...built, margin: { show } }
  })

  on('session.start', async ($, e, next) => {
    const { palette, ignored } = await readPalette($)
    applyPalette(palette)
    // Paths are the user's own JSON keys: no control bytes into the toast, and a bounded length.
    const named = ignored.slice(0, 5).map(path => [...path.replace(/[\x00-\x1f\x7f-\x9f]/g, '')]).map(cps => (cps.length > 40 ? `${cps.slice(0, 39).join('')}…` : cps.join('')))
    const more = ignored.length > 5 ? ` +${ignored.length - 5} more` : ''
    if (named.length) $.ui.toast(`claudzilla.json: ignored ${named.join(', ')}${more}`)
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
    await update($, stepsTop, () => 0)
    await update($, stepsFollow, () => true)
    resetStepsHeld()
    await update($, submitted, n => n + 1)
    // A background task's result carries the last request on: Claude pings its report, not a new one, so it reopens.
    if (e.origin.kind === 'task-notification') {
      await refreshSpawns($)
      await update($, intent, now => (now.wants ? { ...now, ended: false, agents: undefined } : { ...now, agents: undefined }))
    } else if (!e.command && !e.isMeta) {
      // One typed over a running turn joins it.
      if (!e.turnId) {
        await update($, turns, n => n + 1)
        await update($, used, resetUsed)
      }
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
      const report = e as unknown as Partial<Pick<Intent, 'wants' | 'steps'>> & { take?: { stance?: unknown; label?: unknown; why?: unknown } } & { agentId?: string; now?: unknown }
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
        // A report missing ASK or TAKE, or with a bad take, keeps the last ones, or the tab goes blank.
        await update($, intent, now => ({
          wants: flat(String(report.wants ?? now.wants)),
          take: readTake(report.take) ?? now.take,
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
        await update($, spawns, now => [...now, { id, description: e.description, step, turn, status: 'pending', name: e.name, type: e.subagentType }])
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
    if (modalOpen() && !/^([ms]|open):/.test(e.element ?? '')) {
      const isTab = TABS.some(one => one === e.element)
      await setModal($, m => (m?.sub && !isTab ? { ...m, sub: undefined } : null))
      if (!isTab) return { element: e.element }
    }
    // Agent rows redraw mid-turn too: their fold takes the tabs' route.
    if (e.element === 'less' || e.element?.startsWith('more:')) {
      await update($, expanded, () => (e.element === 'less' ? -1 : Number(e.element!.slice(5))))

      return { element: e.element }
    }
    if (e.element === 'o:topics:all') {
      await setModal($, () => ({ key: 'topics', top: 0 }))

      return { element: e.element }
    }
    const picked = TABS.find(one => one === e.element)
    if (!picked) return next(e)
    await pick($, picked)

    return { element: e.element }
  })

  // A divider, dragged or clicked: the render clamps a divider to keep 1 row on either side.
  on('ui.message', async ($, e, next) => {
    // A row Client: the pointer entered or left it, or it was pressed.
    if (e.requestId === PANE && typeof e.element === 'string' && e.element.startsWith('row:')) {
      const row = e.element.slice(4)
      const data = e.data as { hover?: boolean; press?: boolean } | undefined
      // A row under the left row's card is entered as the pointer lands on that card: its card stays undrawn.
      const under = (left: string | null) => {
        const span = left ? hoverOf(row).spans[left] : undefined
        return !!span && hoverOf(row).lines[row]! >= span[0] && hoverOf(row).lines[row]! < span[1]
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
        await hoverOf(row).acts[row]?.()
      }
      return {}
    }
    const rows = (e.data as { split?: unknown } | undefined)?.split
    if (e.requestId !== PANE || e.element !== 'divider' || typeof rows !== 'number') return next(e)
    await update($, split, () => Math.max(0, rows))

    return {}
  })

  // Wheel zone order: an open modal takes every notch; then a held or hovered divider; then the zone under the pointer;
  // then the tab's fallback; else next(e).
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const zones = drawnZones()
    const rowIn = (z: Zone) => (e.pointer ? e.pointer.row + z.offset : undefined)
    const over = (z: Zone) => {
      const row = rowIn(z)
      return row !== undefined && row >= z.from && row < z.to && (!z.columns || (e.pointer!.column >= z.columns[0] && e.pointer!.column < z.columns[1]))
    }
    // 1. An open modal takes every notch: over its top layer it scrolls it, anywhere else nothing.
    const layer = zones.find(z => z.kind === 'modal')
    if (layer) {
      if (over(layer)) await layer.wheel(e.by)
      return {}
    }
    // 2. A divider under the pointer, or still wheeled within WHEEL_HOLD on the same row.
    const dividers = zones.filter(z => z.kind === 'divider')
    if (dividers.length) {
      const now = await $.clock.now().catch(() => -Infinity)
      const held = (z: Zone) => !!wheeling && wheeling.zone === z.hold && e.pointer?.row === wheeling.row && now - wheeling.at < WHEEL_HOLD
      const divider = dividers.find(z => rowIn(z) === z.from || held(z))
      if (divider) {
        wheeling = { zone: divider.hold!, row: e.pointer!.row, at: now }
        await divider.wheel(e.by)
        return {}
      }
    }
    // 3. The list under the pointer; 4. else the tab's fallback. The Overview has none: the engine scrolls it.
    const list = zones.find(z => z.kind === 'list' && over(z)) ?? zones.find(z => z.fallback)
    if (!list) return next(e)
    await list.wheel(e.by)
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

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    if (e.path) for (const name of [e.skill, ...(e.pluginName ? [`${e.pluginName}:${e.skill}`] : [])]) skillPaths.set(name, e.path)

    return result
  })

  // Recorded after the call runs: a call that fails or is refused used nothing.
  on('tool.call', { tool: /^(Read|Grep|Glob|WebSearch|WebFetch|Skill|mcp__.+)$/ }, async ($, e, next) => {
    const result = await next(e)
    if (useOf(e as never)) await update($, used, u => recordUse(u, e as never))

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
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // A tab saved before it was hidden falls back to the first shown.
    const saved = await read($, tab)
    const current = TABS.includes(saved) ? saved : TABS[0]!
    const flagged = await read($, notices)
    // Divider gets half the side margin on each side.
    const rule = '─'.repeat(e.props.bodyColumns - PAD)
    const emptyNote = (rows: number, title: string, ...lines: JSX.Element[]) => kitEmptyNote(elements, rows, title, ...lines)

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

    // Kept while a Git draw reads: a wheel tick meanwhile still scrolls its zone.
    keepZones(current)
    const ctx: TabCtx = { props: e.props, signal: next.signal, el: elements, pick: tab => pick($, tab), setModal: change => setModal($, change) }
    let out: TabDraw
    if (current === 'File') {
      out = await drawFile($, ctx)
    } else if (current === 'History') {
      out = await drawHistory($, {
        ...ctx,
        reads: async () => {
          const key = `${await $.session.id()}:${await read($, submitted)}`
          const at = await $.clock.now()
          if (historyRead?.key !== key || at - historyRead.at >= READ_TTL) historyRead = { key, at, reads: readHistory($) }
          return historyRead.reads
        },
        rowTimes: keys => rowTimes($, keys),
        rowIds,
        awaited,
        shown,
        pin: () => pin,
        flat,
        isCommand,
        jump,
        reuse,
        rewind,
        latest,
      })
    } else if (current === 'Decisions') {
      out = {
        body: emptyNote(
          e.props.scroll.bodyRows - BAR_ROWS - 2,
          'Coming in v1.8',
          <Text color={HUD.faint}>Choices made in this chat</Text>,
          <Text color={HUD.faint}>and why they were made.</Text>,
        ),
        zones: [],
        trace: {},
      }
    } else if (current === 'Tree') {
      out = {
        body: emptyNote(
          e.props.scroll.bodyRows - BAR_ROWS - 2,
          'Coming in v1.8',
          <Text color={HUD.faint}>The repo's files as a tree,</Text>,
          <Text color={HUD.faint}>each one opens in File.</Text>,
        ),
        zones: [],
        trace: {},
      }
    } else if (current === 'Git') {
      out = await drawGit($, { ...ctx, readGh: () => readGh($), readCommitView: sha => readCommitView($, sha), readPrView: (n, failed) => readPrView($, n, failed), rerunFailed: runs => rerunFailed($, runs) })
    } else {
      viewing = e.props.view?.agentId
      out = await drawOverview($, { ...ctx, viewing: () => viewing, skillPath: name => skillPaths.get(name) })
    }
    if (!next.signal.aborted && (await read($, tab)) === saved) setZones(current, out.zones)
    const body = out.fade ? fadeTree(out.body, out.fade.keep, () => setModal($, () => null), out.fade.open) : out.body
    // What the tab drew, or hid and why.
    const zones = out.trace
    // Kept in the entry but out of the change key: a wheel tick moves these alone.
    const scroll = out.scroll ?? {}

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
