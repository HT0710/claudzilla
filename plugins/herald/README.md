# herald

Toasts claudzilla's update progress: an update is available, it is installing, it installed (restart to apply; `/claudzilla news` lists the changes), it was skipped for local changes (ask Claude to update), or it failed (ask Claude to debug it). A failure also reaches Claude with your next prompt, with the log path and the retry command.

It reads the lines `claude/hooks/claudzilla-update.sh` appends to `.git/claudzilla-update.events` in the claudzilla clone. Every 15 minutes it runs that hook again, so a session left open also hears of a new release. With `autoUpdate` on, the default, a tick that finds a new release also fast-forwards the clone and runs `install.sh` while the session stays open. The change applies after a restart. It does not update when the clone has local commits, or edits in a part the release changes. The hook still fetches at most once an hour per clone, however many sessions are open.

It also toasts when the 5-hour or weekly usage limit passes 50%, 75% or 90%, such as `5-hour usage 77% · resets in 2h10m`. Each point toasts once per limit window: the highest point toasted and the window's reset time are kept in the plugin's store, which outlives the session. Claude Code reports these limits only on a Claude subscription login, such as Pro, Max or Team.

It also toasts when context passes rules-guard's `compactNudge` threshold, at 1×, 2× and 4× and every 30 min after: `Compact — optional: /claudzilla compact, or /clear for new work` (`suggest` at 2×, `recommend` at 4×). After 30 idle minutes the reminder stays under the prompt until the next message.

When you step away with a 1-hour prompt cache and context past `compactNudge`, it acts before the cache goes cold, when the next message would pay for the whole conversation again. 15 minutes before, it toasts and puts `/claudzilla compact` in an empty prompt box, so Enter drafts a compact while the cache is still warm. Past rules-guard's `coldCompact` times `compactNudge` (2×, 300,000 tokens by default), if the box is still empty or holds only that command 5 minutes before, it compacts on its own with the default summary. `coldCompact` `0` keeps the fill and drops the compact; `compactNudge` `0` turns both off. Any compact, or the cache going cold, empties the box if it still holds only that command. The herald part turns off Claude Code's own idle compaction (`idleCompaction` `false`), which would otherwise compact first, from 200,000 tokens. Each reply starts the clock again. The cache's TTL comes from the session transcript, as the HUD's `cch` meter reads it.

Once the cache has gone cold, a compact would read the whole conversation back, so herald offers `/claudzilla handoff` instead. It starts a fresh session with a note from this one. At the moment the cache goes cold it puts `/claudzilla handoff` in the prompt box if the box is empty or holds only the compact command. If you were away, your first key back shows a status line with the cost of a send. While that line is up, emptying the prompt box suggests `/claudzilla handoff` dim, and Tab takes it.

The fills `/claudzilla compact` and `/claudzilla handoff` are primer commands, so they work only with the primer part installed.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.312; mod events and methods can change between releases. `sh`, `readlink -f`, `git` and `tail` on the PATH.

## Develop

`claude --plugin-dir plugins/herald` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/herald` runs the tests.
