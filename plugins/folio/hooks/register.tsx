import type { EngineInterface, Register } from 'claude-code'

import { href, linked, mentions } from './mentions'
import { tracer } from './trace'
import { traceIo } from './trace-io'

// margin's noun, mirrored: listing margin as a dependency would stop this plugin loading without it.
declare module 'claude-code' {
  interface EngineInterface {
    margin: { show: (at: { path: string; line: number }) => Promise<void> }
  }
}

// md-display.pl's frame lines, as a share of the width: heavy whole, separator half, group break a quarter.
const SHARE: Record<string, number> = { '━': 1, '─': 2, '┈': 4 }
const RULE = /^([━─┈])\1*$/

const t = tracer('folio')
// Messages whose decision is traced: a render repeats on resize and scroll.
const traced = new Set<string>()
const note = (id: string, decision: string, data: object) => {
  const key = `${id}:${decision}`
  if (traced.has(key)) return
  if (traced.size > 500) traced.clear()
  traced.add(key)
  t.event('folio.split', { decision, ...data })
}

type Part = { text: string } | { rule: string } | { code: { lang: string; body: string } }

// Splits a reply at frame lines and fenced blocks, outside ``` / ~~~ fences.
export function split(text: string): Part[] {
  const parts: Part[] = []
  let chunk: string[] = []
  let fence = ''
  let open = { lang: '', body: [] as string[] }
  let pad = 0
  // The open fence's own lines, given back as text if it never closes.
  let held: string[] = []
  const flush = () => {
    const t = chunk.join('\n').replace(/^\n+|\n+$/g, '')
    if (t) parts.push({ text: t })
    chunk = []
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    const mark = m?.[2]
    // CommonMark's close: the opener's character, at least as long, nothing after it.
    if (mark && fence && mark[0] === fence[0] && mark.length >= fence.length && !m[3]!.trim()) {
      parts.push({ code: { lang: open.lang, body: open.body.join('\n') } })
      fence = ''
      continue
    }
    if (mark && !fence) {
      flush()
      held = []
      fence = mark
      pad = m[1]!.length
      open = { lang: m[3]!.trim().split(/\s+/)[0]!.toLowerCase(), body: [] }
    } else if (fence) open.body.push(line.slice(Math.min(pad, line.search(/\S|$/))))
    if (fence) {
      held.push(line)
      continue
    }
    const rule = line.match(RULE)?.[1]
    if (rule) {
      flush()
      parts.push({ rule })
    } else chunk.push(line)
  }
  if (fence) chunk.push(...held)
  flush()

  return parts
}

const SHELL = new Set(['bash', 'sh', 'zsh', 'shell', 'console'])

const PROMPT = /^\s*\$ /

// What Run runs: the block as one script; a transcript's commands are its `$ ` lines.
export function runText(lang: string, body: string): string | undefined {
  if (!SHELL.has(lang)) return undefined
  const lines = body.split('\n')
  const cmds = lines.some(l => PROMPT.test(l)) ? lines.filter(l => PROMPT.test(l)).map(l => l.replace(PROMPT, '')) : lines
  return cmds.some(l => l.trim() && !l.trim().startsWith('#')) ? cmds.join('\n').trim() : undefined
}

// Copy buttons pressed in the last 2 s: key to the press that set it, so an older press's timer leaves a newer one lit.
const copied = new Map<string, number>()
let presses = 0

async function copy($: EngineInterface, key: string, text: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const done = await $.ui.copy({ text, surface })
  if (!done.isCopied) return $.ui.toast(`folio: copy failed (${done.reason})`)
  const press = ++presses
  copied.set(key, press)
  $.ui.invalidate('ui.render')
  void $.clock.after(2000, () => {
    if (copied.get(key) !== press) return
    copied.delete(key)
    $.ui.invalidate('ui.render')
  })
}

// Run pressed once in the last 3 s, by block, to the press that armed it: the second press runs, as nothing else stands between a click and the shell.
const armed = new Map<string, number>()
// Each running block's command: leaving its stream kills it.
const live = new Map<string, ReturnType<EngineInterface['process']['spawn']>>()
const stopped = new Set<string>()
// Each block's last run, by block. shortcut: in memory, so a restart drops it (Claude keeps its row); persist via $.store if missed.
const outputs = new Map<string, { end: string; text: string; tail: string; more: number }>()
const SHOWN = 20
// shortcut: output past 4 MB is dropped from the card and the copy, like $.process.run's cap; page it if a run needs more.
const CAP = 4_000_000
// Blocks whose output Hide took off the card; the block still counts as run.
const hidden = new Set<string>()

