# Bestiary

Every name claudzilla gives its parts, with what each one does. Most are paper and print words, such as a folio, a ledger or a byline, and a few are old roles, such as herald and steward.

For Claude Code's own words, such as session, hook or skill, see *Key terms* in [GUIDE.md](GUIDE.md) (`/claudzilla words`).

## Familiars (plugins)

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

## Scouts (agents)

| name | what it does |
|---|---|
| `atlas` | A read-only code locator on haiku. It answers "where is X defined" or "what calls Y" with a `file:line` table and never suggests fixes. |

## Wild ones (experiments)

Experiments are off by default unless the row says otherwise. Switch one with `/claudzilla experimental <id> on|off` (see [CONFIGURATION.md](CONFIGURATION.md)); `/claudzilla labs` says what each one does.

| name | what it does |
|---|---|
| Baton (`baton`) | Off by default. Past the `compactNudge` threshold, Claude can offer to continue the job in a fresh session after `/claudzilla handoff`. ballot suggests the command. A runner hands a baton to the next one in a relay. |
| Chancery (`chancery`) | Off by default. Claude designs features with the `blueprint` skill instead of `superpowers:brainstorming`. Its summons entry is below. |
| Steward (`steward`) | On by default. Picks, per task, whether Claude hands work to a subagent, and at which model and effort, for the best work per token spent. A steward manages the budget and assigns the work. |

## Summons (skills)

Each entry here is a skill that Claude calls up for one job. A summons leaves when the job is done.

| name | what it does |
|---|---|
| `chancery` | The court's keeper of papers. Keeps one folder per job in `docs/chancery/`. Its first skill is `blueprint`, which designs a feature before any build. Still a wild one: it sleeps until the `chancery` experiment is on. |

## Naming a new part

- Pick a single word that fits the theme: a paper and print word, or an old role.
- Check that no file in the repo already uses it, so a search finds only the new part.
- Add it here in the same change that ships it.
