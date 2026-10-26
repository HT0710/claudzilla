# Capture helpers for shoot.sh: drive Claude Code in tmux, render frames, build GIFs.
# Sourced; the tmux session name is $SHOT.
V="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FG='#d4d4d4' BG='#0d1117'
SHOT=${SHOT:-shot}
# Under $HOME: a snap Firefox cannot read /tmp.
WORK=$(mktemp -d "$HOME/claudzilla-visuals.XXXXXX")
GIF_MAX=2097152

# A private tmux server: the user's tmux config and sessions stay untouched.
tm() { tmux -L claudzilla-visuals -f /dev/null "$@"; }

# start DIR COLS ROWS: fresh demo repo in DIR, Claude in a detached tmux session.
start() {
  local dir=$1
  if [ -e "$dir" ]; then
    # Only ever delete a demo repo this script made.
    [ "$(git -C "$dir" log --reverse --format=%ae 2>/dev/null | head -1)" = demo@example.com ] ||
      { echo "start: $dir exists and is not the demo repo" >&2; return 1; }
    rm -rf "$dir"
  fi
  cp -r "$V/demo" "$dir" && git -C "$dir" init -q && git -C "$dir" add -A &&
    git -C "$dir" -c user.name=demo -c user.email=demo@example.com commit -qm "feat: add token check" || return 1
  tm kill-session -t "$SHOT" 2>/dev/null
  COLS=$2 ROWS=$3
  tm new-session -d -s "$SHOT" -x "$COLS" -y "$ROWS" -c "$dir" \
    "env CLAUDE_CODE_NO_FLICKER=1 COLORTERM=truecolor TZ=UTC claude --dangerously-skip-permissions" \; \
    set -g status off \; set -g focus-events on \; set -g mouse on || return 1
  trap finish EXIT
  LIVE=1
  wait_for 'Try "' 40 || return 1
  [ "$COLS" -ge 110 ] || return 0
  [ -n "${MARGIN0:-}" ] || margin_save
  # The dock border column depends on the terminal width: saved once per width.
  dock_saved "$COLS" >/dev/null || DOCKS="$DOCKS$COLS:$(margin_open && dock_col) "
}

# wait_for TEXT SECS: poll the pane for TEXT (grep -E); 1 on timeout.
wait_for() {
  local end=$((SECONDS + $2))
  until tm capture-pane -t "$SHOT" -p | grep -E -- "$1" >/dev/null; do
    [ "$SECONDS" -lt "$end" ] || { echo "wait_for: '$1' not seen in $2 s" >&2; return 1; }
    sleep 0.5
  done
}

# say TEXT: type TEXT, then Enter; the pause keeps a long TEXT's paste from swallowing the Enter.
say() { tm send-keys -t "$SHOT" -l -- "$1" && sleep 0.5 && tm send-keys -t "$SHOT" Enter; }

# click X Y [MOD]: SGR mouse press + release at 1-based cell X,Y.
click() {
  local b=$((0 + ${3:-0}))
  tm send-keys -t "$SHOT" -l $'\e[<'"$b;$1;$2M" && tm send-keys -t "$SHOT" -l $'\e[<'"$b;$1;$2m"
}

# locate TEXT [MAXCOL]: prints the 1-based "X Y" cell of TEXT's last match on screen left of MAXCOL.
locate() {
  tm capture-pane -t "$SHOT" -p | python3 -I -c '
import sys
t, m, hit = sys.argv[1], int(sys.argv[2]), None
for y, l in enumerate(sys.stdin, 1):
    x = l.find(t)
    if 0 <= x and x + len(t) <= m: hit = (x + 1, y)
if not hit: sys.exit(1)
print(*hit)' "$1" "${2:-100000}"
}

# row TEXT: 0-based row of TEXT's last match on screen.
row() { tm capture-pane -t "$SHOT" -p | grep -nF -- "$1" | tail -1 | cut -d: -f1 | awk '{ print $1 - 1 }'; }

# grab FILE [START [END]]: pane with colors, rows START..END (0 = top).
grab() { tm capture-pane -t "$SHOT" -e -N -p ${2:+-S "$2"} ${3:+-E "$3"} > "$1"; }

