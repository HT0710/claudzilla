#!/usr/bin/env bash
# Pass: hidden tests green, a test file exists, and the first file write went to a test, not to src/duration.mjs.
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
first=$(node "$C/../../../tx.mjs" tools "$TRANSCRIPT" | awk -F'\t' '
  $1 == "Write" || $1 == "Edit" || $1 == "MultiEdit" {
    if ($2 ~ /(\/test\/|\.test\.mjs$)/) { print "test"; exit }
    if ($2 ~ /src\/duration\.mjs$/) { print "impl"; exit }
  }')
[ "$first" = test ] || exit 1
ls test/*.test.mjs >/dev/null 2>&1 || exit 1
mkdir -p hidden && cp "$C"/hidden/*.test.mjs hidden/ || exit 1
node --test hidden/*.test.mjs >/dev/null 2>&1
