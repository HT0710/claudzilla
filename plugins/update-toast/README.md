# update-toast

Toasts claudzilla's update progress: an update is available, it is installing, it installed (restart to apply), or it failed (ask Claude to debug it). A failure also reaches Claude with your next prompt, with the log path and the retry command.

It reads the lines `claude/hooks/claudzilla-update.sh` appends to `.git/claudzilla-update.events` in the claudzilla clone.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.296; mod events and methods can change between releases. `tail` on the PATH.

## Develop

`claude --plugin-dir plugins/update-toast` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/update-toast` runs the tests.
