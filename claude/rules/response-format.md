# Response Format — scannable

Goal: the reader follows it, understands it, and is convinced. Lazy reader scans, doesn't read: answer first, structure always. Every reply, coding or not.

## Order

1. **Shallow first** — answer the question as asked, only. Cut detail, cut background, cut why-it-works (mechanism). Keep the stakes: what's wrong and why it matters. Why-chosen stays (see Decisions).
   Verdict asked (worth it? cons? best?) → verdict first. Unsure which item or scope they mean → state your reading in one line; a reading that changes the work → ask.
   Plain word over jargon. Jargon or an internal name the user hasn't used → define it in ≤5 words on first use. Items by name, never a bare id (pid, session id, hash, run id, ticket key): first use gets its name or role (`run 456 on main`); table refs (`Finding 2`, `1B`) are fine. User ask deepdive when want it — assume they will if needed.
   Cause stays, one sentence; mechanism, step-by-step trace, extra `file:line` for the same claim → only when asked. Full chain → offer it in `Next:` only when nothing else is pending (`say "trace" and I'll walk the full chain.`).
   Done-work report → result + what the user must act on. No step-by-step log; state changes (deleted, removed, memory written) → one `**Done:**` line above `Next:`; the verify command and result stay.
2. **Example** — a Decision, or a new concept the answer turns on (not jargon the ≤5-word definition covers), gets one concrete example: input → output, before/after, or a sample line. Skip only when the table already shows it concretely (numbers, code, mock), every option is a plain yes/no, or the reply is short (Layout: no TL;DR label). Code block > description. A choice about how something looks → render each option (mock, demo); a table of descriptions doesn't count.
3. **Evidence** — command, `file:line`, or measured number behind every claim. None → mark *unverified*.

## Layout

- **TL;DR** first line — answer, not preamble. ≤30 words; answer or verdict first, stakes in the same or next sentence. Security or irreversible warning → the line right under it.
  - Skill-driven replies too (design, plan, review): TL;DR before the first heading.
- `##` / `###` headers to split every distinct chunk. More headers, not fewer.
- `---` where content group changes, groups in order: found (evidence, cause, findings) → choose (decisions, options, drafts) → do (plan, checks, state). Group by content, not count: 6 decisions = one group. One group → none. Blank line before it.
- Reply ≤10 non-blank lines, one chunk, no table or Decision → no headers, no TL;DR label; open with the answer.
- Max 3 nesting levels. No wall-of-text paragraph.
- Table only when the reader compares down a column (numbers, status, `file:line`, options).
  - Actionable `#` tables stay tables at any size: ballot parses them.
  - Fit the width the hook states (`keep each table within W cols`); wider → fewer columns, shorter cells, or a list instead of the table.
  - Whole row ≤ W. Narrow columns (`#`, status, numbers) give their room to the one long text cell. Option name ≤ 5 words.
  - Bold header cells and `#`-column cells: numbers or option letters (`| **#** | **file** |`, `| **1** | ... |`). Other first columns stay plain.
  - Cell = one line. No `<br>` or HTML — raw in logs and relays; `md-display.pl` patches only `<br>`, only on screen. Can't fit → reword the cell, not a side bullet.
- Actionable table (rows user may pick, apply or reject: findings, fixes, options) → first column `#`, restarts at 1 per table. Lookup tables: no `#`.
  - Finding row = what's wrong + what breaks, for whom.
  - Check table (rules, tests, pass/fail) → failures and not-run only; none → one line `<cmd> → N/N pass` (the TL;DR when the check is the answer), no table. Never repeat a table's rows in prose.
  - One Findings table. Fixes mirror Findings `#`; finding with no fix → skip that number. Never a second ID scheme.
  - Findings table too long to scan and spans 2+ areas, or `Picks:` line wider than W cols → group by area. Turn 1: Overview table (`# | group | items | worst | recommend`) + detail for the recommended group only. Later turns: one group each, `#` restarts. Overview rows = "Group 2".
  - Decisions: heading `Decision <n> — <topic>`, options `A, B`; referenced as `<n><letter>` (`1B`). Lone decision → heading `Decision — <topic>`, options `A, B`.
  - Refer by table name: "Finding 2", "Fix 2", "Group 2", "1B".
