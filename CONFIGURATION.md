# Configuration

Everything past the defaults. Back to the [README](README.md).

- [How install works](#how-install-works)
- [Machine-local files](#machine-local-files)
- [Guard hook config](#guard-hook-config)
- [Keybindings](#keybindings)
- [Notes](#notes)

## How install works

```text
~/claudzilla/claude/*  ──symlink──▶  ~/.claude/*              edit either side, see it in git status
settings.base.json     ──merge────▶  ~/.claude/settings.json  your own keys survive re-installs
```

- **Linked:** instructions, rules, hooks, skills (`pr`, `rule-review`; your own stay), theme and statusline. The repo stays the source of truth.
- **Merged:** `settings.json` (Claude Code rewrites it). Repo values win, and extras you add on a machine are kept.
- **Plugin:** `panel` installs from this clone as a local marketplace, so it loads in place and updates with the repo. caveman and ponytail stay on the `ref` tag in `settings.base.json`; change the tag to upgrade.
- **WSL:** adds `export COLORTERM=truecolor` to existing `~/.bashrc` / `~/.zshrc` that don't set COLORTERM, else the theme falls back to 256 colours.
- **Font:** unless MesloLGS NF is already installed, asks (in the terminal, or as a Claude question when Claude runs the install) to install MesloLGS NF (draws the statusline symbols) to `~/.local/share/fonts` or `~/Library/Fonts`. On WSL it also installs it on Windows and sets it in Windows Terminal unless you picked a font. Elsewhere, set it as your terminal font. Say no and the statusline uses basic symbols; `CLAUDZILLA_FONT=yes` or `no` answers without asking.
- **Safe to re-run:** anything replaced is backed up to `~/.claude/.claudzilla-backup/<timestamp>/`.

## Machine-local files

| file | for |
|---|---|
| `~/.claude/CLAUDE.local.md` | instructions for this machine only |
| `~/.claude/settings.overrides.json` | settings for this machine only, merged last (e.g. `{"permissions":{"defaultMode":"dontAsk"}}`) |
| `claudzilla.json` | turn guard checks on or off, see below |

## Guard hook config

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
  "allowMain": false,
  "reviewNudge": true,
  "autoUpdate": true,
  "compactNudge": 150000
}}
```

| rules | values |
|---|---|
| gates: `pushVerify` `prSkill` `forcePush` `discard` `mainCommit` `commitSubject` `sessionLink` `envStaged` `worktreePath` | `deny` `remind` `off` |
| triggers: `debugTrigger` `reviewTrigger` `debugGate` | `remind` `off` |
| `doneClaim` | `now` `flag` `off` |
| `specExclude` | `on` `off` |
| format: `tldr` `emoji` `brInTable` `boxAlign` `tableWidth` | `flag` `off` |

`reviewNudge` sits next to `allowMain`, not under `rules`: `false` turns off the weekly `/rule-review` summary at startup.

`autoUpdate` (machine file only): at startup a background job fast-forwards the clone to the newest release tag (weekly) and re-runs `install.sh`; the next session says it updated (or failed, with the log). Skipped when the clone has uncommitted edits or local commits. `false` = notice only.

`tableWidth`: each prompt tells Claude the terminal width (`COLUMNS`, which Claude Code passes to hooks), and a reply whose table renders wider gets flagged.

`compactNudge` (tokens, `0` = off): past it, when a piece of work is done (or, at 4×, older context is clearly stale) and the next step won't need it, Claude adds a **Compact** section with the reason and a drafted `/compact <instructions>` (or `/clear` when nothing carries over) to copy; wording strengthens at 2× and 4×.

A bad file or value is skipped and named on your next prompt; unknown keys are ignored.

## Keybindings

`~/.claude/keybindings.json` holds your keys. Install adds alt+h for the panel and alt+k to focus the picks card, each unless you bound that key (`Chat` or `Global`) or gave its action a key; a symlinked file is left alone; `"alt+h": null` or `"alt+k": null` in `Chat` opts out.

## Notes

- The display hook changes the screen only, not the transcript; it shows `<br>` in tables as ` · `.
- Only the default `~/.claude` config dir is supported. `CLAUDE.md` imports from `@~/.claude/...`.
- `/rule-review` counts a rule only from when it reached your machine (`~/.claude/.claudzilla-rules.json`, written by the installer).
- Tests run offline: `bash tests/install.test.sh` (the other suites are in `tests/`).
