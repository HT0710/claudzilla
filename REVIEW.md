# Review focus

Traps that passed tests and broke for real. A reviewer checks every item that the diff touches, on top of its usual review.

## Live config

- `~/.claude` links into the main clone, so the clone's checked-out branch is what every session runs. A change that edits or switches branches in the clone changes every open session. Check that work happens in a worktree.
- `install.sh` run from a worktree relinks `~/.claude` to that worktree. Flag any doc, script or step that runs it outside the main clone.
- Sessions load plugins from the main clone or the plugin cache, never from a worktree. A plugin change counts as checked only after a live run with `--plugin-dir` in a throwaway tmux session.
- `claude -p --resume <id>` drops `--model` and `--effort` and falls back to saved defaults. Every resumed call must pass them again.

## Hooks and shell

- Hook state lives in the private `$TMPDIR/claudzilla-rules-<uid>`, never a shared `/tmp` path (PR #275). Flag new state files outside it.
- A new or changed `git status` or `git diff` call in a hook, the status line or a plugin must pass `--no-optional-locks`, because without it users hit a stuck `.git/index.lock` (PR #345).
- The `cc-plugin-sec-default` guard skips user mods' `prompt.compose`, `attribution.text` and `classic.UserPromptSubmit` context. A per-turn reminder must go in `rules-guard.mjs` `onPrompt`, or it silently does nothing for some users.

## Mod API

- `$` may be passed only to top-level functions; elsewhere the module fails to load.
- `$.ui.toast` drops any `timeoutMs` over 60000. A message that must stay uses `$.ui.status`.
- A `Client` region moved while dragged jumps, because the terminal keeps sending positions from its old place. Keep it still during the drag, post once on `up`, and treat a buttonless `move` while grabbed as a missed `up` (PR #100).
- Tests lay out instantly, so they cannot catch the drag jump above.
- After `/reload-plugins`, old rows are drawn again in one pass. State a later row needs must be stored in `place()`, not after `await next(e)`, or that row draws without it (PR #321).
- Live runs miss the reload bug above unless old rows are redrawn.
