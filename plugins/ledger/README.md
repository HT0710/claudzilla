# ledger

Keeps two Claude sessions from editing the same file without knowing it. Each session records the files it edits in a ledger that every session on the machine shares. When Claude is about to edit a file that another live session edited in the last 30 minutes, ledger pauses that first edit and messages the other session. The paused session shows a dim line saying so; the other shows the message.

Claude then re-reads the file and goes ahead. If its change touches the same lines, it waits for the other session's reply or asks you first. The retry is never blocked, and each file pauses a session only once.

- **Covers:** the Edit, Write and NotebookEdit tools. A path reached through a link, such as `~/.claude` into the claudzilla clone, counts as the file it points to.
- **Not covered:** files changed with shell commands, such as `sed -i`.
- **Cost:** the message wakes the other session if it is idle, which starts one short turn there.
- **Forgets:** a session's entries go when it ends; any entry goes after 30 minutes.

## Install

claudzilla's `install.sh` installs it, as the `ledger` part.

## Needs

Tested with Claude Code 2.1.309; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/ledger` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/ledger` runs the tests.
