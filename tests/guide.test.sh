#!/usr/bin/env bash
# Structure and style lint for GUIDE.md.
#   bash tests/guide.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
G="$REPO/GUIDE.md"
. "$REPO/tests/lib.sh"

SLUGS="start first words talk replies flow approve skills context undo guard hud margin ballot plugins limits customize labs keys background stuck bugs ref more news"
PARTS="Get started|Work with Claude|On your screen|Settings and cost|Get help"

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
parts_ok() { [ -f "$G" ] && [ "$(awk '/^```/{f=!f;next} !f&&/^## /{sub(/^## /,"");printf "%s|",$0}' "$G")" = "$PARTS|" ]; }
tldr_ok() { [ -f "$G" ] && ! prose | awk -F"\t" '$1!="replies"{print $2}' | grep -Ei 'tl;dr' >/dev/null; }
words_ok() { [ -f "$G" ] && ban "(^|[^[:alnum:]])(simply|easy|please|let's)([^[:alnum:]]|\$)" && ban '!([[:space:]]|$)'; }

above_ok() { [ -f "$G" ] && ban '(^|[^[:alnum:]])(above|below)([^[:alnum:]]|$)'; }

report_ok() { case " $SLUGS " in *" report "*) return 1;; esac; }
MEMBERS="Get started:start Get started:first Get started:words Work with Claude:talk Work with Claude:replies Work with Claude:flow Work with Claude:approve Work with Claude:skills Work with Claude:context Work with Claude:undo Work with Claude:guard On your screen:hud On your screen:margin On your screen:ballot On your screen:plugins Settings and cost:limits Settings and cost:customize Settings and cost:labs Settings and cost:keys Settings and cost:background Get help:stuck Get help:bugs Get help:ref Get help:more Get help:news"
members_ok() { [ -f "$G" ] && [ "$(awk '/^```/{f=!f;next} f{next} /^## /{p=substr($0,4)} /^<!-- topic: [a-z]+ -->$/{printf "%s:%s ",p,$3}' "$G")" = "$MEMBERS " ]; }
body_ok() { [ -f "$G" ] && awk '/^```/{f=!f} !f&&/^<!-- topic: [a-z]+ -->$/{w=1;next} w&&NF{if(/^#{2,3} /)bad=1;w=0} END{exit bad}' "$G"; }
check "slugs in order"        slugs_ok
check "topic follows heading" follow_ok
check "parts in order"        parts_ok
check "report is never a slug" report_ok
check "no above/below"        above_ok
check "TL;DR only in replies" tldr_ok
check "banned words"          words_ok
check "sections in their part" members_ok
check "every topic has text" body_ok

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
