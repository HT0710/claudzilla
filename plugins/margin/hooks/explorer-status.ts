export const MIXED = 'mixed'

export type TreeMarks = { files: Map<string, string>; folders: Map<string, string> }

export function statusLetter(xy: string): string {
  if (xy === '??') return '?'
  const [x, y] = [xy[0], xy[1]]
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'U'
  return y !== ' ' ? y : x
}

export function treeMarks(root: string, changes: readonly { path: string; xy: string }[], dirs: ReadonlySet<string> = new Set()): TreeMarks {
  const files = new Map<string, string>()
  const folders = new Map<string, string>()
  const addFolder = (key: string, letter: string) => {
    const old = folders.get(key)
    folders.set(key, old === undefined || old === letter ? letter : MIXED)
  }
  for (const c of changes) {
    const letter = statusLetter(c.xy)
    const abs = `${root}/${c.path.replace(/\/$/, '')}`
    if (c.path.endsWith('/') || dirs.has(abs)) addFolder(abs, letter)
    else files.set(abs, letter)
    for (let up = abs.slice(0, abs.lastIndexOf('/')); up.length > root.length; up = up.slice(0, up.lastIndexOf('/'))) addFolder(up, letter)
  }
  return { files, folders }
}
