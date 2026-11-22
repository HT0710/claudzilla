import type { EngineInterface } from 'claude-code'

import { walkNames } from './explorer-find'
import type { NameEntry } from './explorer-find'
import type { Listing } from './explorer-tree'

export type Loaded = { path: string; lines: string[]; unreadable: boolean; missing: boolean; mtimeMs: number; size: number }

export const CUT = 2000

export const gitArgs = (...args: string[]): string[] => ['git', '--no-optional-locks', '-c', 'core.quotePath=false', ...args]

/** Git top-level of the session directory; the directory itself outside a repo. */
export async function projectRoot($: EngineInterface): Promise<string> {
  const run = await $.process.run(gitArgs('rev-parse', '--show-toplevel')).catch(() => undefined)
  const top = run?.exitCode === 0 ? run.stdout.split('\n')[0]!.trim() : ''
  return top || (await $.session.cwd().catch(() => ''))
}

export function statOf($: EngineInterface, path: string): Promise<{ kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number } | undefined> {
  return $.fs.stat(path).then(s => s, () => undefined)
}

export async function loadFile($: EngineInterface, path: string): Promise<Loaded> {
  const st = await statOf($, path)
  if (!st) return { path, lines: [], unreadable: true, missing: true, mtimeMs: 0, size: 0 }
  const base = { path, mtimeMs: st.mtimeMs, size: st.size, missing: false }
  if (st.kind !== 'file') return { ...base, lines: [], unreadable: true }
  const text = await $.fs.read(path).then(String, () => undefined)
  if (text === undefined || text.includes('\0')) return { ...base, lines: [], unreadable: true }
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/)
  return { ...base, unreadable: false, lines: lines.map(l => l.slice(0, CUT).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ')) }
}

export async function listDir($: EngineInterface, dir: string): Promise<Listing[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  return Promise.all(entries.map(async (e): Promise<Listing> => {
    if (e.isLink) {
      const target = await statOf($, `${dir}/${e.name}`)
      if (!target) return { name: e.name, kind: 'file', broken: true }
      return { name: e.name, kind: target.kind === 'dir' ? 'dir' : 'file' }
    }
    return { name: e.name, kind: e.kind === 'dir' ? 'dir' : 'file' }
  }))
}

// Run as `sh -c SCRIPT sh <path>`: the path stays in $1, never in the script text. `open` is macOS only (on Linux it may be openvt); bare `open` would run a .command or .app, `-t` only edits.
export const OPEN_EDITOR_SH = [
  'case $1 in -*) set -- "./$1";; esac',
  't=; if command -v code >/dev/null 2>&1; then o=code',
  'elif [ "$(uname)" = Darwin ]; then o=open; t=-t',
  'else o=xdg-open; fi',
  'command -v "$o" >/dev/null 2>&1 || exit 127',
  'if command -v setsid >/dev/null 2>&1; then setsid -f "$o" ${t:+"$t"} "$1" </dev/null >/dev/null 2>&1',
  'else nohup "$o" ${t:+"$t"} "$1" </dev/null >/dev/null 2>&1 &',
  'fi',
].join('\n')

/** Counter so a slow load that finished late can tell it was overtaken. */
export function latestOf(): { begin(): number; isLatest(n: number): boolean } {
  let n = 0
  return { begin: () => ++n, isLatest: m => m === n }
}

/** Every file and folder under `folder`, as paths relative to it. `onCap` runs when git's output was cut and rows were lost. */
export async function listNames($: EngineInterface, folder: string, onCap?: () => void): Promise<NameEntry[]> {
  const run = await $.process.run(gitArgs('-C', folder, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '-s')).catch(() => undefined)
  if (run?.exitCode !== 0 || !run.stdout) return walkNames(dir => $.fs.list(dir).catch(() => []), folder)
  // -s prefixes tracked paths with `mode hash stage<TAB>`; untracked paths come bare. Mode 160000 is a submodule.
  const files = new Set<string>()
  const subs: string[] = []
  const rows = run.stdout.split('\0')
  // The last row of a cut read is a partial path.
  if (run.isStdoutTruncated) (rows.pop(), onCap?.())
  for (const row of rows) {
    if (!row) continue
    const m = /^(\d{6}) [0-9a-f]+ \d\t/.exec(row)
    const path = m ? row.slice(m[0].length) : row
    if (m?.[1] === '160000') subs.push(path)
    else files.add(path)
  }
  const dirs = new Set<string>()
  for (const f of [...files, ...subs]) for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i))
  for (const s of subs) dirs.add(s)
  return [...dirs].map((path): NameEntry => ({ path, kind: 'dir' })).concat([...files].map((path): NameEntry => ({ path, kind: 'file' })))
}
