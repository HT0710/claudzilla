# update-toast

Toasts claudzilla's update progress: an update is available, it is installing, it installed (restart to apply), or it failed (ask Claude to debug it). A failure also reaches Claude with your next prompt, with the log path and the retry command.

It reads the lines `claude/hooks/claudzilla-update.sh` appends to `.git/claudzilla-update.events` in the claudzilla clone.

It also toasts when the 5-hour (`5h`) or weekly (`wk`) usage limit passes 50%, 75% or 90%, such as `5h usage 77% · resets in 2h10m`. Each point toasts once per limit window: the highest point toasted and the window's reset time are kept in the plugin's store, which outlives the session. Claude Code reports these limits only on Pro and Max subscriptions.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.296; mod events and methods can change between releases. `tail` on the PATH.

## Develop

`claude --plugin-dir plugins/update-toast` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/update-toast` runs the tests.
