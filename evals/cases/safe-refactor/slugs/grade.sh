#!/usr/bin/env bash
# Pass: behavior preserved (hidden tests, incl. tagKey keeping "_") and the normalize chain lives in one file.
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
[ "$(grep -rl 'NFKD' src | wc -l | tr -d ' ')" = 1 ] || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ || exit 1
node --test test/*.test.mjs hidden/*.test.mjs >/dev/null 2>&1
