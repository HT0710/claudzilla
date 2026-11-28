#!/usr/bin/env bash
# Offline HUD tests: fixture payload + transcript through hud.pl.
#   bash tests/hud.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HUD="$REPO/claude/hud"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# keep every run (state files, trace) out of the real home
export TMPDIR="$TMP" CLAUDE_CONFIG_DIR="$TMP/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL
. "$REPO/tests/lib.sh"
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
# time and localtime frozen, so the clock repeats run to run
PL="$TMP/perl"; mkdir -p "$PL"
cat > "$PL/Frozen.pm" <<'EOF'
package Frozen;
BEGIN { my $t = $ENV{FROZEN_TIME}; *CORE::GLOBAL::time = sub () { $t }; *CORE::GLOBAL::localtime = sub (;$) { CORE::localtime(@_ ? $_[0] : $t) } }
1;
EOF

full=$(cat <<JSON
{"session_id":"abcdef1234567890","workspace":{"current_dir":"$TMP"},"transcript_path":"$T",
 "model":{"display_name":"Opus"},"effort":{"level":"high"},
 "context_window":{"used_percentage":42.4,"context_window_size":1000000},
 "rate_limits":{"five_hour":{"used_percentage":30,"resets_at":$((now + 7200 + 30))},
                "seven_day":{"used_percentage":12,"resets_at":$(( (now + 200000) * 1000 ))}}}
JSON
)
data() { CLAUDE_CONFIG_DIR="$C" HUD_DUMP=1 perl "$HUD/hud.pl"; }
key() { awk -F'\t' -v k="$1" '$1==k{print $2}' <<<"$2"; }
T0=1795845600                                                            # 2026-11-28 06:00:00 UTC
apiful='{"session_id":"api1","cost":{"total_cost_usd":1.24},"model":{"display_name":"Opus"}}'
# seed S, the ledger at T0: 4.18 at 00:30 and 0.62 at 05:20 today; Nov 1 91.60, Nov 28 4.80
printf 'slot\t1795825800\t4.18\nslot\t1795843200\t0.62\nday\t2026-11-01\t91.60\nday\t2026-11-28\t4.80\n' > "$TMP/seed-S.tsv"
# api_kv <config dir> [payload]: KV of one API tick at AT (default T0), in ZONE (default UTC)
api_kv() { printf '%s' "${2:-$apiful}" | FROZEN_TIME=${AT:-$T0} TZ=${ZONE:-UTC} PERL5LIB="$PL" ANTHROPIC_API_KEY=x CLAUDE_CONFIG_DIR="$1" HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl"; }
# seedS: fresh config dir holding seed S, prints its path
seedS() { local d; d=$(mktemp -d -p "$TMP"); cp "$TMP/seed-S.tsv" "$d/claudzilla-spend.tsv"; echo "$d"; }
# api_raw <cols> [layout]: rendered API frame with colours; api_row strips them
api_raw() { local d; d=$(seedS); [ -n "${2:-}" ] && echo "{\"hud\":{\"layout\":\"$2\"}}" > "$d/claudzilla.json"; api_kv "$d" | FROZEN_TIME=${AT:-$T0} TZ=${ZONE:-UTC} PERL5LIB="$PL" COLUMNS=$1 HUD_KV=1 perl -MFrozen "$HUD/hud.pl"; }
api_row() { api_raw "$@" | perl -pe 's/\e\[[0-9;]*m//g'; }
# spend_at <epoch> <cost> <sid> <config dir>: one API tick at a frozen time; ZONE sets TZ (default UTC)
spend_at() { printf '{"session_id":"%s","cost":{"total_cost_usd":%s}}' "$3" "$2" | ANTHROPIC_API_KEY=x FROZEN_TIME=$1 TZ=${ZONE:-UTC} PERL5LIB="$PL" CLAUDE_CONFIG_DIR="$4" HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl"; }
usd() { printf '%.2f' "$(key "$1" "$2")"; }   # usd <key> <kv>: two decimals

# --- hud.pl: data ---
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
check_eq "data: wk_note ms" 2d7h "$(key wk_note "$kv")"
check "data: profile"   [ "$(key profile "$kv")" = a…h@example.test ]
C2="$TMP/cfg2"; mkdir -p "$C2"; echo '{"oauthAccount":{"emailAddress":"me@example.test"}}' > "$C2/.claude.json"
check "data: short profile -> first char only" [ "$(key profile "$(CLAUDE_CONFIG_DIR="$C2" HUD_DUMP=1 perl "$HUD/hud.pl" <<<"$full")")" = m…@example.test ]
check "data: up"        [ "$(key up "$kv")" = 90m ]
check_eq "data: last skill" pr "$(key skill "$kv")"
check_eq "data: thinking recent" 1 "$(key thinking "$kv")"
mkdir -p "$TMP/noacct" "$TMP/badacct" "$TMP/apiacct" "$TMP/arracct" "$TMP/nullacct"
echo '{"oauthAccount":null}' > "$TMP/nullacct/.claude.json"
echo '{}' > "$TMP/apiacct/.claude.json"; echo '{bad' > "$TMP/badacct/.claude.json"; echo '[]' > "$TMP/arracct/.claude.json"
norl=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits;console.log(JSON.stringify(j))' "$full")  # rate_limits mean subscription, so API-mode checks omit them
check_eq "login: subscription sends no login" "" "$(key login "$(data <<<"$full")")"
check_eq "login: key overrides OAuth" "api key" "$(key login "$(ANTHROPIC_API_KEY=x data <<<"$norl")")"
check_eq "login: API mode drops the email" "" "$(key profile "$(ANTHROPIC_API_KEY=x data <<<"$norl")")"
check_eq "login: auth token counts" "api key" "$(key login "$(ANTHROPIC_AUTH_TOKEN=x data <<<"$norl")")"
check_eq "login: key with rate_limits stays subscription" "" "$(key login "$(ANTHROPIC_API_KEY=x data <<<"$full")")"
check_eq "login: key with rate_limits keeps the 5h meter" 30 "$(key 5h "$(ANTHROPIC_API_KEY=x data <<<"$full")")"
check_eq "login: token with rate_limits stays subscription" "" "$(key login "$(ANTHROPIC_AUTH_TOKEN=x data <<<"$full")")"
check_eq "login: empty key is no key" "" "$(key login "$(ANTHROPIC_API_KEY= data <<<"$full")")"
check_eq "login: cost field but no .claude.json stays subscription" "" "$(key login "$(C="$TMP/noacct" data <<<"$apiful")")"
check_eq "login: malformed .claude.json stays subscription" "" "$(key login "$(C="$TMP/badacct" data <<<"$apiful")")"
check_eq "login: .claude.json that is not an object stays subscription" "" "$(key login "$(C="$TMP/arracct" data <<<"$apiful")")"
check_eq "login: null oauthAccount stays subscription" "" "$(key login "$(C="$TMP/nullacct" data <<<"$apiful")")"
check_eq "login: parsed, no oauthAccount, cost field gives API mode" "api key" "$(key login "$(C="$TMP/apiacct" data <<<"$apiful")")"
check_eq "login: parsed, no oauthAccount, no cost field stays subscription" "" "$(key login "$(C="$TMP/apiacct" data <<<"$full")")"
check_eq "login: OAuth account with a cost field stays subscription" "" "$(key login "$(data <<<"$apiful")")"
while IFS='|' read -r url want; do
  check_eq "login host: [$url]" "$want" "$(key login "$(ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL="$url" data <<<"$norl")")"
done <<'EOT'
https://openrouter.ai/api/v1|openrouter.ai
http://localhost:8080/v1|localhost
https://u:p@gw.example.com:443/x?y=1|gw.example.com
https://[::1]:4000/v1|[::1]
openrouter.ai|openrouter.ai
https://|api key
|api key
EOT
r1=$(ANTHROPIC_API_KEY=x data <<<"$norl" | COLUMNS=120 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g' | head -1)  # render() is not defined until line 158
check "login: identity row shows the tag" grep -q 'api key' <<<"$r1"
check "login: identity row drops the email" bash -c "! grep -q 'example.test' <<<'$r1'"

nolim=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits;j.context_window.context_window_size=200000;console.log(JSON.stringify(j))' "$full")
kv=$(data <<<"$nolim")
check "data: no limits -> no 5h" [ -z "$(key 5h "$kv")" ]
check "data: no limits -> no wk" [ -z "$(key wk "$kv")" ]
check_eq "data: logged in, no reply, no limits -> lim_wait" 1 "$(key lim_wait "$kv")"
check "data: limits in -> no lim_wait" [ -z "$(key lim_wait "$(data <<<"$full")")" ]
check "data: not logged in -> no lim_wait" [ -z "$(key lim_wait "$(CLAUDE_CONFIG_DIR="$TMP/none" HUD_DUMP=1 perl "$HUD/hud.pl" <<<"$nolim")")" ]
used=$(node -e 'const j=JSON.parse(process.argv[1]);j.context_window.current_usage={input_tokens:2,output_tokens:830,cache_creation_input_tokens:2018,cache_read_input_tokens:414892};console.log(JSON.stringify(j))' "$full")
check_eq "data: no reply yet -> ctx_note 0" 0 "$(key ctx_note "$(data <<<'{}')")"
check_eq "data: ctx_note used" 417k "$(key ctx_note "$(data <<<"$used")")"
# usage <current_usage json>: ctx_note for that shape (printf: bash 3.2 brace-expands here-strings)
usage() { key ctx_note "$(printf '{"context_window":{"used_percentage":1,"current_usage":%s}}' "$1" | data)"; }
check "data: empty usage -> no note" [ -z "$(usage '{}')" ]
check "data: junk usage -> no note" [ -z "$(usage '{"input_tokens":"a","cache_read_input_tokens":{}}')" ]
check "data: string counts ignored" [ -z "$(usage '{"input_tokens":"300000"}')" ]
check_eq "data: negative counts ignored" 20k "$(usage '{"input_tokens":-5000,"cache_read_input_tokens":20000}')"
check "data: non-object usage -> no note" [ -z "$(usage '5')" ]
check_eq "data: 999.5k rounds to 1M" 1M "$(usage '{"input_tokens":999600}')"

past=$(node -e 'const j=JSON.parse(process.argv[1]);j.rate_limits.five_hour.resets_at=1;console.log(JSON.stringify(j))' "$full")
check "data: past reset -> no note" [ -z "$(key 5h_note "$(data <<<"$past")")" ]
gone=$(node -e 'const j=JSON.parse(process.argv[1]);delete j.rate_limits.five_hour;console.log(JSON.stringify(j))' "$full")
kv=$(data <<<"$gone")
check_eq "data: dropped window -> 5h 0" 0 "$(key 5h "$kv")"
check "data: dropped window -> no note" [ -z "$(key 5h_note "$kv")" ]
kv=$(data <<<'{"rate_limits":{"spend_limit":{"used_percentage":5}}}')
check "data: spend limit only -> no 5h" [ -z "$(key 5h "$kv")" ]
check "data: spend limit only -> no wk" [ -z "$(key wk "$kv")" ]
kv=$(data <<<'{"rate_limits":{"five_hour":{"used_percentage":null,"resets_at":9999999999}}}')
check "data: null pct -> no 5h_note" [ -z "$(key 5h_note "$kv")" ]

perl -i -ne 'print unless eof' "$T"
echo "{\"timestamp\":\"$(iso 120)\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"\"}]}}" >> "$T"
check "data: thinking stale" [ -z "$(key thinking "$(data <<<"$full")")" ]

check "data: garbage stdin exit 0" bash -c "echo nope | HUD_DUMP=1 perl '$HUD/hud.pl' >/dev/null"
check "data: missing transcript" bash -c "echo '{\"session_id\":\"x\",\"transcript_path\":\"/nope\"}' | HUD_DUMP=1 perl '$HUD/hud.pl' | grep -q '^id	x$'"

check_eq "data: no context_window -> ctx 0" 0 "$(key ctx "$(data <<<'{"cwd":"/x"}')")"
check_eq "data: cwd fallback" /x "$(key cwd "$(data <<<'{"cwd":"/x"}')")"
check "data: non-object current_usage never dies, ctx kept" bash -c 'o=$(HUD_DUMP=1 CLAUDE_CONFIG_DIR="$1" perl "$2/hud.pl" <<<"{\"context_window\":{\"current_usage\":5}}") && grep -q "^ctx	" <<<"$o"' _ "$C" "$HUD"
echo '{"palette":{"hud":"x"}}' > "$C/claudzilla.json"
check "data: non-object palette.hud never dies, ctx kept" bash -c 'o=$(HUD_DUMP=1 CLAUDE_CONFIG_DIR="$1" perl "$2/hud.pl" <<<"{\"cwd\":\"/x\"}") && grep -q "^ctx	" <<<"$o"' _ "$C" "$HUD"
rm -f "$C/claudzilla.json"
check_eq "data: tab in value flattened" "a b" "$(key model "$(data <<<'{"model":{"display_name":"a\tb"}}')")"

check "data: surrogate pair decoded" [ "$(key model "$(data <<<'{"model":{"display_name":"\ud83d\ude00"}}')")" = "$(printf '\xf0\x9f\x98\x80')" ]
check "data: trailing garbage -> no fields" [ -z "$(key model "$(data <<<'{"model":{"display_name":"Opus"}} x')")" ]
check "data: numeric string resets_at" [ "$(key 5h_note "$(printf '{"rate_limits":{"five_hour":{"used_percentage":30,"resets_at":"%s"}}}' "$(( $(date +%s) + 7230 ))" | data)")" = 2h0m ]
printf '%s' '{"palette":{"hud":{"rampHot":"#123456\n"}}}' > "$C/claudzilla.json"
check_eq "data: #rrggbb plus newline rejected" '#ffaa5a' "$(key pal_hud_rampHot "$(data <<<'{}')")"
rm "$C/claudzilla.json"
check "data: invalid UTF-8 becomes U+FFFD" [ "$(key model "$(data <<<"$(printf '{"model":{"display_name":"a\xffb"}}')")")" = "$(printf 'a\xef\xbf\xbdb')" ]
printf '{"timestamp":"2026-11-21T00:00:00.000Z","message":{"content":"x"}}\n' > "$TMP/iso.jsonl"
check_eq "data: ISO 8601 fixed value gives up 10m" 10m "$(printf '{"transcript_path":"%s"}' "$TMP/iso.jsonl" | HUD_DUMP=1 CLAUDE_CONFIG_DIR="$C" FROZEN_TIME=$((1795219200 + 600)) TZ=UTC PERL5LIB="$PL" perl -MFrozen "$HUD/hud.pl" | awk -F'\t' '$1=="up"{print $2}')"
rm "$TMP/iso.jsonl"
printf '{"timestamp":"2026-11-21T25:00:00Z","message":{"content":"x"}}\n' > "$TMP/iso2.jsonl"
check "data: out-of-range ISO time gives no up" [ -z "$(key up "$(printf '{"transcript_path":"%s"}' "$TMP/iso2.jsonl" | data)")" ]
rm "$TMP/iso2.jsonl"

# big transcript: head cut and tail cut both land mid-file
B="$TMP/big.jsonl"
{ echo "{\"timestamp\":\"$(iso 120)\"}"
  node -e 'const l=JSON.stringify({pad:"x".repeat(1000)})+"\n";process.stdout.write(l.repeat(5000))'
  echo "{\"timestamp\":\"$(iso 1)\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"id\":\"c\",\"name\":\"Skill\",\"input\":{\"skill\":\"big\"}}]}}"
} > "$B"
kv=$(data <<<"{\"transcript_path\":\"$B\"}")
check "data: big transcript up"    [ "$(key up "$kv")" = 2m ]
check_eq "data: big transcript skill" big "$(key skill "$kv")"
# cache: newest main-chat reply with tokens starts the clock; TTL from the newest reply that wrote cache
reply() { # <secs ago> <5m written> <1h written> [sidechain]
  echo "{\"type\":\"assistant\",\"isSidechain\":${4:-false},\"timestamp\":\"$(iso "$1")\",\"message\":{\"usage\":{\"input_tokens\":2,\"cache_read_input_tokens\":9000,\"cache_creation_input_tokens\":$(($2 + $3)),\"cache_creation\":{\"ephemeral_5m_input_tokens\":$2,\"ephemeral_1h_input_tokens\":$3}}}}"
}
# cache -> "<percent of TTL used> <note>"
cache() { printf '%s\n' "$@" > "$TMP/c.jsonl"; kv=$(data <<<"{\"transcript_path\":\"$TMP/c.jsonl\"}"); [ -n "$(key cch "$kv")" ] && echo "$(key cch "$kv") $(key cch_note "$kv")"; }
check "data: cache 1h warm"     [ "$(cache "$(reply 1200 0 500)")" = "33 40m" ]
check "data: cache 5m warm"     [ "$(cache "$(reply 120 500 0)")" = "40 3m" ]
check "data: cache 1h cold"     [ "$(cache "$(reply 3660 0 500)")" = "100 cold" ]
check_eq "data: cache read keeps earlier TTL" "16 50m" "$(cache "$(reply 1800 0 500)" "$(reply 600 0 0)")"
check_eq "data: cache sidechain ignored" "50 30m" "$(cache "$(reply 1800 0 500)" "$(reply 60 500 0 true)")"
synthetic="{\"type\":\"assistant\",\"timestamp\":\"$(iso 10)\",\"message\":{\"model\":\"<synthetic>\",\"usage\":{\"input_tokens\":0,\"output_tokens\":0,\"cache_read_input_tokens\":0,\"cache_creation_input_tokens\":0}}}"
check_eq "data: cache synthetic reply ignored" "50 30m" "$(cache "$(reply 1800 0 500)" "$synthetic")"
check_eq "data: cache future reply clamps to fresh" "0 60m" "$(cache "$(reply -60 0 500)")"
check_eq "data: cache seconds left not shown as 100%" "99 1m" "$(cache "$(reply 3595 0 500)")"
check_eq "data: cache reply but no write -> cold" "100 cold" "$(cache "$(reply 600 0 0)")"
check "data: cache no reply -> hot" [ "$(key cch "$(data <<<"$full")") $(key cch_note "$(data <<<"$full")")" = "0 hot" ]
printf '%s\n' "$(reply 60 0 500)" > "$TMP/r.jsonl"
check_eq "data: reply but no limits -> lim_wait" 1 "$(key lim_wait "$(data <<<"{\"transcript_path\":\"$TMP/r.jsonl\"}")")"

kv=$(data <<<'{"model":{"display_name":"a\u001b]52;c;aGk=\u0007b"}}')
check_eq "data: control chars dropped" "a ]52;c;aGk= b" "$(key model "$kv")"
kv=$(data <<<'{"model":{"display_name":"a\u009d52;c;aGk=\u009cb"}}')
check_eq "data: C1 control chars dropped" "a 52;c;aGk= b" "$(key model "$kv")"

# --- spend: API ledger ---
d=$TMP/sp1; mkdir -p "$d"
spend_at $T0 0 s1 "$d" >/dev/null; spend_at $((T0+60)) 1.00 s1 "$d" >/dev/null
check_eq "spend: deltas add up" 1.50 "$(usd spend_today "$(spend_at $((T0+120)) 1.50 s1 "$d")")"

d=$TMP/sp2; mkdir -p "$d"
spend_at $T0 0 s2 "$d" >/dev/null; spend_at $((T0+60)) 2.00 s2 "$d" >/dev/null; spend_at $((T0+120)) 0.30 s2 "$d" >/dev/null
check_eq "spend: cost drop after /clear is a new baseline" 2.50 "$(usd spend_today "$(spend_at $((T0+180)) 0.80 s2 "$d")")"

d=$TMP/sp2b; mkdir -p "$d"
spend_at $T0 1.00 s2b "$d" >/dev/null; spend_at $((T0+60)) 0.90 s2b "$d" >/dev/null
check_eq "spend: 1.00, 0.90, 1.00 adds 0.10 after the baseline" 0.10 "$(usd spend_today "$(spend_at $((T0+120)) 1.00 s2b "$d")")"

d=$TMP/sp3; mkdir -p "$d"
spend_at $T0 0 s3 "$d" >/dev/null; spend_at $((T0+60)) 1.00 s3 "$d" >/dev/null
spend_at $((T0+60)) 0 s4 "$d" >/dev/null; spend_at $((T0+120)) 0.40 s4 "$d" >/dev/null
check_eq "spend: two sessions add to today, no double count" 1.40 "$(usd spend_today "$(spend_at $((T0+180)) 1.00 s3 "$d")")"

d=$TMP/sp4; mkdir -p "$d"
spend_at $T0 0 s5 "$d" >/dev/null; spend_at $T0 0 s6 "$d" >/dev/null
for i in $(seq 20); do spend_at $((T0+60)) 1.00 s5 "$d" >/dev/null & spend_at $((T0+60)) 0.50 s6 "$d" >/dev/null & done; wait
check_eq "spend: parallel ticks count each delta once" 1.50 "$(usd spend_today "$(spend_at $((T0+60)) 1.00 s5 "$d")")"
check_eq "spend: no temp file left behind" "claudzilla-spend.lock claudzilla-spend.tsv" "$(ls "$d" | tr '\n' ' ' | sed 's/ $//')"

d=$TMP/sp5; mkdir -p "$d"
printf 'garbage\nslot\tbad\t1\nslot\t%s\t0.75\nslot\t17' $((T0-600)) > "$d/claudzilla-spend.tsv"
check_eq "spend: corrupt and truncated lines skipped" 0.75 "$(usd spend_today "$(spend_at $T0 0 s7 "$d")")"
spend_at $T0 0 s7 "$d" >/dev/null; check "spend: corrupt file exits 0" [ $? -eq 0 ]

check "spend: missing config dir still draws" [ -n "$(spend_at $T0 0 s8 "$TMP/absent")" ]
check "spend: missing config dir writes nothing" [ ! -e "$TMP/absent" ]

d=$TMP/sp7; mkdir -p "$d"; cp "$C/.claude.json" "$d/"
CLAUDE_CONFIG_DIR="$d" HUD_DUMP=1 perl "$HUD/hud.pl" <<<"$full" >/dev/null
check "spend: subscription writes no ledger" [ ! -e "$d/claudzilla-spend.tsv" ]

d=$TMP/sp8; mkdir -p "$d"
kv=$(printf '{"cost":{"total_cost_usd":1}}' | ANTHROPIC_API_KEY=x FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" CLAUDE_CONFIG_DIR="$d" HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl")
check "spend: no session id writes nothing" [ ! -e "$d/claudzilla-spend.tsv" ]
check_eq "spend: here still shows the cost" 1.00 "$(usd spend_here "$kv")"

d=$TMP/sp9; mkdir -p "$d"
printf 'day\t2026-11-30\t5.00\nslot\t1796082600\t5.00\nslot\t%s\t9.00\nsess\ts9\t1.00\t%s\n' $((T0-259200)) $T0 > "$d/claudzilla-spend.tsv"
kv=$(spend_at 1796083800 1.20 s9 "$d")
check_eq "spend: rollover, today" 0.20 "$(usd spend_today "$kv")"
check_eq "spend: rollover, month" 0.20 "$(usd spend_month "$kv")"
check_eq "spend: rollover, per day on the 1st" 0.20 "$(usd spend_day "$kv")"
check_eq "spend: rate crosses midnight" 5.20 "$(usd spend_rate "$kv")"
check "spend: write drops last month and 48 h-old lines" bash -c "perl -ne 'exit 1 if /^day\t2026-11-30|^slot\t$((T0-259200))\t/' '$d/claudzilla-spend.tsv'"

d=$TMP/sp10; mkdir -p "$d"; printf 'slot\t1793505000\t3.00\n' > "$d/claudzilla-spend.tsv"
ZONE=America/New_York spend_at 1793505300 0 s10 "$d" >/dev/null
kv=$(ZONE=America/New_York spend_at 1793506200 0.50 s10 "$d")
check_eq "spend: today resets at New York midnight" 0.50 "$(usd spend_today "$kv")"
check_eq "spend: rate crosses that midnight" 3.50 "$(usd spend_rate "$kv")"
check_eq "spend: midnight offset in the window" 85200 "$(key spend_mid "$kv")"
check_eq "spend: DST afternoon midnight is EDT midnight (17400, not 18000)" 17400 "$(key spend_mid "$(ZONE=America/New_York AT=1793574000 api_kv "$(mktemp -d -p "$TMP")")")"

# --- spend: OpenRouter billed figures ---
# fake curl: logs argv and stdin, answers like /api/v1/key; FAKE_FAIL fails, FAKE_SLEEP delays
FC="$TMP/fakecurl"; mkdir -p "$FC"
cat > "$FC/curl" <<'EOF'
#!/usr/bin/env bash
d=$(dirname "$0"); echo "$*" >> "$d/argv"; cat > "$d/stdin"
sleep "${FAKE_SLEEP:-0}"
[ -n "${FAKE_FAIL:-}" ] && exit 22
echo "{\"data\":{\"usage_daily\":${FAKE_DAILY:-7.5},\"usage_monthly\":77.1}}"
EOF
chmod +x "$FC/curl"
or_kv() { printf '%s' "$apiful" | PATH="$FC:$PATH" FROZEN_TIME=${AT:-$T0} TZ=${ZONE:-UTC} PERL5LIB="$PL" ANTHROPIC_BASE_URL=https://openrouter.ai/api ANTHROPIC_AUTH_TOKEN=sk-or-test CLAUDE_CONFIG_DIR="$1" HUD_DUMP=1 perl -e 'alarm 5; exec @ARGV' perl -MFrozen "$HUD/hud.pl"; }
orc() { printf 'at\t%s\ndaily\t5\nmonthly\t40\n' "$1" > "$2/claudzilla-or-key.tsv"; }
# or_wait <dir> <line>: up to 3 s for the background fetch to write <line>
or_wait() { for _ in $(seq 60); do grep -qx "$2" "$1/claudzilla-or-key.tsv" 2>/dev/null && return 0; sleep 0.05; done; return 1; }

d=$(seedS); orc $((T0-30)) "$d"; rm -f "$FC/argv"
kv=$(or_kv "$d")
check_eq "or: fresh cache sets today" 5.00 "$(usd spend_today "$kv")"
check_eq "or: fresh cache sets month" 40.00 "$(usd spend_month "$kv")"
check_eq "or: per day from the billed month" 1.43 "$(usd spend_day "$kv")"
check_eq "or: here stays local" 1.24 "$(usd spend_here "$kv")"
sleep 0.2; check "or: fresh cache fetches nothing" [ ! -e "$FC/argv" ]

d=$(seedS); orc $((T0-300)) "$d"; rm -f "$FC/argv"
kv=$(or_kv "$d")
check_eq "or: stale cache still shows while refetching" 5.00 "$(usd spend_today "$kv")"
check "or: refetch writes the cache" or_wait "$d" "$(printf 'at\t%s' $T0)"
check_eq "or: refetched daily" 7.500000 "$(key daily "$(cat "$d/claudzilla-or-key.tsv")")"
check_eq "or: refetched monthly" 77.100000 "$(key monthly "$(cat "$d/claudzilla-or-key.tsv")")"
check "or: key never in curl argv" bash -c "! grep -q sk-or-test '$FC/argv'"
check "or: key sent on stdin" grep -q 'Authorization: Bearer sk-or-test' "$FC/stdin"
check_eq "or: cache is private" 600 "$(perl -e 'printf "%o", (stat shift)[2] & 0777' "$d/claudzilla-or-key.tsv")"
d=$(seedS); FAKE_DAILY=0.00005 or_kv "$d" >/dev/null; or_wait "$d" "$(printf 'at\t%s' $T0)"
check_eq "or: tiny daily keeps the billed month" 77.10 "$(usd spend_month "$(AT=$((T0+1)) or_kv "$d")")"

d=$(seedS); orc $((T0-700)) "$d"; rm -f "$FC/argv"
kv=$(FAKE_FAIL=1 or_kv "$d")
check_eq "or: cache past 10 min falls back to the ledger" "$(usd spend_today "$(api_kv "$(seedS)")")" "$(usd spend_today "$kv")"
check "or: failed fetch notes the try" or_wait "$d" "$(printf 'tried\t%s' $T0)"
rm -f "$FC/argv"; AT=$((T0+30)) or_kv "$d" >/dev/null; sleep 0.2
check "or: failed fetch waits a minute to retry" [ ! -e "$FC/argv" ]

# Dec 1 05:00 in Tokyo is still Nov 30 in UTC, where OpenRouter's month runs
d=$(seedS); orc $((1796068800-30)) "$d"
check_eq "or: per day counts UTC days" 1.33 "$(usd spend_day "$(ZONE=Asia/Tokyo AT=1796068800 or_kv "$d")")"

d=$(seedS); rm -f "$FC/argv"
for _ in $(seq 10); do FAKE_SLEEP=0.5 or_kv "$d" >/dev/null & done; wait
or_wait "$d" "$(printf 'at\t%s' $T0)"
check_eq "or: parallel sessions fetch once" 1 "$(wc -l < "$FC/argv" | tr -d " ")"

d=$(seedS); s0=$(date +%s%N)
x=$(FAKE_SLEEP=2 or_kv "$d")   # captured: a child holding stdout would make this wait
check "or: status line does not wait for the fetch" [ $(( ($(date +%s%N) - s0) / 1000000 )) -lt 1500 ]

d=$(seedS); api_kv "$d" >/dev/null
check "or: other hosts never fetch" [ ! -e "$d/claudzilla-or-key.tsv" ]

d=$TMP/sp11; mkdir -p "$d"; printf 'slot\t1795842000\t1.00\nslot\t1795842600\t0.20\n' > "$d/claudzilla-spend.tsv"
kv=$(spend_at $T0 0 s11 "$d")
check_eq "spend: rate is the last six slots" 0.20 "$(usd spend_rate "$kv")"
check_eq "spend: today is the whole local day" 1.20 "$(usd spend_today "$kv")"

d=$TMP/sp12; mkdir -p "$d"; : > "$d/claudzilla-spend.tsv.111.tmp"; : > "$d/claudzilla-spend.tsv.222.tmp"
perl -e 'utime $ARGV[0], shift, @ARGV' $((T0-7200)) "$d/claudzilla-spend.tsv.111.tmp"; perl -e 'utime $ARGV[0], shift, @ARGV' $((T0-60)) "$d/claudzilla-spend.tsv.222.tmp"
spend_at $T0 0 s12 "$d" >/dev/null
check "spend: temp file over 1 h old swept, fresh one kept" bash -c "[ ! -e '$d/claudzilla-spend.tsv.111.tmp' ] && [ -e '$d/claudzilla-spend.tsv.222.tmp' ]"

d="$TMP/sp 13/cfg"; mkdir -p "$d"; : > "$TMP/sp"; : > "$d/claudzilla-spend.tsv.333.tmp"
perl -e 'utime $ARGV[0], shift, @ARGV' $((T0-10800)) "$TMP/sp" "$d/claudzilla-spend.tsv.333.tmp"
spend_at $T0 0 s13 "$d" >/dev/null
check "spend: sweep ignores a decoy before a space in the dir" bash -c "[ -e '$TMP/sp' ] && [ ! -e '$d/claudzilla-spend.tsv.333.tmp' ]"

kv=$(api_kv "$(seedS)")
check_eq "spend: seed S here" 1.24 "$(usd spend_here "$kv")"
check_eq "spend: seed S today" 4.80 "$(usd spend_today "$kv")"
check_eq "spend: seed S month" 96.40 "$(usd spend_month "$kv")"
check_eq "spend: seed S rate" 0.62 "$(usd spend_rate "$kv")"
check_eq "spend: seed S per day" 3.44 "$(usd spend_day "$kv")"
check_eq "spend: 144 chart slots" 144 "$(key spend_slots "$kv" | tr ',' '\n' | wc -l | tr -d ' ')"
check_eq "spend: slot 110 holds 00:30" 4.18 "$(printf '%.2f' "$(key spend_slots "$kv" | cut -d, -f111)")"
check_eq "spend: slot 139 holds 05:20" 0.62 "$(printf '%.2f' "$(key spend_slots "$kv" | cut -d, -f140)")"
check_eq "spend: seed S midnight offset" 64200 "$(key spend_mid "$kv")"
check_eq "spend: no cost yet shows 0.00 here" 0.00 "$(usd spend_here "$(api_kv "$(seedS)" '{"session_id":"api2"}')")"

bars="$(printf '▁%.0s' $(seq 33))╎█$(printf '▁%.0s' $(seq 8))▂▁"
check "chart: seed S, 120 cols, exact bars" grep -qF "24h ago $bars now" <<<"$(api_row 120)"
flat_raw=$(api_kv "$(mktemp -d -p "$TMP")" | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=120 HUD_KV=1 perl -MFrozen "$HUD/hud.pl")
check "chart: empty ledger draws track-coloured ▁" grep -q $'\e\\[38;2;30;42;58m▁' <<<"$flat_raw"
flat=$(perl -pe 's/\e\[[0-9;]*m//g' <<<"$flat_raw")
check "chart: empty ledger, marker at midnight, flat elsewhere" grep -qF "24h ago $(printf '▁%.0s' $(seq 33))╎$(printf '▁%.0s' $(seq 11)) now" <<<"$flat"
dst=$(printf '%s' "$apiful" | FROZEN_TIME=1793574000 TZ=America/New_York PERL5LIB="$PL" ANTHROPIC_API_KEY=x CLAUDE_CONFIG_DIR="$(mktemp -d -p "$TMP")" HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl" | FROZEN_TIME=1793574000 TZ=America/New_York PERL5LIB="$PL" COLUMNS=120 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "chart: DST afternoon, marker at EDT midnight (cell 9 of 45)" grep -qF "24h ago $(printf '▁%.0s' $(seq 9))╎$(printf '▁%.0s' $(seq 35)) now" <<<"$dst"
out=$(api_row 40)
check "chart: 40 cols stacks at full width" perl -CSA -e 'exit(($ARGV[0] =~ /^24h ago \S{24} now$/m) ? 0 : 1)' "$out"

# --- spend: words row ---
check "words: seed S, 120 cols" grep -qF '┃ $1.24 here  $4.80 today  $96.40 month  $0.62/h  $3.44/day' <<<"$(api_row 120)"
check "words: the $ shares its number's colour" grep -qE $'\e''\[38;2;[0-9;]+m\$1\.24' <<<"$(api_raw 120)"
check "words: 60 cols sheds per day, month and rate" grep -qE '┃ \$1\.24 here  \$4\.80 today +$' <<<"$(api_row 60)"
check "words: 40 cols stacks, rate flush right, month shed" grep -qE 'today +\$0\.62/h$' <<<"$(api_row 40)"
subcfg="$TMP/subcfg"; mkdir -p "$subcfg"; cp "$C/.claude.json" "$subcfg/"  # clean layout config; strip() is defined only at line 191
check_eq "words: 40 cols has the subscription's row count" "$(data <<<"$full" | CLAUDE_CONFIG_DIR="$subcfg" COLUMNS=40 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g' | wc -l | tr -d ' ')" "$(api_row 40 | wc -l | tr -d ' ')"
check "words: no cost yet, 120 cols, starts with \$0.00 here" grep -qF '┃ $0.00 here' <<<"$(api_kv "$(seedS)" '{"session_id":"api2"}' | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=120 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')"
check "words: rate_limits mean subscription, so no spend text" bash -c 'o=$(cat); ! grep -qF "here" <<<"$o" && grep -qF "5h" <<<"$o"' <<<"$(api_kv "$(seedS)" '{"session_id":"api3","cost":{"total_cost_usd":1.24},"rate_limits":{"five_hour":{"used_percentage":40,"resets_at":'$((T0+3600))'}}}' | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=120 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')"

# --- spend: compact ---
check_eq "compact: API, 150 cols, 3 rows" 3 "$(api_row 150 compact | wc -l | tr -d ' ')"
c=$(api_row 150 compact)
check "compact: text left, divider, labelled chart" grep -qE '┃ \$1\.24 here  \$4\.80 today  \$96\.40 month ┃ 24h ago \S{20} now *$' <<<"$c"
check_eq "compact: three dividers" 3 "$(head -2 <<<"$c" | tail -1 | grep -o '┃' | wc -l | tr -d ' ')"
d=$(seedS); printf 'day\t2026-11-28\t999999.00\n' >> "$d/claudzilla-spend.tsv"; echo '{"hud":{"layout":"compact"}}' > "$d/claudzilla.json"
check "compact: longer text, fewer bars" grep -qE 'month ┃ 24h ago \S{15} now *$' <<<"$(api_kv "$d" | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=150 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')"
check "compact: cch first" grep -q '^cch ' <<<"$c"
check_eq "compact: 120 cols too narrow for the chart falls back to 4 rows" 4 "$(api_row 120 compact | wc -l | tr -d ' ')"
check_eq "compact: 108 cols falls back to 4 rows" 4 "$(api_row 108 compact | wc -l | tr -d ' ')"
d=$(seedS); printf 'day\t2026-11-28\t9999999999999999999.00\n' >> "$d/claudzilla-spend.tsv"; echo '{"hud":{"layout":"compact"}}' > "$d/claudzilla.json"
check_eq "compact: text too wide falls back to 4 rows" 4 "$(api_kv "$d" | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=150 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | wc -l | tr -d ' ')"
d=$(seedS); echo '{"hud":{"layout":"compact"}}' > "$d/claudzilla.json"
nc=$(api_kv "$d" | grep -v '^ctx	' | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=150 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check_eq "compact: no ctx value, one row" 3 "$(wc -l <<<"$nc" | tr -d ' ')"
check_eq "compact: no ctx value, three dividers" 3 "$(grep -o '┃' <<<"$nc" | wc -l | tr -d ' ')"
check "compact: no ctx value, text cell kept" grep -qF '$1.24 here' <<<"$nc"
check "compact: no ctx value, blank ctx meter drawn" grep -qE "ctx .*--% +┃" <<<"$nc"

# --- spend: minimal ---
widest() { perl -CS -ne 'chomp; $m = length if length > $m; END { print $m }'; }
check_eq "minimal: API, one row at 170 cols" 1 "$(api_row 170 minimal | wc -l | tr -d ' ')"
check "minimal: spend part after ctx" grep -qE '┃ \$1\.24 here  \$96\.40 month *$' <<<"$(api_row 170 minimal)"
o=$(api_row 170 minimal)
check "minimal: no login tag, no chart" bash -c "[ -n \"\$1\" ] && ! grep -q 'api key' <<<\"\$1\" && ! grep -q '24h ago' <<<\"\$1\"" _ "$o"
rl='"rate_limits":{"five_hour":{"used_percentage":40,"resets_at":'$((T0+3600))'},"seven_day":{"used_percentage":20,"resets_at":'$((T0+86400))'}}'
d=$(seedS); echo '{"hud":{"layout":"minimal"}}' > "$d/claudzilla.json"
o=$(api_kv "$d" '{"session_id":"api6","cost":{"total_cost_usd":1.24},'"$rl"'}' | FROZEN_TIME=$T0 TZ=UTC PERL5LIB="$PL" COLUMNS=170 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "minimal: rate_limits mean subscription, 5h and wk shown, no spend" bash -c 'grep -qE "5h" <<<"$1" && grep -qE "wk" <<<"$1" && ! grep -qF "here" <<<"$1"' _ "$o"
bad=0
for w in $(seq 21 170); do
  o=$(api_row $w minimal)
  [ "$(wc -l <<<"$o" | tr -d ' ')" -eq 1 ] || bad=$((bad+1))
  [ "$(widest <<<"$o")" -le $((w - 4)) ] || bad=$((bad+1))   # the row gets W = cols - 4
  if grep -q 'month' <<<"$o"; then grep -q 'here' <<<"$o" || bad=$((bad+1)); fi
  if grep -q 'here' <<<"$o"; then grep -qF '$1.24' <<<"$o" || bad=$((bad+1)); fi
done
check_eq "minimal: one row at every width, month sheds before here, here before the figure" 0 "$bad"

# --- hud.pl: render ---
render() { data <<<"$1" | COLUMNS=120 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
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
# colours
raw() { data <<<"{\"session_id\":\"r0\",\"transcript_path\":\"$TMP/c.jsonl\",\"rate_limits\":{\"five_hour\":{\"used_percentage\":30}}}" | COLUMNS=120 HUD_KV=1 perl "$HUD/hud.pl"; }
cache "$(reply 0 0 500)" >/dev/null
check "render: fresh cache one blue bar" grep -q $'cch \e\\[38;2;36;58;93m▬[^\e ]*   0%' <<<"$(raw)"
cache "$(reply 1800 0 500)" >/dev/null
check "render: half cache one light blue bar" grep -q $'cch \e\\[38;2;146;188;228m▬[^\e ]*  50%' <<<"$(raw)"
cache "$(reply 3660 0 500)" >/dev/null
check "render: cold cache one orange bar" grep -q $'cch \e\\[38;2;255;170;90m▬[^\e ]* 100%  \e\\[38;2;64;71;80mcold' <<<"$(raw)"
out=$(C="$TMP/none" render "$nolim")
check "render: no login, no limits -> ctx only" [ "$(grep -cE '^(ctx|5h|wk) ' <<<"$out")" -eq 1 ]
check "render: no login, no limits -> cache below ctx, no divider" bash -c "grep -q '^cch .* 33%  *40m$' <<<'$out' && ! grep -q '┃' <<<'$out'"
# first launch, logged in: limits not in yet, so 5h | wk hold their slots
out=$(render '{"session_id":"w1"}')
check "render: limits pending -> 5h placeholder" grep -qE '^ctx .*┃ 5h  (▱)+  --%     --$' <<<"$out"
check "render: limits pending -> wk placeholder" grep -qE '^cch .*┃ wk  (▱)+  --%     --$' <<<"$out"
wn=$(data <<<'{"session_id":"w1"}' | COLUMNS=40 HUD_KV=1 perl "$HUD/hud.pl" 2>"$TMP/warn" | perl -pe 's/\e\[[0-9;]*m//g')
check "render: limits pending, narrow -> 4 meter rows" [ "$(grep -cE '^(ctx|cch|5h|wk) ' <<<"$wn")" -eq 4 ]
check "render: limits pending -> no warnings" [ ! -s "$TMP/warn" ]

# strip <cols> <payload>: rendered rows, colours removed
strip() { data <<<"$2" | COLUMNS=$1 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
check "render: default -> no clock on bottom row" bash -c "! tail -1 <<<\"\$1\" | grep -q ':'" _ "$(strip 170 "$full")"
check "render: default -> 6 rows, 2 rules" [ "$(strip 170 "$full" | grep -c '━')/$(strip 170 "$full" | wc -l | tr -d ' ')" = 2/6 ]
check "data: layout full by default" [ -z "$(key layout "$(data <<<"$full")")" ]
printf '{bad' > "$C/claudzilla.json"
check "data: bad config -> full" [ -z "$(key layout "$(data <<<"$full")")" ]
echo '{"hud":{"layout":"tiny"}}' > "$C/claudzilla.json"
check "data: unknown layout -> full" [ -z "$(key layout "$(data <<<"$full")")" ]
echo '{"hud":{"compact":true}}' > "$C/claudzilla.json"
check "data: old compact key ignored" [ -z "$(key layout "$(data <<<"$full")")" ]
echo '{"hud":{"layout":"compact"}}' > "$C/claudzilla.json"
check_eq "data: layout compact" compact "$(key layout "$(data <<<"$full")")"
out=$(strip 170 "$full")
check "compact: 3 rows" [ "$(wc -l <<<"$out")" -eq 3 ]
check "compact: no rules" bash -c "! grep -q '━' <<<'$out'"
check "compact: one meter row" grep -q '^cch  [^ ].*[^ ]  33%  40m ┃ ctx  [^ ].*[^ ]  42%  *┃ 5h  [^ ].*[^ ]  30%  2h0m ┃ wk  [^ ].*[^ ]  12%  2d7h$' <<<"$out"
check "compact: meter row fills 166 cols" [ "$(sed -n 2p <<<"$out" | widest)" -eq 166 ]
check "compact: time then date on the bottom row" grep -qE '[0-9]{2}:[0-9]{2} (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [0-9]{2} [A-Z][a-z]{2}  .*up ' <<<"$(sed -n 3p <<<"$out")"
check "compact: narrow bottom row drops the clock first" bash -c "! grep -qE '[0-9]{2}:[0-9]{2} ' <<<'$(strip 40 "$full" | tail -1)'"
# The clock goes before live state: wherever it shows, the skill shows too.
clock_alone=0; rendered=$(data <<<"$full")
for w in $(seq 40 170); do
  bottom=$(COLUMNS=$w HUD_KV=1 perl "$HUD/hud.pl" <<<"$rendered" | perl -pe 's/\e\[[0-9;]*m//g' | tail -1)
  grep -qE '[0-9]{2}:[0-9]{2} ' <<<"$bottom" && ! grep -q 'pr' <<<"$bottom" && clock_alone=$w
done
check_eq "compact: clock never outlives the skill" 0 "$clock_alone"
check "compact: 109 cols -> one meter row" [ "$(strip 109 '{"session_id":"w1"}' | wc -l)" -eq 3 ]
check "compact: 108 cols -> two columns, 4 rows" [ "$(strip 108 '{"session_id":"w1"}' | wc -l)" -eq 4 ]
check "compact: 108 cols, short notes -> height holds" [ "$(strip 108 "$full" | wc -l)" -eq 4 ]
mkdir -p "$TMP/nologin" && cp "$C/claudzilla.json" "$TMP/nologin/"
out=$(C="$TMP/nologin" strip 120 "$nolim")
check "compact: no login, no limits -> cache beside ctx, no 5h" bash -c "grep -q '^cch .* 33%  40m ┃ ctx ' <<<'$out' && ! grep -q ' 5h ' <<<'$out'"
check "compact: limits waiting -> note beside percent" grep -q '┃ 5h  [^ ].*[^ ]  --%  -- ┃ wk  [^ ].*[^ ]  --%  --$' <<<"$(strip 120 '{"session_id":"w1"}')"
# divider columns, whatever the note and percent lengths
dividers() { sed -n 2p | perl -Mutf8 -CS -ne 'while (/\x{2503}/g) { print pos(), " " }'; }
base=$(strip 170 "$full" | dividers)
check "compact: 100% keeps dividers" [ "$(strip 170 "${full//\"used_percentage\":30/\"used_percentage\":100}" | dividers)" = "$base" ]
check "compact: waiting limits keep dividers" [ "$(strip 170 '{"session_id":"w1"}' | dividers)" = "$base" ]
check "compact: 40 cols -> meters stack, no rules" [ "$(strip 40 '{"session_id":"w1"}' | wc -l)" -eq 6 ]
echo '{"hud":{"layout":"minimal"}}' > "$C/claudzilla.json"
# HOME at the cwd: the folder draws as ~, so what fits does not hang on the temp path's length (long on macOS)
mstrip() { HOME="$TMP" strip "$@"; }
check_eq "data: layout minimal" minimal "$(key layout "$(data <<<"$full")")"
out=$(mstrip 170 "$full")
check "minimal: 1 row" [ "$(wc -l <<<"$out")" -eq 1 ]
check "minimal: place and model left, meters right" grep -q '^~  Opus  high  .*  cch 40m ┃ ctx [^ ]*  42% ┃ 5h [^ ]*  30%  2h0m ┃ wk [^ ]*  12%  2d7h$' <<<"$out"
check "minimal: 12-cell bars" [ "$(perl -Mutf8 -CS -ne 'print scalar(() = /[▰▱]/g)' <<<"$out")" -eq 36 ]
check "minimal: fills 166 cols" [ "$(widest <<<"$out")" -eq 166 ]
# right of the model only: the folder is a random temp path
check "minimal: no email, version, clock, id, uptime, skill, thinking" bash -c "! grep -qE 'a…h|v[0-9]|[0-9]{2}:[0-9]{2}|abcdef12|up |pr|thinking' <<<'${out#*Opus  high}'"
# a digit more must not change what fits: same left part at every width for 9% and 10%
flip=0; for w in $(seq 60 2 130); do
  a=$(mstrip $w "${full//\"used_percentage\":42.4/\"used_percentage\":9}" | perl -pe 's/ (cch|ctx) .*//')
  b=$(mstrip $w "${full//\"used_percentage\":42.4/\"used_percentage\":10}" | perl -pe 's/ (cch|ctx) .*//')
  [ "$a" = "$b" ] || flip=$w
done
check_eq "minimal: 9% vs 10% keeps the left part" 0 "$flip"
for w in 120 90 70 50 30; do
  o=$(mstrip $w "$full")
  check "minimal: $w cols -> 1 row within $((w - 4))" [ "$(wc -l <<<"$o" | tr -d ' ')/$(widest <<<"$o" | awk -v w=$((w - 4)) '{ print ($1 <= w) }')" = 1/1 ]
done
check "minimal: 120 cols keeps every meter" grep -q 'cch .* ┃ ctx .* ┃ 5h .* ┃ wk ' <<<"$(mstrip 120 "$full")"
check "minimal: 50 cols drops wk, keeps ctx" bash -c "o=\$(cat); grep -q 'ctx' <<<\"\$o\" && ! grep -q 'wk' <<<\"\$o\"" <<<"$(mstrip 50 "$full")"
check "minimal: no reply yet -> cch --" grep -q ' cch  -- ┃ ctx ' <<<"$(mstrip 120 '{"session_id":"w1"}')"
check "minimal: cold -> cch 0m" grep -q ' cch  0m ┃ ctx ' <<<"$(data <<<"$full" | perl -pe 's/^cch\t.*/cch\t100/; s/^cch_note\t.*/cch_note\tcold/' | HOME="$TMP" COLUMNS=170 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')"
check "minimal: limits waiting -> placeholders" grep -q '5h .*--% *-- ┃ wk .*--% *--$' <<<"$(mstrip 90 '{"session_id":"w1"}')"
rm "$C/claudzilla.json"

check "render: not a repo -> no branch" bash -c "! head -1 <<<'$(render "$full")' | grep -q '⎇'"
narrow=$(data <<<"$full" | COLUMNS=60 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g')
check "render: narrow fits 56 cols" [ "$(perl -CS -ne 'chomp; $m = length if length > $m; END { print $m }' <<<"$narrow")" -eq 56 ]

# row1 <cwd> [env...]: first rendered row, colours stripped, COLUMNS=60
row1() { local d=$1; shift; env "$@" CLAUDE_CONFIG_DIR="$C" HUD_DUMP=1 perl "$HUD/hud.pl" <<<"{\"session_id\":\"sid-u\",\"workspace\":{\"current_dir\":\"$d\"}}" | env "$@" CLAUDE_CONFIG_DIR="$C" COLUMNS=60 HUD_KV=1 perl "$HUD/hud.pl" | head -1 | perl -pe 's/\e\[[0-9;]*m//g'; }
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
# git status refreshes and rewrites a stale index unless --no-optional-locks: that holds index.lock against the user's git
IX="$TMP/ix"; mkdir -p "$IX"; echo a > "$IX/f"; git -C "$IX" init -q -b main; git -C "$IX" add f
git -C "$IX" -c user.name=t -c user.email=t@t commit -qm i; touch -d '1 hour ago' "$IX/.git/index"; touch "$IX/f"
ixs=$(stat -c %Y "$IX/.git/index"); row1 "$IX" >/dev/null
check "render: git status never writes the index" [ "$(stat -c %Y "$IX/.git/index")" = "$ixs" ]
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
cp "$HUD/hud.pl" "$R/claude/hud/"; cp "$REPO/.github/next-version.sh" "$R/.github/"
g() { git -C "$R" -c user.name=t -c user.email=t@t "$@"; }
verfresh() { rm -f "$TMP"/claudzilla-rules-*/hud-ver-*; ver; }
ver() { data <<<"$full" | COLUMNS=120 HUD_KV=1 perl "$R/claude/hud/hud.pl" | head -1 | perl -pe 's/\e\[[0-9;]*m//g'; }
g init -q -b main; g commit -q --allow-empty -m a
check "render: no tags -> no version" grep -q 'a…h@example.test$' <<<"$(verfresh)"
g tag v9.9.9
check "render: on release tag -> tag far right" grep -q 'a…h@example.test  v9.9.9$' <<<"$(verfresh)"
g commit -q --allow-empty -m 'docs: x'
check "render: no release due -> last tag" grep -q 'a…h@example.test  v9.9.9$' <<<"$(verfresh)"
g commit -q --allow-empty -m 'feat(hud): x'
check "render: ahead with feat -> next minor" grep -q 'a…h@example.test  v9.10.0$' <<<"$(verfresh)"
g tag backup
check "render: non-release tag ignored" grep -q 'a…h@example.test  v9.10.0$' <<<"$(verfresh)"


# --- caches: reads that did not change are skipped; times, not text, are cached ---
CD="$TMP/claudzilla-rules-$(id -u)"
cfull() { local t=$1 sid=$2; echo "${full//$T/$t}" | sed "s/abcdef1234567890/$sid/"; }
tick() { data <<<"$(cfull "$1" "$2")"; }
# tick with the clock frozen <off> seconds ahead: a file written now is no longer racy, and time passes without a sleep
tick_at() { local off=$1; shift; FROZEN_TIME=$(( $(date +%s) + off )) PERL5LIB="$PL" CLAUDE_CONFIG_DIR="$C" HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl" <<<"$(cfull "$@")"; }
sk() { printf '{"timestamp":"%s","message":{"content":[{"type":"tool_use","id":"x","name":"Skill","input":{"skill":"%s"}}]}}\n' "$(iso 30)" "$1"; }
CT="$TMP/c1.jsonl"; { echo "{\"timestamp\":\"$(iso 5400)\",\"message\":{\"content\":\"hi\"}}"; sk pr; } > "$CT"
# a file changed in the current second is never cached (racy), so let the clock pass first; the rewrite below needs a real new second for ctime
sleep 1; tick "$CT" csid1 >/dev/null
# chmod would move ctime and miss the cache; instead plant a value only a cache hit can return
perl -i -pe 's/^skill\tpr$/skill\tzz/' "$CD/hud-csid1.cache"
check_eq "cache: unchanged transcript reads nothing" zz "$(key skill "$(tick "$CT" csid1)")"
tick "$CT" csid1 >/dev/null
c=$(cat "$CT"); printf '%s\n' "${c//\"pr\"/\"qq\"}" > "$CT"
check_eq "cache: same-size rewrite of a cached transcript shows the new skill" qq "$(key skill "$(tick "$CT" csid1)")"
sk new >> "$CT"
# start of a new second, so write, tick and rewrite share it: the first tick must store nothing
s=$(date +%s); until [ "$(date +%s)" != "$s" ]; do :; done
CR="$TMP/c1r.jsonl"; sk pr > "$CR"; tick "$CR" csidR >/dev/null
c=$(cat "$CR"); printf '%s\n' "${c//\"pr\"/\"qq\"}" > "$CR"
check_eq "cache: file changed this second is not cached" qq "$(key skill "$(tick "$CR" csidR)")"
check_eq "cache: changed transcript shows the new skill" new "$(key skill "$(tick "$CT" csid1)")"
CU="$TMP/c2.jsonl"; echo '{"type":"mode","mode":"normal"}' > "$CU"
u0=$(key up "$(tick "$CU" csid2)")
echo "{\"timestamp\":\"$(iso 600)\",\"message\":{\"content\":\"hi\"}}" >> "$CU"
check "cache: up appears once a timestamp line arrives" bash -c '[ -z "$1" ] && [ "$2" = 10m ]' _ "$u0" "$(key up "$(tick "$CU" csid2)")"
CK="$TMP/c3.jsonl"; echo "{\"timestamp\":\"$(iso 25)\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"\"}]}}" > "$CK"
t1=$(key thinking "$(tick_at 2 "$CK" csid3)")
check "cache: thinking recomputed on an unchanged transcript" bash -c '[ "$1" = 1 ] && [ -z "$2" ]' _ "$t1" "$(key thinking "$(tick_at 7 "$CK" csid3)")"
# a 4 MB cut inside a multi-byte character must not push the whole slice through the slow decode fallback
CM="$TMP/c5.jsonl"
perl -e 'my $tail = shift; my $r = 4194305 - 91 - length $tail;
  print "a" x 99, "\n" for 1 .. 1000; print "\xe2\x86\x92" x 30, "\n"; print "b" x 99, "\n" for 1 .. int($r / 100);
  print "c" x ($r % 100 - 1), "\n" if $r % 100; print $tail' "$(sk pr)"$'\n' > "$CM"
check "cache: transcript over 4 MB cut mid-character: size" [ "$(stat -c %s "$CM" 2>/dev/null || stat -f %z "$CM")" -gt 4194304 ]
m0=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000'); mo=$(tick "$CM" csid5); m1=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
check_eq "cache: 4 MB cut mid-character still finds the skill" pr "$(key skill "$mo")"
check "cache: 4 MB cut mid-character reads in under 250 ms" [ $(( m1 - m0 )) -lt 250 ]
echo "  mid-char tick: $(( m1 - m0 )) ms"
CH="$TMP/c4.jsonl"; echo "{\"type\":\"assistant\",\"timestamp\":\"$(iso 60)\",\"message\":{\"usage\":{\"input_tokens\":5,\"cache_creation\":{\"ephemeral_5m_input_tokens\":10}}}}" > "$CH"
h1=$(key cch "$(tick_at 2 "$CH" csid4)")
check "cache: cch recomputed on an unchanged transcript" [ "$(key cch "$(tick_at 7 "$CH" csid4)")" -gt "$h1" ]
VF="$CD/hud-ver-$(perl -e 'my $h = 2166136261; for (unpack "C*", $ARGV[0]) { $h ^= $_; $h = ($h * 16777619) & 0xffffffff } printf "%08x", $h' "$R/claude/hud")"
vset() { perl -i -pe "s/^$1\t.*/$1\t$2/" "$VF" 2>/dev/null; }
vat() { awk -F'\t' '$1=="at"{print $2}' "$VF"; }
verfresh >/dev/null; vset ver v0.0.1-bogus
check "cache: version reused within 60 s" grep -q 'v0.0.1-bogus$' <<<"$(ver)"
verfresh >/dev/null; vset at $(( $(date +%s) - 61 )); vset ver v0.0.1-bogus; o=$(ver)
check "cache: version recomputed past 60 s" bash -c '[ $(( $(date +%s) - $(cat "$2") )) -le 2 ] && grep -q "v9.10.0$" <<<"$1"' _ "$o" <(vat)
verfresh >/dev/null; vset at $(( $(date +%s) + 65 )); vset ver v0.0.1-bogus
check "cache: version recomputed when at is in the future" bash -c '[ -s "$2" ] && grep -q "v9.10.0$" <<<"$1"' _ "$(ver)" "$VF"
sn() { data <<<"$full" | COLUMNS=170 HUD_KV=1 perl "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
sn_at() { data <<<"$full" | FROZEN_TIME=$(( $(date +%s) + $1 )) PERL5LIB="$PL" COLUMNS=170 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
mkdir -p "$C/sessions"; echo '{"sessionId":"abcdef1234567890","name":"n1"}' > "$C/sessions/1.json"; sn_at 2 >/dev/null
echo '{"sessionId":"abcdef1234567890","name":"n22"}' > "$C/sessions/1.json"
check "cache: session rename shows on the next tick" grep -q 'n22' <<<"$(sn)"
rm -rf "$C/sessions"
data <<<"$full" >/dev/null; echo '{"oauthAccount":{"emailAddress":"bob.jones@example.test"}}' > "$C/.claude.json"
check "cache: account switch shows on the next tick" [ "$(key profile "$(data <<<"$full")")" = b…s@example.test ]
echo '{"oauthAccount":{"emailAddress":"alex.smith@example.test"}}' > "$C/.claude.json"
rm -f "$CD"/hud-csid5.cache "$TMP/rc"
for i in $(seq 10); do { tick "$CT" csid5 >/dev/null; echo $? >> "$TMP/rc"; } & { tick "$CT" csid5 >/dev/null; echo $? >> "$TMP/rc"; } & done; wait
check "cache: two ticks at once" bash -c '[ "$(grep -cx 0 "$1")" = 20 ] && [ -s "$2" ] && ! grep -qv "^[^	][^	]*	" "$2"' _ "$TMP/rc" "$CD/hud-csid5.cache"
FT=$(date +%s)
fr() { frz() { FROZEN_TIME=$FT TZ=UTC PERL5LIB="$PL" "$@"; }; frz env HUD_DUMP=1 perl -MFrozen "$HUD/hud.pl" <<<"$(cfull "$CT" csid6)" | frz env COLUMNS=120 HUD_KV=1 perl -MFrozen "$HUD/hud.pl" | perl -pe 's/\e\[[0-9;]*m//g'; }
rm -f "$CD"/hud-csid6.cache; a=$(fr); echo garbage > "$CD/hud-csid6.cache"; b=$(fr)
check "cache: corrupt cache file is a miss" [ "$a" = "$b" ]

# --- palette: today's look, byte for byte ---
# a tagged clone copy (fixed version) that is also the dirty cwd (branch, dirty), under a fake HOME (~/gold)
GH="$TMP/ghome"; G="$GH/gold"; GC="$TMP/gcfg"; mkdir -p "$G/claude/hud" "$G/.github" "$GC/sessions"
cp "$HUD/hud.pl" "$G/claude/hud/"; cp "$REPO/.github/next-version.sh" "$G/.github/"; printf 'a\nb\n' > "$G/f"
gg() { git -C "$G" -c user.name=t -c user.email=t@t "$@"; }
gg init -q -b main; gg add -A; gg commit -qm init; gg tag v9.9.9; printf 'a\nc\n' > "$G/f"; touch "$G/u"
echo '{"sessionId":"abcdef1234567890","name":"maxis-24"}' > "$GC/sessions/1.json"
KV=$(printf 'id\tabcdef12\nsid\tabcdef1234567890\ncwd\t%s\nmodel\tOpus\neffort\thigh\nctx\t42\ncch\t50\ncch_note\t30m\n5h\t30\n5h_note\t2h0m\nwk\t12\nwk_note\t2d7h\nprofile\ta…h@example.test\nup\t90m\nskill\tpr\nthinking\t1' "$G")
# frame <offset s> <cols> [extra kv line]: the payload plus hud.pl's pal_ lines, as the pipe sends them
frame() { { printf '%s\n' "$KV" ${3:+"$3"}; CLAUDE_CONFIG_DIR="$GC" HUD_DUMP=1 perl "$HUD/hud.pl" </dev/null | grep '^pal_'; } |
  FROZEN_TIME=$((1790000000 + $1)) TZ=UTC HOME="$GH" CLAUDE_CONFIG_DIR="$GC" COLUMNS=$2 PERL5LIB="$PL" HUD_KV=1 perl -MFrozen "$G/claude/hud/hud.pl"; }
golden() { for t in 0 40 50 72; do echo "== $t 120"; frame "$t" 120; done; echo "== 45 170 compact"; frame 45 170 $'layout\tcompact'; echo "== 45 170 minimal"; frame 45 170 $'layout\tminimal'; echo "== 0 60"; frame 0 60; }
golden > "$TMP/golden.out"
[ -n "${HUD_GOLDEN_WRITE:-}" ] && cp "$TMP/golden.out" "$REPO/tests/fixtures/hud-golden.txt"
check "palette: no palette -> byte-identical to tests/fixtures/hud-golden.txt" cmp -s "$TMP/golden.out" "$REPO/tests/fixtures/hud-golden.txt"
want=$(node --experimental-strip-types --no-warnings -e "import {DEFAULTS} from '$REPO/plugins/margin/hooks/palette.ts'; for (const t of ['shared','hud']) for (const [k,v] of Object.entries(DEFAULTS[t])) if (v !== null) console.log('pal_'+t+'_'+k+'\t'+v); for (const [k,v] of Object.entries(DEFAULTS.margin.types)) console.log('pal_types_'+k+'\t'+v)" | sort)
got=$(CLAUDE_CONFIG_DIR="$GC" HUD_DUMP=1 perl "$HUD/hud.pl" </dev/null | grep '^pal_' | sort)
check "palette: hud.pl shared, hud and margin.types defaults equal palette.ts" bash -c '[ -n "$1" ] && [ "$1" = "$2" ]' _ "$want" "$got"
check "palette: no session colour sent by default" bash -c '! grep -q "^pal_hud_session" <<<"$1"' _ "$got"
for p in folio primer ballot; do
  check "palette.ts copy in $p identical to margin" cmp -s "$REPO/plugins/margin/hooks/palette.ts" "$REPO/plugins/$p/hooks/palette.ts"
done
echo '{"palette":{"shared":{"action":"#010203","label":"#A0B0C0"},"hud":{"session":"#0a0b0c"}}}' > "$GC/claudzilla.json"
out=$(frame 0 120)
check "palette: shared.action recolours the branch glyph, 2 spaces after it" grep -q $'\e\\[38;2;1;2;3m⎇  \e\\[0mmain' <<<"$out"
check "palette: uppercase hex accepted" grep -q $'\e\\[38;2;160;176;192mctx' <<<"$out"
check "palette: hud.session colours the session name" grep -q $'\e\\[38;2;10;11;12mmaxis-24' <<<"$out"
printf '{"palette":{"shared":{"label":"#12\\u001b[0m"},"hud":"x","margin":{"ahead":"#010203"}}}' > "$GC/claudzilla.json"
kv=$(CLAUDE_CONFIG_DIR="$GC" HUD_DUMP=1 perl "$HUD/hud.pl" </dev/null)
check_eq "palette: escape in a value -> default sent" '#a396d2' "$(key pal_shared_label "$kv")"
check "palette: \"hud\": \"x\" -> hud defaults sent" [ "$(key pal_hud_rampHot "$kv")" = '#ffaa5a' ]
check "palette: escape never reaches the output" bash -c '! grep -q "#12" <<<"$1"' _ "$(frame 0 120)"
check "palette: margin table not sent" bash -c '! grep -q "^pal_margin" <<<"$1"' _ "$kv"
echo '{"palette":{"shared":{"label":"nope"},"hud":{"rampHot":"#12"}}}' > "$GC/claudzilla.json"
out=$(frame 0 120)
check "palette: invalid override still renders" bash -c '[ -n "$1" ] && grep -q "⎇  .*main" <<<"$1"' _ "$out"
printf '{bad' > "$GC/claudzilla.json"
check "palette: broken file -> every default sent" [ "$(CLAUDE_CONFIG_DIR="$GC" HUD_DUMP=1 perl "$HUD/hud.pl" </dev/null | grep -c '^pal_')" -eq 31 ]
rm "$GC/claudzilla.json"
gg switch -qc feat/x
check "palette: a branch type prefix takes its type colour, the rest plain" grep -q $'⎇  \e\\[0m\e\\[38;2;152;195;121mfeat/\e\\[0mx' <<<"$(frame 0 120)"
echo '{"palette":{"margin":{"types":{"feat":"#010203"}}}}' > "$GC/claudzilla.json"
check "palette: margin.types recolours the branch prefix" grep -q $'\e\\[38;2;1;2;3mfeat/' <<<"$(frame 0 120)"
rm "$GC/claudzilla.json"; gg switch -q main; gg branch -qD feat/x
gg switch -qc release/1.0
check "palette: an unknown prefix draws faint" grep -q $'\e\\[38;2;79;92;104mrelease/\e\\[0m1.0' <<<"$(frame 0 120)"
gg switch -q main; gg branch -qD release/1.0
gg switch -qc chore/y
check "palette: chore/ takes shared.label, as margin's Git tab draws it" grep -q $'\e\\[38;2;163;150;210mchore/\e\\[0my' <<<"$(frame 0 120)"
gg switch -q main; gg branch -qD chore/y
check "palette: no pal_ lines -> frame drawn, exit 0" bash -c 'out=$(printf "" | CLAUDE_CONFIG_DIR="$1" COLUMNS=120 HUD_KV=1 perl "$2/hud.pl") && [ -n "$out" ]' _ "$GC" "$HUD"

# --- trace: hud.change only when the output changes ---
TRC="$TMP/trcfg"; TRT="$TMP/trtmp"; mkdir -p "$TRC" "$TRT"; TR="$TMP/trrepo"; mkdir -p "$TR"
git -C "$TR" init -q -b main
trun() { printf '{"session_id":"trs1","workspace":{"current_dir":"%s"},"model":{"display_name":"Opus"}}' "$TR" |
  CLAUDE_CONFIG_DIR="$TRC" TMPDIR="$TRT" COLUMNS=120 HUD_DUMP=1 perl "$HUD/hud.pl" | CLAUDE_CONFIG_DIR="$TRC" TMPDIR="$TRT" COLUMNS=120 HUD_KV=1 perl "$HUD/hud.pl"; }
TRF="$TRC/claudzilla-trace/trs1.hud.jsonl"
trun >/dev/null; trun >/dev/null
check "trace hud: same payload twice -> one hud.change" [ "$(grep -c '"event":"hud.change"' "$TRF")" -eq 1 ]
git -C "$TR" checkout -q -b feat/x; trun >/dev/null
check "trace hud: branch change -> second entry" [ "$(grep -c '"event":"hud.change"' "$TRF")" -eq 2 ]
check "trace hud: entry names the new branch" bash -c "tail -1 '$TRF' | grep -q 'feat/x'"
check "trace hud: part is hud" grep -q '"part":"hud"' "$TRF"
rm -rf "$TRC/claudzilla-trace" "$TRT"; a=$(trun); ac=$?; rm -rf "$TRC/claudzilla-trace" "$TRT"; : > "$TRC/claudzilla-trace"; b=$(trun); bc=$?
# cwd colours pulse with the clock (hud.pl cwd_str): compare text only
check "trace hud: output unchanged with unwritable trace" [ "$(perl -pe 's/\e\[[0-9;]*m//g' <<<"$a")" = "$(perl -pe 's/\e\[[0-9;]*m//g' <<<"$b")" ]
check "trace hud: exit code unchanged with unwritable trace" [ "$ac" = "$bc" ]

# --- state dir: private per user, never a planted symlink or a dir others can write ---
TRD="$TRT/claudzilla-rules-$(id -u)"
rm -rf "$TRT"; mkdir -p "$TRT"; trun >/dev/null
check_eq "state hud: state dir is private" drwx------ "$(ls -ld "$TRD" | cut -c1-10)"
hud_guarded() {
  rm -rf "$TRT"; mkdir -p "$TRT/victim"; ln -s "$TRT/victim" "$TRD"; local out; out=$(trun)
  rm "$TRD"; mkdir "$TRD"; chmod 777 "$TRD"; trun >/dev/null
  [ -n "$out" ] && [ -z "$(ls -A "$TRT/victim")" ] && [ -z "$(ls -A "$TRD")" ]
}
check "state hud: a planted or open state dir is never used" hud_guarded

summary hud
