#!/usr/bin/env bash
# List pictures that may be stale: feat and fix commits on a picture's sources since it was last committed.
#   bash .github/visuals/stale.sh     (release gate step 5; no output means every picture is current)
# Also lists mapped paths that no longer exist and pictures missing from sources.txt.
set -uo pipefail
set -f # sources.txt globs are git pathspecs, not shell globs
cd "$(dirname "$0")/../.." || exit 1
A=.github/assets
SRC=.github/visuals/sources.txt

while read -r pic paths; do
  case $pic in '' | \#*) continue ;; esac
  pic=${pic%:}
  [ -f "$A/$pic" ] || { echo "$pic: not in $A"; continue; }
  since=$(git log -1 --format=%H -- "$A/$pic")
  [ -n "$since" ] || { echo "$pic: never committed"; continue; }
  [ -n "$paths" ] || { echo "$pic: no paths"; continue; }
  for p in $paths; do
    [ -n "$(git ls-files -- "$p")" ] || echo "$pic: missing $p"
  done
  # shellcheck disable=SC2086 # split on purpose: one pathspec per word
  git log -E --grep='^(feat|fix)[(:!]' --format="$pic: %h %s" "$since"..HEAD -- $paths
done < "$SRC"

set +f
for f in "$A"/*; do
  grep -q "^${f##*/}:" "$SRC" || echo "${f##*/}: not in $SRC"
done
