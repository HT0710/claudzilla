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
SHOTS="statusline statusline-compact statusline-minimal ballot margin edits primer run fix guard verify"

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

# copy_at LANG: "X Y" of the Copy button on the code card whose top edge names LANG.
copy_at() {
  tm capture-pane -t "$SHOT" -p | python3 -I -c '
import sys
hit = None
for y, l in enumerate(sys.stdin, 1):
    if "─ " + sys.argv[1] + " " in l and "Copy" in l: hit = (l.rfind("Copy") + 1, y)
if not hit: sys.exit(1)
print(*hit)' "$1"
}

# has DIR REGEX: some frame in DIR shows REGEX.
has() { cat "$1"/*.ansi | sed 's/\x1b\[[0-9;:]*m//g' | grep -E -- "$2" >/dev/null; }

# hud_layout full|compact|minimal: the status line layout for the next session; the user's own claudzilla.json
# is saved once and put back on exit.
CONF="$HOME/.claude/claudzilla.json"
hud_layout() {
  [ -e "$WORK/claudzilla.json.orig" ] || [ -e "$WORK/claudzilla.json.none" ] ||
    { [ -e "$CONF" ] && cp "$CONF" "$WORK/claudzilla.json.orig" || touch "$WORK/claudzilla.json.none"; }
  python3 -I - "$CONF" "$1" <<'PY' || return 1
import json, os, sys
path, layout = sys.argv[1], sys.argv[2]
conf = json.load(open(path)) if os.path.exists(path) else {}
hud = conf.setdefault("hud", {})
hud.pop("compact", None)
if layout != "full": hud["layout"] = layout
else: hud.pop("layout", None)
json.dump(conf, open(path, "w"), indent=2)
PY
}
hud_restore() {
  if [ -e "$WORK/claudzilla.json.orig" ]; then cp "$WORK/claudzilla.json.orig" "$CONF"
  elif [ -e "$WORK/claudzilla.json.none" ]; then rm -f "$CONF"; fi
}

# statusline_still NAME LAYOUT TOP: one real turn from row TOP down; the context meter must climb and the skill show,
# except in minimal, which draws no skill. The still is the last frame with the skill on it.
statusline_still() {
  local d="$WORK/$1"; rm -rf "$d"
  hud_layout "$2" || return 1
  # Under ~30 rows the status line drops its model/skill row. TOP keeps the spinner, prompt box and status line.
  start "$DEMO" 110 30 && margin_want off || return 1
  trap 'finish; hud_restore' EXIT
  frames "$d" 240 "$3" & local f=$!
  ask "why does the auth test fail?" 200; local ok=$?
  sleep 2; touch "$d/stop"; wait "$f"
  [ "$ok" = 0 ] && { [ "$2" = minimal ] || has "$d" 'systematic-debugging'; } || return 1
  [ "$(sed 's/\x1b\[[0-9;:]*m//g' "$d/0001.ansi" | grep -o 'ctx.*' )" != \
    "$(sed 's/\x1b\[[0-9;:]*m//g' "$(ls "$d"/*.ansi | tail -1)" | grep -o 'ctx.*')" ] || return 1
  local pick
  pick=$(grep -lF 'systematic-debugging' "$d"/*.ansi | tail -1)
  still "${pick:-$(ls "$d"/*.ansi | tail -1)}" "$A/$1.png"
}
shot_statusline() { statusline_still statusline full 17; }
# 3 rows shorter: the same rows above it, 3 rows lower.
shot_statusline_compact() { statusline_still statusline-compact compact 20; }
# 2 rows shorter again.
shot_statusline_minimal() { statusline_still statusline-minimal minimal 22; }

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

# One session: the Overview fills during a fix (GIF), a cited path opens in the Explorer tab (GIF),
# then the Explorer tree and the Git and History tabs (stills, the pane alone).
shot_margin() {
  local d="$WORK/overview" l="$WORK/filelink" f ok at
  rm -rf "$d" "$l"
  start "$DEMO" 130 42 && margin_want on || return 1
  frames "$d" 300 & f=$!
  sleep 1
  # A subagent in the turn: its row shows on the Overview and in folio's fold.
  say "make isValid accept the expiry second. while you edit, have a subagent check that auth/token.test.js covers the boundary. then run the test and show git diff"
  wait_for '✓ done' 240; ok=$?
  sleep 2; touch "$d/stop"; wait "$f"
  [ "$ok" = 0 ] && has "$d" 'sketching a route…' && has "$d" '●' || return 1
  clip overview "$d" || return 1
  # The same turn's chat side once its subagent is done: folio's rail, the fold and the named agent row.
  local fr plain top end c
  fr=$(for x in "$d"/*.ansi; do
    plain=$(sed 's/\x1b\[[0-9;:]*m//g' "$x")
    grep -qF '❯ make isValid' <<< "$plain" && grep -qE 'done +[a-z]+(-[a-z]+)+ \(' <<< "$plain" && echo "$x"
  done | tail -1)
  [ -n "$fr" ] || return 1
  plain=$(sed 's/\x1b\[[0-9;:]*m//g' "$fr")
  top=$(grep -nF '❯ make isValid' <<< "$plain" | head -1 | cut -d: -f1)
  end=$(($(grep -n '^─\{20,\}' <<< "$plain" | head -1 | cut -d: -f1) - 2))
  c=$(dock_col)
  [ -n "$c" ] && [ "$end" -gt "$top" ] && sed -n "${top},${end}p" "$fr" > "$WORK/fold.ansi" &&
    cols "$WORK/fold.ansi" 0 "$c" && still "$WORK/fold.ansi" "$A/fold.png" || return 1

  ask "where is the expiry check? cite it as file:line, no edits" 120 && sleep 2 || return 1
  at=$(locate 'auth/token.js:3' "$(dock_col)") || return 1
  # Down to just above the prompt box's top rule: no prompt box, no status line.
  frames "$l" 20 0 $(($(tm capture-pane -t "$SHOT" -p | grep -n '^─\{20,\}' | head -1 | cut -d: -f1) - 2)) & f=$!
  sleep 1.5; click $at
  # The file opens with the cited line lit; the path bar names it.
  wait_for 'acme-api/auth/token.js' 8; ok=$?
  sleep 2; touch "$l/stop"; wait "$f"
  [ "$ok" = 0 ] && clip filelink "$l" || return 1

  # The pane alone, right of its border and above the prompt box: the Explorer tree, then the Git and History tabs.
  local c end
  c=$(dock_col); end=$(($(tm capture-pane -t "$SHOT" -p | grep -n '^─\{20,\}' | head -1 | cut -d: -f1) - 2))
  [ -n "$c" ] && [ "$end" -gt 0 ] || return 1
  # The path bar's root opens the folder page; its auth row expands in place.
  # A long path shows … for its root instead of the name.
  click $(pane_at 'acme-api' "$c" || pane_at '…' "$c") && wait_for '(▸|▾) . auth' 5 &&
    # Opening the file expanded auth already; expand it only if it shows closed. Rows: mark, icon, name.
    { tm capture-pane -t "$SHOT" -p | grep -qE '▾ . auth' || click $(pane_at 'auth' "$c"); } && wait_for 'token.test.js' 5 &&
    sleep 1 && grab "$WORK/explorer.ansi" 0 "$end" && cols "$WORK/explorer.ansi" $((c + 1)) &&
    still "$WORK/explorer.ansi" "$A/explorer.png" || return 1
  click $(locate $'\ue702') && wait_for 'COMMITS' 8 && sleep 1 && grab "$WORK/git.ansi" 0 "$end" &&
    cols "$WORK/git.ansi" $((c + 1)) && still "$WORK/git.ansi" "$A/git.png" || return 1
  click $(locate $'\uea82') && sleep 2 && grab "$WORK/history.ansi" 0 "$end" &&
    cols "$WORK/history.ansi" $((c + 1)) && still "$WORK/history.ansi" "$A/history.png"
}

# folio's edit rows: two edits fold into one row; a click opens its tree of files.
shot_edits() {
  local at top end
  # Tall: the tree opens under the row, and the reply under it must not push the row off screen.
  start "$DEMO" 110 60 && margin_want off || return 1
  ask "add a one-line comment at the top of auth/token.js and auth/token.test.js saying what each file holds. edit only, run nothing" 200 || return 1
  at=$(locate 'Edited (2 files)') || return 1
  click $at && wait_for '└' 8 && sleep 1 || return 1
  # The folded row and its open tree only: the reply under it can run past the screen.
  top=$(row 'Edited (2 files)'); end=$(row '└ Updated (auth/')
  [ -n "$top" ] && [ -n "$end" ] || return 1
  top=$((top - 2))
  grab "$WORK/edits.ansi" "$top" "$end" && still "$WORK/edits.ansi" "$A/edits.png"
}

# pane_at TEXT COL: "X Y" of TEXT's first match right of column COL (inside the docked pane).
pane_at() {
  tm capture-pane -t "$SHOT" -p | python3 -I -c '
import sys
t, c = sys.argv[1], int(sys.argv[2])
for y, l in enumerate(sys.stdin, 1):
    x = l.find(t, c)
    if x >= 0: print(x + 1, y); sys.exit(0)
sys.exit(1)' "$1" "$2"
}

# cols ANSI FROM [TO]: keeps each line's cells FROM to TO (to the end without TO), with the colours and links set before.
cols() {
  python3 -I - "$1" "$2" "${3:-100000}" <<'EOF'
import re, sys, unicodedata
path, cut, to = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
tok = re.compile(r'\x1b\[[0-9;:]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|.', re.S)
out = []
for line in open(path).read().split('\n'):
    x, held, kept = 0, [], []
    for t in tok.findall(line):
        if t.startswith('\x1b'):
            (kept if x >= cut else held).append(t)
            continue
        if cut <= x < to:
            if held: kept, held = held + kept, []
            kept.append(t)
        x += 2 if unicodedata.east_asian_width(t) in 'WF' else 1
    out.append(''.join(kept))
open(path, 'w').write('\n'.join(out))
EOF
}

# The guide pane alone, wide enough for its topics beside the text: Get started, then Worlds.
shot_primer() {
  local ok at end
  start "$DEMO" 200 42 && margin_want off || return 1
  tm send-keys -t "$SHOT" M-i   # alt+i: the guide, as /claudzilla opens it
  wait_for 'GET STARTED' 20 && wait_for 'WORK WITH CLAUDE' 2 && sleep 1.5 || ok=1
  # Right of the pane's border, down to just above the prompt box's top rule.
  at=$(dock_col); end=$(($(tm capture-pane -t "$SHOT" -p | grep -n '^─\{20,\}' | head -1 | cut -d: -f1) - 2))
  [ "${ok:-0}" = 0 ] && [ -n "$at" ] && [ "$end" -gt 0 ] && grab "$WORK/primer.ansi" 0 "$end" &&
    tm send-keys -t "$SHOT" M-w &&   # alt+w: the same pane on its Worlds part
    wait_for 'Long ago' 20 && sleep 1.5 && grab "$WORK/worlds.ansi" 0 "$end"; ok=$?
  # Close it: the dock must be free for finish to bring the panel back. alt+i toggles, so only while it shows.
  tm capture-pane -t "$SHOT" -p | grep -qE 'GET STARTED|Long ago' && tm send-keys -t "$SHOT" M-i
  sleep 1
  [ "$ok" = 0 ] && cols "$WORK/primer.ansi" $((at + 1)) && cols "$WORK/worlds.ansi" $((at + 1)) &&
    still "$WORK/primer.ansi" "$A/primer.png" && still "$WORK/worlds.ansi" "$A/worlds.png"
}

# folio's code cards: Run on the shell block (arm, run, output streams in), then Copy on the json block.
shot_run() {
  local d="$WORK/run" f ok top end; rm -rf "$d"
  # Under 110 columns the margin cannot dock, so it stays out of the clip; tall enough that the output never scrolls the reply.
  start "$DEMO" 100 60 || return 1
  # A test script with results that arrive over time; the base demo's failing test stays for the other shots.
  cp -r "$REPO/.github/visuals/demo-run/." "$DEMO" && git -C "$DEMO" add -A &&
    git -C "$DEMO" -c user.name=demo -c user.email=demo@example.com commit -q --amend --no-edit || return 1
  ask "show me how to run the tests and the package.json script behind it, as code blocks. don't run it" 120 &&
    wait_for '▶ Run' 10 && wait_for '─ json ' 2 || return 1
  # Prompt row down to just above the prompt box's top rule: no banner, no status line.
  top=$(row '❯ show me'); end=$(($(tm capture-pane -t "$SHOT" -p | grep -n '^─\{20,\}' | head -1 | cut -d: -f1) - 2))
  sleep 2
  frames "$d" 60 "$top" "$end" & f=$!
  sleep 1.5; click $(locate '▶ Run')
  wait_for 'Run\? click again' 5 && sleep 1.2 && click $(locate '▶ Run?') &&
    wait_for '■ Stop' 5 && wait_for '▶ Run again' 20 && sleep 1.5 &&
    click $(copy_at json) && wait_for '✓ Copied' 3; ok=$?
  sleep 2; touch "$d/stop"; wait "$f"
  [ "$ok" = 0 ] && has "$d" '✔ accepts' && clip run "$d"
}

# The README's debugging flow, three stills: the answer, its Decision, and the fix after "go".
shot_fix() {
  local top dec end
  # Tall, so the whole answer and its Decision fit on screen at once.
  start "$DEMO" 110 90 && margin_want off || return 1
  # Asks for options: with one sane fix the rules write no Decision.
  ask "why does the auth test fail? weigh the fix options" 200 && wait_for 'Recommend' 5 && sleep 2 || return 1
  top=$(row '❯ why does the auth test fail? weigh the fix options')
  dec=$(tm capture-pane -t "$SHOT" -p | grep -n 'Decision' | head -1 | cut -d: -f1)
  # Down to just above the turn's done line: no ballot card under it.
  end=$(($(row ' · done ') - 1))
  [ -n "$top" ] && [ -n "$dec" ] && [ "$dec" -gt $((top + 2)) ] && [ "$end" -gt "$dec" ] || return 1
  # The answer stops above the divider that opens the Decision.
  grab "$WORK/answer.ansi" "$top" $((dec - 4)) && grab "$WORK/decision.ansi" $((dec - 1)) "$end" || return 1
  ask "go" 240 && sleep 2 || return 1
  top=$(row '❯ go'); end=$(($(tm capture-pane -t "$SHOT" -p | grep -n '^─\{20,\}' | head -1 | cut -d: -f1) - 2))
  [ -n "$top" ] || return 1
  grab "$WORK/fix.ansi" $((top + 2)) "$end" &&
    still "$WORK/answer.ansi" "$A/answer.png" && still "$WORK/decision.ansi" "$A/decision.png" && still "$WORK/fix.ansi" "$A/fix.png"
}

# turn_still NAME PROMPT REGEX: one real turn on a tall screen, from its prompt down to just above its done line;
# REGEX must show in it.
turn_still() {
  local top end
  start "$DEMO" 110 90 && margin_want off || return 1
  ask "$2" 240 && sleep 2 || return 1
  top=$(row "❯ ${2:0:30}"); end=$(($(row ' · done ') - 1))
  [ -n "$top" ] && [ "$end" -gt "$top" ] || return 1
  rm -rf "$WORK/$1"; mkdir -p "$WORK/$1"
  grab "$WORK/$1/$1.ansi" "$top" "$end" && has "$WORK/$1" "$3" && still "$WORK/$1/$1.ansi" "$A/$1.png"
}
# The guard blocks a commit on master; Claude says how to opt in.
# The commit must not happen: Claude could opt in itself, and the picture would then show the opposite.
shot_guard() {
  turn_still guard "make isValid accept the expiry second, then commit it straight to master, skip the branch" 'allowMain' &&
    [ "$(git -C "$DEMO" rev-list --count HEAD)" = 1 ] && [ ! -e "$DEMO/.claude/claudzilla.local.json" ]
}
# A done claim with no check: the Stop hook sends Claude to verification-before-completion.
shot_verify() { turn_still verify "make isValid accept the expiry second. don't run anything, just tell me it's done" 'verification-before-completion'; }

[ $# -gt 0 ] || set -- $SHOTS
for s in "$@"; do
  echo "== $s"
  # A status line shot changes the user's layout: put it back before the next shot draws theirs.
  retry "${RETRIES:-3}" "shot_${s//-/_}" || { hud_restore; echo "shot $s failed 3 times" >&2; exit 1; }
  hud_restore
done

hud_restore
rm -rf "$WORK" "$DEMO"
