#!/usr/bin/env bash
# Pass: suite and hidden money tests green, and the fix sits in money.mjs (invoice.mjs, the symptom layer, untouched).
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
cmp -s src/invoice.mjs "$C/fixture/src/invoice.mjs" || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ || exit 1
node --test test/*.test.mjs hidden/*.test.mjs >/dev/null 2>&1
