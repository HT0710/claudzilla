// Fixed accent colours; claudzilla.json's palette key overrides them. Copied byte for byte into margin, folio,
// primer and ballot (each plugin is cached on its own); claude/hud/hud-data.mjs keeps shared and hud (tests/hud.test.sh).
export const DEFAULTS = {
  shared: { label: '#a396d2', faint: '#4f5c68', idle: '#456186', action: '#5d9678', dirty: '#8c7850', churn: '#6e8c6e', muted: '#808286', lit: '#0f1c28' },
  hud: {
    rampLow: '#0e2042', rampHigh: '#a8d6ff', rampHot: '#ffaa5a', track: '#1e2a3a', note: '#404750', cwdLow: '#4a6b8a', cwdHigh: '#93b4e0',
    profile: '#5f9ea8', version: '#9d6554', divider: '#263240', sweep: '#ffecc8', model: '#7fb6d9', skill: '#93b4e0', thinking: '#a98fd9',
    clock: '#8da6c2', session: null as string | null,
  },
  margin: {
    compacted: '#8c7850', latest: '#a8995a', ahead: '#d4b860', behind: '#b48ead', card: '#030507', hairline: '#3a424a', faded: '#555555',
    pill: { green: '#1d3a2a', gray: '#2a2e33', purple: '#2e2640', red: '#3a2030', yellow: '#3a3220', blue: '#1c2f44', cyan: '#173538' },
    types: { feat: '#98c379', fix: '#e06c75', refactor: '#61afef', perf: '#d19a66', docs: '#e5c07b', test: '#56b6c2' },
    status: { M: '#e5c07b', A: '#98c379', D: '#e06c75', U: '#e06c75', R: '#61afef', C: '#61afef', '?': '#56b6c2' },
  },
}
export type Palette = typeof DEFAULTS
