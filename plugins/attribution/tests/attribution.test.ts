import { expect, test } from 'claude-code/testing'

import { strip } from '../hooks/register'

const coAuthor = 'Co-Authored-By: Claude <noreply@anthropic.com>'

test('commit trailer loses the Claude-Session line', async ($, on) => {
  on('attribution.text', () => ({ text: `${coAuthor}\nClaude-Session: https://claude.ai/code/session_01AbC` }))
  expect((await $.attribution.text({ kind: 'commit', text: '' })).text).toBe(coAuthor)
})

test('PR footer keeps its line, loses the inline session URL', () => {
  expect(strip('🤖 Generated with [Claude Code](https://claude.com/claude-code) https://claude.ai/code/session_01AbC'))
    .toBe('🤖 Generated with [Claude Code](https://claude.com/claude-code)')
})

test('a session URL in parentheses keeps the closing paren', () => {
  expect(strip('see (https://claude.ai/code/session_01AbC)')).toBe('see ()')
})

test('text without a session link is unchanged', () => {
  const text = `${coAuthor}\n`
  expect(strip(text)).toBe(text)
})

test('blank lines left by a removed line collapse', () => {
  expect(strip(`body\n\nClaude-Session: https://claude.ai/code/session_x\n\n${coAuthor}`)).toBe(`body\n\n${coAuthor}`)
})

test('a sentence naming the trailer mid-line is kept', () => {
  const text = 'Do not add a Claude-Session: trailer to the commit.'
  expect(strip(text)).toBe(text)
})

// The trace file lands through fs.write; the harness has no fs, so these handlers stand in beneath the mod.
test('traces whether the text changed', async ($, on) => {
  const files = new Map<string, string>()
  on('env.get', (_, e) => ({ value: ({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/u' } as Record<string, string>)[e.name] }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', () => ({ deny: 'no marker' }))
  on('fs.write', (_, e) => { files.set(e.path, e.text); return { value: undefined } })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 's1' }))
  on('attribution.text', () => ({ text: `${coAuthor}\nClaude-Session: https://claude.ai/code/session_01AbC` }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await $.attribution.text({ kind: 'commit', text: '' })
  await $.session.end({ reason: 'other' })
  const rows = [...files.entries()].find(([p]) => p.endsWith('s1.attribution.jsonl'))![1].trim().split('\n').map(l => JSON.parse(l))
  expect(rows.find(r => r.event === 'attribution.text')?.data).toMatchObject({ kind: 'commit', changed: true })
})
