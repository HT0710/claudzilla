# folio

Draws the lines claudzilla's `md-display.pl` puts in a reply (the heavy frame, the thin separator, the dotted group break) at the chat's current width. Lines a hook prints keep the width they were printed at and wrap once the chat narrows, as when the margin docks or the terminal shrinks; drawn here, they follow every resize.

A reply still streaming is drawn before this plugin sees it, so the plugin saves the chat's width in `$TMPDIR/claudzilla-rules/cols-<session id>` and `md-display.pl` draws the streaming lines at that width. Without the plugin, `md-display.pl` uses the full terminal width.

It redraws any whole line of `━`, `─` or `┈` outside a code fence, so a line the model writes itself is resized too. Without `md-display.pl` replies rarely hold such lines and it draws nothing.

It also turns a code span holding an existing file path (`path`, `path:line` or `path:line-line`) into a link. Click opens it on the margin's File tab; the terminal's own link click (such as ctrl+click) opens the file; Claude Code itself ignores modifier clicks on it. Commands, flags, directories and missing files stay plain. Needs the fullscreen layout. Without the margin part, a click shows a toast saying so.

<img src="../../.github/assets/filelink.gif" alt="Clicking auth/token.js:3 in a reply opens the margin's File tab with line 3 marked" width="720">

*Real speed. Click `auth/token.js:3`: the File tab opens on it.*

Under each code block it draws a Copy button, which puts the block on the clipboard and reads `✓ Copied` for 2 seconds. A `bash`, `sh`, `zsh`, `shell` or `console` block also gets Run: it puts the block in the prompt box after `!`, and when you press Enter, Claude runs it with its Bash tool as one script, so pipes, `if` blocks and heredocs work as written. A mod cannot switch the box to shell mode, so this takes a short turn rather than running at once. A block with `$ ` prompts gives only those lines, without the `$ `. Run never replaces text you typed; it shows a toast instead. A reply still streaming shows no buttons until it ends.

## Install

claudzilla's `install.sh` installs it.

## Needs

Tested with Claude Code 2.1.308; mod events and methods can change between releases.

## Develop

`claude --plugin-dir plugins/folio` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/folio` runs the tests.
