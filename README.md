<div align="center">

# claudzilla

**Claude Code, tamed: terse answers, small diffs, verified work, guarded git.**

One command turns a stock `~/.claude` into a careful senior dev's setup.

[![Release](https://img.shields.io/github/v/release/HT0710/claudzilla?style=flat-square)](https://github.com/HT0710/claudzilla/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/HT0710/claudzilla/test.yml?branch=main&label=tests&style=flat-square)](https://github.com/HT0710/claudzilla/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
![Platforms](https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20WSL-555?style=flat-square)

</div>

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/HT0710/claudzilla/main/install.sh | bash
```

**Requires:** `git`, `curl`, `tar`, `perl` and [Claude Code](https://claude.com/claude-code). Missing `node` or [`rtk`](https://github.com/rtk-ai/rtk) is installed to `~/.local` without sudo; keep `~/.local/bin` on your `PATH`. Native Windows is not supported; use WSL.

Safe to re-run. Anything replaced is backed up to `~/.claude/.claudzilla-backup/`.

## What you get

Answer first, evidence cited, one fix proposed, nothing edited until you say go, and "fixed" only after the test ran.

<img src=".github/assets/answer.png" alt="Claude Code with claudzilla answering why a test fails: TL;DR first, then a cause table citing file:line and the real test output" width="720">

### Answers you can scan
- **Terse replies:** TL;DR first, tables over prose, every claim backed by a `file:line` or a command, or marked unverified.
- **Investigate, then ask:** root cause and one recommendation before any multi-file edit.

  <img src=".github/assets/decision.png" alt="A decision table with options A and B, a bold recommendation with its source, and a Next line" width="720">

- **Picks card:** a reply that ends in a decision shows a card above the prompt; press a digit to answer ([details](plugins/picks/README.md)).

  <img src=".github/assets/picks.png" alt="The picks card above the prompt, numbering the options so a digit answers" width="720">

- **Dividers:** lines frame the TL;DR, `Next:` and each `---`, fitted to the chat width ([details](plugins/response-dividers/README.md)).

### Code that stays small
- **Lazy by default:** the smallest change that fully works ([ponytail](https://github.com/DietrichGebert/ponytail)).

  <img src=".github/assets/fix.png" alt="A one-line test fix shown as a +2 -2 diff, then the test run that proves it" width="720">

- **Disciplined workflow:** debugging, TDD, plans and reviews via [superpowers](https://github.com/obra/superpowers).
- **Fewer tokens:** short-form voice ([caveman](https://github.com/JuliusBrussee/caveman)), and every Bash call is filtered through [`rtk`](https://github.com/rtk-ai/rtk).

### Git that can't bite
- **Guard hook:** blocks force-pushes, discarding work and commits on `main`.

  <img src=".github/assets/guard.png" alt="Asked to commit straight to master, Claude reports the guard hook blocked it and names the opt-in setting" width="720">

- **Verify before push:** push and PR wait until verification ran; "done" claims get sent back to check.

  <img src=".github/assets/verify.png" alt="The stop hook sends a done claim back; Claude reruns the checks, including one that proves the test fails if the code is broken again" width="720">

- **Clean history:** Conventional Commits enforced, Claude session links stripped from commits and PRs ([details](plugins/attribution/README.md)).

### A better terminal
- **Statusline:** cwd, branch, context / 5h / weekly meters, model, effort, active skill.
- **Prompt panel:** `/panel` lists this chat's prompts; click to jump, reuse or rewind ([details](plugins/panel/README.md)).
- **Update toasts:** updates install in the background and say so ([details](plugins/update-toast/README.md)).
- **Theme + settings:** muted dark truecolor theme, `opus[1m]`, normal permission prompts.

<img src=".github/assets/statusline.png" alt="Statusline: cwd, branch, context, 5-hour and weekly meters, model, effort and active skill" width="720">

### Skills and commands

| command | does |
|---|---|
| `/panel` | side pane of this chat's prompts |
| `/rule-review` | how often each rule slipped; weekly summary at startup; on your yes, shares the counts (no text) as a claudzilla issue |
| `pr` skill | pre-PR checks + description template, runs before every PR |

## Customize

| file | for |
|---|---|
| `~/.claude/CLAUDE.local.md` | instructions for this machine only |
| `~/.claude/settings.overrides.json` | settings for this machine only, merged last |
| `~/.claude/claudzilla.json` | turn guard checks on or off |

Full reference, install internals and keybindings: **[CONFIGURATION.md](CONFIGURATION.md)**.

## Update

Updates install themselves in the background, unless the clone has local changes; then you get a notice. To update by hand:

```bash
cd ~/claudzilla && git pull && ./install.sh
```

## Uninstall

```bash
find ~/.claude -maxdepth 2 -lname "$HOME/claudzilla/*" -delete
claude plugin marketplace remove claudzilla
rm -rf ~/.claude/.claudzilla-rules.json ~/.claude/.claudzilla-base.json ~/.claude/claudzilla-reports
```

Then remove claudzilla's hooks and `statusLine` from `~/.claude/settings.json` (or restore it from `~/.claude/.claudzilla-backup/`), otherwise they point at deleted scripts.

## Credits

Built on [caveman](https://github.com/JuliusBrussee/caveman), [ponytail](https://github.com/DietrichGebert/ponytail), [superpowers](https://github.com/obra/superpowers) and [rtk](https://github.com/rtk-ai/rtk).

## License

[MIT](LICENSE)
