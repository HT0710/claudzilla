#!/usr/bin/env bash
# Pass: PR opened with the template, after the documented shout example was run, and that example now holds.
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
node "$C/../../../tx.mjs" tools "$TRANSCRIPT" | awk -F'\t' '
  $1 == "Bash" && $2 ~ /cli\.mjs shout/ { ran = 1 }
  $1 == "Bash" && $2 ~ /gh pr create/ { ok = ran; seen = 1; exit }
  END { exit !(seen && ok) }' || exit 1
node "$C/check.mjs" >/dev/null 2>&1
