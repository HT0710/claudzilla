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

## Before / after

Same prompt: *"why does the login test fail?"* (illustrative)

<table>
<tr><th>Stock Claude Code</th><th>claudzilla</th></tr>
<tr><td>

```text
Great question! Let me take a look at the
login test. I'll start by exploring the
codebase to understand the authentication
flow...

[edits 4 files]

I've fixed the issue! The test should now
pass. Here's a summary of what I changed:
...
```

</td><td>

```text
TL;DR — token check uses <, should be <=.

  what              where
  off-by-one expiry auth/mw.go:42

Fix: if now <= exp {

Next: say go → I patch + run go test ./auth
```

</td></tr>
</table>

Answer first, evidence cited, one fix proposed, nothing edited until you say go, and "fixed" only after the test ran.

## What you get

### Answers you can scan
- **Terse replies:** TL;DR first, tables over prose, every claim backed by a `file:line` or a command.
- **Investigate, then ask:** root cause and one recommendation before any multi-file edit.
- **Picks card:** a reply that ends in a decision shows a card above the prompt; press a digit to answer ([details](plugins/picks/README.md)).
- **Dividers:** lines frame the TL;DR, `Next:` and each `---`, fitted to the chat width ([details](plugins/response-dividers/README.md)).

### Code that stays small
- **Lazy by default:** the smallest change that fully works ([ponytail](https://github.com/DietrichGebert/ponytail)).
- **Disciplined workflow:** debugging, TDD, plans and reviews via [superpowers](https://github.com/obra/superpowers).
- **Fewer tokens:** short-form voice ([caveman](https://github.com/JuliusBrussee/caveman)), and every Bash call is filtered through [`rtk`](https://github.com/rtk-ai/rtk).

### Git that can't bite
- **Guard hook:** blocks force-pushes, discarding work and commits on `main`.
- **Verify before push:** push and PR wait until verification ran; "done" claims get sent back to check.
- **Clean history:** Conventional Commits enforced, Claude session links stripped from commits and PRs ([details](plugins/attribution/README.md)).

### A better terminal
- **Statusline:** cwd, branch, context / 5h / weekly meters, model, effort, active skill.
- **Prompt panel:** `/panel` lists this chat's prompts; click to jump, reuse or rewind ([details](plugins/panel/README.md)).
- **Update toasts:** updates install in the background and say so ([details](plugins/update-toast/README.md)).
- **Theme:** muted dark truecolor theme, `opus[1m]`, medium effort.

### Skills and commands

| command | does |
|---|---|
| `/panel` | side pane of this chat's prompts |
| `/rule-review` | how often each rule slipped; weekly summary at startup |
| `pr` skill | pre-PR checks + description template, runs before every PR |

## Customize

| file | for |
|---|---|
| `~/.claude/CLAUDE.local.md` | instructions for this machine only |
| `~/.claude/settings.overrides.json` | settings for this machine only, merged last |
| `~/.claude/claudzilla.json` | turn guard checks on or off |

Full reference, install internals and keybindings: **[CONFIGURATION.md](CONFIGURATION.md)**.

## Update

Updates install themselves in the background. To update by hand:

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
