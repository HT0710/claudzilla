#!/usr/bin/env bash
# Offline HUD tests: fixture payload + transcript through hud-data.mjs and hud-filter.pl.
#   bash tests/hud.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HUD="$REPO/claude/hud"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
iso() { node -p "new Date(Date.now() - $1 * 1000).toISOString()"; }
now=$(date +%s)

# transcript: session started 90 min ago; skill "old" then "pr"; thinking 5s ago
T="$TMP/t.jsonl"
{
  echo '{"type":"mode","mode":"normal"}'
  echo "{\"timestamp\":\"$(iso 5400)\",\"message\":{\"content\":\"hi\"}}"
  echo "{\"timestamp\":\"$(iso 600)\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"a\",\"name\":\"Skill\",\"input\":{\"skill\":\"old\"}}]}}"
  echo "{\"timestamp\":\"$(iso 60)\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"b\",\"name\":\"Skill\",\"input\":{\"skill\":\"pr\"}}]}}"
  echo "{\"timestamp\":\"$(iso 5)\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"\"}]}}"
} > "$T"
C="$TMP/cfg"; mkdir -p "$C"; echo '{"oauthAccount":{"emailAddress":"me@example.test"}}' > "$C/.claude.json"

full=$(cat <<JSON
{"session_id":"abcdef1234567890","workspace":{"current_dir":"$TMP"},"transcript_path":"$T",
 "model":{"display_name":"Opus"},"effort":{"level":"high"},
 "context_window":{"used_percentage":42.4,"context_window_size":1000000},
 "rate_limits":{"five_hour":{"used_percentage":30,"resets_at":$((now + 7200 + 30))},
                "seven_day":{"used_percentage":12,"resets_at":$(( (now + 200000) * 1000 ))}}}
JSON
)
data() { CLAUDE_CONFIG_DIR="$C" node "$HUD/hud-data.mjs"; }
key() { awk -F'\t' -v k="$1" '$1==k{print $2}' <<<"$2"; }

# --- hud-data.mjs ---
kv=$(data <<<"$full")
check "data: id"        [ "$(key id "$kv")" = abcdef12 ]
check "data: sid"       [ "$(key sid "$kv")" = abcdef1234567890 ]
check "data: cwd"       [ "$(key cwd "$kv")" = "$TMP" ]
check "data: model"     [ "$(key model "$kv")" = Opus ]
check "data: effort"    [ "$(key effort "$kv")" = high ]
check "data: ctx"       [ "$(key ctx "$kv")" = 42 ]
check "data: ctx_note"  [ "$(key ctx_note "$kv")" = 1M ]
check "data: 5h"        [ "$(key 5h "$kv")" = 30 ]
check "data: 5h_note"   [ "$(key 5h_note "$kv")" = 2h0m ]
check "data: wk"        [ "$(key wk "$kv")" = 12 ]
check "data: wk_note ms" [ "$(key wk_note "$kv")" = 2d7h ]
check "data: profile"   [ "$(key profile "$kv")" = me@example.test ]
check "data: up"        [ "$(key up "$kv")" = 90m ]
check "data: last skill" [ "$(key skill "$kv")" = pr ]
check "data: thinking recent" [ "$(key thinking "$kv")" = 1 ]

nolim=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits;j.context_window.context_window_size=200000;console.log(JSON.stringify(j))' "$full")
kv=$(data <<<"$nolim")
check "data: no limits -> no 5h" [ -z "$(key 5h "$kv")" ]
check "data: no limits -> no wk" [ -z "$(key wk "$kv")" ]
check "data: 200k note" [ "$(key ctx_note "$kv")" = 200k ]

past=$(node -e 'const j=JSON.parse(process.argv[1]);j.rate_limits.five_hour.resets_at=1;console.log(JSON.stringify(j))' "$full")
check "data: past reset -> no note" [ -z "$(key 5h_note "$(data <<<"$past")")" ]

sed -i '$d' "$T"
echo "{\"timestamp\":\"$(iso 120)\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"\"}]}}" >> "$T"
check "data: thinking stale" [ -z "$(key thinking "$(data <<<"$full")")" ]

check "data: garbage stdin exit 0" bash -c "echo nope | node '$HUD/hud-data.mjs' >/dev/null"
check "data: missing transcript" bash -c "echo '{\"session_id\":\"x\",\"transcript_path\":\"/nope\"}' | node '$HUD/hud-data.mjs' | grep -q '^id	x$'"

check "data: no context_window -> ctx 0" [ "$(key ctx "$(data <<<'{"cwd":"/x"}')")" = 0 ]
check "data: cwd fallback" [ "$(key cwd "$(data <<<'{"cwd":"/x"}')")" = /x ]
check "data: tab in value flattened" [ "$(key model "$(data <<<'{"model":{"display_name":"a\tb"}}')")" = "a b" ]

# big transcript: head cut and tail cut both land mid-file
B="$TMP/big.jsonl"
{ echo "{\"timestamp\":\"$(iso 120)\"}"
  node -e 'const l=JSON.stringify({pad:"x".repeat(1000)})+"\n";process.stdout.write(l.repeat(5000))'
  echo "{\"timestamp\":\"$(iso 1)\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"c\",\"name\":\"Skill\",\"input\":{\"skill\":\"big\"}}]}}"
} > "$B"
kv=$(data <<<"{\"transcript_path\":\"$B\"}")
check "data: big transcript up"    [ "$(key up "$kv")" = 2m ]
check "data: big transcript skill" [ "$(key skill "$kv")" = big ]

# --- hud-filter.pl ---
render() { data <<<"$1" | COLUMNS=120 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
out=$(render "$full")
check "render: ctx row"  grep -q '^ctx .* 42%  *1M$' <<<"$out"
check "render: 5h row"   grep -q '^5h .* 30%  *2h0m$' <<<"$out"
check "render: wk row"   grep -q '^wk .* 12%  *2d7h$' <<<"$out"
check "render: profile"  grep -q 'me@example.test$' <<<"$out"
check "render: activity" grep -q '^Opus  high  ⚑ pr .*abcdef12  up 90m$' <<<"$out"
out=$(render "$nolim")
check "render: no limits -> ctx only" [ "$(grep -cE '^(ctx|5h|wk) ' <<<"$out")" -eq 1 ]

check "render: not a repo -> no branch" bash -c "! head -1 <<<'$(render "$full")' | grep -q '⎇'"
narrow=$(data <<<"$full" | COLUMNS=60 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "render: narrow fits 56 cols" [ "$(perl -CS -ne 'chomp; $m = length if length > $m; END { print $m }' <<<"$narrow")" -eq 56 ]

echo "hud: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
