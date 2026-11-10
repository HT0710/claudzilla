# Working on claudzilla

The clone is the live config: `~/.claude` links into it, so the checked-out branch is what every session runs.

- Before any branch, commit or worktree step: read `docs/how-i-work.md` in the main clone (first line of `git worktree list`) if it exists (local, git-excluded), and check `git -C ~/claudzilla branch --show-current`; another session may be using the clone.
- New feature → branch from the current `release/X.Y` in the clone (no stacking), so it gets daily use before it reaches `main`; PR it into `release/X.Y`.
- Worktree (`../claudzilla-<slug>`) only for a fix to `main`, a release-branch rebase, an old-commit check, or a second feature while another is in progress in the clone (branch it from `release/X.Y`).
- Never run `install.sh` from a worktree: it relinks `~/.claude` to that worktree.
- After switching branches in the clone, run `./install.sh` so new or removed files get linked.
- `finishing-a-development-branch` here: skip its menu, because the user's ask to finish counts as asking to push, PR and merge. Run `requesting-code-review` first if the branch had no SDD or executing-plans review, and list any parked review findings in the PR body.
- A feature PRs into `release/X.Y` and rebase-merges once CI is green; then rebase the other open features onto it. A fix for released code that hurts users now PRs into `main`. Merging it ships a patch release, so it waits for an explicit yes (`docs/how-i-work.md`).
- Plugin or status-line change: before calling it done, check it live in a throwaway tmux session with `--plugin-dir`, because installed plugins run from the cache.
