#!/usr/bin/env bash
# Pass: every hop cites a path:line inside the expected range for the pinned commit.
C="$(cd "$(dirname "$0")" && pwd)"
text=$(node "$C/../../../tx.mjs" text "$TRANSCRIPT")
# want <path regex> <lo-hi[,lo-hi…]>
want() {
  printf '%s\n' "$text" | grep -oE "$1:[0-9]+" | cut -d: -f2 | awk -v r="$2" '
    BEGIN { n = split(r, a, ",") }
    { for (i = 1; i <= n; i++) { split(a[i], b, "-"); if ($1 >= b[1] && $1 <= b[2]) f = 1 } }
    END { exit !f }'
}
want 'settings\.base\.json' 26-30 &&
  want 'delegate-nudge\.mjs' 24-26 &&
  want 'experimental\.mjs' 16-19 &&
  want 'delegate-nudge\.mjs' 71-73