# frames DIR SECS [START [END]]: grab every 0.5 s for SECS or until DIR/stop exists. Run in the background.
frames() {
  local dir=$1 i=0 end=$((SECONDS + $2))
  mkdir -p "$dir"
  while [ "$SECONDS" -lt "$end" ] && [ ! -e "$dir/stop" ]; do
    i=$((i + 1)); grab "$(printf '%s/%04d.ansi' "$dir" "$i")" "${3:-}" "${4:-}"; sleep 0.5
  done
}

# masks: private strings to blank in every frame; fails with no account email to mask.
# The status line reads the email from the same file (claude/hud/hud-data.mjs).
masks() {
  local e
  e=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1])).get("oauthAccount",{}).get("emailAddress",""))' \
    "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json" 2>/dev/null)
  [ -n "$e" ] || { echo "masks: no account email found" >&2; return 1; }
  # A narrow status line shows only the part before @.
  printf '%s\n' "$e" "${e%@*}" "$USER" "$(hostname)" "$HOME"
}

# leaks HTML: any mask string, or the first 8 characters of a longer one, in HTML.
leaks() {
  local m p hit=1
  while IFS= read -r m; do
    for p in "$m" "${m:0:8}"; do
      [ "${#p}" -ge 6 ] && grep -qF -- "$p" "$1" && { echo "leak: ${p:0:3}… in $1" >&2; hit=0; }
    done
  done < <(masks)
  return $hit
}

# render ANSI PNG: masked HTML, then a full-window Firefox screenshot (uncropped).
render() {
  local html=${1%.ansi}.html m ms args=()
  ms=$(masks) || return 1
  while IFS= read -r m; do args+=(--mask "$m"); done <<< "$ms"
  python3 -I "$V/ansi2html.py" "$1" "$html" "$FG" "$BG" "${args[@]}" || return 1
  ! leaks "$html" || return 1
  mkdir -p "$WORK/prof"
  timeout 90 firefox --headless --no-remote --profile "$WORK/prof" --window-size=2000,1400 \
    --screenshot "$2" "file://$html" >/dev/null 2>&1
  [ -s "$2" ]
}

# bbox PNG...: prints "w:h:x:y", the union of all frames' non-background boxes plus 20 px.
bbox() {
  python3 -I - "$BG" "$@" <<'EOF'
import sys
from PIL import Image, ImageChops
bg = tuple(int(sys.argv[1][i:i + 2], 16) for i in (1, 3, 5))
x0 = y0 = 10**9; x1 = y1 = 0
for f in sys.argv[2:]:
    im = Image.open(f).convert("RGB")
    b = ImageChops.difference(im, Image.new("RGB", im.size, bg)).getbbox()
    if b:
        x0, y0, x1, y1 = min(x0, b[0]), min(y0, b[1]), max(x1, b[2]), max(y1, b[3])
w, h = im.size
x0, y0, x1, y1 = max(0, x0 - 20), max(0, y0 - 20), min(w, x1 + 20), min(h, y1 + 20)
print(f"{x1 - x0}:{y1 - y0}:{x0}:{y0}")
EOF
}

# still ANSI PNG: render, crop to content.
still() {
  local raw=${2%.png}.raw.png c
  render "$1" "$raw" && c=$(bbox "$raw") &&
    ffmpeg -v error -y -i "$raw" -vf "crop=$c" "$2" && rm -f "$raw"
}

