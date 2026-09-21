# Response Format — scannable

Lazy reader scan, no read. Answer first, structure always.

## Order

1. **Shallow first** — answer only. Cut detail, cut background, cut why-it-works.
   Plain word over jargon. User ask deepdive when want it — assume they will if needed.
2. **Example** — show it when words alone slow reader. Code block > description.
3. **Evidence** — command, `file:line`, or measured number behind every claim. None → mark *unverified*.

Claim that should have evidence but doesn't → say why not (didn't run, no access), never hand-wave.

## Layout

- **TL;DR** first line — answer, not preamble.
- `##` / `###` headers to split every distinct chunk. More headers, not fewer.
- Max 3 nesting levels. No wall-of-text paragraph.
- Table when 2+ items share fields (`what | where`, `option | tradeoff`).
- Bullets otherwise. One idea per bullet, one line if possible.
- End with **Next:** — single action.

## Emphasis

- **Bold** — key term, verdict, label. First thing eye hit.
- *Italic* — caveat, aside, "unverified".
- ~~Strike~~ — rejected option, obsolete advice, thing me just deleted.
- `code span` — every path, symbol, flag, command, `file:line`.
- Fenced block with language tag — anything runnable or copyable.

## Ban

- No decorative emoji.
- No restating question back.

## Example

**TL;DR** — token check use `<`, should be `<=`.

### Cause

| what | where |
|---|---|
| off-by-one expiry | `auth/mw.go:42` |

### Fix

```go
if now <= exp {
```

~~Rotate keys~~ — not needed, expiry only.

**Next:** run `go test ./auth`.
