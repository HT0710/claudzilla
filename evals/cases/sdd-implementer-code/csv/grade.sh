#!/usr/bin/env bash
# Pass: existing and hidden parseCsvLine tests green.
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ || exit 1
node --test test/*.test.mjs hidden/*.test.mjs >/dev/null 2>&1