# gif DIR OUT SPEED: DIR holds 0.5 s frames (NNNN.ansi or NNNN.png); OUT plays them SPEED× faster,
# looping. Over GIF_MAX, it keeps every 2nd, then 4th frame (same pace); still over → 1, no OUT.
gif() {
  local dir=$1 out=$2 speed=$3 f prev= step c rate
  for f in "$dir"/*.ansi; do
    [ -e "$f" ] || break
    if [ -n "$prev" ] && cmp -s "$f" "$prev"; then cp "${prev%.ansi}.png" "${f%.ansi}.png"
    else render "$f" "${f%.ansi}.png" || return 1; fi
    prev=$f
  done
  c=$(bbox "$dir"/*.png) || return 1
  for step in 1 2 4; do
    rate=$(python3 -I -c "print(2 * $speed / $step)")
    ffmpeg -v error -y -framerate "$rate" -pattern_type glob -i "$dir/*.png" -loop 0 \
      -vf "select='not(mod(n\,$step))',setpts=N/($rate*TB),crop=$c,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
      -r "$rate" "$out" || return 1
    [ "$(wc -c < "$out")" -le "$GIF_MAX" ] && return 0
  done
  echo "gif: $out over $GIF_MAX bytes at every frame step" >&2
  rm -f "$out"; return 1
}

# retry N CMD...: run CMD until it exits 0, at most N times; restores the user's state after each try.
retry() {
  local _max=$1 _try; shift
  for ((_try = 1; _try <= _max; _try++)); do
    "$@" && { finish; return; }
    echo "retry: $* failed ($_try/$_max)" >&2
    grab "$WORK/failed.$_try.ansi" 2>/dev/null
    finish || return 1   # the user's panel or dock is off: stop before another paid try
  done
  return 1
}

margin_open() { tm capture-pane -t "$SHOT" -p | grep 'Overview.*Decisions' >/dev/null; }
# The panel opens a few seconds after the prompt when the user left it open; a slow start must not read as closed.
margin_save() { if wait_for 'Overview.*Decisions' 25 2>/dev/null; then MARGIN0=on; else MARGIN0=off; fi; }
# margin_want on|off
margin_want() {
  local now=off; margin_open && now=on
  [ "$now" = "$1" ] && return 0
  tm send-keys -t "$SHOT" M-h
  if [ "$1" = on ]; then wait_for 'Overview.*Decisions' 10; else sleep 1; ! margin_open; fi
}
# Under 110 columns the panel cannot dock, so its state cannot be read or set here.
margin_restore() { [ -z "${MARGIN0:-}" ] || [ "${COLS:-0}" -lt 110 ] || margin_want "$MARGIN0"; }

# dock_col: 0-based column of the dock's left border (the column of │ on most rows); empty if none.
dock_col() {
  tm capture-pane -t "$SHOT" -p | python3 -I -c '
import sys, collections
rows = sys.stdin.read().split("\n")
c = collections.Counter(i for l in rows for i, ch in enumerate(l) if ch == "│")
if c:
    col, n = c.most_common(1)[0]
    if n >= len(rows) // 2: print(col)'
}
# Saved border columns as " COLS:COL ..." (bash 3.2 on macOS has no associative arrays).
DOCKS=" "
# dock_saved COLS: prints the column saved for COLS (empty when the panel was closed); 1 if none saved.
dock_saved() { case "$DOCKS" in *" $1:"*) local x=${DOCKS#* $1:}; echo "${x%% *}" ;; *) return 1 ;; esac; }
# Focus the dock, then ctrl+x left/right move its border 4 columns per press.
dock_restore() {
  local want now i
  want=$(dock_saved "${COLS:-0}")
  [ -n "$want" ] || return 0
  tm send-keys -t "$SHOT" C-x Tab
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
    now=$(dock_col); [ -n "$now" ] || break
    if [ "$now" -gt "$want" ]; then tm send-keys -t "$SHOT" C-x Left
    elif [ "$now" -lt "$want" ]; then tm send-keys -t "$SHOT" C-x Right
    else break; fi
    sleep 0.4
  done
  [ "$(dock_col)" = "$want" ] || { echo "dock_restore: border at $(dock_col), wanted $want" >&2; return 1; }
}

# finish: put the user's dock width and panel state back, end the session; 1 if that failed.
finish() {
  if ! tm has-session -t "$SHOT" 2>/dev/null; then
    [ -n "${LIVE:-}" ] || return 0
    LIVE=; echo "finish: session $SHOT ended early; panel and dock width not restored, check them" >&2; return 1
  fi
  local ok=0
  [ -z "$(dock_saved "${COLS:-0}")" ] || { margin_want on && dock_restore; } || ok=1
  margin_restore || ok=1
  tm kill-session -t "$SHOT"; LIVE=
  return $ok
}
