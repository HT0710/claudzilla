# claudzilla

My global [Claude Code](https://claude.com/claude-code) setup: terse replies, lazy code, strict rules, a truecolor statusline — installable on any machine in one command.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/HT0710/claudzilla/main/install.sh | bash
```

or

```bash
git clone https://github.com/HT0710/claudzilla ~/claudzilla && ~/claudzilla/install.sh
```

Then start `claude` and `/login`. Re-running the installer is safe; anything it replaces is moved to `~/.claude/.claudzilla-backup/<timestamp>/`.

Needs `git`, `curl`, `tar`, `perl` and Claude Code. If missing, `node` (official build, checksum-verified; `node` only, no `npm`) and [`rtk`](https://github.com/rtk-ai/rtk) (its upstream installer, latest release) are installed into `~/.local` without sudo — make sure `~/.local/bin` is on your `PATH`.

Only the default config dir `~/.claude` is supported: `CLAUDE.md` imports `@~/.claude/...`, so a different `CLAUDE_CONFIG_DIR` loses those imports.

## What you get

| | |
|---|---|
| `CLAUDE.md` | global instructions: brevity, surgical changes, investigate before acting, evidence discipline |
| `rules/` | always-loaded rules, one file per topic — see [Rules](#rules) |
| `RTK.md` + Bash hook | every Bash call goes through `rtk` to cut token usage |
| `hooks/rules-guard.mjs` | blocks risky git (force push, discarding work, commit on `main`, push/PR before verification); reminds skill triggers; flags format slips on your next prompt. `md-display.pl` shows `<br>` in tables as `·` |
| plugins | [caveman](https://github.com/JuliusBrussee/caveman) (terse talk), [ponytail](https://github.com/DietrichGebert/ponytail) (minimal code), [superpowers](https://github.com/obra/superpowers) (plan / TDD / debug workflows) |
| statusline | model, effort, context / 5h / weekly usage bars, git branch, session (`hud/`) |
| theme | `custom:mine`, a muted dark palette |
| settings | `opus[1m]`, medium effort, `COLORTERM=truecolor`, Claude Code's default permission prompts |

## Rules

Every file in `claude/rules/` is loaded into every session.

| file | what it enforces |
|---|---|
| `git.md` | no push/PR/tag unless asked; branch off `main` (solo repos: ask once); manual work stays uncommitted until push, while skill chains commit locally and get regrouped into logical commits before the first push; Conventional Commits, subject ≤ 50 chars, `Why:` / `Impact:` / `Verify:` body without file lists; pre-PR checks; bold-labelled PR template; no Claude session links |
| `response-format.md` | scannable replies: TL;DR first, headers, tables, `#`-numbered findings, a single bold recommendation per decision, unicode diagrams checked for alignment, `Next:` line |
| `comments.md` | no comment by default; comments explain *why* only; one-line docstrings; no change history in code |
| `python.md` | an existing repo's own tooling and conventions win; new code gets `uv` + `pyproject.toml`, `ruff`, `pathlib`, type hints on public functions, stdlib first, explicit timeouts on network/subprocess calls, plain `pytest` |
| `superpowers.md` | which superpowers skills run automatically, which are only suggested, which are manual; debugging stops at a proposed fix until you approve it; verification before finishing a branch; worktrees go next to the repo; specs and plans kept out of git by default |

## Config

`hooks/rules-guard.mjs` reads optional JSON files; later wins, objects merge key by key, arrays replace:

1. `~/.claude/claudzilla.json` — this machine
2. `<repo>/.claude/claudzilla.json` — shared, commit it
3. `<repo>/.claude/claudzilla.local.json` — yours, git-ignore it

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

Gates (`pushVerify` `forcePush` `discard` `mainCommit` `commitSubject` `sessionLink` `envStaged` `worktreePath`) take `deny`, `remind` or `off`; triggers (`debugTrigger` `reviewTrigger` `debugGate`) `remind` or `off`; `specExclude` `on` or `off`; format checks (`doneClaim` `tldr` `emoji` `brInTable` `boxAlign`) `flag` or `off`. A bad file or value is skipped and named on your next prompt.

## How it works

- `CLAUDE.md`, `RTK.md`, `rules/`, `themes/`, `hud/` and `.omc/hud-config.json` in `~/.claude` become **symlinks into this repo**. Edit them anywhere and the change shows up in `git status`.
- `settings.json` is **merged**, not linked, because Claude Code rewrites it. Values from `settings.base.json` win; objects merge key by key; arrays are unioned. Anything a machine adds on its own (extra hooks, env, plugins) survives re-installs.
- Machine-specific instructions go in `~/.claude/CLAUDE.local.md`, which `CLAUDE.md` imports. It is created empty and never committed.
- Machine-specific settings go in `~/.claude/settings.overrides.json`. It is merged **last**, so it beats the repo — use it for anything you want to differ from `settings.base.json` on one machine, e.g. no permission prompts:

  ```json
  { "permissions": { "defaultMode": "dontAsk" } }
  ```

## Update

```bash
cd ~/claudzilla && git pull && ./install.sh
```

You don't have to check by hand: when `claude` starts and your clone is behind GitHub, a SessionStart hook (`claude/hooks/claudzilla-update.sh`) shows `claudzilla: update available`. Run the command above, or just tell Claude to update claudzilla — it gets the exact command, and only runs it when you ask. The check compares against the last fetch, so startup never waits on the network, and it refreshes that fetch in the background at most once a day.

## Uninstall

Remove the symlinks in `~/.claude` (`find ~/.claude -maxdepth 2 -lname "$HOME/claudzilla/*" -delete`) and restore what you need from `~/.claude/.claudzilla-backup/`.

## Tests

```bash
bash tests/install.test.sh
```

Offline; every case installs into a throwaway `HOME`.

## Third-party

`claude/hud/omc-vendor/` is a trimmed build of [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)'s HUD — only the files `dist/hud/index.js` imports. Patched: `dist/lib/worktree-paths.js` caches `getProjectIdentifier` (keep on re-vendor). MIT, see its `LICENSE`.

## License

MIT
