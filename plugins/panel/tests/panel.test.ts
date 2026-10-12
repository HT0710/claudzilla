import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { dayLabel, gone, inView, keepNewest, litPrompt, nearestCommandId, nearestId, needles, ordered, pinHolds, readStamps, stampPattern } from '../hooks/register'

// A process.run result with `stdout`.
const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
// Stands for grep pulling this chat's lines from the prompt history.
const isHistoryGrep = (argv: readonly string[]) => argv.at(-1)?.endsWith('history.jsonl') ?? false

const props = {
  title: 'Panel',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: only History shows while Activity and Git are deferred`, async ($, on) => {
    on('clock.now', () => ({ value: 0 }))
    on('env.get', () => ({ value: '/home/me' }))
    on('session.id', () => ({ value: 'chat-1' }))
    on('fs.read', () => ({ value: '' }))
    const ui = await $.ui.mount({ plugin: 'panel', surface, component: 'Pane', props, requestId: 'panel' })
    expect(await ui.find({ key: 'Activity' })).toBeUndefined()
    expect(await ui.find({ key: 'Git' })).toBeUndefined()
    expect(await ui.find({ key: 'rewind' })).toBeDefined()
  })
}

test('a slow pane draw finishes before a newer fast one', async () => {
  let open = () => {}
  const gate = new Promise<void>(resolve => (open = resolve))
  const finished: string[] = []

  const older = ordered(async () => {
    await gate
    return 'older'
  }).then(name => finished.push(name))
  const newer = ordered(async () => 'newer').then(name => finished.push(name))
  // The newer draw has settled by now when nothing holds it back.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  open()
  await Promise.all([older, newer])

  expect(finished).toEqual(['older', 'newer'])
})

test('divider keeps half the side margin', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: '' }))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text.length).toBe(props.bodyColumns - 2)
})

test("History tab lists this chat's prompts, newest first, wherever the shell cd'd", async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = [
    JSON.stringify({ display: 'older\nprompt', timestamp: 1, project: '/proj', sessionId: 'chat-1' }),
    JSON.stringify({ display: 'other chat, same folder', timestamp: 2, project: '/proj', sessionId: 'chat-0' }),
    '{"display": "half writ',
    JSON.stringify({ display: 'newest prompt', timestamp: 3, project: '/proj', sessionId: 'chat-1' }),
  ].join('\n')
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.cwd', () => ({ value: '/proj/sub' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path === '/home/me/.claude/history.jsonl' ? history : '' }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('newest prompt')
  // "↻ " takes 2 columns; the jump button fills the rest of the row.
  expect((await ui.find({ key: 'jump:0' }))?.text.length).toBe(props.bodyColumns - 4 - 2)
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('older prompt')
  expect(await ui.find({ key: 'jump:2' })).toBeUndefined()
})

test('History reads the prompt history under CLAUDE_CONFIG_DIR when it is set', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = JSON.stringify({ display: 'from the moved folder', timestamp: 1, sessionId: 'chat-1' })
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/cfg' : '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path === '/cfg/history.jsonl' ? history : '' }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('from the moved folder')
})

test('History still lists prompts once the prompt history is too big to read whole', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const line = JSON.stringify({ display: 'found by grep', timestamp: 1, sessionId: 'chat-1' })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => {
    throw new Error('over 4 MiB')
  })
  on('process.run', (_, e) =>
    ran(e.argv.includes('/home/me/.claude/history.jsonl') && e.argv.includes('"sessionId":"chat-1"') ? `${line}\n` : ''),
  )

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('found by grep')
})

test('↻ puts the prompt, line breaks kept, back in the prompt box', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const filled: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'older\nprompt', timestamp: 1, sessionId: 'chat-1' }) }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'reuse:0' })

  expect(filled).toEqual(['older\nprompt'])
})

test('jumping to a prompt the chat cannot find says so', async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'from yesterday', timestamp: 1, sessionId: 'chat-1' }) }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'jump:0' })

  expect(toasts).toEqual(["Can't jump: not found in the chat. ↻\u00a0reuses it."])
})

test('a jump whose scroll fails says so', async ($, on) => {
  const toasts: string[] = []
  const at = '2026-10-10T10:00:00.000Z'
  const history = JSON.stringify({ display: 'go', timestamp: Date.parse(at), sessionId: 'chat-1' })
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  // The chat file holds the prompt's row, so the jump tries to scroll; the test surface cannot.
  on('process.run', (_, e) =>
    ran(isHistoryGrep(e.argv) ? history : JSON.stringify({ type: 'user', uuid: 'go-row', timestamp: at, message: { content: 'go' } })),
  )
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'jump:0' }).catch(() => undefined)

  expect(toasts).toEqual(["Can't jump: not found in the chat. ↻ reuses it."])
})

test('a repeated prompt resolves to the transcript copy sent nearest its time', () => {
  const at = (iso: string) => Date.parse(iso)
  const transcript = [
    JSON.stringify({ type: 'user', uuid: 'early', timestamp: '2026-10-10T09:00:00Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'right', timestamp: '2026-10-10T10:00:01Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'late', timestamp: '2026-10-10T11:00:00Z', message: { content: 'go' } }),
    JSON.stringify({ type: 'user', uuid: 'tool', timestamp: '2026-10-10T10:00:00Z', message: { content: [] } }),
    JSON.stringify({ type: 'assistant', uuid: 'reply', timestamp: '2026-10-10T10:00:00Z', message: { content: 'go' } }),
    '{"type": "user", "uu',
  ].join('\n')

  expect(nearestId(transcript, { display: 'go', timestamp: at('2026-10-10T10:00:00Z') })).toBe('right')
  expect(nearestId(transcript, { display: 'stop', timestamp: at('2026-10-10T10:00:00Z') })).toBeUndefined()
})

test('the rewind button opens the /rewind picker', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const ran: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'go', timestamp: 1, sessionId: 'chat-1' }) }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'rewind' })

  expect(ran).toEqual(['rewind'])
})

test('day labels: today, then the date', () => {
  const now = new Date(2026, 9, 11, 1, 20)
  expect(dayLabel(new Date(2026, 9, 11, 0, 5).getTime(), now)).toBe('Today')
  expect(dayLabel(new Date(2026, 9, 10, 23, 41).getTime(), now)).toBe('Sat 10 Oct')
  expect(dayLabel(new Date(2026, 9, 9, 12, 0).getTime(), now)).toBe('Fri 9 Oct')
})

test('a day divider opens each day, once', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const day = 24 * 60 * 60 * 1000
  const history = [Date.now() - 3 * day, Date.now() - 3 * day + 1000, Date.now()]
    .map((timestamp, i) => JSON.stringify({ display: `p${i}`, timestamp, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.findAll({ type: 'Text', text: 'Today' })).length).toBe(1)
  // "──── Today ────" spans the row exactly (side margins take 4 columns), label centered.
  const [left] = await ui.findAll({ type: 'Text', text: /^─+ $/ })
  const [right] = await ui.findAll({ type: 'Text', text: /^ ─+$/ })
  expect((left?.text.length ?? 0) + 'Today'.length + (right?.text.length ?? 0)).toBe(props.bodyColumns - 4)
  expect(Math.abs((left?.text.length ?? 0) - (right?.text.length ?? 0))).toBeLessThanOrEqual(1)
  expect((await ui.findAll({ type: 'Text', text: dayLabel(Date.now() - 3 * day, new Date()) })).length).toBe(1)
})

const asPrompts = (...texts: string[]) => texts.map((display, i) => ({ display, timestamp: i }))

test('gone runs: a middle run was rewound, a run reaching the oldest was compacted', () => {
  // Newest first, as the panel lists them.
  expect(gone(asPrompts('P6', 'P5', 'P4', 'P3', 'P2', 'P1'), ['P1', 'P2', 'P6'], ['P1', 'P2', 'P6'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: false },
    { isLive: false },
    { isLive: true },
    { isLive: true },
  ])
  expect(gone(asPrompts('P9', 'P8', 'P7', 'P1'), ['P8', 'P9'], ['P8', 'P9']).map(row => row.marker)).toEqual([
    undefined,
    undefined,
    'Compacted',
    undefined,
  ])
})

test('gone runs: a repeated prompt keeps its newest copies live', () => {
  expect(gone(asPrompts('go', 'x', 'go'), ['go', 'x'], ['go', 'x'])).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: false, marker: 'Compacted' },
  ])
})

test('gone runs: an empty read marks nothing rather than calling it all compacted', () => {
  expect(gone(asPrompts('a', 'b'), [], [])).toEqual([{ isLive: true }, { isLive: true }])
})

test('gone runs: a chat reloaded after a compaction, no prompt typed since, is compacted whole', () => {
  expect(gone(asPrompts('/compact', 'b', 'a'), ['summary', '<command-name>/compact</command-name>'], ['summary'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Compacted' },
    { isLive: false },
  ])
})

test('gone runs: compacted prompts stay live, the marker on the first one the model lost', () => {
  expect(gone(asPrompts('P4', 'P3', 'P2', 'P1'), ['P1', 'P2', 'P3', 'P4'], ['P3', 'P4'])).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true, marker: 'Compacted' },
    { isLive: true },
  ])
  // Right after /compact the model holds the summary alone: every prompt the chat shows was compacted.
  expect(gone(asPrompts('P2', 'P1'), ['P1', 'P2'], ['summary'])).toEqual([{ isLive: true, marker: 'Compacted' }, { isLive: true }])
})

test('gone runs: one Compacted marker, right under the newest /compact above it', () => {
  const prompts = asPrompts('/compact', '/panel', '/restart', 'go', '/compact', '/restart', 'old')
  expect(gone(prompts, ['go'], ['summary']).map(row => row.marker)).toEqual([
    undefined,
    'Compacted',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

test('gone runs: a slash command inside a run goes with it, at its edge stays live', () => {
  expect(gone(asPrompts('P4', 'P3', '/panel', 'P2', 'P1'), ['P1', 'P4'], ['P1', 'P4'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: false },
    { isLive: false },
    { isLive: true },
  ])
  // /compact under a rewound `hi`: the prompt before it is still in the chat.
  expect(gone(asPrompts('P3', 'hi', '/compact', 'P1'), ['P1', 'P3'], ['P1', 'P3'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
    { isLive: true },
  ])
})

test('gone runs: a prompt opening with a path is a prompt, not a slash command', () => {
  expect(gone(asPrompts('P2', '/home/me/notes.txt is broken', 'P1'), ['P1', 'P2'], ['P1', 'P2'])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
})

test('the History tab draws Rewound above a rewound run, Compacted where the model lost the chat', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'kept', 'undone', 'latest']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 4 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [
            { role: 'user', content: [{ type: 'text', text: 'summary' }] },
            { role: 'user', content: [{ type: 'text', text: 'kept' }, { type: 'text', text: '<system-reminder>' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            { role: 'user', content: [{ type: 'text', text: 'latest' }] },
          ]
        : [
            { role: 'user', text: 'old', toolUses: [] },
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'assistant', text: 'ok', toolUses: [] },
            { role: 'user', text: 'latest', toolUses: [] },
          ],
  }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(1)
  expect((await ui.findAll({ type: 'Text', text: 'Compacted' })).length).toBe(1)
  // Still in the chat but compacted: dim.
  expect((await ui.find({ type: 'Text', text: /^old\s*$/ }))?.props.color).toBe('#4f5c68')
})

test('gone runs: a paste matches though the chat wraps it in tags', () => {
  const chat = ['see\n\n \n\n<pasted_content id="1">\n~~~ pasted\n</pasted_content id="1">', 'kept']
  expect(gone(asPrompts('see\n\n ~~~ pasted', 'kept'), chat, chat)).toEqual([{ isLive: true }, { isLive: true }])
})

test('a paste kept as a placeholder shows its text and matches the chat', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = [
    JSON.stringify({ display: 'kept', timestamp: Date.now() - 3, sessionId: 'chat-1' }),
    JSON.stringify({
      display: '[Pasted text #1 +1 lines]',
      pastedContents: { 1: { id: 1, type: 'text', contentHash: 'abc' } },
      timestamp: Date.now() - 2,
      sessionId: 'chat-1',
    }),
    JSON.stringify({
      display: 'see [Pasted text #2]',
      pastedContents: { 2: { id: 2, type: 'text', content: 'short' } },
      timestamp: Date.now() - 1,
      sessionId: 'chat-1',
    }),
  ].join('\n')
  const chat = [
    'kept',
    '\n\n<pasted_content id="9">\nlong\npaste\n</pasted_content id="9">',
    'see \n\n<pasted_content id="8">\nshort\n</pasted_content id="8">',
  ]
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('paste-cache/abc.txt') ? 'long\npaste' : history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? chat.map(text => ({ role: 'user', content: [{ type: 'text', text }] }))
        : chat.map(text => ({ role: 'user', text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('see short')
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('long paste')
  expect(await ui.find({ type: 'Text', text: 'Rewound' })).toBeUndefined()
})

test('gone runs: a pasted /command is a prompt; a paste whose text is lost takes the run around it', () => {
  const pasted = { display: '/compact keep', typed: '[Pasted text #1]', timestamp: 1 }
  expect(gone([{ display: 'next', timestamp: 2 }, pasted, { display: 'first', timestamp: 0 }], ['first', 'next'], [])).toEqual([
    { isLive: true },
    { isLive: false, marker: 'Rewound' },
    { isLive: true },
  ])
  const chat = ['first', 'next']
  expect(gone(asPrompts('next', '[Pasted text #1 +3 lines]', 'first'), chat, chat)).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
})

test('the search text finds a paste prompt: cut at the placeholder, a lone paste by its tag', () => {
  const hits = (typed: string, content: string) =>
    needles(typed).some(text => JSON.stringify({ type: 'user', message: { role: 'user', content } }).includes(text))
  expect(hits('see [Pasted text #1 +2 lines]', 'see \n\n<pasted_content id="1">\nx\n</pasted_content id="1">')).toBe(true)
  expect(hits('[Pasted text #1]', '\n\n<pasted_content id="1">\nx\n</pasted_content id="1">')).toBe(true)
})

test('a prompt sent mid-turn, remembered in the store, is not marked rewound', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', 'sent mid-turn', 'latest']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 3 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? []
        : [
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'user', text: 'latest', toolUses: [] },
          ],
  }))
  mock.store(on, { 'midTurn:chat-1': ['sent mid-turn'] })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.findAll({ type: 'Text', text: 'Rewound' })).length).toBe(0)
})

test('/quit, /exit, /rewind, /panel, /resume and /clear are left out', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['/quit', 'kept', '/rewind', '/panel', '/resume', '/clear', '/exit', '/exited-not']
    .map((display, i) => JSON.stringify({ display, timestamp: i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('/exited-not')
  expect((await ui.find({ key: 'jump:1' }))?.text).toContain('kept')
  expect(await ui.find({ key: 'jump:2' })).toBeUndefined()
})

test("the search text finds a prompt's row in the chat file: escaped, pasted after, image beside", () => {
  const display = 'say "hi"\nthen go'
  const hits = (row: unknown) => needles(display).some(text => JSON.stringify(row).includes(text))
  const content = `${display}\n\n<pasted_content id="1">\nx\n</pasted_content id="1">`
  expect(hits({ type: 'user', message: { role: 'user', content } })).toBe(true)
  expect(hits({ type: 'user', message: { content: [{ type: 'text', text: display }, { type: 'image' }] } })).toBe(true)
  expect(hits({ display })).toBe(false)
})

test('a prompt sent with an image resolves to its row, text block beside the image', () => {
  const transcript = [
    JSON.stringify({ type: 'user', uuid: 'shot', timestamp: '2026-10-10T10:00:00Z', message: { content: [{ type: 'text', text: '[Image #1] look' }, { type: 'image' }] } }),
    JSON.stringify({ type: 'user', uuid: 'tool', timestamp: '2026-10-10T10:00:00Z', message: { content: [{ type: 'tool_result', content: '[Image #1] look' }] } }),
  ].join('\n')

  expect(nearestId(transcript, { display: '[Image #1] look', timestamp: Date.parse('2026-10-10T10:00:00Z') })).toBe('shot')
})

test('a slash row stays dim until its output line is drawn in the chat', async ($, on) => {
  const clock = mock.clock(on)
  const history = ['kept', '/model']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'kept', toolUses: [] }] }))
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'Text' as const, children: ['Set model.'] }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  const color = async () => (await ui.find({ type: 'Text', text: /^\/model\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const output = { command: 'model', args: '', text: 'Set model.', isErrored: false }
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'CommandOutput', props: output, requestId: 'cmd-1' })
  // The list redraws within 100 ms of the row drawing.
  await clock.advance(100)

  expect(await color()).toBe('claude')
})

test('a slash row is live once the chat holds its command row, drawn or not', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', '/compact keep']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  const command = '<command-name>/compact</command-name>\n  <command-message>compact</command-message>\n  <command-args>keep</command-args>'
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value: e.as === 'api' ? [] : ['kept', command].map(text => ({ role: 'user', text, toolUses: [] })),
  }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ type: 'Text', text: /^\/compact keep\s*$/ }))?.props.color).toBe('claude')
})

test('a stored mid-turn note the chat lost to a compaction is not held live', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'note', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 3 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  mock.store(on, { 'midTurn:chat-1': ['note'] })
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? [{ role: 'user', content: [{ type: 'text', text: 'new' }] }]
        : [{ role: 'user', text: 'new', toolUses: [] }],
  }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.findAll({ type: 'Text', text: 'Compacted' })).length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^note\s*$/ }))?.props.color).toBe('#4f5c68')
})

test('jumping to a prompt gone from the chat says so without searching', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const toasts: string[] = []
  const history = ['old', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'new', toolUses: [] }] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  await ui.press({ key: 'jump:1' })

  expect(toasts).toEqual(["Can't jump: rewound or compacted out of the chat. ↻\u00a0reuses it."])
})

test('a mid-turn prompt stays dim until its row is drawn in the chat', async ($, on) => {
  const clock = mock.clock(on)
  const history = ['kept', 'sent mid-turn']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'kept', toolUses: [] }] }))
  mock.store(on, { 'midTurn:chat-1': ['sent mid-turn'] })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['sent mid-turn'] }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })
  const color = async () => (await ui.find({ type: 'Text', text: /^sent mid-turn\s*$/ }))?.props.color
  expect(await color()).toBe('#4f5c68')

  const row = { text: 'sent mid-turn', origin: { kind: 'composer' as const }, isExpanded: false }
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', props: row, requestId: 'msg-1' })
  await clock.advance(100)

  expect(await color()).toBe('claude')
})

test('a slash command resolves to the output line of the run nearest its time', () => {
  const run = (uuid: string, at: string, name: string, args: string) => [
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid, timestamp: at, content: `<command-name>${name}</command-name>\n <command-message>x</command-message>\n <command-args>${args}</command-args>` }),
    JSON.stringify({ type: 'system', subtype: 'local_command', uuid: `${uuid}-out`, parentUuid: uuid, timestamp: at, content: '<local-command-stdout>ok</local-command-stdout>' }),
  ]
  const transcript = [
    ...run('early', '2026-10-10T09:00:00Z', '/panel', ''),
    ...run('right', '2026-10-10T10:00:01Z', '/panel', ''),
    ...run('other', '2026-10-10T10:00:00Z', '/compact', 'keep this'),
  ].join('\n')
  const at = Date.parse('2026-10-10T10:00:00Z')

  expect(nearestCommandId(transcript, { display: '/panel', timestamp: at })).toBe('right-out')
  expect(nearestCommandId(transcript, { display: '/compact keep this', timestamp: at })).toBe('other-out')
  expect(nearestCommandId(transcript, { display: '/compact other', timestamp: at })).toBeUndefined()
})

test('a prompt sent mid-turn that landed as a normal message is not held dim', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['kept', 'landed normally']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value:
      e.as === 'api'
        ? []
        : [
            { role: 'user', text: 'kept', toolUses: [] },
            { role: 'user', text: 'landed normally', toolUses: [] },
          ],
  }))
  mock.store(on, { 'midTurn:chat-1': ['landed normally'] })

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect((await ui.find({ type: 'Text', text: /^landed normally\s*$/ }))?.props.color).toBe('claude')
})

test('the count says 100+ when the chat holds more prompts than the list shows', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = Array.from({ length: 101 }, (_, i) => JSON.stringify({ display: `p${i}`, timestamp: i, sessionId: 'chat-1' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history.join('\n') }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect(await ui.find({ type: 'Text', text: '100+ prompts this session' })).toBeDefined()
  expect(await ui.find({ key: 'jump:100' })).toBeUndefined()
})

test('one prompt is counted without the plural s', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: JSON.stringify({ display: 'only', timestamp: 1, sessionId: 'chat-1' }) }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'History' })

  expect(await ui.find({ type: 'Text', text: '1 prompt this session' })).toBeDefined()
})

test('in view: one prompt, the newest whose turn is on screen', () => {
  // Newest first; the chat stamps a prompt's row ~0.1 s before history does.
  const prompts = [
    { display: 'c', timestamp: 30_000 },
    { display: 'b', timestamp: 20_000 },
    { display: 'a', timestamp: 10_000 },
  ]
  expect(inView(prompts, [])).toBe(0)
  expect(inView(prompts, [25_000, 26_000])).toBe(1)
  expect(inView(prompts, [29_900, 31_000])).toBe(0)
  // Several shown: the newest of them.
  expect(inView(prompts, [15_000, 25_000])).toBe(1)
  expect(inView(prompts, [5_000])).toBe(-1)
})

test('the stamp search finds a row by uuid either way round, a tool call by its id', () => {
  // Shapes from a real chat file: a user row, a command's output row, an assistant tool call.
  const lines = [
    '{"parentUuid":"p","type":"user","uuid":"u-1","timestamp":"2026-10-10T10:00:00.000Z","userType":"external"}',
    '{"type":"system","subtype":"local_command","content":"ok","level":"info","timestamp":"2026-10-10T10:00:01.000Z","uuid":"c-1","isMeta":false}',
    '{"message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash"}]},"uuid":"a-1","timestamp":"2026-10-10T10:00:02.000Z"}',
  ]
  // grep -o prints what the pattern matched on each line.
  const pattern = new RegExp(stampPattern(['u-1', 'c-1', 'toolu_1']))
  const printed = lines.map(line => line.match(pattern)?.[0] ?? '').join('\n')

  expect(readStamps(printed)).toEqual(
    new Map([
      ['u-1', Date.parse('2026-10-10T10:00:00.000Z')],
      ['c-1', Date.parse('2026-10-10T10:00:01.000Z')],
      ['toolu_1', Date.parse('2026-10-10T10:00:02.000Z')],
    ]),
  )
})

test('History lights the prompt whose turn is on screen, not the newest', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const runs: (readonly string[])[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : [{ role: 'user', text: 'a', toolUses: [] }, { role: 'user', text: 'b', toolUses: [] }, { role: 'user', text: 'c', toolUses: [] }] }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    runs.push(e.argv)
    const at = new Date(start + 15_000).toISOString()
    return { value: { exitCode: 0, stdout: `"uuid":"row-1","timestamp":"${at}"\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: "a reply in b's turn", origin: { kind: 'composer' as const }, isExpanded: false }
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('b')).toBe('claude')
  expect(await color('c')).toBeUndefined()
  expect(runs.some(argv => argv.join(' ').includes('row-1'))).toBe(true)

  // Scrolled away, nothing on screen is known: the newest lights again.
  await row.redraw({ ...reply, onScreen: null })
  await clock.advance(100)
  expect(await color('c')).toBe('claude')
})