async function press($: EngineInterface, cmd: string, block: string) {
  const run = live.get(block)
  if (run) {
    stopped.add(block)
    void run.return(undefined as never)
    return
  }
  // A block run once already had its look, so Run again goes at once.
  if (!armed.has(block) && !outputs.has(block)) {
    const at = ++presses
    armed.set(block, at)
    $.ui.invalidate('ui.render')
    void $.clock.after(3000, () => {
      if (armed.get(block) !== at) return
      armed.delete(block)
      $.ui.invalidate('ui.render')
    })
    return
  }
  armed.delete(block)
  await shell($, cmd, block)
}

// shortcut: no TTY and no input, so an interactive command waits until Stop; a typed `!` handles those.
async function shell($: EngineInterface, cmd: string, block: string) {
  const run = $.process.spawn({ argv: ['bash', '-c', cmd] })
  live.set(block, run)
  stopped.delete(block)
  hidden.delete(block)
  const got = { stdout: '', stderr: '' }
  let all = ''
  // Lines split here, not per draw: a render runs on every scroll. Colour codes and \r would garble the chat.
  const show = (end: string) => {
    const lines = all.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').trimEnd().split('\n')
    outputs.set(block, { end, text: lines.join('\n'), tail: lines.slice(-SHOWN).join('\n'), more: Math.max(lines.length - SHOWN, 0) })
    $.ui.invalidate('ui.render')
  }
  show('')
  // At most one redraw per 100 ms, so a chatty command cannot flood the screen.
  let due = false
  let end = ''
  try {
    for await (const { stream, text } of run) {
      if (got[stream].length < CAP) got[stream] += text
      if (all.length < CAP) all += text
      if (due) continue
      due = true
      void $.clock.after(100, () => {
        due = false
        if (live.get(block) === run) show('')
      })
    }
    const r = await run.result
    end = stopped.has(block) ? 'stopped' : r.code ? `exit ${r.code}` : r.signal ? `killed (${r.signal})` : ''
  } catch (err) {
    if (stopped.has(block)) end = 'stopped'
    else {
      end = 'exit 1'
      all += `${all ? '\n' : ''}${err instanceof Error ? err.message : err}`
    }
  } finally {
    live.delete(block)
  }
  show(end)
  const stdout = got.stdout.trimEnd()
  // Claude cannot tell a Stop from a quiet success by the output alone.
  const stderr = [got.stderr.trimEnd(), end === 'stopped' ? '(stopped by the user)' : ''].filter(Boolean).join('\n')
  // The row a typed `!` command leaves, so Claude reads the output next turn.
  const row = await $.session.append({ message: { type: 'user', content: [{ type: 'text',
    text: `<bash-input>${cmd}</bash-input>\n<bash-stdout>${stdout.slice(0, 30_000)}</bash-stdout><bash-stderr>${stderr.slice(0, 30_000)}</bash-stderr>` }] } })
  if ('deny' in row && row.deny) $.ui.toast(`folio: Claude will not see this output (${row.deny})`)
}

type Link = { href: string; path: string; line: number }
// Paths known to be files: a render repeats on scroll and resize.
const files = new Set<string>()
// Paths found missing, by when: a burst of redraws asks once, and a file made later links on a later draw.
const misses = new Map<string, number>()
const MISS_MS = 5_000
let toldNoPanel = false
// shortcut: one cols-<session> file per session stays in TMPDIR ($.fs has no delete); clean it on session.end if $.fs gains one.
let wroteColumns = 0

