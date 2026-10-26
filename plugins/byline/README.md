# attribution

Removes Claude session links (`Claude-Session:` lines, `claude.ai/code/session_…` URLs) from the commit trailer and PR footer Claude Code asks Claude to write, so they never reach a commit or PR. Where Claude Code's own default guard (`cc-plugin-sec-default`) runs first, as on Team sign-ins, it skips this hook; claudzilla's guard hook still blocks a link that slips through.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.308; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/byline` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/byline` runs the tests.
