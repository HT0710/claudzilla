# RTK - Rust Token Killer

PreToolUse hook (`rtk hook claude`) auto-rewrites Bash commands. No manual prefix needed.

Not rewritten: `uv run <tool>` → write `uv run rtk <tool>` (e.g. `uv run rtk pytest -q`).
`rtk uv run ...` passes through unfiltered; `rtk pytest` outside venv fails (pytest not on PATH).

User meta: `rtk gain`, `rtk discover`.
