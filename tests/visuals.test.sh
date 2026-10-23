#!/usr/bin/env bash
# README visuals: converter, masking, demo repo.
#   bash tests/visuals.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
V="$REPO/.github/visuals"
T="$(mktemp -d)"
# Firefox runs from $HOME's view: a snap Firefox cannot read /tmp.
H="$(mktemp -d "$HOME/visuals-test.XXXXXX")"; trap 'rm -rf "$T" "$H"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }

conv() { printf '%b' "$1" > "$T/in.ansi"; shift; python3 -I "$V/ansi2html.py" "$T/in.ansi" "$T/out.html" '#d4d4d4' '#0d1117' "$@"; }

color_ok() { conv '\e[38;2;255;0;0mX\e[0m\n' && grep -q 'color:#ff0000">X<' "$T/out.html"; }
mask_width_ok() { conv 'a me@x.com b\n' --mask me@x.com && grep -q "a $(printf '%8s') b" "$T/out.html" && ! grep -q 'me@x' "$T/out.html"; }
mask_prefix_ok() { conv 'cut someone@exam\n' --mask someone@example.test && ! grep -q someone "$T/out.html"; }
mask_split_ok() { conv 'x me@\e[1mx.com\e[0m y\n' --mask me@x.com && ! grep -q 'me@' "$T/out.html"; }
osc_ok() { conv 'see \e]8;id=a1;https://x.dev\e\\Claude Code\e]8;;\e\\ now\n' && grep -q 'see Claude Code now' "$T/out.html" && ! grep -q '8;' "$T/out.html"; }
demo_fails_ok() { cp -r "$V/demo" "$T/demo" && ! node "$T/demo/auth/token.test.js" >/dev/null 2>&1; }

check "ansi2html: 24-bit fg becomes a colored span" color_ok
check "ansi2html: mask keeps width"                 mask_width_ok
check "ansi2html: masks a cut-off prefix"           mask_prefix_ok
check "ansi2html: masks across a style change"      mask_split_ok
check "ansi2html: drops OSC 8 link wrappers"        osc_ok
check "demo: test fails before the fix"             demo_fails_ok

# A fake account, so no test reads the real one.
export CLAUDE_CONFIG_DIR="$H/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
echo '{"oauthAccount":{"emailAddress":"someone@example.test"}}' > "$CLAUDE_CONFIG_DIR/.claude.json"
SHOT=visuals-test WORK="$H/ignored"
# shellcheck source=/dev/null
check "lib.sh loads" . "$V/lib.sh"
work_ok() { [ "$WORK" != "$H/ignored" ] && [ -d "$WORK" ]; }
check "lib: WORK ignores the environment" work_ok
rmdir "$WORK" 2>/dev/null; WORK="$H"
n=0
f() { n=$((n+1)); return 1; }
g() { n=$((n+1)); [ "$n" -ge 2 ]; }
retry_stop_ok() { n=0; ! retry 3 f 2>/dev/null && [ "$n" -eq 3 ]; }
retry_pass_ok() { n=0; retry 3 g 2>/dev/null && [ "$n" -eq 2 ]; }
check "retry: stops after 3"     retry_stop_ok
check "retry: passes on 2nd try" retry_pass_ok
ok() { return 0; }
finish_fail_ok() { ( finish() { return 1; }; ! retry 3 ok 2>/dev/null ); }
check "retry: fails when restore fails" finish_fail_ok
dead_ok() { ( LIVE=1 PANEL0=on; ! finish 2>"$H/dead.err" ) && grep -q 'not restored' "$H/dead.err"; }
check "finish: fails when the session died before restore" dead_ok