// The chunk's spans that name an existing file, by span; none when the engine cannot say.
async function links($: EngineInterface, text: string): Promise<Map<string, Link>> {
  const found = new Map<string, Link>()
  const all = mentions(text)
  if (!all.length) return found
  try {
    const cwd = await $.session.cwd()
    const home = all.some(m => m.path.startsWith('~/')) ? await $.env.get('HOME') : undefined
    const pathOf = (p: string) => (p.startsWith('/') ? p : p.startsWith('~/') ? `${home}${p.slice(1)}` : `${cwd}/${p}`)
    const unknown = [...new Set(all.map(m => pathOf(m.path)).filter(p => !files.has(p)))]
    if (unknown.length) {
      const now = await $.clock.now()
      const asked = unknown.filter(p => now - (misses.get(p) ?? -Infinity) >= MISS_MS)
      const kinds = await Promise.all(asked.map(p => $.fs.stat(p).then(s => s.kind, () => undefined)))
      asked.forEach((p, i) => {
        if (kinds[i] === 'file') {
          if (files.size > 500) files.clear()
          files.add(p)
          misses.delete(p)
        } else {
          if (misses.size > 500) misses.clear()
          misses.set(p, now)
        }
      })
    }
    for (const m of all) {
      const path = pathOf(m.path)
      if (files.has(path)) found.set(m.span, { href: href(path, m.line), path, line: m.line })
    }
  } catch {
    return new Map()
  }
  return found
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await t.start(traceIo($))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    t.turn()
    void t.flush(traceIo($))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A /clear or resume goes on under a new session id, which needs its own cols file.
    wroteColumns = 0
    await t.flush(traceIo($))
    return next(e)
  })

  // A reply still streaming skips the hook below, so md-display.pl draws its lines from this width.
  on('ui.render', { component: ['UserMessage', 'AssistantMessage'] }, async ($, e, next) => {
    const columns = e.surface === 'terminal' ? e.viewport?.columns : undefined
    if (columns && columns !== wroteColumns) {
      wroteColumns = columns
      try {
        await $.fs.write(`${(await $.env.get('TMPDIR')) || '/tmp'}/claudzilla-rules/cols-${await $.session.id()}`, String(columns))
      } catch {}
    }
    return next(e)
  })

  // A hook's text is fixed when printed; drawn here, the lines follow a resize or a docked pane.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary block split up would repeat the engine's ` · summary` mark per chunk.
    if (e.props.isSummary) {
      note(e.requestId, 'summary', { split: false, reason: 'summary block' })
      return next(e)
    }
    const parts = split(e.props.text)
    const rules = parts.filter(p => 'rule' in p).length
    const codes = parts.filter(p => 'code' in p).length
    // Only the fullscreen terminal hands a plain click on a link to the plugin.
    const found = e.surface === 'terminal' ? await Promise.all(parts.map(p => ('text' in p ? links($, p.text) : undefined))) : []
    if (!rules && !codes && !found.some(f => f?.size)) {
      note(e.requestId, 'plain', { split: false, reason: 'no frame lines' })
      return next(e)
    }
    if (rules) note(e.requestId, 'split', { split: true, rules, chunks: parts.length - rules, columns: e.viewport?.columns ?? 80, first: !!e.props.isFirstOfReply })
    else note(e.requestId, codes ? 'fenced' : 'linked', { split: false, reason: codes ? 'code blocks' : 'file links', codes, links: found.filter(f => f?.size).length })
    const { Box, Text, Markdown, Button, Code } = $.ui.resolve(e)
    // The engine indents only the block that draws the bullet, so later chunks take its two columns here.
    const indent = e.props.isFirstOfReply ? 2 : 0
    const room = Math.max((e.viewport?.columns ?? 80) - indent - 2, 4)
    const rows = []
    let isFirst = e.props.isFirstOfReply
    for (const [i, p] of parts.entries()) {
      if ('rule' in p) {
        rows.push(
          <Box paddingLeft={indent} marginTop={1}>
            <Text wrap="truncate">{p.rule.repeat(Math.floor(room / SHARE[p.rule]!))}</Text>
          </Box>,
        )
      } else if ('code' in p) {
        const { lang, body } = p.code
        const cmd = runText(lang, body)
        const block = `${e.requestId}:${i}`
        const ran = outputs.get(block)
        const shown = ran && !hidden.has(block)
        const output = shown ? [ran.more ? `… ${ran.more} earlier lines` : '', ran.tail].filter(Boolean).join('\n') : ''
        const edge = cmd ? 'bashBorder' : 'promptBorder'
        // Every edge drawn here at a fixed width: a mod's Box cannot drop one border side or overlap it.
        const line = (left: string, right: string, label: any, end: any) => (
          <Box>
            <Text color={edge}>{left}</Text>
            {label}
            <Box width={1} flexGrow={1} height={1} overflow="hidden">
              <Text color={edge}>{'─'.repeat(400)}</Text>
            </Box>
            {end}
            <Text color={edge}>{right}</Text>
          </Box>
        )
        const side = (content: any, k: string) => (
          <Box key={k} width={room}>
            <Text color={edge}>{'│ '}</Text>
            <Box width={room - 4}>{content}</Box>
            <Text color={edge}>{' │'}</Text>
          </Box>
        )
        const copyButton = (k: string, text: string) => (
          <Button key={k} plain onPress={p => void copy($, k, text, p.surface).catch(() => undefined)}>
            <Text color={copied.has(k) ? 'success' : 'text'}>{copied.has(k) ? '✓ Copied' : '⧉ Copy'}</Text>
          </Button>
        )
        const runLabel = live.has(block) ? '■ Stop' : armed.has(block) ? '▶ Run? click again' : ran ? '▶ Run again' : '▶ Run'
        const runColor = live.has(block) ? 'error' : armed.has(block) ? 'warning' : 'success'
        rows.push(
          <Box marginLeft={indent} marginTop={1} flexDirection="column" width={room}>
            {line(
              lang ? '╭─ ' : '╭─',
              ' ─╮',
              lang ? <Box><Text color="subtle">{lang}</Text><Text>{' '}</Text></Box> : null,
              <Box>
                <Text>{' '}</Text>
                {cmd ? (
                  <Box>
                    <Button key={`run:${block}`} plain onPress={() => void press($, cmd, block).catch(() => undefined)}>
                      <Text color={runColor}>{runLabel}</Text>
                    </Button>
                    <Text color={edge}>{' │ '}</Text>
                  </Box>
                ) : null}
                {copyButton(`copy:${block}`, body)}
              </Box>,
            )}
            {body.split('\n').map((l, n) => side(<Code source={l || ' '} language={lang || undefined} wrap="truncate-end" />, `c${n}`))}
            {shown
              ? line(
                  '├─ ',
                  ' ─┤',
                  <Box><Text color="subtle">{ran.end ? `output · ${ran.end}` : 'output'}</Text><Text>{' '}</Text></Box>,
                  <Box>
                    <Text>{' '}</Text>
                    <Button key={`hide:${block}`} plain onPress={() => { hidden.add(block); $.ui.invalidate('ui.render') }}>
                      <Text color="error">{'✕ Hide'}</Text>
                    </Button>
                    <Text color={edge}>{' │ '}</Text>
                    {copyButton(`copyout:${block}`, ran.text)}
                  </Box>,
                )
              : null}
            {output ? output.split('\n').map((l, n) => side(<Text wrap="truncate-end">{l || ' '}</Text>, `o${n}`)) : null}
            {line('╰', '╯', null, null)}
          </Box>,
        )
      } else {
        // Awaited on a linked chunk too: hooks beneath (panel's in-view tracking) still see it.
        let drawn = await next({ ...e, props: { ...e.props, text: p.text, isFirstOfReply: isFirst } })
        const chunk = found[i]
        if (chunk?.size) {
          const at = new Map([...chunk.values()].map(l => [l.href, { path: l.path, line: l.line }]))
          // Drawn by the plugin, the block lacks the engine's blank row above and its bullet.
          drawn = (
            <Box marginTop={1}>
              {isFirst ? <Text color="text">● </Text> : null}
              <Markdown
                key={`m:${e.requestId}:${i}`}
                text={linked(p.text, new Map([...chunk].map(([span, l]) => [span, l.href])))}
                pressableLinks={[...at.keys()].slice(0, 256)}
                onLinkPress={async link => {
                  const target = at.get(link.href)
                  if (!target) return
                  try {
                    await $.margin.show(target)
                  } catch (err) {
                    // A missing noun throws TypeError; any other failure is margin's to report.
                    if (!(err instanceof TypeError) || toldNoPanel) return
                    toldNoPanel = true
                    $.ui.toast('folio: install the margin part to preview files; ctrl+click opens them')
                  }
                }}
              />
            </Box>
          )
        }
        rows.push(isFirst ? drawn : <Box paddingLeft={indent}>{drawn}</Box>)
        isFirst = false
      }
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