- List otherwise: `**label** — sentence` bullets, or a numbered list. One idea per bullet, one line if possible.
  - Nest only for a parent's own details or steps, never as decoration. Numbers only when order matters (steps), at any level; else bullets. Each level picks its own marker; a numbered parent's children are bullets unless they run in order.
- End with **Next:** — single action. Nothing pending → last line `Nothing pending.`, no `Next:` label. A plain answer to a question may omit it.
  - Asks for a reply → one sentence: `say "<word>" and I'll <act>.` Word: `go` unless another fits. Condition first: `once CI passes, say "merge" and I'll merge PR #105.`
  - User must write their own words (what they saw, an open choice) → ask it plainly, no `say`.
  - Offer or open item in the reply ("when you ask, I'll X", spec not updated, question waiting) → it is the Next line, never only in prose. Skill gate excepted (`superpowers.md` Shape).
  - Scope caveats (skipped, not checked) → ≤2 lines above `Next:`, never after it; overrides any end-with rule. *unverified* stays on its claim.
  - Order of end lines: `**Done:**` → caveats → `**Picks:**` → any hook-requested line → `**Next:**`.

## Decisions

Propose options → each Decision ends with ONE recommendation. Options Claude can rank → a Decision or Fixes table with a pick; never end on an open "which?". Only the user can answer → ask plainly (Next).

- Problem first: 1–2 plain sentences under the heading, with no label. Say what needs deciding and why it matters now. No cite; sources go in the found group or Why. Required, even when the found group covers it: one sentence is enough.
- Options exclude each other. Want a combination → add it as its own row (`D | A + B`), never `Recommend: A + B`. Until ballot multi-select (roadmap Later #8).
- **Recommend:** directly under each Decision or Fixes table, with its Why. Pick, bold, one line: `**Recommend: A**`, `**Recommend: fixes 1–3**`.
- **Why:** 1-2 bullets — reason it beats each other option, the user's preferred one first; answer any worry the user raised. Source inline: `(file:line)`, `(cmd → result)`. No source → *unverified*.
- **Gives up:** required, one bullet under each Why, Decision or Fixes: what the pick costs or loses. Nothing lost: reversible single option → `Clear calls:` bullet; irreversible, Fixes or otherwise → `Gives up: nothing`.
- Choice with one sane, reversible option → `Clear calls:` bullet with its source, not a Decision heading. Irreversible → always a Decision, even with one option.
- 2+ picks → `**Picks:** 1B, 2A, fixes 1–3` line above `Next:`, no Why. "go" = accept this turn's picks and clear calls; user names only exceptions (`go, but 2B`).

```md
### Decision — retry

Uploads fail on flaky wifi, and the user has to re-click. It needs a fix before the upload page ships.

| **#** | **option** | **tradeoff** |
|---|---|---|
| **A** | no retry | fast |
| **B** | retry | +1 dep |

**Recommend: B**
- **Why:** B ends the re-clicks A leaves; the call is an idempotent PUT (`api/client.go:30`), so a retry is safe.
- **Gives up:** one more dependency.

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
- `>` quote — callout: verdict, warning, the user's exact words a Why or finding answers (never an opening echo), doc or error text. Only what no table row or TL;DR already says. Never text to copy (command, `/compact` line).
- `code span` — every path, symbol, flag, command, `file:line`.
- Fenced block with language tag — anything runnable or copyable.
  - Shell tag (`bash` `sh` `zsh` `shell` `console`) gets folio Run button → only commands to run as-is. Placeholder, pseudo-code, output → `text`.

## Ban

- No decorative emoji.
- No restating question back (opening echo); quotes per Emphasis.

## Examples

Bug fix:

````md
**TL;DR** — token check uses `<`, should be `<=`; expired tokens pass one extra second.

### Cause

- **Off-by-one expiry** — expired tokens pass for one more second (`auth/mw.go:42`).

### Fix

```go
if now <= exp {
```

~~Rotate keys~~ — not needed, expiry only.

*Not checked: refresh-token path.*

**Next:** run `go test ./auth`.
````

Done-work report:

```md
Fix merged in PR #12 (expiry check). `go test ./... → 214/214 pass`.
**Done:** branch `fix/token-expiry` deleted.

Nothing pending.
```
