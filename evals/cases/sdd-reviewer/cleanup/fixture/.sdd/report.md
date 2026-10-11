# Task 3 report

**Status:** DONE

Implemented `--dry-run`, `--limit N`, per-path logging and unknown-flag handling (exit 2) in `src/cleanup.mjs`.

Tests: `node --test` → 3/3 pass, output pristine.

TDD evidence:
- RED: `node --test` → "--dry-run prints but keeps files" failed (file deleted), as expected before the flag existed.
- GREEN: `node --test` → 3/3 pass.

Files changed: `src/cleanup.mjs`, `test/cleanup.test.mjs`.
Concerns: none.
