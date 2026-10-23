# picks

After a reply with one `Decision — <topic>` (or `Decision: <topic>`) table of two or more options, a card above the prompt asks the reply's question and numbers the answers:

```text
╭──────────────────────────────────────────────╮
│ How to finish the branch?                    │
│                                              │
│ 1: merge to main locally                     │
│ 2: push + PR                                 │
│ 3: keep the branch as-is                     │
│ 4: go ahead, except…                         │
│                                              │
│ Why: PR, merge once CI is green              │
╰──────────────────────────────────────────────╯
```

- **One `Decision` table in the reply:** its heading is the question, and each option row is a choice; its tradeoff stays in the reply's table, just above. The recommended row is blue, and when the reply gives a `Why:`, a `Why:` line in the same blue under the rows gives the reason. A choice puts its option's id and text (`2: push + PR`) in the prompt box, so the history reads on its own; Enter sends it.
- **Nothing to choose** (a `**Picks:**` line, a `**Next:**` that says "say go" or `say <word> and I'll X`, or a one-option table): no card, only the dim answer in the prompt box: `1B, 2A` with the Picks (`1B, 2A, then X` when Next says `say go and I'll X`), else `run X` from `say go → I run X` (or `X` from `say go and I'll X` or `say commit and I'll X`; `B: X` from `say B and I'll X`), else `go`; a one-option table with no Picks gives its option. X stops at its first sentence or at `, or say`.
- **Your voice:** an answer put in the prompt box swaps I and you (`show you the diff` → `show me the diff`, `then you run` → `then I run`, `your branch` → `my branch`); `code`, double-quoted text and "we" stay. The card shows the reply's words as written.
- **Compact line:** a reply ending with a **Compact** line and no `Next:` offers its command (`/claudzilla compact` or `/clear`) as the dim suggestion.
- **Last row, `go ahead, except…`:** puts `go, but ` in the prompt box for your exceptions (`go, but 2B`).

A digit typed into an empty prompt, then a short pause, picks a row. The recommended row's answer (or the `go` answer) waits dim in the empty prompt: → or Tab, then Enter, sends it. alt+k (`abovePrompt:focus`, which claudzilla's `install.sh` binds; `ctrl+x tab` by default) focuses the card on that row: arrows move, Enter puts the answer in the prompt box and returns there, Esc returns without one. The card hides while Claude works and goes once you send any prompt. When a Stop hook sends Claude back to finish with a "no claim" reply, the offer survives: the card keeps the ask from the message before it.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.308; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/picks` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/picks` runs the tests.
