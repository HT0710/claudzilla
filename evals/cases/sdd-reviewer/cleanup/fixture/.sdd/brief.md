### Task 3: cleanup flags

**Files:**
- Modify: `src/cleanup.mjs`
- Test: `test/cleanup.test.mjs`

**Requirements:**

1. `--dry-run`: print the paths that would be deleted; delete nothing.
2. `--limit N`: delete at most N files, oldest first.
3. Print each deleted path on its own line through `main`'s `log` callback.
4. An unknown flag (any other argument starting with `--`) prints `unknown flag: <flag>` to stderr and makes `main` return 2 without deleting anything.
5. Tests in `test/cleanup.test.mjs` cover 1–4.
