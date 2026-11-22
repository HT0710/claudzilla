# Bestiary

Every name claudzilla gives its parts, with what each one does. Most are paper and print words, such as a folio, a ledger or a byline, and a few are old roles, such as herald and steward.

For Claude Code's own words, such as session, hook or skill, see *Key terms* in [GUIDE.md](GUIDE.md) (`/claudzilla words`).

## Plugins

Each plugin installs as its own part, except `primer`, which always installs. Pick parts with `install.sh --custom` (see [README.md](README.md#pick-parts)).

| name | what it does |
|---|---|
| `ballot` | After a reply with a Decision, shows a card above the prompt with numbered options, so you pick by key instead of typing. |
| `byline` | Strips Claude session links and the "Generated with Claude Code" line from the commit and PR text Claude writes. |
| `folio` | Draws the reply's frame and divider lines at the chat's live width, so they never wrap, and links file paths to the margin. |
| `herald` | Toasts claudzilla update progress, usage limits passing 50, 75 and 90%, and when to compact. |
| `ledger` | Pauses Claude's first edit of a file that another live session edited in the last 30 minutes, and tells that session. |
| `margin` | Shows a side pane with what Claude plans and does, this chat's prompts, a file view and git. |
| `primer` | Serves the guide in [GUIDE.md](GUIDE.md) one section at a time with `/claudzilla [topic]`, plus `/claudzilla report`, `/claudzilla compact` and `/claudzilla handoff`. |

## Agents

| name | what it does |
|---|---|
| `atlas` | A read-only code locator on haiku. It answers "where is X defined" or "what calls Y" with a `file:line` table and never suggests fixes. |

## Experiments

Experiments are off by default unless the row says otherwise. Switch one with `/claudzilla experimental <id> on|off` (see [CONFIGURATION.md](CONFIGURATION.md)); `/claudzilla labs` says what each one does.

| name | what it does |
|---|---|
| Steward (`steward`) | On by default. Picks, per task, whether Claude hands work to a subagent, and at which model and effort, for the best work per token spent. A steward manages the budget and assigns the work. |

## Naming a new part

- Pick a single word that fits the theme: a paper and print word, or an old role.
- Check that no file in the repo already uses it, so a search finds only the new part.
- Add it here in the same change that ships it.