test('History rereads at most once a second while the chat scrolls', async ($, on) => {
  const history = JSON.stringify({ display: 'a', timestamp: 1, sessionId: 'chat-1' })
  let greps = 0
  const clock = mock.clock(on, { now: 2_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) greps++
    return ran(isHistoryGrep(e.argv) ? history : '')
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const before = greps
  // A row coming on screen redraws the pane.
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'row-1',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  await clock.advance(100)
  expect(greps).toBe(before)

  await clock.advance(1_000)
  await row.redraw({ ...reply, onScreen: { first: 1, last: 3, of: 3 } })
  await clock.advance(100)
  expect(greps).toBe(before + 1)
  await row.redraw({ ...reply, onScreen: null })
})

test('chat moves redraw the panel once, 100 ms later', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const clock = mock.clock(on, { now: 1_000_000 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) =>
    ran(isHistoryGrep(e.argv) ? history : `"uuid":"b-row","timestamp":"${new Date(start + 15_000).toISOString()}"\n`),
  )
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color
  expect(await color('b')).toBe('claude')

  // Two moves inside 100 ms: nothing redraws until the one redraw for both.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })
  await row.redraw({ ...reply, onScreen: null })
  expect(await color('b')).toBe('claude')
  await clock.advance(100)
  expect(await color('c')).toBe('claude')
})

