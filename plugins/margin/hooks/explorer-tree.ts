export type Listing = { name: string; kind: 'file' | 'dir'; broken?: boolean }
export type TreeRow = {
  path: string
  name: string
  kind: 'file' | 'dir'
  x: number
  depth: number
  open: boolean
  empty: boolean
  dim: boolean
  broken: boolean
}
type IconColor = 'claude' | 'faint' | 'refactor' | 'docs' | 'test' | 'feat'

const g = (hex: number) => String.fromCharCode(hex)

const FILE_ICONS = new Map<string, { glyph: string; color: IconColor }>(Object.entries({
  ts: { glyph: g(0xe628), color: 'refactor' },
  tsx: { glyph: g(0xe628), color: 'refactor' },
  md: { glyph: g(0xe609), color: 'docs' },
  json: { glyph: g(0xe60b), color: 'docs' },
  py: { glyph: g(0xe606), color: 'test' },
  sh: { glyph: g(0xe795), color: 'feat' },
}))

const LANGS = new Map(Object.entries({
  ts: 'TypeScript', tsx: 'TypeScript JSX', md: 'Markdown', json: 'JSON', py: 'Python', sh: 'Shell',
  js: 'JavaScript', jsx: 'JavaScript JSX', css: 'CSS', html: 'HTML', yml: 'YAML', yaml: 'YAML', toml: 'TOML', rs: 'Rust', go: 'Go',
}))

export function langOf(name: string): string {
  return LANGS.get(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '') ?? 'Plain text'
}

/** Folders first, then names by code point. */
export function sortListing(entries: readonly Listing[]): Listing[] {
  return [...entries].sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.kind === 'dir' ? -1 : 1))
}

/** Rows under root: each expanded, listed folder is followed by its sorted children. */
export function treeRows(root: string, expanded: ReadonlySet<string>, listed: ReadonlyMap<string, readonly Listing[]>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, px: number | null, depth: number, dimmed: boolean) => {
    for (const e of sortListing(listed.get(dir) ?? [])) {
      const path = `${dir.replace(/\/$/, '')}/${e.name}`
      const kids = e.kind === 'dir' ? listed.get(path) : undefined
      const dim = dimmed || e.name.startsWith('.')
      const x = px === null ? 0 : px + (e.kind === 'dir' ? 1 : 2)
      const open = !!kids && expanded.has(path)
      rows.push({ path, name: e.name, kind: e.kind, x, depth, open, empty: kids?.length === 0, dim, broken: !!e.broken })
      if (open) walk(path, x, depth + 1, dim)
    }
  }
  walk(root, null, 0, false)
  return rows
}

export function iconOf(name: string, kind: 'file' | 'dir', state?: { open: boolean; empty: boolean }): { glyph: string; color: IconColor } {
  if (kind === 'dir') return { glyph: g(state && (state.open || state.empty) ? 0xf07c : 0xf07b), color: 'claude' }
  const hit = FILE_ICONS.get(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '')
  return hit ? { ...hit } : { glyph: g(0xf15b), color: 'faint' }
}
