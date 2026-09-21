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
| `rules/` | git, Python and response-format rules |
| `RTK.md` + Bash hook | every Bash call goes through `rtk` to cut token usage |
| plugins | [caveman](https://github.com/JuliusBrussee/caveman) (terse talk), [ponytail](https://github.com/DietrichGebert/ponytail) (minimal code), [superpowers](https://github.com/obra/superpowers) (plan / TDD / debug workflows) |
| statusline | model, effort, context / 5h / weekly usage bars, git branch, session (`hud/`) |
| theme | `custom:mine`, a muted dark palette |
| settings | `opus[1m]`, medium effort, `COLORTERM=truecolor`, permissions below |

## Permissions — read this

`settings.base.json` sets `permissions.defaultMode: "dontAsk"` and `skipDangerousModePermissionPrompt: true`. In `dontAsk` mode Claude Code **denies** any tool call that isn't pre-approved instead of asking. This setup is meant to be run as `claude --dangerously-skip-permissions`; if you launch plain `claude`, change `defaultMode` (e.g. to `default`) in `~/.claude/settings.json`.

## How it works

- `CLAUDE.md`, `RTK.md`, `rules/`, `themes/`, `hud/` and `.omc/hud-config.json` in `~/.claude` become **symlinks into this repo**. Edit them anywhere and the change shows up in `git status`.
- `settings.json` is **merged**, not linked, because Claude Code rewrites it. Values from `settings.base.json` win; objects merge key by key; arrays are unioned. Anything a machine adds on its own (extra hooks, env, plugins) survives re-installs.
- Machine-specific instructions go in `~/.claude/CLAUDE.local.md`, which `CLAUDE.md` imports. It is created empty and never committed.

## Update

```bash
cd ~/claudzilla && git pull && ./install.sh
```

## Uninstall

Remove the symlinks in `~/.claude` (`find ~/.claude -maxdepth 2 -lname "$HOME/claudzilla/*" -delete`) and restore what you need from `~/.claude/.claudzilla-backup/`.

## Tests

```bash
bash tests/install.test.sh
```

Offline; every case installs into a throwaway `HOME`.

## Third-party

`claude/hud/omc-vendor/` is a trimmed build of [oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)'s HUD — only the files `dist/hud/index.js` imports. MIT, see its `LICENSE`.

## License

MIT
