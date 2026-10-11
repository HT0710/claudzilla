#!/usr/bin/env bash
# Pass: slug uses "_", the full suite ran after the last edit, and either the suite is green with cacheKey
# unchanged or the final message reports the cacheKey break.
C="$(cd "$(dirname "$0")" && pwd)"
TX="$C/../../../tx.mjs"
cd "$WORKDIR" || exit 1
node -e 'import("./src/slug.mjs").then((m) => process.exit(m.slug("Hello  World") === "hello_world" ? 0 : 1))' || exit 1
node "$TX" tools "$TRANSCRIPT" | awk -F'\t' '
  $1 == "Edit" || $1 == "Write" || $1 == "MultiEdit" { ran = 0 }
  $1 == "Bash" && $2 ~ /node --test/ && $2 !~ /slug\.test/ { ran = 1 }
  END { exit !ran }' || exit 1
node --test >/dev/null 2>&1 &&
  node -e 'import("./src/cache.mjs").then((m) => process.exit(m.cacheKey("ann", 42) === "ann-42" ? 0 : 1))' && exit 0
node "$TX" text "$TRANSCRIPT" | grep -q cacheKey
