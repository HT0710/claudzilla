# claudzilla

An opinionated global setup for [Claude Code](https://claude.com/claude-code), installable on any machine in one command.

- **Terse:** short, scannable answers with the answer first.
- **Lazy code:** the smallest change that works. Investigate first, then verify before calling anything done.
- **Guarded:** a hook blocks risky git and keeps work inside the rules.
- **Visible:** a truecolor statusline shows model, context and usage limits.

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/HT0710/claudzilla/main/install.sh | bash
```

**Requires:** `git`, `curl`, `tar`, `perl` and Claude Code. If `node` or [`rtk`](https://github.com/rtk-ai/rtk) is missing, the installer puts it in `~/.local` without sudo. Make sure `~/.local/bin` is on your `PATH`.

## What's inside

| part | what it does |
|---|---|
| **Instructions** (`CLAUDE.md`) | brevity, surgical changes, investigate before acting, evidence for every claim |
| **Rules** (`rules/`) | always-loaded rules for git, response format, comments, Python and skill use |
| **Guard hook** | blocks force-pushes, discarding work and commits on `main`; asks for verification before push or "done" |
| **Skills** | `pr` (pre-PR checks + description template), `/rule-review` (how often each rule slipped) |
| **Plugins** | [caveman](https://github.com/JuliusBrussee/caveman), [ponytail](https://github.com/DietrichGebert/ponytail), [superpowers](https://github.com/obra/superpowers) |
| **Statusline** | cwd, branch, context / 5h / weekly meters, model, effort, active skill |
| **Token saver** | every Bash call runs through `rtk` |
| **Theme + settings** | muted dark theme, `opus[1m]`, truecolor |

## How it works

```text
~/claudzilla/claude/*  ──symlink──▶  ~/.claude/*              edit either side, see it in git status
settings.base.json     ──merge────▶  ~/.claude/settings.json  your own keys survive re-installs
```

- **Linked:** instructions, rules, hooks, skills, theme and statusline. The repo stays the source of truth.
- **Merged:** `settings.json` (Claude Code rewrites it). Repo values win, and extras you add on a machine are kept.
- **Safe to re-run:** anything replaced is backed up to `~/.claude/.claudzilla-backup/<timestamp>/`.

## Customize

| file | for |
|---|---|
| `~/.claude/CLAUDE.local.md` | instructions for this machine only |
| `~/.claude/settings.overrides.json` | settings for this machine only, merged last (e.g. `{"permissions":{"defaultMode":"dontAsk"}}`) |
| `claudzilla.json` | turn guard checks on or off, see below |

<details>
<summary>Guard hook config</summary>

Optional JSON files, applied in this order. Later files win; objects merge and arrays replace.

1. `~/.claude/claudzilla.json`: this machine
2. `<repo>/.claude/claudzilla.json`: shared, commit it
3. `<repo>/.claude/claudzilla.local.json`: yours, git-ignore it

```json
{"rulesGuard": {
  "rules": { "pushVerify": "remind", "tldr": "off" },
  "keywords": { "debug": ["bug", "broken", "crash"] },
  "commitTypes": ["feat", "fix", "refactor", "chore", "docs", "test", "ci"],
  "subjectMax": 72,
  "tldrMinLines": 15,
  "allowMain": false
}}
```

| rules | values |
|---|---|
| gates: `pushVerify` `prSkill` `forcePush` `discard` `mainCommit` `commitSubject` `sessionLink` `envStaged` `worktreePath` | `deny` `remind` `off` |
| triggers: `debugTrigger` `reviewTrigger` `debugGate` | `remind` `off` |
| `doneClaim` | `now` `flag` `off` |
| `specExclude` | `on` `off` |
| format: `tldr` `emoji` `brInTable` `boxAlign` | `flag` `off` |

A bad file or value is skipped and named on your next prompt.

</details>

## Update

```bash
cd ~/claudzilla && git pull && ./install.sh
```

Claude Code tells you at startup when an update is available.

## Uninstall

```bash
find ~/.claude -maxdepth 2 -lname "$HOME/claudzilla/*" -delete
```

Then restore anything you need from `~/.claude/.claudzilla-backup/`.

## Notes

- Only the default `~/.claude` config dir is supported. `CLAUDE.md` imports from `@~/.claude/...`.
- Tests run offline: `bash tests/install.test.sh` (the other suites are in `tests/`).

## License

MIT
