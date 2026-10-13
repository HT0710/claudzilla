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
