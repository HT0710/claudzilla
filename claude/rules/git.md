# Git

## Safety

- Never `push`, PR, or tag unless asked.
- On default branch (`main`/`master`) → branch first, then commit.
- Never `--force` on shared branch. `--force-with-lease` if truly needed and asked.
- Never `reset --hard`, `clean -fd`, or discard uncommitted work without explicit go-ahead.
- Big or risky edit → ask before checkpoint commit, then edit.

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Subject ≤ 50 chars, imperative. Small commit (1 file, obvious diff) → subject only; else body per template below.
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
<type>(<scope>)?: <subject, imperative, <=50 chars>

Why: <1 line — trigger or root cause. Skip if subject says it.>

Impact: <who/what is affected — callers, config, data, behaviour. 1-2 lines.>

Verify: <command run, or how checked>
Refs: <#issue / ticket / commit sha>
```

Rules:
- High level: what + why. Not how — diff shows how.
- No file list in commits — one logical change per commit, `git show --stat` has the files.
- `Why:` = cause, not narration. No paragraph.
- `Impact:` = blast radius, not benefit. Names what changes for a user/caller. None → omit line.
- `Verify:` names a real command run. Not run → say `not run`.
- Breaking change → `BREAKING:` line with migration in one line.
- No emoji, no marketing words, no "comprehensive/robust/seamless".
- Never add a Claude session link: no `Claude-Session:` trailer, no `claude.ai/code/session_…` URL, in commit messages or PR descriptions. `Co-Authored-By` and the "Generated with Claude Code" line stay.

## Before opening a PR

- New file → read one sibling of the same kind first; match its imports, test style, docstrings.
- A pattern, marker or convention you add → `git grep` it on main. Zero hits → don't ship it.
- A "repo convention" claim → name the file that shows it, or don't make it.
- Run every command the PR or docstrings document, exactly as written. Red for an unrelated
  reason → fix the command or file it; never just footnote it.
- Existing data or config needing action after deploy → `**Action required:**` section.
- `**Not covered:**` also lists side effects of the fix (idempotency, boundaries, ordering).

## PR description

Same sections as the commit body, plus `Changes:` and a `Test plan:` checklist. Nothing more.
`Changes:` = bullet per logical change, one line. `path` only if not obvious. Never per file. Flow across 3+ components → one ```mermaid block allowed.
Title = commit subject shape (`<type>(<scope>)?: <subject>`, scope optional).

Markdown renders in PRs → **bold every section label** (`**Why:**`, `**Changes:**`,
`**Impact:**`, `**Test plan:**`, and any extra label like `**Action required:**`, `**Not covered:**`).
Commit messages stay plain text — `**` shows literally in `git log`.

```markdown
**Why:** <1 line — trigger or root cause>

**Changes:**
- <logical change, 1 line> (`path` only if not obvious)

**Impact:**
- <who/what is affected>

**Action required:** <post-deploy step: re-embed, migration, config. Omit if none>

**Test plan:**
- [x] <command run / check done>
- [ ] <check still open>
```
