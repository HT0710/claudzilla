#!/usr/bin/env bash
# Structure and style lint for GUIDE.md.
#   bash tests/guide.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
G="$REPO/GUIDE.md"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }

SLUGS="start first words talk replies flow approve skills context undo guard hud panel picks limits background stuck ref keys customize more"
PARTS="Basics|Working|Screen|Own it"

# prose: lines outside fences as "<slug>\t<line>"; inline code spans removed
prose() { [ -f "$G" ] && awk '
  /^```/ { f = !f; next }
  f { next }
  match($0, /^<!-- topic: [a-z]+ -->$/) { s = $3; next }
  { gsub(/`[^`]*`/, ""); print s "\t" $0 }' "$G"; }
ban() { ! prose | cut -f2- | grep -Ei "$1" >/dev/null; }

slugs_ok() { [ -f "$G" ] && [ "$(awk '/^```/{f=!f;next} !f&&/^<!-- topic: [a-z]+ -->$/{printf "%s ",$3}' "$G")" = "$SLUGS " ]; }
follow_ok() { [ -f "$G" ] && awk '
  /^```/ { f = !f; next }
  f { next }
  h { if ($0 !~ /^<!-- topic: [a-z]+ -->$/) bad = 1; h = 0 }
  /^### / { h = 1 }
  END { exit (bad || h) }' "$G"; }
parts_ok() { [ -f "$G" ] && [ "$(awk '/^```/{f=!f;next} !f&&/^## /{sub(/^## /,"");printf "%s|",$0}' "$G")" = "Basics|Working|Screen|Own it|" ]; }
tldr_ok() { [ -f "$G" ] && ! prose | awk -F"\t" '$1!="replies"{print $2}' | grep -Ei 'tl;dr' >/dev/null; }
words_ok() { [ -f "$G" ] && ban "(^|[^[:alnum:]])(simply|easy|please|let's)([^[:alnum:]]|\$)" && ban '!([[:space:]]|$)'; }

above_ok() { [ -f "$G" ] && ban '(^|[^[:alnum:]])(above|below)([^[:alnum:]]|$)'; }

check "slugs in order"        slugs_ok
check "topic follows heading" follow_ok
check "parts in order"        parts_ok
check "no above/below"        above_ok
check "TL;DR only in replies" tldr_ok
check "banned words"          words_ok

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
