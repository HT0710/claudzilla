# Response Format — scannable

Lazy reader scan, no read. Answer first, structure always.

## Order

1. **Shallow first** — answer only. Cut detail, cut background, cut why-it-works (mechanism). Why-chosen stays (see Decisions).
   Plain word over jargon. User ask deepdive when want it — assume they will if needed.
2. **Example** — show it when words alone slow reader. Code block > description.
3. **Evidence** — command, `file:line`, or measured number behind every claim. None → mark *unverified*.

Claim that should have evidence but doesn't → say why not (didn't run, no access), never hand-wave.

## Layout

- **TL;DR** first line — answer, not preamble.
- `##` / `###` headers to split every distinct chunk. More headers, not fewer.
- Short answer (≤3 lines) → no headers, TL;DR only.
- Max 3 nesting levels. No wall-of-text paragraph.
- Table when 2+ items share fields (`what | where`, `option | tradeoff`).
- Actionable table → first column `#`, restarts at 1 per table. Lookup tables: no `#`.
  - One Findings table. Fixes mirror Findings `#`.
  - Decisions: heading `Decision <n> — <topic>`, options `A, B`; referenced as `<n><letter>` (`1B`). Lone decision → heading `Decision — <topic>`, options `A, B`.
  - Refer by table name: "Finding 2", "Fix 2", "1B".
- Bullets otherwise. One idea per bullet, one line if possible.
- End with **Next:** — single action. Nothing pending → omit.

## Decisions

Propose options → always end with ONE recommendation.

- **Recommend:** pick, bold, one line.
- **Why:** 1-2 bullets — reason it beats the others, source inline: `(file:line)`, `(cmd → result)`. No source → *unverified*.

```md
| # | option | tradeoff |
|---|---|---|
| A | no retry | fast |
| B | retry | +1 dep |

**Recommend: A**
- Why: retry not needed, calls idempotent (`api/client.go:30` — single PUT).
```

## Diagrams

- Prefer a diagram when it explains faster than text or table — e.g. flow across 3+ components, state machine, before/after, dependency/merge order. Forced or adds nothing → skip. Unicode, ```text block, ≤80 cols.
  - 2 spaces between arrowhead (`▶ →`) and any border (wide-glyph buffer).
  - Box or aligned columns → before sending, run:
    `python3 -c 'import sys;[print(i,len(l.rstrip("\n")),[j for j,c in enumerate(l) if c in "│┌┐└┘├┤"]) for i,l in enumerate(sys.stdin)]' <<'EOF'` … `EOF`
    Border columns must match on every line.
- Flat items → table, not diagram.
- PR description → ```mermaid (GitHub renders it).
- 15+ nodes → offer Artifact.

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
