export const MAX_HISTORY = 20

export type Place = { kind: 'file'; path: string; line?: number; top?: number; md?: boolean } | { kind: 'folder'; path: string; top?: number }
export type Nav = { entries: Place[]; at: number }

export const navStart = (root: string): Nav => ({ entries: [{ kind: 'folder', path: root }], at: 0 })

export const current = (nav: Nav): Place => nav.entries[nav.at]!

// A `.md` entry's view: unset is Markdown, false is source.
export function setView(nav: Nav, md: boolean): Nav {
  const place = current(nav)
  const entries = nav.entries.slice()
  if (place.kind === 'file') entries[nav.at] = { ...place, md }
  return { ...nav, entries }
}

export function remember(nav: Nav, top: number, line?: number): Nav {
  const place = current(nav)
  const entries = nav.entries.slice()
  entries[nav.at] = place.kind === 'file' ? { ...place, top, line } : { ...place, top }
  return { ...nav, entries }
}

export function visit(nav: Nav, next: Place): Nav {
  const here = current(nav)
  const same = here.kind === next.kind && here.path === next.path
  if (same && (next.kind === 'folder' || next.line === undefined)) return next.kind === 'file' && next.md === false ? setView(nav, false) : nav
  // A file opened with no line starts where its latest entry was left.
  const left = next.kind === 'file' && next.line === undefined ? nav.entries.filter(p => p.kind === 'file' && p.path === next.path).at(-1) : undefined
  const entries = [...nav.entries.slice(0, nav.at + 1), left?.top === undefined ? next : { ...next, top: left.top }]
  while (entries.length > MAX_HISTORY) entries.shift()
  return { entries, at: entries.length - 1 }
}

export const back = (nav: Nav): Nav => (nav.at > 0 ? { ...nav, at: nav.at - 1 } : nav)

export const forward = (nav: Nav): Nav => (nav.at < nav.entries.length - 1 ? { ...nav, at: nav.at + 1 } : nav)
