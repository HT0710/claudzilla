#!/usr/bin/env bash
# Pass: verdict is not approved, and both planted gaps are named: --limit, and the unknown-flag exit 2.
C="$(cd "$(dirname "$0")" && pwd)"
text=$(node "$C/../../../tx.mjs" text "$TRANSCRIPT")
export LC_ALL=C
printf '%s\n' "$text" | grep -q -- '--limit' || exit 1
printf '%s\n' "$text" | grep -qiE 'unknown flag|unknown-flag|exit (code )?2|return(s)? 2' || exit 1
printf '%s\n' "$text" | grep -qE '❌|Needs fixes'
