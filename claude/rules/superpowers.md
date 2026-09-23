# Superpowers

Tiers below override `using-superpowers` "invoke on 1% chance".
Brevity governs output, not whether to invoke.
Names below = `superpowers:<name>` in the Skill tool.

## Auto — invoke without asking

| trigger | skill |
|---|---|
| bug, test fail, unexpected behaviour | `systematic-debugging` — §3 analysis runs inside it; still wait for go-ahead before edit |
| writing non-trivial code (branch, loop, parser, money/security) | `test-driven-development` — trivial one-liner exempt |
| before saying done / fixed / passing | `verification-before-completion` — push / PR: see git.md Before push + Order |
| review feedback received | `receiving-code-review` |

## Suggest — name in `Recommend:` or `Next:`, invoke on yes

| trigger | skill |
|---|---|
| new feature, behaviour change, multi-file | `brainstorming` → `writing-plans` |
| plan exists, execute it | `executing-plans` / `subagent-driven-development` |
| 2+ independent tasks | `dispatching-parallel-agents` |
| isolated feature work | `using-git-worktrees` |
| work done, before merge | `requesting-code-review` |
| branch finished | `finishing-a-development-branch` |

Shape:
- `Recommend:` line → add `Skill: <name> — <why, 1 line>` when one fits.
- `Next:` → `say go → I run <name>`.

## Manual — only when user asks

- `writing-skills`

## Overrides

- git.md wins on push / PR. Skill commits = automation (git.md Commits): local, reorganized before push.
- TDD: keep red-first order; test count per Ponytail (smallest check that fails).
- Skill asks one question at a time → batch into one `AskUserQuestion` when possible.
- Skill asks for a long spec/plan → keep response-format.md (TL;DR, tables, no prose).

## Order — sequence, not trigger

- `subagent-driven-development` / `executing-plans` done → `verification-before-completion` → `finishing-a-development-branch`. Skill text says "use finishing" → verification first.
- Finishing Step 1 (run tests) ≠ verification.
- Finishing option that pushes / merges / opens PR = user asked. Reorganize (git.md) → re-run verification that turn → push.

## Spec/plan files — local only by default

Specs + plans land in `docs/superpowers/` (`specs/`, `plans/`). Before first write in a repo:

- `git ls-files docs/superpowers` empty → append `docs/superpowers/` to `$(git rev-parse --git-path info/exclude)` if missing. No ask.
- Non-empty (repo tracks them) → ask: keep tracking, or exclude new ones?
- User asks to commit specs/plans → skip exclude.
