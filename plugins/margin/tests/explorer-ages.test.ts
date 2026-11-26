import { expect, test } from 'claude-code/testing'

import { AGE_SH, scanAges } from '../hooks/explorer-load'
import { ageOf, parseScan, SCAN_CAP } from '../hooks/explorer-ages'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `1 f${i}.ts`).join('\n')

test('parseScan: a folder age is the newest file mtime under it', () => {
  const s = parseScan('100 src/a.ts\n300 src/lib/b.ts\n200 README.md\n', '/repo')
  expect(ageOf(s, '/repo/src')).toBe(300000)
  expect(ageOf(s, '/repo/src/lib')).toBe(300000)
  expect(ageOf(s, '/repo/README.md')).toBe(200000)
})

test('parseScan: a name with a space or a non-ASCII letter keeps its age', () => {
  const s = parseScan('50 docs/My notes é.md\n', '/repo')
  expect(ageOf(s, '/repo/docs/My notes é.md')).toBe(50000)
  expect(ageOf(s, '/repo/docs')).toBe(50000)
})

test('parseScan: a tracked file gone from disk has no age, and its folder keeps the age of its other files', () => {
  const s = parseScan('100 src/a.ts\n', '/repo')
  expect(ageOf(s, '/repo/src/gone.ts')).toBeUndefined()
  expect(ageOf(s, '/repo/src')).toBe(100000)
})

test('parseScan: exactly 5000 lines keep their ages', () => {
  const s = parseScan(lines(SCAN_CAP) + '\n', '/repo')
  expect(s.capped).toBe(false)
  expect(ageOf(s, '/repo/f0.ts')).toBe(1000)
})

test('parseScan: 5001 lines blank every age', () => {
  const s = parseScan(lines(SCAN_CAP + 1) + '\n', '/repo')
  expect(s.capped).toBe(true)
  expect(ageOf(s, '/repo/f0.ts')).toBeUndefined()
})

test('parseScan: a line not in the form <seconds> <name> is skipped', () => {
  const s = parseScan('junk\n12x a.ts\n100\n200 ok.ts\n', '/repo')
  expect([...s.at.keys()]).toEqual(['/repo/ok.ts'])
})

test('parseScan: a find line with a leading ./ keys the same as a git line', () => {
  const s = parseScan('100 ./src/a.ts\n', '/repo')
  expect(ageOf(s, '/repo/src')).toBe(100000)
  expect(ageOf(s, '/repo/src/a.ts')).toBe(100000)
})

test('parseScan: a nested repo listed as nested/ keys without the slash', () => {
  const s = parseScan('100 nested/\n', '/repo')
  expect([...s.at.keys()]).toEqual(['/repo/nested'])
})

test('parseScan: page / keys children as /etc, not //etc', () => {
  expect(parseScan('100 etc/hosts\n', '/').at.get('/etc')).toBe(100_000)
})

test('ageOf: undefined for an empty folder, or a folder with no scanned file under it', () => {
  const s = parseScan('100 src/a.ts\n', '/repo')
  expect(ageOf(s, '/repo/empty')).toBeUndefined()
  expect(ageOf(undefined, '/repo/src')).toBeUndefined()
})

test('AGE_SH: git runs with both flags, the page comes in as $1 and never in the text, and no xdg-open', () => {
  const sh = AGE_SH.join('\n')
  expect(sh).toContain('git --no-optional-locks -c core.quotePath=false ls-files -z --cached --others --exclude-standard')
  expect(sh).toContain('git --no-optional-locks -c core.quotePath=false rev-parse --is-inside-work-tree')
  expect(sh).toContain("xargs -0 stat -c '%Y %n' --")
  expect(sh).toContain("xargs -0 stat -f '%m %N' --")
  expect(sh).toContain('cd "$1"')
  expect(sh).toContain("stat -c '%Y %n'")
  expect(sh).toContain("stat -f '%m %N'")
  expect(sh).toContain('head -n 5001')
  expect(sh).not.toContain('/repo')
  expect(sh).not.toContain('xdg-open')
})

test('AGE_SH: inside a .git folder rev-parse prints false, so the script must test its output', () => {
  const sh = AGE_SH.join('\n')
  expect(sh).toContain('rev-parse --is-inside-work-tree 2>/dev/null)" = true ]')
})

test('AGE_SH: outside a repo find pipes -print0 to xargs stat, so head ends the walk', () => {
  const sh = AGE_SH.join('\n')
  expect(sh).toContain('find . \\( -name .git -o -name node_modules \\) -prune -o -type f -print0 | xargs -0 stat')
  expect(sh).not.toContain('-exec stat')
})

test('scanAges: a cut stdout reads as capped', async () => {
  const $ = { process: { run: async () => ({ exitCode: 0, stdout: '1 a\n', isStdoutTruncated: true }) } } as any
  const s = await scanAges($, '/repo')
  expect(s?.capped).toBe(true)
  expect(s?.at.size).toBe(0)
})

test('scanAges: a failed run is undefined, and the page goes in as $1', async () => {
  const argv: string[][] = []
  const $ = { process: { run: async (a: string[]) => (argv.push(a), { exitCode: 1, stdout: '' }) } } as any
  expect(await scanAges($, '/repo')).toBeUndefined()
  expect(argv[0]!.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv[0]!.slice(3)).toEqual(['sh', '/repo'])
})