test('History shows a prompt as soon as it is sent, inside the second', async ($, on) => {
  let history = JSON.stringify({ display: 'first', timestamp: 1, sessionId: 'chat-1' })
  on('clock.now', () => ({ value: 0 }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('process.run', (_, e) => ran(isHistoryGrep(e.argv) ? history : ''))
  on('prompt.submit', (_, e) => ({ text: e.text }) as any)

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('first')
  history += `\n${JSON.stringify({ display: 'second', timestamp: 2, sessionId: 'chat-1' })}`
  await $.prompt.submit({ text: 'second', wait: false, origin: { kind: 'composer' } })
  await ui.drawn()

  expect((await ui.find({ key: 'jump:0' }))?.text).toContain('second')
})

test('after a long jump, rows left on the old screen no longer stretch the lit range', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const stamped: Record<string, number> = { 'old-1': start + 5_000, 'new-1': start + 25_000, 'new-2': start + 26_000 }
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = Object.entries(stamped)
      .filter(([id]) => e.argv.join(' ').includes(id))
      .map(([id, at]) => `"uuid":"${id}","timestamp":"${new Date(at).toISOString()}"\n`)
      .join('')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const mount = (requestId: string) =>
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  // On screen in a's turn; the jump never reports it gone.
  const old = await mount('old-1')
  now += 5_000
  const fresh = [await mount('new-1'), await mount('new-2')]
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  expect(await color('a')).toBeUndefined()
  for (const row of [old, ...fresh]) await row.redraw({ ...reply, onScreen: null })
})

test('a moved row the chat file does not hold (a tool group) leaves the highlight where it is', async ($, on) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  let now = 1_000_000
  on('clock.now', () => ({ value: now }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = e.argv.join(' ').includes('b-row') ? `"uuid":"b-row","timestamp":"${new Date(start + 15_000).toISOString()}"\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stands for the engine's own drawing of the row.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }
  const mount = (requestId: string) =>
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })

  const rows = [await mount('b-row')]
  now += 5_000
  rows.push(await mount('collapse-1'))
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('b')).toBe('claude')
  expect(await color('c')).toBeUndefined()
  for (const row of rows) await row.redraw({ ...reply, onScreen: null })
})

// Three prompts 10 s apart; `stamped` says when the chat file wrote each row (by uuid or tool call id).
const inViewSetup = (on: Parameters<TestBody>[1], stamped: (start: number) => Record<string, number>) => {
  const start = Date.now() - 60_000
  const history = ['a', 'b', 'c']
    .map((display, i) => JSON.stringify({ display, timestamp: start + i * 10_000, sessionId: 'chat-1' }))
    .join('\n')
  const clock = mock.clock(on, { now: 1_000_000 })
  const runs: (readonly string[])[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({ value: e.as === 'api' ? [] : ['a', 'b', 'c'].map(text => ({ role: 'user' as const, text, toolUses: [] })) }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    if (isHistoryGrep(e.argv)) return ran(history)
    const stdout = Object.entries(stamped(start))
      .filter(([id]) => e.argv.join(' ').includes(id))
      .map(([id, at]) => (id.startsWith('toolu_') ? `"id":"${id}","name":"Bash"},"uuid":"x","timestamp":"` : `"uuid":"${id}","timestamp":"`) + `${new Date(at).toISOString()}"\n`)
      .join('')
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // Stand for the engine's own drawing of the rows.
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text' as const, children: ['reply'] }))
  on('ui.render', { component: 'ToolGroup' }, () => ({ type: 'Text' as const, children: ['tools'] }))
  // `advance` moves the clock, firing the History redraw a move leaves pending.
  return { runs, advance: (ms: number) => clock.advance(ms) }
}
const reply = { text: 'a reply', origin: { kind: 'composer' as const }, isExpanded: false }

test('a tool group at the bottom of the screen lights its turn, found by its first call', async ($, on) => {
  inViewSetup(on, start => ({ 'b-row': start + 15_000, toolu_c1: start + 25_000 }))
  const top = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-row',
    props: { ...reply, onScreen: { first: 4, last: 9, of: 10 } } })
  const call = { tool_use_id: 'toolu_c1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const group = { calls: [call], isActive: false, isExpanded: false }
  const tools = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'ToolGroup', requestId: 'collapsed-toolu_c1',
    props: { ...group, onScreen: { first: 0, last: 0, of: 2 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  await top.redraw({ ...reply, onScreen: null })
  await tools.redraw({ ...group, onScreen: null })
})

test('a row still on screen counts when it redraws without moving', async ($, on) => {
  const clock = inViewSetup(on, start => ({ 'b-top': start + 15_000, 'c-mid': start + 25_000 }))
  const mount = (requestId: string, first: number) =>
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const mid = await mount('c-mid', 0)
  const top = await mount('b-top', 3)
  await clock.advance(5_000)
  // A scroll tick: only the top row moves; the middle one redraws as it was.
  await top.redraw({ ...reply, onScreen: { first: 4, last: 9, of: 10 } })
  // The redraw it sets off makes the middle row say where it is again.
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color

  expect(await color('c')).toBe('claude')
  expect(await color('b')).toBeUndefined()
  for (const row of [top, mid]) await row.redraw({ ...reply, onScreen: null })
})

test('a row is looked up in the chat file once, not on every redraw', async ($, on) => {
  const setup = inViewSetup(on, start => ({ 'b-once': start + 15_000 }))
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-once',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const renders = setup.runs.filter(isHistoryGrep).length
  await setup.advance(5_000)
  // A real move: the pane redraws.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })
  await setup.advance(100)

  expect(setup.runs.filter(isHistoryGrep).length).toBeGreaterThan(renders)
  expect(setup.runs.filter(argv => argv.join(' ').includes('b-once')).length).toBe(1)
  await row.redraw({ ...reply, onScreen: null })
})

test('a row the chat file does not hold yet is looked for at most once a second', async ($, on) => {
  // Mid-turn: the reply streaming in is on screen before the chat file holds it.
  const setup = inViewSetup(on, start => ({ 'b-row': start + 15_000 }))
  const mount = (requestId: string, first: number) =>
    $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId,
      props: { ...reply, onScreen: { first, last: 9, of: 10 } } })
  const streaming = await mount('not-yet', 0)
  const row = await mount('b-row', 3)
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const looks = () => setup.runs.filter(argv => argv.join(' ').includes('not-yet')).length
  const first = looks()

  await row.redraw({ ...reply, onScreen: { first: 4, last: 9, of: 10 } })
  await setup.advance(100)
  expect(looks()).toBe(first)

  await setup.advance(1_000)
  await row.redraw({ ...reply, onScreen: { first: 3, last: 9, of: 10 } })
  await setup.advance(100)
  expect(looks()).toBe(first + 1)
  for (const one of [streaming, row]) await one.redraw({ ...reply, onScreen: null })
})

test('a row growing below the screen, as a reply streams in, redraws nothing', async ($, on) => {
  const setup = inViewSetup(on, start => ({ 'c-grow': start + 25_000 }))
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'c-grow',
    props: { ...reply, onScreen: { first: 0, last: 9, of: 10 } } })
  await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const renders = setup.runs.filter(isHistoryGrep).length
  await setup.advance(5_000)
  await row.redraw({ ...reply, onScreen: { first: 0, last: 9, of: 30 } })
  await setup.advance(100)

  expect(setup.runs.filter(isHistoryGrep).length).toBe(renders)
  await row.redraw({ ...reply, onScreen: null })
})