masks_cfg_ok() { masks | grep -qxF someone@example.test && masks | grep -qxF someone; }
masks_none_ok() { ! CLAUDE_CONFIG_DIR="$H/none" masks >/dev/null 2>&1; }
# A mid-line 8-char start of a mask string gets past ansi2html; render must refuse it.
leak_ok() { ( masks() { echo abcdefghijkl; }; printf 'id abcdefghZ x\n' > "$H/l.ansi" && ! render "$H/l.ansi" "$H/l.png" 2>/dev/null ) && [ ! -e "$H/l.png" ]; }
check "masks: reads CLAUDE_CONFIG_DIR, adds the local part" masks_cfg_ok
check "masks: fails without an account email"              masks_none_ok
check "render: refuses a frame with an unmasked prefix"     leak_ok

if command -v ffmpeg >/dev/null && python3 -I -c 'import PIL' 2>/dev/null; then
  gif_ok() {
    mkdir -p "$T/g" && ffmpeg -v error -f lavfi -i testsrc=size=1100x600:rate=2 -frames:v 12 "$T/g/%04d.png" &&
      gif "$T/g" "$T/g.gif" 2 && [ "$(wc -c < "$T/g.gif")" -le 2097152 ] && grep -q NETSCAPE2.0 "$T/g.gif" &&
      [ "$(ffprobe -v error -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$T/g.gif")" -le 12 ]
  }
  gif_budget_ok() {
    mkdir -p "$T/n" && ffmpeg -v error -f lavfi -i "nullsrc=size=1100x600:rate=2,geq=random(1)*255:128:128" -frames:v 60 "$T/n/%04d.png" &&
      { ! gif "$T/n" "$T/n.gif" 2 2>/dev/null && [ ! -e "$T/n.gif" ] || [ "$(wc -c < "$T/n.gif")" -le 2097152 ]; }
  }
  check "gif: under 2 MB, loops"  gif_ok
  check "gif: budget miss fails"  gif_budget_ok
else echo "skip: gif (no ffmpeg or PIL)"; fi

if command -v firefox >/dev/null && python3 -I -c 'import PIL' 2>/dev/null; then
  still_ok() { printf '\e[1mhello\e[0m\n' > "$H/s.ansi" && still "$H/s.ansi" "$H/s.png" && [ -s "$H/s.png" ]; }
  check "still: renders a PNG" still_ok
else echo "skip: still (no firefox or PIL)"; fi

# READMEs and assets
READMES="$REPO/README.md $(ls "$REPO"/plugins/*/README.md)"
refs() { grep -ho 'src="[^"]*\.github/assets/[^"]*"' $READMES | sed 's/.*assets\///; s/"$//' | sort -u; }
refs_exist_ok() {
  local f r ok=0
  for f in $READMES; do
    for r in $(grep -o 'src="[^"]*\.github/assets/[^"]*"' "$f" | sed 's/^src="//; s/"$//'); do
      [ -f "$(dirname "$f")/$r" ] || { echo "  missing: $f -> $r"; ok=1; }
    done
  done
  return $ok
}
assets_used_ok() {
  local a ok=0
  for a in "$REPO"/.github/assets/*; do refs | grep -qxF "$(basename "$a")" || { echo "  unused: $(basename "$a")"; ok=1; }; done
  return $ok
}
gif_size_ok() { local g; for g in "$REPO"/.github/assets/*.gif; do [ "$(wc -c < "$g")" -le 2097152 ] || return 1; done; }
# For each GIF sped up N× (speeds.txt), the line after its <img> in every README says "N× speed".
speed_ok() {
  local name n f ok=0
  while IFS=': ' read -r name n; do
    n=${n%×}; [ "$n" -gt 1 ] || continue
    for f in $READMES; do
      grep -qF "assets/$name.gif" "$f" || continue
      awk -v g="assets/$name.gif" -v want="$n× speed" 'index($0, g) { s = 1; next } s && NF { exit !index($0, want) } END { if (!s) exit 1 }' "$f" ||
        { echo "  no '$n× speed' under $name.gif in $f"; ok=1; }
    done
  done < "$REPO/.github/visuals/speeds.txt"
  return $ok
}
check "assets: every referenced asset exists" refs_exist_ok
check "assets: every asset is referenced"     assets_used_ok
check "assets: GIFs <= 2 MB"                  gif_size_ok
check "captions: speed stated"                speed_ok

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
