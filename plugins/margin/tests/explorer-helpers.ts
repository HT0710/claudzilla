import { mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Body = Parameters<TestBody>
type Entry = { name: string; kind: 'file' | 'dir' }

export const ran = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
export const props = { title: 'Panel', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 19 }, view: {} }
// The disk: a test changes a file by setting its entry again. A path in `tree` is a folder.
export const disk = new Map<string, { text: string; mtimeMs: number }>()
export const tree = new Map<string, Entry[]>()
// A held read answers only when the test releases it (set by the stale-result test).
export const hold: { reads?: Array<() => void> } = {}
// Every process.run argv, in order, for tests that check a command.
export const runs: string[][] = []
// A test sets exit to make the detached editor launch fail.
export const launch = { exit: 0 }
// The clock the plugin's timers run on; a test advances it.
export let clock: ReturnType<typeof mock.clock>
// A test sets failList to make every fs.list fail.
export const failList = { on: false }
// Every fs.read path, in order.
export const reads: string[] = []
// Every state key written, in order.
export const sets: string[] = []
// Every fs.list path, in order.
export const lists: string[] = []
// Polls until `pred` holds. Each turn yields a macrotask, so answers the host queued can land.
export const waitFor = async (pred: () => boolean) => {
  for (let i = 0; i < 1000 && !pred(); i++) await new Promise(done => setTimeout(done, 0))
}
export const textOf = (n: any): string => (n == null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : textOf(n.children ?? n.props?.children))
// The header's path text across its segments, joined in order. The path Box is keyed `path`.
export const pathText = async (ui: { find: (q: any) => Promise<any> }) => textOf(await ui.find({ key: 'path' }))
export const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
// What the engine answers for the plugin's state keys.
export const store = new Map<string, unknown>()
// The place the `file` key answers; the plugin's draw applies it. Each call is a new revision, stepping 1000 so it stays above the plugin's own counter.
let revs = 0
export const open = (place: { path: string; line?: number; kind?: 'file' | 'folder' }) => void store.set('file', { rev: 1000 * ++revs, ...place })
export const setup = async ($: Body[0], on: Body[1]) => {
  disk.clear()
  tree.clear()
  hold.reads = undefined
  launch.exit = 0
  lists.length = 0
  reads.length = 0
  sets.length = 0
  failList.on = false
  tree.set('/repo', [])
  store.clear()
  store.set('tab', 'Explorer')
  on('state.get', (_$, e, next) => (store.has(e.key) ? { value: { value: store.get(e.key), version: 1 } } : next(e)) as any)
  // A write reaches the engine, so the pane redraws; the engine's value answers from then on.
  on('state.set', (_$, e, next) => (sets.push(e.key), store.delete(e.key), next(e)) as any)
  clock = mock.clock(on, { now: 0 })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'chat-1' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => (runs.push([...e.argv]), e.argv.includes('rev-parse') ? ran(0, '/repo\n') : ran(e.argv.some(x => x.includes('setsid -f')) ? launch.exit : 0)) as any)
  on('fs.stat', (_, e) => (tree.has(e.path) ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : disk.has(e.path) ? { value: { kind: 'file', size: disk.get(e.path)!.text.length, mtimeMs: disk.get(e.path)!.mtimeMs, isLink: false } } : { deny: 'ENOENT' }) as any)
  on('fs.read', (_, e) => {
    reads.push(e.path)
    const answer = disk.has(e.path) ? { value: disk.get(e.path)!.text } : { deny: 'ENOENT' }
    return (hold.reads ? new Promise(done => hold.reads!.push(() => done(answer))) : answer) as any
  })
  on('fs.list', (_, e) => (lists.push(e.path), failList.on ? { deny: 'EIO' } : { value: (tree.get(e.path) ?? []).map(x => ({ ...x, size: 0, mtimeMs: 0, isLink: false })) }) as any)
}
export const mountPane = ($: Body[0]) => $.ui.mount({ plugin: 'margin', surface: 'terminal', component: 'Pane', props, requestId: 'margin' })
// An Explorer tab showing `open`, with `text` on disk at its path. `trees` fills folder listings before the mount.
export const explorer = async ($: Body[0], on: Body[1], at: { path: string; line?: number }, text: string, trees: Record<string, Entry[]> = {}) => {
  await setup($, on)
  for (const [path, list] of Object.entries(trees)) tree.set(path, list)
  disk.set(at.path, { text, mtimeMs: 1 })
  open(at)
  return mountPane($)
}
// The root folder page, with no file open. `trees` is filled before the mount.
export const explorerRoot = async ($: Body[0], on: Body[1], trees: Record<string, Entry[]> = {}) => {
  await setup($, on)
  for (const [path, list] of Object.entries(trees)) tree.set(path, list)
  return mountPane($)
}
// The tree rows' keys as drawn: a row's Box and its Client share the key `x:<hash>`.
export const treeRow = async (ui: { drawn: () => Promise<any> }, name: string) => {
  const found: any[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    const left = n.props?.props?.left
    if (n.props?.module && Array.isArray(left) && left.at(-1)?.text === name) found.push(n)
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return found[0]
}
// A tree row Client is pressed by a down and up on it.
export const tapTree = async (ui: any, name: string) => {
  const row = (await treeRow(ui, name)).props.key
  await ui.resize({ columns: 30, rows: 1, in: row })
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: row })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: row })
}
// Whether any drawn tree row has a piece reading `text` (a chevron or icon glyph).
export const chevron = async (ui: { drawn: () => Promise<any> }, text: string) => {
  let hit: any
  const walk = (n: any) => {
    if (!n || typeof n !== 'object' || hit) return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.props?.module && n.props.props?.left?.some((x: any) => x.text === text)) hit = n
    walk([n.children, n.props?.children])
  }
  walk(await ui.drawn())
  return hit
}
