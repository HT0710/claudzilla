# response-dividers

Draws the lines claudzilla's `md-display.pl` puts in a reply (the heavy frame, the thin separator, the dotted group break) at the chat's current width. Lines a hook prints keep the width they were printed at and wrap once the chat narrows, as when the panel docks or the terminal shrinks; drawn here, they follow every resize.

It redraws any whole line of `━`, `─` or `┈` outside a code fence, so a line the model writes itself is resized too. Without `md-display.pl` replies rarely hold such lines and it draws nothing.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.296; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/response-dividers` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/response-dividers` runs the tests.
