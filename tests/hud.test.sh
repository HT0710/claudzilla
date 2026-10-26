#!/usr/bin/env bash
# Offline HUD tests: fixture payload + transcript through hud-data.mjs and hud-filter.pl.
#   bash tests/hud.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HUD="$REPO/claude/hud"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# keep every run (state files, trace) out of the real home
export TMPDIR="$TMP" CLAUDE_CONFIG_DIR="$TMP/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
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
C="$TMP/cfg"; mkdir -p "$C"; echo '{"oauthAccount":{"emailAddress":"alex.smith@example.test"}}' > "$C/.claude.json"

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
check "data: profile"   [ "$(key profile "$kv")" = a…h@example.test ]
C2="$TMP/cfg2"; mkdir -p "$C2"; echo '{"oauthAccount":{"emailAddress":"me@example.test"}}' > "$C2/.claude.json"
check "data: short profile -> first char only" [ "$(key profile "$(CLAUDE_CONFIG_DIR="$C2" node "$HUD/hud-data.mjs" <<<"$full")")" = m…@example.test ]
check "data: up"        [ "$(key up "$kv")" = 90m ]
check "data: last skill" [ "$(key skill "$kv")" = pr ]
check "data: thinking recent" [ "$(key thinking "$kv")" = 1 ]

nolim=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits;j.context_window.context_window_size=200000;console.log(JSON.stringify(j))' "$full")
kv=$(data <<<"$nolim")
check "data: no limits -> no 5h" [ -z "$(key 5h "$kv")" ]
check "data: no limits -> no wk" [ -z "$(key wk "$kv")" ]
used=$(node -e 'const j=JSON.parse(process.argv[1]);j.context_window.current_usage={input_tokens:2,output_tokens:830,cache_creation_input_tokens:2018,cache_read_input_tokens:414892};console.log(JSON.stringify(j))' "$full")
check "data: no reply yet -> ctx_note 0" [ "$(key ctx_note "$(data <<<'{}')")" = 0 ]
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
gone=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits.five_hour;console.log(JSON.stringify(j))' "$full")
kv=$(data <<<"$gone")
check "data: dropped window -> 5h 0" [ "$(key 5h "$kv")" = 0 ]
check "data: dropped window -> no note" [ -z "$(key 5h_note "$kv")" ]
kv=$(data <<<'{"rate_limits":{"spend_limit":{"used_percentage":5}}}')
check "data: spend limit only -> no 5h" [ -z "$(key 5h "$kv")" ]
check "data: spend limit only -> no wk" [ -z "$(key wk "$kv")" ]
kv=$(data <<<'{"rate_limits":{"five_hour":{"used_percentage":null,"resets_at":9999999999}}}')
check "data: null pct -> no 5h_note" [ -z "$(key 5h_note "$kv")" ]

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
# cache: newest main-chat reply with tokens starts the clock; TTL from the newest reply that wrote cache
reply() { # <secs ago> <5m written> <1h written> [sidechain]
  echo "{\"type\":\"assistant\",\"isSidechain\":${4:-false},\"timestamp\":\"$(iso "$1")\",\"message\":{\"usage\":{\"input_tokens\":2,\"cache_read_input_tokens\":9000,\"cache_creation_input_tokens\":$(($2 + $3)),\"cache_creation\":{\"ephemeral_5m_input_tokens\":$2,\"ephemeral_1h_input_tokens\":$3}}}}"
}
# cache -> "<percent of TTL used> <note>"
cache() { printf '%s\n' "$@" > "$TMP/c.jsonl"; kv=$(data <<<"{\"transcript_path\":\"$TMP/c.jsonl\"}"); [ -n "$(key cch "$kv")" ] && echo "$(key cch "$kv") $(key cch_note "$kv")"; }
check "data: cache 1h warm"     [ "$(cache "$(reply 1200 0 500)")" = "33 40m" ]
check "data: cache 5m warm"     [ "$(cache "$(reply 120 500 0)")" = "40 3m" ]
check "data: cache 1h cold"     [ "$(cache "$(reply 3660 0 500)")" = "100 cold" ]
check "data: cache read keeps earlier TTL" [ "$(cache "$(reply 1800 0 500)" "$(reply 600 0 0)")" = "16 50m" ]
check "data: cache sidechain ignored" [ "$(cache "$(reply 1800 0 500)" "$(reply 60 500 0 true)")" = "50 30m" ]
synthetic="{\"type\":\"assistant\",\"timestamp\":\"$(iso 10)\",\"message\":{\"model\":\"<synthetic>\",\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"cache_read_input_tokens\":0,\"cache_creation_input_tokens\":0}}}"
check "data: cache synthetic reply ignored" [ "$(cache "$(reply 1800 0 500)" "$synthetic")" = "50 30m" ]
check "data: cache future reply clamps to fresh" [ "$(cache "$(reply -60 0 500)")" = "0 60m" ]
check "data: cache seconds left not shown as 100%" [ "$(cache "$(reply 3595 0 500)")" = "99 1m" ]
check "data: cache reply but no write -> cold" [ "$(cache "$(reply 600 0 0)")" = "100 cold" ]
check "data: cache no reply -> hot" [ "$(key cch "$(data <<<"$full")") $(key cch_note "$(data <<<"$full")")" = "0 hot" ]

