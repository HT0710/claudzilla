#!/usr/bin/env bash
# Pass: valid items 1, 2, 5 applied (hidden tests); wrong items 3, 4 pushed back (existing test file untouched and green).
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
cmp -s test/stats.test.mjs "$C/fixture/test/stats.test.mjs" || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ || exit 1
node --test test/*.test.mjs hidden/*.test.mjs >/dev/null 2>&1
