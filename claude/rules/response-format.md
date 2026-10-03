# Response Format — scannable

Lazy reader scan, no read. Answer first, structure always. Every reply, coding or not.

## Order

1. **Shallow first** — answer only. Cut detail, cut background, cut why-it-works (mechanism). Why-chosen stays (see Decisions).
   Plain word over jargon. User ask deepdive when want it — assume they will if needed.
2. **Example** — show it when words alone slow reader. Code block > description.
3. **Evidence** — command, `file:line`, or measured number behind every claim. None → mark *unverified*.

## Layout

- **TL;DR** first line — answer, not preamble.
  - Skill-driven replies too (design, plan, review): TL;DR before the first heading.
- `##` / `###` headers to split every distinct chunk. More headers, not fewer.
- `---` where content group changes, groups in order: found (evidence, cause, findings) → choose (decisions, options, drafts) → do (plan, checks, state). Group by content, not count: 6 decisions = one group. One group → none. Blank line before it.
- Short answer (≤3 lines) → no headers, no TL;DR label.
- Max 3 nesting levels. No wall-of-text paragraph.
- Table when 2+ items share fields (`what | where`, `option | tradeoff`).
  - Fit the width the hook states (`keep each table within W cols`); wider → fewer columns, shorter cells, or bullets.
  - Cell = one line. No `<br>` or HTML — raw in logs and relays; `md-display.pl` patches only `<br>`, only on screen. Needs 2+ lines → split row or use bullets under table.
- Actionable table (rows user may pick, apply or reject: findings, fixes, options) → first column `#`, restarts at 1 per table. Lookup tables: no `#`.
  - One Findings table. Fixes mirror Findings `#`; finding with no fix → skip that number. Never a second ID scheme.
  - Findings table too long to scan and spans 2+ areas, or `Picks:` line wider than W cols → group by area. Turn 1: Overview table (`# | group | items | worst | recommend`) + detail for the recommended group only. Later turns: one group each, `#` restarts. Overview rows = "Group 2".
  - Decisions: heading `Decision <n> — <topic>`, options `A, B`; referenced as `<n><letter>` (`1B`). Lone decision → heading `Decision — <topic>`, options `A, B`.
  - Refer by table name: "Finding 2", "Fix 2", "Group 2", "1B".
- Bullets otherwise. One idea per bullet, one line if possible.
- End with **Next:** — single action. Nothing pending → omit.

## Decisions

Propose options → each Decision ends with ONE recommendation.

- **Recommend:** directly under each Decision or Fixes table, with its Why. Pick, bold, one line: `**Recommend: A**`, `**Recommend: fixes 1–3**`.
- **Why:** 1-2 bullets — reason it beats the others, source inline: `(file:line)`, `(cmd → result)`. No source → *unverified*.
- Choice with one sane, reversible option → `Clear calls:` bullet with its source, not a Decision heading. Irreversible → always a Decision, even with one option.
- 2+ picks → `**Picks:** 1B, 2A, fixes 1–3` line above `Next:`, no Why. "go" = accept this turn's picks and clear calls; user names only exceptions (`go, but 2B`).

```md
### Decision — retry

| # | option | tradeoff |
|---|---|---|
| A | no retry | fast |
| B | retry | +1 dep |

**Recommend: A**
- **Why:** retry not needed, calls idempotent (`api/client.go:30` — single PUT).

**Clear calls:**
- Timeout stays 5 s (`api/client.go:12`).
```

## Diagrams

- Prefer a diagram when it explains faster than text or table — e.g. flow across 3+ components, state machine, before/after, dependency/merge order. Forced or adds nothing → skip. Unicode, ```text block, ≤80 cols.
  - 2 spaces between arrowhead (`▶ →`) and any border (wide-glyph buffer).
  - Box or aligned columns → before sending, run:
    `python3 -c 'import sys;[print(i,len(l.rstrip("\n")),[j for j,c in enumerate(l) if c in "│┌┐└┘├┤"]) for i,l in enumerate(sys.stdin)]' <<'EOF'` … `EOF`
    Border columns must match on every line.
- Flat items → table, not diagram.
- 15+ nodes → offer Artifact.

## Emphasis

- **Bold** — key term, verdict, label. First thing eye hit.
- *Italic* — caveat, aside, "unverified".
- ~~Strike~~ — rejected option, obsolete advice, thing me just deleted.
- `>` quote — callout: verdict, warning, quoted user, doc or error text. Never text to copy (command, `/compact` line).
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