kv=$(data <<<'{"model":{"display_name":"a\u001b]52;c;aGk=\u0007b"}}')
check "data: control chars dropped" [ "$(key model "$kv")" = "a ]52;c;aGk= b" ]
kv=$(data <<<'{"model":{"display_name":"a\u009d52;c;aGk=\u009cb"}}')
check "data: C1 control chars dropped" [ "$(key model "$kv")" = "a 52;c;aGk= b" ]

# --- hud-filter.pl ---
render() { data <<<"$1" | COLUMNS=120 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
out=$(render "$full")
# meters in two columns: ctx over cache | 5h over wk; no reply yet shows the cache hot
check "render: ctx | 5h row" grep -q '^ctx .* 42%  *┃ 5h  .* 30%  *2h0m$' <<<"$out"
check "render: ctx used" grep -q '^ctx .* 42%  *417k ┃ 5h ' <<<"$(render "$used")"
check "render: no reply -> hot cch | wk row" grep -q '^cch .*   0%  hot ┃ wk  .* 12%  *2d7h$' <<<"$out"
check "render: profile"  grep -qE 'a…h@example\.test(  v[0-9.]+)?$' <<<"$out"
check "render: activity" grep -q '^Opus  high  ⚑ pr .*abcdef12  up 90m$' <<<"$out"
printf '%s\n' "$(reply 1200 0 500)" >> "$T"
out=$(render "$full")
check "render: cch | wk row" grep -q '^cch .* 33%  40m ┃ wk  .* 12%  2d7h$' <<<"$out"
check "render: two meter rows" [ "$(grep -cE '(^|┃ )(ctx|cch|5h|wk) ' <<<"$out")" -eq 2 ]
check "render: cache not in bottom row" bash -c "! tail -1 <<<'$out' | grep -q cch"
# colours: pick a session id whose highlight sweep is resting now (hud-filter.pl \$OFF, 30 s sweep in 90)
rest=$(perl -e 'for my $i (0..999) { my $id = "r$i"; my $o = 0; $o = ($o * 31 + ord) % 3600 for split //, $id; my $t = (time() + $o) % 90; if ($t >= 35 && $t <= 80) { print $id; last } }')
raw() { data <<<"{\"session_id\":\"$rest\",\"transcript_path\":\"$TMP/c.jsonl\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":30}}}" | COLUMNS=120 perl "$HUD/hud-filter.pl"; }
cache "$(reply 0 0 500)" >/dev/null
check "render: fresh cache one blue bar" grep -q $'cch \e\\[38;2;36;58;93m▬[^\e ]*   0%' <<<"$(raw)"
cache "$(reply 1800 0 500)" >/dev/null
check "render: half cache one light blue bar" grep -q $'cch \e\\[38;2;146;188;228m▬[^\e ]*  50%' <<<"$(raw)"
cache "$(reply 3660 0 500)" >/dev/null
check "render: cold cache one orange bar" grep -q $'cch \e\\[38;2;255;170;90m▬[^\e ]* 100%  \e\\[38;2;64;71;80mcold' <<<"$(raw)"
out=$(render "$nolim")
check "render: no limits -> ctx only" [ "$(grep -cE '^(ctx|5h|wk) ' <<<"$out")" -eq 1 ]
check "render: no limits -> cache below ctx, no divider" bash -c "grep -q '^cch .* 33%  *40m$' <<<'$out' && ! grep -q '┃' <<<'$out'"

