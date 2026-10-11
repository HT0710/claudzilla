#!/usr/bin/env bash
# Pass: valid items 1, 2, 5 applied (hidden tests); wrong items 3, 4 pushed back (original tests still green; added tests are fine).
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ && cp "$C/fixture/test/stats.test.mjs" hidden/original.test.mjs || exit 1
node --test test/*.test.mjs hidden/*.test.mjs >/dev/null 2>&1
