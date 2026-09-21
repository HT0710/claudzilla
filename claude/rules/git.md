# Git

## Safety

- Never `push`, PR, or tag unless asked.
- On default branch (`main`/`master`) → branch first, then commit.
- Never `--force` on shared branch. `--force-with-lease` if truly needed and asked.
- Never `reset --hard`, `clean -fd`, or discard uncommitted work without explicit go-ahead.
- Big or risky edit → commit current state first (checkpoint), then edit.

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Subject ≤ 50 chars, imperative. Body only when *why* isn't obvious from diff.
- One logical change per commit. Don't bundle refactor + feature.
- Never commit secrets, `.env`, or generated files. Check `git status` before `add`.
- Prefer `git add <paths>` over `git add -A`.

## Branch / parallel

- Branch name: `<type>/<short-slug>` e.g. `fix/token-expiry`.
- Parallel tasks on same repo → `git worktree add ../repo-<slug> -b <branch>`. Not stash-juggling.
- Rebase local, merge shared. Never rebase pushed history others use.

## Message content — brief + structured

Core info only. No verbose prose, no restating the diff, no "this change improves...".

Body sections, in order, **only those that apply**:

```
<type>: <subject, imperative, <=50 chars>

Why: <1 line — trigger or root cause. Skip if subject says it.>

Changes:
- <path> — <what, 1 line>
- <path> — <what, 1 line>

Impact: <who/what is affected — callers, config, data, behaviour. 1-2 lines.>

Verify: <command run, or how checked>
Refs: <#issue / ticket / commit sha>
```

Rules:
- Bullet per file or per logical change. One line each.
- `Why:` = cause, not narration. No paragraph.
- `Impact:` = blast radius, not benefit. Names what changes for a user/caller. None → omit line.
- `Verify:` names a real command run. Not run → say `not run`.
- Breaking change → `BREAKING:` line with migration in one line.
- No emoji, no marketing words, no "comprehensive/robust/seamless".

PR description = same shape plus a `Test plan:` checklist. Nothing more.
