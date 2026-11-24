const graphemes = new Intl.Segmenter()
const pieces = (text: string) => [...graphemes.segment(text)].map(s => s.segment)

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export const cells = (text: string) =>
  pieces(text).reduce((sum, g) =>
    sum + (/\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFF}]/u.test(g) ? 2 : 1), 0)

// Display only: the sent text keeps its tabs, controls and blank lines.
export const tidy = (text: string) =>
  text.replace(/\t/g, ' ').replace(CONTROLS, '')
    .replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/\n(?:[ \t]*\n){2,}/g, '\n\n')

// Word wrap to `room` cells; a word longer than room is cut by grapheme, taking at least one per line.
export const wrap = (text: string, room: number) => text.split('\n').flatMap(para => {
  const out: string[] = []
  let line = ''
  for (const word of para.split(/ +/)) {
    const next = line ? `${line} ${word}` : word
    if (cells(next) <= room) { line = next; continue }
    if (line) out.push(line)
    line = word
    while (cells(line) > room) {
      let head = ''
      for (const g of pieces(line)) {
        if (head && cells(head + g) > room) break
        head += g
      }
      out.push(head)
      line = line.slice(head.length)
    }
  }
  if (line || !out.length) out.push(line)
  return out
})

export const stamp = (ms: number, now = Date.now()) => {
  const d = new Date(ms)
  const hm = d.toTimeString().slice(0, 5)
  return d.toDateString() === new Date(now).toDateString() ? hm
    : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${hm}`
}
