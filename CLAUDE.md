# Working on claudzilla

The clone is the live config: `~/.claude` links into it, so the checked-out branch is what every session runs.

- New feature → branch on top of the feature stack in the clone, so it gets daily use before it reaches `main`.
- Worktree (`../claudzilla-<slug>`) only for a fix to `main`, a stack rebase, or an old-commit check.
- Never run `install.sh` from a worktree: it relinks `~/.claude` to that worktree.
- After switching branches in the clone, run `./install.sh` so new or removed files get linked.
