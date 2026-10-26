#!/usr/bin/env bash
# Re-shoot the README visuals from real Claude Code sessions in tmux.
#   bash .github/visuals/shoot.sh [name...]     (all by default)
# Real turns on your login and ~/.claude; needs tmux, firefox, ffmpeg, python3 with PIL.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
A="$REPO/.github/assets"
SPEEDS="$REPO/.github/visuals/speeds.txt"
# shellcheck source=lib.sh
. "$REPO/.github/visuals/lib.sh"
DEMO="$HOME/acme-api"
SHOTS="statusline ballot margin primer"

# ask PROMPT SECS: send PROMPT, wait until its turn ends: a "✻ Sautéed for 21s · done 5:03 am" line
# not on screen before (a long reply scrolls the prompt itself away).
ask() {
  # Only the done text: the docked panel beside it changes on its own.
  local end=$((SECONDS + $2)) re='[^ ]+ for [0-9][0-9hms ]* · done [0-9:]+( [ap]m)?' old
  old=$(tm capture-pane -t "$SHOT" -p | grep -oE -- "$re")
  say "$1"
  until tm capture-pane -t "$SHOT" -p | grep -oE -- "$re" | grep -vxF -- "${old:-none}" >/dev/null; do
    [ "$SECONDS" -lt "$end" ] || { echo "ask: no reply to '$1' in $2 s" >&2; return 1; }
    sleep 0.5
  done
}

# clip NAME DIR: GIF at a uniform speed-up that fits ~10 s; records "NAME: N×".
clip() {
  local n s
  n=$(find "$2" -name '*.ansi' | wc -l)
  s=$(( (n * 5 + 99) / 100 ))   # ceil(n * 0.5 s / 10 s)
  [ "$s" -ge 1 ] || s=1
  gif "$2" "$A/$1.gif" "$s" || return 1
  touch "$SPEEDS"; sed -i "/^$1: /d" "$SPEEDS"; echo "$1: ${s}×" >> "$SPEEDS"; sort -o "$SPEEDS" "$SPEEDS"
  echo "$1: $n frames, ${s}× speed, $(wc -c < "$A/$1.gif") bytes"
}

# prompt_row: the prompt box's text (the last ❯ row).
prompt_row() { tm capture-pane -t "$SHOT" -p | grep -F '❯' | tail -1; }

# card_row N: the first 14 characters of the ballot card's row N.
card_row() { tm capture-pane -t "$SHOT" -p | sed -n "s/.*│ *$1: \(.\{1,14\}\).*/\1/p" | head -1; }

# has DIR REGEX: some frame in DIR shows REGEX.
has() { cat "$1"/*.ansi | sed 's/\x1b\[[0-9;:]*m//g' | grep -E -- "$2" >/dev/null; }

shot_statusline() {
  local d="$WORK/statusline"; rm -rf "$d"
  # Under ~30 rows the status line drops its model/skill row; keep the bottom 13 (spinner to status line).
  start "$DEMO" 110 30 && margin_want off || return 1
  frames "$d" 240 17 & local f=$!
  ask "why does the auth test fail?" 200; local ok=$?
  sleep 2; touch "$d/stop"; wait "$f"
  [ "$ok" = 0 ] && has "$d" 'systematic-debugging' || return 1
  [ "$(sed 's/\x1b\[[0-9;:]*m//g' "$d/0001.ansi" | grep -o 'ctx.*' )" != \
    "$(sed 's/\x1b\[[0-9;:]*m//g' "$(ls "$d"/*.ansi | tail -1)" | grep -o 'ctx.*')" ] || return 1
  clip statusline "$d"
}

# Card appears, a digit picks, the answer lands in the prompt box, Enter sends.
shot_ballot() {
  local d="$WORK/ballot" top end opt before pick f ok; rm -rf "$d"
  start "$DEMO" 110 42 && margin_want off || return 1
  ask "why does the auth test fail?" 200 && wait_for '│ *1: ' 10 && wait_for '│ *2: ' 2 || return 1
  top=$(row '╭'); end=$(row '❯')
  # Press the row that is not the dim suggestion, so the pick visibly changes the prompt box.
  before=$(prompt_row); pick=1
  [ "$(card_row 1)" = "$(sed 's/^❯[^:]*: \(.\{1,14\}\).*/\1/' <<< "$before")" ] && pick=2
  opt=$(card_row "$pick")
  frames "$d" 30 "$top" "$end" & f=$!
  sleep 1.5; tm send-keys -t "$SHOT" "$pick"
  sleep 2; prompt_row | grep -F -- "$opt" | grep -vxF -- "$before" >/dev/null; ok=$?
  sleep 0.5; tm send-keys -t "$SHOT" Enter; sleep 1.5
  touch "$d/stop"; wait "$f"
  tm send-keys -t "$SHOT" Escape   # stop the turn the answer started: it is not part of the clip
  [ "$ok" = 0 ] && clip ballot "$d"
}

# One session: the Overview fills during a fix (GIF), a cited path opens in the File tab (GIF),
# then the Git and History tabs (stills).
shot_margin() {
  local d="$WORK/overview" l="$WORK/filelink" f ok at
  rm -rf "$d" "$l"
  start "$DEMO" 110 42 && margin_want on || return 1
  frames "$d" 300 & f=$!
  sleep 1
  say "make isValid accept the expiry second, run the test, then show git diff"
  wait_for '✓ done' 240; ok=$?
  sleep 2; touch "$d/stop"; wait "$f"
  [ "$ok" = 0 ] && has "$d" 'planning…' && has "$d" '●' || return 1
  clip overview "$d" || return 1

  ask "where is the expiry check? cite it as file:line, no edits" 120 && sleep 2 || return 1
  at=$(locate 'auth/token.js:' "$(dock_col)") || return 1
  frames "$l" 20 & f=$!
  sleep 1.5; click $at
  wait_for '▶' 8; ok=$?
  sleep 2; touch "$l/stop"; wait "$f"
  [ "$ok" = 0 ] && clip filelink "$l" || return 1

  click $(locate 'Git') && wait_for 'COMMITS' 8 && sleep 1 && grab "$WORK/git.ansi" && still "$WORK/git.ansi" "$A/git.png" || return 1
  click $(locate 'History') && sleep 2 && grab "$WORK/history.ansi" && still "$WORK/history.ansi" "$A/history.png"
}

# The primer pane: topics beside a section.
shot_primer() {
  local ok
  start "$DEMO" 110 42 && margin_want off || return 1
  tm send-keys -t "$SHOT" M-q   # alt+q: the guide, as /claudzilla opens it
  wait_for 'BASICS' 20 && wait_for 'WORKING' 2 && sleep 1.5 && grab "$WORK/primer.ansi"; ok=$?
  tm send-keys -t "$SHOT" M-q   # close it: the dock must be free for finish to bring the panel back
  sleep 1
  [ "$ok" = 0 ] && still "$WORK/primer.ansi" "$A/primer.png"
}

[ $# -gt 0 ] || set -- $SHOTS
for s in "$@"; do
  echo "== $s"
  retry "${RETRIES:-3}" "shot_${s//-/_}" || { echo "shot $s failed 3 times" >&2; exit 1; }
done

rm -rf "$WORK" "$DEMO"
