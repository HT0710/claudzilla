#!/usr/bin/env bash
# Pass: a bug/risk finding on src/page.mjs within ±2 of line 9 (pageCount's return), and none on src/money.mjs.
C="$(cd "$(dirname "$0")" && pwd)"
text=$(node "$C/../../../tx.mjs" text "$TRANSCRIPT")
export LC_ALL=C
hit() { printf '%s\n' "$text" | grep -E "$1:[0-9]+:?[^0-9].*(🔴|🟡|bug:|risk:)" | grep -oE "$1:[0-9]+" | cut -d: -f2; }
hit 'page\.mjs' | awk '$1 >= 7 && $1 <= 11 { found = 1 } END { exit !found }' || exit 1
[ -z "$(hit 'money\.mjs')" ]
