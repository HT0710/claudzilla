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
check "data: no usage -> no ctx_note" [ -z "$(key ctx_note "$kv")" ]
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
used=$(node -e 'const j=JSON.parse(process.argv[1]);j.context_window.current_usage={input_tokens:2,output_tokens:830,cache_creation_input_tokens:2018,cache_read_input_tokens:414892};console.log(JSON.stringify(j))' "$full")
check "data: ctx_note used" [ "$(key ctx_note "$(data <<<"$used")")" = 417k ]
# usage <current_usage json>: ctx_note for that shape (printf: bash 3.2 brace-expands here-strings)
usage() { key ctx_note "$(printf '{"context_window":{"used_percentage":1,"current_usage":%s}}' "$1" | data)"; }
check "data: empty usage -> no note" [ -z "$(usage '{}')" ]
check "data: junk usage -> no note" [ -z "$(usage '{"input_tokens":"a","cache_read_input_tokens":{}}')" ]
check "data: string counts ignored" [ -z "$(usage '{"input_tokens":"300000"}')" ]
check "data: negative counts ignored" [ "$(usage '{"input_tokens":-5000,"cache_read_input_tokens":20000}')" = 20k ]
check "data: non-object usage -> no note" [ -z "$(usage '5')" ]
check "data: 999.5k rounds to 1M" [ "$(usage '{"input_tokens":999600}')" = 1M ]

past=$(node -e 'const j=JSON.parse(process.argv[1]);j.rate_limits.five_hour.resets_at=1;console.log(JSON.stringify(j))' "$full")
check "data: past reset -> no note" [ -z "$(key 5h_note "$(data <<<"$past")")" ]

perl -i -ne 'print unless eof' "$T"
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
kv=$(data <<<'{"model":{"display_name":"a\u001b]52;c;aGk=\u0007b"}}')
check "data: control chars dropped" [ "$(key model "$kv")" = "a ]52;c;aGk= b" ]
kv=$(data <<<'{"model":{"display_name":"a\u009d52;c;aGk=\u009cb"}}')
check "data: C1 control chars dropped" [ "$(key model "$kv")" = "a 52;c;aGk= b" ]

# --- hud-filter.pl ---
render() { data <<<"$1" | COLUMNS=120 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
out=$(render "$full")
check "render: ctx row"  grep -q '^ctx .* 42% *$' <<<"$out"
check "render: ctx used" grep -q '^ctx .* 42%  *417k$' <<<"$(render "$used")"
check "render: 5h row"   grep -q '^5h .* 30%  *2h0m$' <<<"$out"
check "render: wk row"   grep -q '^wk .* 12%  *2d7h$' <<<"$out"
check "render: profile"  grep -q 'me@example.test$' <<<"$out"
check "render: activity" grep -q '^Opus  high  ⚑ pr .*abcdef12  up 90m$' <<<"$out"
out=$(render "$nolim")
check "render: no limits -> ctx only" [ "$(grep -cE '^(ctx|5h|wk) ' <<<"$out")" -eq 1 ]

check "render: not a repo -> no branch" bash -c "! head -1 <<<'$(render "$full")' | grep -q '⎇'"
narrow=$(data <<<"$full" | COLUMNS=60 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "render: narrow fits 56 cols" [ "$(perl -CS -ne 'chomp; $m = length if length > $m; END { print $m }' <<<"$narrow")" -eq 56 ]

# row1 <cwd> [env...]: first rendered row, colours stripped, COLUMNS=60
row1() { local d=$1; shift; env "$@" CLAUDE_CONFIG_DIR="$C" node "$HUD/hud-data.mjs" <<<"{\"session_id\":\"sid-u\",\"workspace\":{\"current_dir\":\"$d\"}}" | env "$@" CLAUDE_CONFIG_DIR="$C" COLUMNS=60 perl "$HUD/hud-filter.pl" | head -1 | perl -pe 's/\e\[[0-9;]*m//g'; }
cells() { perl -CS -ne 'chomp; print length($_) + (() = /[\p{EA=W}\p{EA=F}]/g)'; }
UH="$TMP/josé"; U="$UH/tiếng-việt"; mkdir -p "$U"; git -C "$U" init -q -b "nhánh"
check "render: non-ASCII path + branch kept" grep -q '~/tiếng-việt.*nhánh' <<<"$(row1 "$U" HOME="$UH")"
CJK="$TMP/项目文件夹中文路径很长很长很长很长很长"; mkdir -p "$CJK"
check "render: wide chars fit 56 cells" [ "$(row1 "$CJK" | cells)" -le 56 ]
BAD="$TMP/bad"; mkdir -p "$BAD"; git -C "$BAD" init -q; git -C "$BAD" checkout -q -b $'bad\xff\xfeX'
check "render: non-UTF-8 branch still renders" grep -q 'bad' <<<"$(row1 "$BAD" 2>/dev/null)"
git -C "$BAD" checkout -q -b $'c1\xc2\x9b31mX'
mkdir -p "$C/sessions"; printf '{"sessionId":"sid-u","name":"n\xc2\x9d52;x"}' > "$C/sessions/1.json"
check "render: C1 in branch and session name dropped" bash -c 'printf %s "$1" | perl -ne "exit 1 if /\xc2[\x80-\x9f]/"' _ "$(row1 "$BAD" 2>/dev/null)"
rm -rf "$C/sessions"

echo "hud: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