test('rows a jump left behind without a word are forgotten past a cap, oldest first', () => {
  const rows = new Map<string, number>()
  for (const id of ['a', 'b', 'c']) keepNewest(rows, id, 0, 2)
  expect([...rows.keys()]).toEqual(['b', 'c'])
  // A row reporting again is the newest.
  keepNewest(rows, 'b', 1, 2)
  keepNewest(rows, 'd', 0, 2)
  expect([...rows]).toEqual([['b', 1], ['d', 0]])
})

test('a clicked prompt stays lit until a move after its jump settles', () => {
  const prompts = [
    { display: 'c', timestamp: 30_000 },
    { display: 'b', timestamp: 20_000 },
    { display: 'a', timestamp: 10_000 },
  ]
  // Pinned to a, though b's turn is in view.
  expect(litPrompt(prompts, [25_000], { timestamp: 10_000 })).toBe(2)
  // A pin to a prompt the list no longer holds, or none: the one in view.
  expect(litPrompt(prompts, [25_000], { timestamp: 5 })).toBe(1)
  expect(litPrompt(prompts, [25_000])).toBe(1)
  expect(pinHolds({ after: 1_300 }, 1_300)).toBe(true)
  expect(pinHolds({ after: 1_300 }, 1_301)).toBe(false)
  expect(pinHolds(undefined, 0)).toBe(false)
})

