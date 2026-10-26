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

- **Linked:** instructions, rules, hooks (rules guard, trace, display filter, updater), skills (`pr`, `rule-review`, `claudzilla-report`, `claudzilla-compact`; your own stay), theme and statusline. The repo stays the source of truth.
- **Merged:** `settings.json` (Claude Code rewrites it). Repo values win, and extras you add on a machine are kept.
- **Plugins:** claudzilla's own (`panel`, `picks`, `guide`, `update-toast`, `folio`, `attribution`, `ledger`) install from this clone as a local marketplace, so they load in place and update with the repo; `guide` always installs, with the updater. caveman and ponytail stay on the `ref` tag in `settings.base.json`; change the tag to upgrade.
- **WSL:** adds `export COLORTERM=truecolor` to existing `~/.bashrc` / `~/.zshrc` that don't set COLORTERM, else the theme falls back to 256 colours.
- **Font:** unless MesloLGS NF is already installed, asks (in the terminal, or as a Claude question when Claude runs the install; not when `hud` is chosen this run) to install MesloLGS NF (draws the statusline symbols) to `~/.local/share/fonts` or `~/Library/Fonts`. On WSL it also installs it on Windows and sets it in Windows Terminal unless you picked a font. Elsewhere, set it as your terminal font. Say no and the statusline uses basic symbols; the no is remembered, also against a later `hud` install. `CLAUDZILLA_FONT=yes` or `no` answers without asking.
- **Saved choice:** `install` key in `~/.claude/claudzilla.json`. `{"skip":[...]}` = Full minus those parts; new parts reach these installs. `{"only":[...]}` = just those parts; new parts stay out. No key = Full. `--full` clears it; `--add` / `--remove` edit it. Other keys stay.
- **Record:** `~/.claude/.claudzilla-installed.json` lists what install added outside `~/.claude` (node, rc lines, plugins, marketplaces, Windows fonts, the Windows Terminal font). `--uninstall` undoes only those.
- **Theme:** with `hud` installed, a `"theme"` in `settings.overrides.json` wins over claudzilla's.
- **Font and `hud`:** newly choosing `hud` (Full, Custom, `--add hud`) installs the font without asking, unless MesloLGS NF is already installed (on WSL it is still copied to Windows).
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

An example; some values are not the defaults. Defaults: `subjectMax` 50, `commitTypes` without `ci`.

```json
{"rulesGuard": {
  "rules": { "pushVerify": "remind", "tldr": "off" },
  "keywords": { "debug": ["bug", "broken", "crash"], "review": ["code review", "PR comment"] },
  "commitTypes": ["feat", "fix", "refactor", "chore", "docs", "test", "ci"],
  "subjectMax": 72,
  "tldrMinLines": 15,
  "allowMain": false,
  "reviewNudge": true,
  "autoUpdate": true,
  "trace": true,
  "compactNudge": 150000
}}
```

| rules | values |
|---|---|
| holds: `forcePush` `discard` | `ask` `deny` `remind` `off` |
| gates: `pushVerify` `prSkill` `mainCommit` `commitSubject` `sessionLink` `envStaged` `worktreePath` | `deny` `remind` `off` |
| triggers: `debugTrigger` `reviewTrigger` `debugGate` | `remind` `off` |
| `releaseSync` | `off` `remind` |
| `doneClaim` | `now` `flag` `off` |
| `specExclude` | `on` `off` |
| format: `tldr` `emoji` `brInTable` `boxAlign` `tableWidth` | `flag` `off` |

`ask` (the default for holds): the command waits for your Yes or No in a permission prompt that lists what it would lose: the changed files, the files `git clean` removes, the stash entry, or the remote commits a force push drops, as of the last fetch. A `claude -p` run has nobody to answer, so the command is refused.

`releaseSync` (off by default): for a release-branch flow, where features collect on `release/X.Y` before `main`. Set to `remind`, every `gh pr merge` in a repo with a `release/*` branch reminds Claude that a merge into `main` means rebasing the newest release branch onto it and pushing with `--force-with-lease`, after your ok.

`reviewNudge` sits next to `allowMain`, not under `rules`: `false` turns off the weekly `/rule-review` summary at startup.

`autoUpdate` (machine file only): at startup or `/clear`, a background job (fetching at most daily) fast-forwards the clone to the newest release tag (cut on each push to `main`) and re-runs `install.sh`; the next session says it updated (or failed, with the log). Skipped when the clone has uncommitted edits or local commits. `false` = notice only.

`trace` (machine file only): `false` stops the local trace in `~/.claude/claudzilla-trace/` (mode 0700, files 0600, secrets masked, 7 days / 50 MB kept, never uploaded) from the next session start. `/claudzilla report` then drafts from the conversation and a snapshot built on the spot.

`tableWidth`: each prompt tells Claude the terminal width (`COLUMNS`, which Claude Code passes to hooks), and a reply whose table renders wider gets flagged.

`compactNudge` (tokens, `0` = off): past it, a reply that finishes a task (at 4×, any reply not mid-task) whose next step won't need the older context ends with one **Compact** line pointing to `/claudzilla compact` (drafts a `/compact` line into the prompt box) or `/clear`; wording strengthens at 2× and 4×. The update toast reminds at 1×, 2×, 4× and every 30 min; after 30 idle min the reminder stays under the prompt until the next message.

A bad file or value is skipped and named on your next prompt; unknown keys are ignored.

## Keybindings

`~/.claude/keybindings.json` holds your keys. Install adds alt+h for the panel, alt+k to focus the picks card and alt+g to toggle the guide (`/claudzilla`), each with its part (removing the part removes the key), and each unless you bound that key (`Chat` or `Global`) or gave its action a key; a symlinked file is left alone; `"alt+h": null`, `"alt+k": null` or `"alt+g": null` in `Chat` opts out.

## Notes

- The display hook changes the screen only, not the transcript; it shows `<br>` in tables as ` · `.
- Only the default `~/.claude` config dir is supported. `CLAUDE.md` imports from `@~/.claude/...`.
- `/rule-review` counts a rule only from when it reached your machine (`~/.claude/.claudzilla-rules.json`, written by the installer).
- Tests run offline: `bash tests/install.test.sh` (the other suites are in `tests/`).
