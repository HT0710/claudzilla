# picks

After a reply with a `**Picks:**` line, or a `**Next:**` line that says "say go", a card above the prompt asks the reply's question and numbers the answers:

```text
╭──────────────────────────────────────────────╮
│ How to finish the branch?                    │
│                                              │
│ 1: merge to main locally    no CI            │
│ 2: push + PR                CI runs          │
│ 3: keep the branch as-is    nothing lands    │
│ 4: type your own…                            │
│                                              │
│ Why: PR, merge once CI is green              │
╰──────────────────────────────────────────────╯
```

- **One `Decision` table in the reply:** its heading is the question, and each option row is a choice with its tradeoff in gray. The recommended row is blue, and when the reply gives a `Why:`, a `Why:` line in the same blue under the rows gives the reason. A choice sends its option's id (`2`, `B`).
- **Several decisions, or none, or one without a table:** the question comes from `say go → I run X`, else the Picks, else the Next line itself; `1: go` sends `go`.
- **Last row, `type your own…`:** puts `go, but ` in the prompt box for your exceptions (`go, but 2B`).

A digit typed into an empty prompt, then a short pause, picks a row. The card hides while Claude works and goes once you send any prompt.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.296; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/picks` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/picks` runs the tests.