test('a jump that finds nothing drops its pin: the turn on screen stays lit', async ($, on) => {
  inViewSetup(on, start => ({ 'b-stay': start + 15_000 }))
  on('ui.toast', () => ({ value: undefined }))
  const row = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'UserMessage', requestId: 'b-stay',
    props: { ...reply, onScreen: { first: 0, last: 2, of: 3 } } })
  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  const color = async (text: string) => (await ui.find({ type: 'Text', text: new RegExp(`^${text}\\s*$`) }))?.props.color
  await ui.press({ key: 'jump:2' })
  // A move inside the settle: a pin left behind would still hold.
  await row.redraw({ ...reply, onScreen: { first: 1, last: 2, of: 3 } })

  expect(await color('b')).toBe('claude')
  expect(await color('a')).toBeUndefined()
  await row.redraw({ ...reply, onScreen: null })
})

test('the chat file is found by session id, whatever its folder is named', async ($, on) => {
  // A root over 200 characters gets a cut, hashed folder name; /cd moves the root.
  const file = '/home/me/.claude/projects/-a-root-cut-at-200-1x2y3z/chat-find.jsonl'
  const greps: (readonly string[])[] = []
  on('clock.now', () => ({ value: 1_000_000 }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-find' }))
  on('session.root', () => ({ value: '/somewhere/else' }))
  on('process.run', (_, e) => {
    if (isHistoryGrep(e.argv)) return ran(JSON.stringify({ display: 'go', timestamp: 1, sessionId: 'chat-find' }))
    if (e.argv[0] === 'find') return ran(`${file}\n`)
    greps.push(e.argv)
    return ran('')
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })
  await ui.press({ key: 'jump:0' })

  expect(greps.at(-1)?.at(-1)).toBe(file)
})

test('gone runs: a capped chat read leaves prompts older than it live and unmarked', () => {
  // The read holds only the newest 4096 entries: P1 fell outside it, not out of the chat.
  expect(gone(asPrompts('P3', 'P2', 'P1'), ['P2', 'P3'], ['P2', 'P3'], [], { chat: true, model: true })).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
  // A capped model read draws no Compacted line where it ends.
  expect(gone(asPrompts('P3', 'P2', 'P1'), ['P1', 'P2', 'P3'], ['P3'], [], { chat: false, model: true })).toEqual([
    { isLive: true },
    { isLive: true },
    { isLive: true },
  ])
})

test('a prompt older than the newest 4096 chat entries is not drawn as gone', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  const history = ['old', 'new']
    .map((display, i) => JSON.stringify({ display, timestamp: Date.now() - 2 + i, sessionId: 'chat-1' }))
    .join('\n')
  const filler = Array.from({ length: 4095 }, () => ({ role: 'assistant' as const, text: 'ok', toolUses: [] }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('fs.read', () => ({ value: history }))
  on('session.messages', (_, e) => ({
    value: e.as === 'api' ? [] : [...filler, { role: 'user' as const, text: 'new', toolUses: [] }],
  }))

  const ui = await $.ui.mount({ plugin: 'panel', surface: 'terminal', component: 'Pane', props, requestId: 'panel' })

  expect((await ui.find({ type: 'Text', text: /^old\s*$/ }))?.props.color).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Compacted' })).toBeUndefined()
})

test('a new session drops all but the newest 50 sessions of mid-turn notes', async ($, on) => {
  const keys = ['other', ...Array.from({ length: 60 }, (_, i) => `midTurn:s${i}`)]
  const deleted: string[] = []
  on('store.keys', () => ({ value: keys }))
  on('store.delete', (_, e) => {
    deleted.push(e.key)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })

  // Keys come back in the order they were first set: the oldest sessions go.
  expect(deleted).toEqual(Array.from({ length: 10 }, (_, i) => `midTurn:s${i}`))
})

test('/panel runs at once, even while Claude is working', async ($, on) => {
  const registered: { name: string; immediate?: true }[] = []
  on('store.keys', () => ({ value: [] }))
  on('command.register', (_, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/proj', surface: null, isInteractive: false })

  expect(registered.find(command => command.name === 'panel')?.immediate).toBe(true)
})
