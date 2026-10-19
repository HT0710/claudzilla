#!/usr/bin/env bash
# claudzilla-report script: trace excerpt, marks, enterprise gate, gh filing, body fit. gh and claude are stubs.
#   bash tests/report.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/cfg" GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_SYSTEM=/dev/null
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$TMP/bin"
: > "$GIT_CONFIG_GLOBAL"
# gh stub records argv; GH_FAIL=1 makes it fail. claude stub keeps the real binary out of the test.
cat > "$TMP/bin/gh" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$GH_LOG"
while [ $# -gt 0 ]; do [ "$1" = --body-file ] && cp "$2" "$GH_LOG.body"; shift; done
[ -n "${GH_SLEEP:-}" ] && sleep "$GH_SLEEP"
[ -n "${GH_FAIL:-}" ] && { echo "gh: boom" >&2; exit 1; }
echo https://github.com/x/y/issues/1
SH
printf '#!/bin/sh\necho "9.9.9 (Claude Code)"\n' > "$TMP/bin/claude"
chmod +x "$TMP/bin/gh" "$TMP/bin/claude"
export PATH="$TMP/bin:$PATH" GH_LOG="$TMP/gh.log" CLAUDE_CODE_SESSION_ID=s1
AUTHVARS="CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN"
unset $AUTHVARS
cd "$TMP"  # git config user.email must not read the clone's own config
R="$REPO/claude/skills/claudzilla-report/report.mjs"
T="$CLAUDE_CONFIG_DIR/claudzilla-trace"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
account() { printf '{"oauthAccount":{"emailAddress":"%s"}}' "$1" > "$CLAUDE_CONFIG_DIR/.claude.json"; }
gitmail() { printf '[user]\n\temail = %s\n' "$1" > "$GIT_CONFIG_GLOBAL"; }
rep() { node "$R" "$@" </dev/null; }
now_ms() { node -p 'Date.now()'; }
# ent <session> <part> <iso-or-minutes-ago> <event> [json-data]
ent() { node -e 'const [s,p,t,ev,d]=process.argv.slice(1);const ts=/^\d+$/.test(t)?new Date(Date.now()-t*6e4).toISOString():t;
require("fs").mkdirSync(process.argv[0]?process.env.T:"",{recursive:true});
require("fs").appendFileSync(process.env.T+"/"+s+"."+p+".jsonl",JSON.stringify({ts,session:s,part:p,event:ev,id:"abcd1234",level:"info",data:d?JSON.parse(d):undefined})+"\n")' "$@"; }
export T
fresh() { rm -rf "$T" "$GH_LOG"; : > "$GIT_CONFIG_GLOBAL"; rm -f "$CLAUDE_CONFIG_DIR/.claude.json"; rm -rf "$CLAUDE_CONFIG_DIR/claudzilla-reports"; }
ghcalls() { [ -f "$GH_LOG" ] && wc -l < "$GH_LOG" | tr -d ' ' || echo 0; }

fresh; account me@gmail.com
check "gate: gmail -> github" [ "$(rep --gate)" = github ]
fresh; account me@fpt.com
check "gate: fpt.com -> blocked" bash -c '[[ "$(node "$1" --gate </dev/null)" == blocked:* ]]' _ "$R"
fresh
check "gate: no account email -> blocked" bash -c '[[ "$(node "$1" --gate </dev/null)" == blocked:* ]]' _ "$R"
fresh; printf 'not json' > "$CLAUDE_CONFIG_DIR/.claude.json"
check "gate: unparseable account -> blocked" bash -c '[[ "$(node "$1" --gate </dev/null)" == blocked:* ]]' _ "$R"
fresh; account Me@GMAIL.com
check "gate: domain compare ignores case" [ "$(rep --gate)" = github ]
fresh; account me@gmail.com; gitmail me@fpt.com
check "gate: gmail account + fpt.com git email -> blocked" bash -c '[[ "$(node "$1" --gate </dev/null)" == blocked:* ]]' _ "$R"
fresh; account me@gmail.com; gitmail me@proton.me
check "gate: gmail account + proton git email -> github" [ "$(rep --gate)" = github ]
fresh; account me@gmail.com; gitmail 123+me@users.noreply.github.com
check "gate: gmail account + github noreply git email -> github" [ "$(rep --gate)" = github ]

blocked_with() { # name, then a setup command; --file/--search/--comment must exit 3 with gh untouched
  local name=$1; shift
  clean_auth; fresh; "$@"; printf '# t\n\nbody\n' > "$TMP/body.md"; printf 'terms' > "$TMP/terms.txt"
  local o1 o2 o3 r1 r2 r3
  o1=$(rep --file "$TMP/body.md"); r1=$?; o2=$(rep --search "$TMP/terms.txt"); r2=$?; o3=$(rep --comment 3 "$TMP/body.md"); r3=$?
  check "$name: file/search/comment exit 3, gh never called, no link" bash -c '[ "$1" = 3 ] && [ "$2" = 3 ] && [ "$3" = 3 ] && [ "$4" = 0 ] && ! grep -q github.com <<<"$5"' _ "$r1" "$r2" "$r3" "$(ghcalls)" "$o1$o2$o3"
  clean_auth
}
clean_auth() { unset $AUTHVARS; rm -f "$CLAUDE_CONFIG_DIR/settings.json"; }
env_gmail_with() { account me@gmail.com; export "$1"; }
helper_gmail() { account me@gmail.com; printf '{"apiKeyHelper":"x"}' > "$CLAUDE_CONFIG_DIR/settings.json"; }
blocked_with "blocked fpt.com" account me@fpt.com
blocked_with "blocked bedrock" env_gmail_with CLAUDE_CODE_USE_BEDROCK=1
blocked_with "blocked vertex" env_gmail_with CLAUDE_CODE_USE_VERTEX=1
blocked_with "blocked api key" env_gmail_with ANTHROPIC_API_KEY=k
blocked_with "blocked foundry" env_gmail_with CLAUDE_CODE_USE_FOUNDRY=1
blocked_with "blocked auth token" env_gmail_with ANTHROPIC_AUTH_TOKEN=t
blocked_with "blocked apiKeyHelper" helper_gmail
blocked_with "blocked two @" account 'x@corp.com@gmail.com'
clean_auth; fresh; account me@gmail.com; CLAUDE_CODE_USE_BEDROCK=1 rep --gate > "$TMP/g1"; CLAUDE_CODE_USE_VERTEX=1 rep --gate > "$TMP/g2"; ANTHROPIC_API_KEY=k rep --gate > "$TMP/g3"
CLAUDE_CODE_USE_FOUNDRY=1 rep --gate > "$TMP/g5"; ANTHROPIC_AUTH_TOKEN=t rep --gate > "$TMP/g6"
printf '{"apiKeyHelper":"x"}' > "$CLAUDE_CONFIG_DIR/settings.json"; rep --gate > "$TMP/g4"; rm "$CLAUDE_CONFIG_DIR/settings.json"
check "gate: bedrock/vertex/foundry/api key/auth token/apiKeyHelper -> blocked" bash -c 'for i in 1 2 3 4 5 6; do [[ "$(cat "$1/g$i")" == "blocked: api-key/bedrock/vertex auth" ]] || exit 1; done' _ "$TMP"
fresh; account 'x@corp.com@gmail.com'
check "gate: two @ -> blocked" bash -c '[[ "$(node "$1" --gate </dev/null)" == blocked:* ]]' _ "$R"
clean_auth

fresh; account me@gmail.com
printf '# My `echo PWNED` title\n\nTOP LINE\n\n<details>\nSECRETBOTTOM sk-%s\n</details>\n' "$(printf 'a%.0s' {1..30})" > "$TMP/body.md"
out=$(GH_FAIL=1 rep --file "$TMP/body.md"); rc=$?
saved=$(ls "$CLAUDE_CONFIG_DIR"/claudzilla-reports/report-*.txt 2>/dev/null | head -1)
check "file: gh fails -> link has top part only, full body saved" bash -c '[ "$1" = 0 ] && grep -q "TOP+LINE" <<<"$2" && ! grep -q SECRETBOTTOM <<<"$2" && grep -q "labels=report" <<<"$2" && grep -q "SECRETBOTTOM" "$3"' _ "$rc" "$out" "$saved"
check "file: saved body is masked" bash -c '! grep -q "sk-aaaa" "$1" && grep -q "\[masked\]" "$1"' _ "$saved"
check "file: gh stderr shown" grep -q "gh: boom" <<<"$out"
check "file: saved path printed, mode 600/700" bash -c '[ "$(node -p "(require(\"fs\").statSync(process.argv[1]).mode&0o777).toString(8)+\"/\"+(require(\"fs\").statSync(require(\"path\").dirname(process.argv[1])).mode&0o777).toString(8)" "$2")" = 600/700 ] && grep -qF "$2" <<<"$1"' _ "$out" "$saved"
rm -f "$GH_LOG" "$GH_LOG.body"; out=$(rep --file "$TMP/body.md")
check "file: gh ok -> label report, title from file, --body-file, masked body" bash -c 'grep -q -- "issue create" "$1" && grep -q -- "--label report" "$1" && grep -qF -- "--title My \`echo PWNED\` title" "$1" && grep -q -- "--body-file" "$1" && ! grep -q -- "--body " "$1" && grep -q "issues/1" <<<"$2" && grep -q "TOP LINE" "$1.body" && ! grep -q "# My" "$1.body" && ! grep -q "sk-aaaa" "$1.body"' _ "$GH_LOG" "$out"
printf '# t\n\nTOP\n\n<details open>\nOPENLEAK\n</details>\n' > "$TMP/b2.md"
out=$(GH_FAIL=1 rep --file "$TMP/b2.md")
check "file: <details open> split, no leak" bash -c '! grep -q OPENLEAK <<<"$1" && grep -q TOP <<<"$1"' _ "$out"
node -e 'console.log("# t\n\nFIRST PART\n\n"+"ế ".repeat(20000))' > "$TMP/b3.md"
out=$(GH_FAIL=1 rep --file "$TMP/b3.md")
check "file: no details -> first section, URL capped" bash -c 'u=$(grep "^https://github.com" <<<"$1"); [ "${#u}" -le 8000 ] && grep -q FIRST <<<"$u"' _ "$out"
node -e 'console.log("# t\n\n"+"ế ".repeat(32000))' > "$TMP/b4.md"
out=$(GH_FAIL=1 rep --file "$TMP/b4.md")
check "file: huge top part -> URL capped" bash -c 'u=$(grep "^https://github.com" <<<"$1"); [ -n "$u" ] && [ "${#u}" -le 8000 ]' _ "$out"
printf '# \n\nbody\n' > "$TMP/b5.md"; rm -f "$GH_LOG"; rep --file "$TMP/b5.md" >/dev/null; rc=$?
check "file: blank title -> exit 2, gh not called" bash -c '[ "$1" = 2 ] && [ "$2" = 0 ]' _ "$rc" "$(ghcalls)"
node -e 'console.log("# "+"😀".repeat(9000)+"\n\n"+"😀 ".repeat(9000))' > "$TMP/b6.md"
out=$(GH_FAIL=1 rep --file "$TMP/b6.md")
check "file: long emoji title+body -> URL <= 8000, no split pair" bash -c 'u=$(grep "^https://github.com" <<<"$1"); [ "${#u}" -le 8000 ] && node -e "const s=decodeURIComponent(process.argv[1].replace(/\+/g,\" \"));if(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s))process.exit(1)" "$u"' _ "$out"
for v in -1 0.5 abc; do o=$(GH_FAIL=1 CLAUDZILLA_GH_TIMEOUT_MS=$v rep --file "$TMP/body.md" 2>&1); [ "$v" = abc ] && v=abc
  check "timeout env $v: no crash" bash -c '! grep -q RangeError <<<"$1" && grep -q "gh unavailable or failed" <<<"$1"' _ "$o"; done
rm -f "$CLAUDE_CONFIG_DIR"/claudzilla-reports/*.txt "$GH_LOG"; rep --comment 7 "$TMP/body.md" >/dev/null
check "comment: no masked copy left behind" bash -c '! ls "$1"/report-*.txt >/dev/null 2>&1' _ "$CLAUDE_CONFIG_DIR/claudzilla-reports"
rm -f "$CLAUDE_CONFIG_DIR"/claudzilla-reports/*.txt "$GH_LOG"; rep --file "$TMP/body.md" >/dev/null
check "file: success leaves no copy" bash -c '! ls "$1"/report-*.txt >/dev/null 2>&1' _ "$CLAUDE_CONFIG_DIR/claudzilla-reports"
rm -f "$GH_LOG"; out=$(GH_SLEEP=3 CLAUDZILLA_GH_TIMEOUT_MS=500 rep --file "$TMP/body.md")
check "file: gh timeout -> warns about duplicate" grep -q "gh timed out: check https://github.com/.*/issues before filing again" <<<"$out"
printf 'picks card $(echo PWNED)' > "$TMP/terms.txt"; rm -f "$GH_LOG"; rep --search "$TMP/terms.txt" >/dev/null
check "search: terms from file, gh issue list --search" bash -c 'grep -qF -- "issue list" "$1" && grep -qF -- "--search picks card \$(echo PWNED)" "$1"' _ "$GH_LOG"
printf 'find sk-%s now' "$(printf 'a%.0s' {1..30})" > "$TMP/terms.txt"; rm -f "$GH_LOG"; rep --search "$TMP/terms.txt" >/dev/null
check "search: terms masked" bash -c '! grep -q sk-aaaa "$1" && grep -qF "[masked]" "$1"' _ "$GH_LOG"
printf '  \n' > "$TMP/terms.txt"; rm -f "$GH_LOG"; rep --search "$TMP/terms.txt" >/dev/null; rc=$?
check "search: blank terms -> exit 2, gh not called" bash -c '[ "$1" = 2 ] && [ "$2" = 0 ]' _ "$rc" "$(ghcalls)"
rm -f "$GH_LOG" "$GH_LOG.body"; rep --comment 7 "$TMP/body.md" >/dev/null
check "comment: gh issue comment 7 --body-file" grep -q -- "issue comment 7 --repo .* --body-file" "$GH_LOG"
check "usage: missing args exit 2, no stack trace" bash -c 'for a in "--file" "--search" "--comment 3" "--fit" "--mark" "--comment x f"; do o=$(node "$1" $a </dev/null 2>&1); [ $? = 2 ] && [[ "$o" == usage:* ]] || { echo "bad: $a -> $o"; exit 1; }; done' _ "$R"

fresh
check "excerpt with no files" bash -c '[ "$(node "$1" --excerpt </dev/null)" = "tracing off or no trace for this session" ]' _ "$R"

fresh
ent s1 guide 1 report.snapshot '{"version":"v9"}'
ent s1 hook 3 b.second; ent s1 mod 4 a.first; ent s1 hook.1 4 a.first.rot
ent s2 hook 3 other.session
ent nosession updater 3 updater.run
ent nosession updater 60 updater.old
rep --excerpt > "$TMP/ex.txt"
check "excerpt merges parts in ts order" bash -c 'e=$(sed 1d "$1" | node -e "const L=require(\"fs\").readFileSync(0,\"utf8\").trim().split(\"\n\");console.log(L.map(l=>JSON.parse(l).event).join(\",\"))"); [ "$e" = "a.first,a.first.rot,b.second,updater.run" ] || { echo "got $e"; exit 1; }; head -1 "$1" | grep -q "\"version\":\"v9\""' _ "$TMP/ex.txt"

fresh
ent s1 hook 30 before; ent s1 report 20 report.mark '{"phase":"start"}'; ent s1 hook 15 inside
ent s1 report 10 report.mark '{"phase":"end"}'; ent s1 hook 6 after; ent s1 guide 5 report.snapshot '{"v":1}'
rep --excerpt | sed 1d | grep -q . && w=$(rep --excerpt | sed 1d | node -e 'console.log(require("fs").readFileSync(0,"utf8").trim().split("\n").map(l=>JSON.parse(l).event).join(","))')
check "excerpt uses the mark window" [ "${w:-}" = "report.mark,inside,report.mark" ]
fresh; ent s1 guide 5 report.snapshot '{"v":1}'; ent s1 hook 20 old; ent s1 hook 7 new; ent s1 hook 2 later
check "excerpt default window: 10 min before snapshot, ends at it" bash -c 'o=$(node "$1" --excerpt </dev/null); [ "$(sed 1d <<<"$o" | grep -c "\"event\":\"new\"")" = 1 ] && ! grep -q "\"event\":\"old\"" <<<"$o" && ! grep -q "\"event\":\"later\"" <<<"$o"' _ "$R"

# F2: only this session's trace, from CLAUDE_CODE_SESSION_ID
fresh; ent s1 hook 6 mine1; ent s1 guide 5 report.snapshot '{"who":"s1"}'; ent s2 hook 3 theirs2; ent s2 guide 1 report.snapshot '{"who":"s2"}'
o=$(rep --excerpt)
check "excerpt: env session picks its own snapshot and trace" bash -c 'head -1 <<<"$1" | grep -q "\"who\":\"s1\"" && grep -q mine1 <<<"$1" && ! grep -q "theirs2\|\"who\":\"s2\"" <<<"$1"' _ "$o"
o=$(CLAUDE_CODE_SESSION_ID=s2 rep --excerpt)
check "excerpt: other env session gets the other trace" bash -c 'head -1 <<<"$1" | grep -q "\"who\":\"s2\"" && grep -q theirs2 <<<"$1" && ! grep -q mine1 <<<"$1"' _ "$o"
o=$(env -u CLAUDE_CODE_SESSION_ID node "$R" --excerpt </dev/null)
check "excerpt: no session id -> says so, live snapshot, no excerpt" bash -c '[ "$(head -1 <<<"$1")" = "no session id" ] && grep -q "\"claudeCode\":\"9.9.9" <<<"$1" && ! grep -q "mine1\|theirs2\|\"who\"" <<<"$1"' _ "$o"
o=$(CLAUDE_CODE_SESSION_ID= rep --excerpt)
check "excerpt: empty session id -> no session id" [ "$(head -1 <<<"$o")" = "no session id" ]
: > "$T/.off"; o=$(rep --excerpt)
check "excerpt: .off -> tracing off, live snapshot, no excerpt" bash -c '[ "$(head -1 <<<"$1")" = "tracing off" ] && grep -q "\"claudeCode\":\"9.9.9" <<<"$1" && ! grep -q "mine1\|\"who\"" <<<"$1"' _ "$o"
o=$(rep --mark start)
check "mark: .off -> tracing off, nothing written" bash -c '[ "$1" = "tracing off" ] && [ ! -e "$2/s1.report.jsonl" ]' _ "$o" "$T"
rm -f "$T/.off"; o=$(env -u CLAUDE_CODE_SESSION_ID node "$R" --mark start </dev/null)
check "mark: no session id -> says so, nothing written" bash -c '[ "$1" = "no session id" ] && ! ls "$2"/*.report.jsonl >/dev/null 2>&1' _ "$o" "$T"

# I1: private text left out of the excerpt
fresh; ent s1 hook 3 priv '{"prompt":"my secret plan","n":{"title":"abc","text":["x"]},"judged":"y","reason":"why not","keep":"shown"}'
ent s1 hook 2 creds '{"cmd":"git clone https://bob:hunter2@host/x","env":"PASSWORD=hunter2 next","t":"token: abc123 ok","p":"pwd=zz"}'
ent s1 guide 1 report.snapshot '{"v":1}'
o=$(rep --excerpt)
check "excerpt: prompt/judged/text/title/reason -> [N chars]" bash -c 'grep -q "\"prompt\":\"\[14 chars\]\"" <<<"$1" && grep -q "\"title\":\"\[3 chars\]\"" <<<"$1" && grep -q "\"text\":\"\[5 chars\]\"" <<<"$1" && grep -q "\"judged\":\"\[1 chars\]\"" <<<"$1" && grep -q "\"reason\":\"\[7 chars\]\"" <<<"$1" && grep -q "\"keep\":\"shown\"" <<<"$1" && ! grep -q "secret plan\|why not" <<<"$1"' _ "$o"
check "excerpt: URL credentials and key=value secrets masked" bash -c '! grep -q hunter2 <<<"$1" && ! grep -q "abc123\|zz" <<<"$1" && grep -qF "https://[masked]@host/x" <<<"$1" && grep -qF "PASSWORD=[masked] next" <<<"$1" && grep -qF "token=[masked] ok" <<<"$1" && grep -qF "pwd=[masked]" <<<"$1"' _ "$o"
sed 1d <<<"$o" | node -e 'require("fs").readFileSync(0,"utf8").trim().split("\n").forEach(l=>JSON.parse(l))' 2>/dev/null
check "excerpt: lines stay valid JSON" [ $? = 0 ]
fresh; ent s1 guide 30 report.snapshot '{"v":1}'; ent s1 hook 29 secretentry
check "excerpt stale snapshot: no excerpt, live snapshot" bash -c 'o=$(node "$1" --excerpt </dev/null); [[ "$o" == "no fresh snapshot"* ]] && grep -q "\"claudeCode\":\"9.9.9" <<<"$o" && ! grep -q secretentry <<<"$o"' _ "$R"

fresh; ent s1 guide 1 report.snapshot '{"v":1}'
rep --mark start; rep --mark end
check "mark writes report.mark in the snapshot's session" bash -c 'f="$1/s1.report.jsonl"; [ "$(grep -c "\"event\":\"report.mark\"" "$f")" = 2 ] && grep -q "\"phase\":\"start\"" "$f" && grep -q "\"session\":\"s1\"" "$f"' _ "$T"

fresh; ent s1 guide 30 report.snapshot '{"v":1}'
o=$(rep --mark start)
check "mark: stale snapshot -> no fresh snapshot, nothing written" bash -c '[ "$1" = "no fresh snapshot" ] && [ ! -e "$2/s1.report.jsonl" ]' _ "$o" "$T"

fresh; mkdir -p "$CLAUDE_CONFIG_DIR"
printf '{"enabledPlugins":{"guide@claudzilla":true,"off@claudzilla":false,"x@other":true}}' > "$CLAUDE_CONFIG_DIR/settings.json"
printf '{"a":{"b":"SECRETVALUE"}}' > "$CLAUDE_CONFIG_DIR/settings.overrides.json"
s=$(rep --snapshot)
check "snapshot: mods enabled only, key names only, writes nothing" bash -c '[ ! -e "$2" ] && grep -q "\"mods\":\[\"guide@claudzilla\"\]" <<<"$1" && grep -q "\"overrideKeys\":\[\"a.b\"\]" <<<"$1" && ! grep -q SECRETVALUE <<<"$1" && grep -q "\"claudeCode\":\"9.9.9" <<<"$1" && grep -q "\"commit\":\"[0-9a-f]\{40\}\"" <<<"$1"' _ "$s" "$T"
rm -f "$CLAUDE_CONFIG_DIR/settings.json" "$CLAUDE_CONFIG_DIR/settings.overrides.json"

fresh; d=$(rep --drafts)
check "drafts: prints the 0700 drafts folder outside the protected config dir" bash -c '[ "$1" = "$2/.cache/claudzilla/report-drafts" ] && [ "$(node -p "[process.argv[1],require(\"path\").dirname(process.argv[1])].map(p=>(require(\"fs\").statSync(p).mode&0o777).toString(8)).join()" "$1")" = 700,700 ]' _ "$d" "$HOME"

# fit
mk() { node -e 'const n=+process.argv[1];const L=["## Top","what happened","<details>","","#### Snapshot","```json","{\"keep\":\"snapshot\"}","```","","#### Trace excerpt","```jsonl"];
for(let i=0;i<n;i++)L.push(JSON.stringify({i,pad:"ab ".repeat(330)}));L.push("```","","#### Steps to reproduce in tmux","1. keep steps","</details>");console.log(L.join("\n"))' "$1" > "$TMP/fit.md"; }
mk 50; cp "$TMP/fit.md" "$TMP/fit0.md"; rep --fit "$TMP/fit.md" >/dev/null
check "fit: small body untouched" cmp -s "$TMP/fit.md" "$TMP/fit0.md"
mk 200; rep --fit "$TMP/fit.md" >/dev/null
check "fit keeps snapshot and steps" bash -c 'f=$1; [ "$(wc -c < "$f")" -le 65000 ] && grep -q "keep.*snapshot" "$f" && grep -q "1. keep steps" "$f" && grep -q "\"i\":199," "$f" && ! grep -q "\"i\":0," "$f" && grep -q "older trace lines cut" "$f" && [ "$(grep -c "^\`\`\`" "$f")" = 4 ]' _ "$TMP/fit.md"

printf '# t\nsk-%s\n' "$(printf 'a%.0s' {1..30})" > "$TMP/m.md"; rep --fit "$TMP/m.md" >/dev/null
check "fit masks the body" bash -c '! grep -q sk-aaaa "$1" && grep -q "\[masked\]" "$1"' _ "$TMP/m.md"

echo "report: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