check "render: not a repo -> no branch" bash -c "! head -1 <<<'$(render "$full")' | grep -q '⎇'"
narrow=$(data <<<"$full" | COLUMNS=60 perl "$HUD/hud-filter.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "render: narrow fits 56 cols" [ "$(perl -CS -ne 'chomp; $m = length if length > $m; END { print $m }' <<<"$narrow")" -eq 56 ]

# row1 <cwd> [env...]: first rendered row, colours stripped, COLUMNS=60
row1() { local d=$1; shift; env "$@" CLAUDE_CONFIG_DIR="$C" node "$HUD/hud-data.mjs" <<<"{\"session_id\":\"sid-u\",\"workspace\":{\"current_dir\":\"$d\"}}" | env "$@" CLAUDE_CONFIG_DIR="$C" COLUMNS=60 perl "$HUD/hud-filter.pl" | head -1 | perl -pe 's/\e\[[0-9;]*m//g'; }
cells() { perl -CS -ne 'chomp; print length($_) + (() = /[\p{EA=W}\p{EA=F}]/g)'; }
UH="$TMP/josé"; U="$UH/tiếng-việt"; mkdir -p "$U"; git -C "$U" init -q -b "nhánh"
check "render: non-ASCII path + branch kept" grep -q '~/tiếng-việt.*nhánh' <<<"$(row1 "$U" HOME="$UH")"
touch "$C/.claudzilla-basic-glyphs"
basic=$(CLAUDE_CONFIG_DIR="$C" render "$full")
check "render basic: meter uses ■□" bash -c "grep -q '^ctx ■' <<<'$basic' && ! grep -q '[▰▱]' <<<'$basic'"
check "render basic: skill uses ▸" grep -q '^Opus  high  ▸ pr ' <<<"$basic"
check "render basic: cache bar uses ■" grep -q $'cch \e\\[[0-9;]*m■' <<<"$(CLAUDE_CONFIG_DIR="$C" raw)"
check "render basic: branch uses ›" bash -c "grep -q '› nhánh' <<<'$(row1 "$U" HOME="$UH")'"
rm "$C/.claudzilla-basic-glyphs"
CJK="$TMP/项目文件夹中文路径很长很长很长很长很长"; mkdir -p "$CJK"
check "render: wide chars fit 56 cells" [ "$(row1 "$CJK" | cells)" -le 56 ]
BAD="$TMP/bad"; mkdir -p "$BAD"; git -C "$BAD" init -q; git -C "$BAD" checkout -q -b $'bad\xff\xfeX'
check "render: non-UTF-8 branch still renders" grep -q 'bad' <<<"$(row1 "$BAD" 2>/dev/null)"
git -C "$BAD" checkout -q -b $'c1\xc2\x9b31mX'
mkdir -p "$C/sessions"; printf '{"sessionId":"sid-u","name":"n\xc2\x9d52;x"}' > "$C/sessions/1.json"
check "render: C1 in branch and session name dropped" bash -c 'printf %s "$1" | perl -ne "exit 1 if /\xc2[\x80-\x9f]/"' _ "$(row1 "$BAD" 2>/dev/null)"
rm -rf "$C/sessions"

# claudzilla version: the last release tag, or the tag CI would cut next (.github/next-version.sh) when ahead of it
R="$TMP/zilla"; mkdir -p "$R/claude/hud" "$R/.github"
cp "$HUD/hud-filter.pl" "$R/claude/hud/"; cp "$REPO/.github/next-version.sh" "$R/.github/"
g() { git -C "$R" -c user.name=t -c user.email=t@t "$@"; }
ver() { data <<<"$full" | COLUMNS=120 perl "$R/claude/hud/hud-filter.pl" | head -1 | perl -pe 's/\e\[[0-9;]*m//g'; }
g init -q -b main; g commit -q --allow-empty -m a
check "render: no tags -> no version" grep -q 'a…h@example.test$' <<<"$(ver)"
g tag v9.9.9
check "render: on release tag -> tag far right" grep -q 'a…h@example.test  v9.9.9$' <<<"$(ver)"
g commit -q --allow-empty -m 'docs: x'
check "render: no release due -> last tag" grep -q 'a…h@example.test  v9.9.9$' <<<"$(ver)"
g commit -q --allow-empty -m 'feat(hud): x'
check "render: ahead with feat -> next minor" grep -q 'a…h@example.test  v9.10.0$' <<<"$(ver)"
g tag backup
check "render: non-release tag ignored" grep -q 'a…h@example.test  v9.10.0$' <<<"$(ver)"

# --- trace: hud.change only when the output changes ---
TRC="$TMP/trcfg"; TRT="$TMP/trtmp"; mkdir -p "$TRC" "$TRT"; TR="$TMP/trrepo"; mkdir -p "$TR"
git -C "$TR" init -q -b main
trun() { printf '{"session_id":"trs1","workspace":{"current_dir":"%s"},"model":{"display_name":"Opus"}}' "$TR" |
  CLAUDE_CONFIG_DIR="$TRC" TMPDIR="$TRT" COLUMNS=120 node "$HUD/hud-data.mjs" | CLAUDE_CONFIG_DIR="$TRC" TMPDIR="$TRT" COLUMNS=120 perl "$HUD/hud-filter.pl"; }
TRF="$TRC/claudzilla-trace/trs1.hud.jsonl"
trun >/dev/null; trun >/dev/null
check "trace hud: same payload twice -> one hud.change" [ "$(grep -c '"event":"hud.change"' "$TRF")" -eq 1 ]
git -C "$TR" checkout -q -b feat/x; trun >/dev/null
check "trace hud: branch change -> second entry" [ "$(grep -c '"event":"hud.change"' "$TRF")" -eq 2 ]
check "trace hud: entry names the new branch" bash -c "tail -1 '$TRF' | grep -q 'feat/x'"
check "trace hud: part is hud" grep -q '"part":"hud"' "$TRF"
rm -rf "$TRC/claudzilla-trace" "$TRT"; a=$(trun); ac=$?; rm -rf "$TRC/claudzilla-trace" "$TRT"; : > "$TRC/claudzilla-trace"; b=$(trun); bc=$?
# cwd colours drift with the clock (hud-filter.pl $DRIFT): compare text only
check "trace hud: output unchanged with unwritable trace" [ "$(perl -pe 's/\e\[[0-9;]*m//g' <<<"$a")" = "$(perl -pe 's/\e\[[0-9;]*m//g' <<<"$b")" ]
check "trace hud: exit code unchanged with unwritable trace" [ "$ac" = "$bc" ]

echo "hud: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
