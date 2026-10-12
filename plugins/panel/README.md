# panel

A side pane listing this chat's prompts, newest first.

- **Click a prompt:** the chat scrolls to it.
- **`↻`:** puts the prompt back in the prompt box.
- **`⟲ rewind`:** opens the `/rewind` picker.
- **Lit prompt:** the one whose turn is on screen. Needs the fullscreen layout.
- **Dim prompt:** rewound or compacted (a `Rewound` or `Compacted` line marks where), or not drawn in the chat yet. `↻` still works.

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
