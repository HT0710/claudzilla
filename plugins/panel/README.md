# panel

A side pane that opens on its Overview tab; the History tab lists this chat's prompts, newest first.

- **Click a prompt:** the chat scrolls to it.
- **`↻`:** puts the prompt back in the prompt box.
- **`⟲ rewind`:** opens the `/rewind` picker.
- **`⤓ latest`:** scrolls the chat to its newest row, as ctrl+end does.
- **Wheel:** scrolls the prompts under the tabs and header. Scrolled, a `↑` line under the header, or a new prompt, goes back to the top.
- **Lit prompt:** the one whose turn is on screen. Needs the fullscreen layout.
- **Dim prompt:** rewound or compacted (a `Rewound` or `Compacted` line marks where), or not drawn in the chat yet. `↻` still works.
- **Git tab:** the session folder's branch (`↑` ahead, `↓` behind), changed files and recent commits. The wheel scrolls the list under it; scrolled, a `↑` line goes back to the top of CHANGES or COMMITS. Redraws after each tool call and prompt.
- **Overview tab:** what this chat is about (TOPICS: Opus groups your prompts, and only your prompts, into topics, after each prompt while the tab shows; past 30 it combines the most closely related), how Claude read your request (ASK), what it plans (PLAN) and its steps (STEPS), in Claude's own words: the panel adds a hidden `intent` tool and asks Claude to call it first in each turn, and again as each step completes or the plan changes. The report comes first in each message, so the tab updates before that message's other tools run; when the turn ends with an answer, every step shows done. Costs a short tool call per report. The `intent` option in `/config` turns it off from the next session. The wheel scrolls TOPICS; scrolled, a `↑` line goes back to the top.

## Install

claudzilla's `install.sh` installs it. Without claudzilla:

```
/plugin install panel --marketplace HT0710/claudzilla
```

## Open it

`/panel` toggles the pane. claudzilla's `install.sh` binds alt+h unless you bound it. Without claudzilla, add this to `~/.claude/keybindings.json`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "alt+h": "command:panel" } }
  ]
}
```

On macOS `alt` is Option; your terminal must send it as Meta — see [Option key shortcuts](https://code.claude.com/docs/en/terminal-config#enable-option-key-shortcuts-on-macos).

## Needs

Tested with Claude Code 2.1.296; mod events and methods can change between releases.

`grep` on `PATH`. Without it, the list still shows, read whole from the prompt history (up to 4 MiB), and a click finds only prompts already drawn.

## Develop

`claude --plugin-dir plugins/panel` loads it and writes the API types `tsconfig.json` points at; `claude plugin test plugins/panel` runs the tests.
