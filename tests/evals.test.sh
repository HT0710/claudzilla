#!/usr/bin/env bash
# Offline eval-harness tests: case graders, run.mjs against a fake `claude`, report.mjs on canned rows.
#   bash tests/evals.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
EV="$REPO/evals"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }

# --- graders: bare fixture fails; fixture + solution.patch (+ solution.jsonl transcript) passes; wrong*.jsonl transcripts fail
graded=0
for d in "$EV"/cases/*/*/; do
  [ -f "$d/solution.patch" ] || [ -f "$d/solution.jsonl" ] || continue
  d=${d%/}; n=${d#"$EV"/cases/}; graded=$((graded+1))
  w="$TMP/grade/$n"; mkdir -p "$w"
  [ -d "$d/fixture" ] && cp -R "$d/fixture/." "$w/"
  [ -f "$d/setup.sh" ] && check "setup.sh runs: $n" bash -c 'cd "$1" && CASE_DIR="$2" REPO="$3" bash "$2/setup.sh" >/dev/null 2>&1' _ "$w" "$d" "$REPO"
  sol=""; [ -f "$d/solution.jsonl" ] && sol="$d/solution.jsonl"
  check "grader rejects bare fixture: $n" bash -c '! WORKDIR="$1" TRANSCRIPT= bash "$2/grade.sh" >/dev/null 2>&1' _ "$w" "$d"
  [ -f "$d/solution.patch" ] && (cd "$w" && patch -s -p1 < "$d/solution.patch")
  for x in "$d"/wrong*.jsonl; do
    [ -f "$x" ] || continue
    check "grader rejects ${x##*/}: $n" bash -c '! WORKDIR="$1" TRANSCRIPT="$3" bash "$2/grade.sh" >/dev/null 2>&1' _ "$w" "$d" "$x"
  done
  # Last: some graders mutate the workdir (migration runs rollback.sh).
  check "grader accepts solution: $n" bash -c 'WORKDIR="$1" TRANSCRIPT="$3" bash "$2/grade.sh" >/dev/null 2>&1' _ "$w" "$d" "$sol"
done
check "graders: at least one synthetic case" [ "$graded" -gt 0 ]

# --- fake claude: logs argv (one line per call), applies $FAKE_PATCH, writes a transcript, prints result JSON
mkdir -p "$TMP/bin" "$TMP/cfg" "$TMP/tmp"
cat > "$TMP/bin/claude" <<'EOF'
#!/usr/bin/env bash
[ "$1" = --version ] && { echo "9.9.9 (fake)"; exit 0; }
{ printf '%s' "$*" | tr '\n' ' '; echo " ROUTING=${EVAL_ROUTING-unset} PATH-HEAD=${PATH%%:*}"; } >> "$FAKE_LOG"
case "${FAKE_MODE:-ok}" in
  error) echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"rate limited"}'; exit 1 ;;
  hang) exec sleep 5 ;;
esac
case " $* " in *" --json-schema "*) echo '{"type":"result","subtype":"success","is_error":false,"structured_output":{"score":0.5,"matched":["a"],"missed":["b"]},"total_cost_usd":0.1}'; exit 0 ;; esac
sid="fake-$$" model=x
while [ $# -gt 0 ]; do
  case "$1" in --resume) sid=$2 ;; --model) model=$2 ;; esac
  shift
done
[ -n "${FAKE_PATCH:-}" ] && patch -s -N -p1 < "$FAKE_PATCH" >/dev/null 2>&1
mkdir -p "$CLAUDE_CONFIG_DIR/projects/fake"
skill=""; [ -n "${FAKE_SKILL:-}" ] && skill=",{\"type\":\"tool_use\",\"name\":\"Skill\",\"input\":{\"skill\":\"$FAKE_SKILL\"}}"
echo "{\"type\":\"assistant\",\"message\":{\"id\":\"m$$\",\"model\":\"claude-$model\",\"usage\":{\"output_tokens\":7},\"content\":[{\"type\":\"text\",\"text\":\"ok\"}$skill]}}" >> "$CLAUDE_CONFIG_DIR/projects/fake/$sid.jsonl"
echo "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"session_id\":\"$sid\",\"total_cost_usd\":0.5,\"num_turns\":2,\"duration_ms\":1000,\"permission_denials\":[{\"tool_name\":\"Bash\"}],\"modelUsage\":{\"claude-$model\":{\"outputTokens\":7,\"costUSD\":0.25}}}"
EOF
chmod +x "$TMP/bin/claude"
export PATH="$TMP/bin:$PATH" CLAUDE_CONFIG_DIR="$TMP/cfg" TMPDIR="$TMP/tmp" FAKE_LOG="$TMP/calls.log"

# test cases: copies of the pilot fixture with their own case.json
mk() { mkdir -p "$TMP/cases/t/$1"; cp -R "$EV/cases/pilot/sum/." "$TMP/cases/t/$1/"; printf '%s\n' "$2" > "$TMP/cases/t/$1/case.json"; }
mk two '{"role":"t","matrix":[{"model":"haiku","effort":"low"},{"model":"sonnet","effort":"high"}],"followups":["go"],"allowed_tools":["Read","Bash(bash test.sh)"]}'
mk skill '{"role":"t","skill":"superpowers:systematic-debugging","matrix":[{"model":"opus","effort":"high"}]}'
mk slow '{"role":"t","timeout_seconds":1,"matrix":[{"model":"opus","effort":"low"},{"model":"opus","effort":"high"}]}'
mk agent '{"role":"a","agent":"caveman:cavecrew-reviewer","followups":["go"],"matrix":[{"model":"haiku","effort":"medium"}]}'
SOL="$EV/cases/pilot/sum/solution.patch"
run() { node "$EV/run.mjs" --root "$TMP/cases" "$@"; }
calls() { if [ -f "$FAKE_LOG" ]; then wc -l < "$FAKE_LOG" | tr -d ' '; else echo 0; fi; }
field() { node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}});console.log(rows.map(r=>r[process.argv[2]]).join(" "))' "$1" "$2"; }

# --- run.mjs: flags per turn, followups resume with flags re-passed, rows graded
FAKE_PATCH="$SOL" run --cases 't/two' --out "$TMP/o1" >/dev/null
check "run: one call per turn per cell" [ "$(calls)" = 4 ]
check "run: first turn carries model, effort, dontAsk, tools" grep -q -- '--model haiku --effort low --permission-mode dontAsk --allowedTools Read,Bash(bash test.sh)' "$FAKE_LOG"
check "run: followup resumes with flags re-passed" bash -c 'sed -n 2p "$1" | grep -q -- "--model haiku --effort low.*--resume fake-"' _ "$FAKE_LOG"
check "run: second cell flags" grep -q -- '--model sonnet --effort high' "$FAKE_LOG"
check "run: Bash rules mirrored for the rtk hook" grep -q -- 'Bash(rtk bash test.sh)' "$FAKE_LOG"
check "run: echo and rtk read-only forms allowed" grep -q -- 'Bash(echo:\*).*Bash(rtk read:\*)' "$FAKE_LOG"
check "run: graded pass" [ "$(field "$TMP/o1/rows.jsonl" status)" = "pass pass" ]
check "run: cost summed over turns" [ "$(field "$TMP/o1/rows.jsonl" cost)" = "1 1" ]
check "run: workdirs removed" [ -z "$(ls -A "$TMP/tmp")" ]
check "run: permission denials summed over turns" [ "$(field "$TMP/o1/rows.jsonl" denials)" = "2 2" ]

# --- fail, resume, torn line
: > "$FAKE_LOG"
run --cases 't/two' --out "$TMP/o2" >/dev/null
check "run: no fix → fail" [ "$(field "$TMP/o2/rows.jsonl" status)" = "fail fail" ]
echo '{"case":"torn' >> "$TMP/o2/rows.jsonl"
n=$(calls); run --cases 't/two' --out "$TMP/o2" >/dev/null
check "run: re-run skips finished rows and survives a torn line" [ "$(calls)" = "$n" ]

# --- skill must fire
run --cases 't/skill' --out "$TMP/o3" >/dev/null
FAKE_SKILL=superpowers:systematic-debugging FAKE_PATCH="$SOL" run --cases 't/skill' --out "$TMP/o4" >/dev/null
check "run: skill not fired → invalid" [ "$(field "$TMP/o3/rows.jsonl" status)" = invalid ]
check "run: skill fired → graded" [ "$(field "$TMP/o4/rows.jsonl" status)" = pass ]

# --- tx.mjs: transcript facts for graders (fake transcript from the skill run above)
tx=$(grep -l '"Skill"' "$CLAUDE_CONFIG_DIR"/projects/fake/*.jsonl | head -1)
check "tx: last assistant text" [ "$(node "$EV/tx.mjs" text "$tx")" = ok ]
check "tx: one line per tool call" [ "$(node "$EV/tx.mjs" tools "$tx")" = "$(printf 'Skill\tsuperpowers:systematic-debugging')" ]
check "tx: no transcript reads as empty" [ -z "$(node "$EV/tx.mjs" text "")" ]

# --- errored: stop after two in a row, re-queued on re-run, hung child
FAKE_MODE=error run --cases 't/two' --out "$TMP/o5" >/dev/null 2>&1; rc=$?
check "run: two errors stop with exit 3" [ "$rc" = 3 ]
check "run: errored rows recorded" [ "$(field "$TMP/o5/rows.jsonl" status)" = "errored errored" ]
FAKE_PATCH="$SOL" run --cases 't/two' --out "$TMP/o5" >/dev/null
check "run: errored rows re-run" [ "$(field "$TMP/o5/rows.jsonl" status)" = "errored errored pass pass" ]
FAKE_MODE=hang run --cases 't/slow' --out "$TMP/o6" >/dev/null 2>&1
check "run: hung child → errored" [ "$(field "$TMP/o6/rows.jsonl" status)" = "errored errored" ]
check "run: workdirs removed after errors" [ -z "$(ls -A "$TMP/tmp")" ]

# --- agent roles: --agent on every turn (spec success criterion)
: > "$FAKE_LOG"
run --cases 't/agent' --out "$TMP/o8" >/dev/null
check "run: --agent passed on first turn and on resume" [ "$(grep -c -- '--agent caveman:cavecrew-reviewer' "$FAKE_LOG")" = 2 ]

# --- smoke: one headless run per pilot case on haiku low
mkdir -p "$TMP/cases/pilot"; cp -R "$EV/cases/pilot/sum" "$TMP/cases/pilot/x"
printf '%s\n' '{"role":"pilot","timeout_seconds":1}' > "$TMP/cases/pilot/x/case.json"
run --smoke --out "$TMP/o10" >/dev/null 2>&1
check "run: smoke = one headless haiku-low run per pilot case" [ "$(field "$TMP/o10/rows.jsonl" effort)" = low ]

# --- setup.sh: runs in the workdir with CASE_DIR and REPO; workdir bin/ leads PATH; failure aborts
mk setup '{"role":"t","matrix":[{"model":"opus","effort":"low"}]}'
mv "$TMP/cases/t/setup/fixture" "$TMP/cases/t/setup/src"
printf '%s\n' '[ -d "$REPO/evals" ] && cp -R "$CASE_DIR/src/." . && patch -s -p1 < "$CASE_DIR/solution.patch"' > "$TMP/cases/t/setup/setup.sh"
mk badsetup '{"role":"t","matrix":[{"model":"opus","effort":"low"}]}'
echo 'exit 1' > "$TMP/cases/t/badsetup/setup.sh"
: > "$FAKE_LOG"
run --cases 't/setup' --out "$TMP/o11" >/dev/null
check "run: setup.sh builds the workdir (no fixture dir)" [ "$(field "$TMP/o11/rows.jsonl" status)" = pass ]
check "run: workdir bin/ leads PATH" grep -q 'PATH-HEAD=.*/eval-[^/ ]*/bin$' "$FAKE_LOG"
run --cases 't/badsetup' --out "$TMP/o12" >/dev/null 2>&1; rc=$?
check "run: failing setup.sh aborts with no row" bash -c '[ "$1" != 0 ] && [ ! -s "$2" ]' _ "$rc" "$TMP/o12/rows.jsonl"
check "run: workdirs removed after setup failure" [ -z "$(ls -A "$TMP/tmp")" ]

# --- replay cases: no grader (status replayed), judge flag on the row, {{WORKDIR}} in prompts → the workdir
mk replay '{"role":"t","source":"replay","judge":true,"matrix":[{"model":"opus","effort":"low"}]}'
echo 'Review {{WORKDIR}} now.' > "$TMP/cases/t/replay/prompt.md"
: > "$FAKE_LOG"
run --cases 't/replay' --out "$TMP/o13" >/dev/null
check "run: replay rows are replayed, not graded" [ "$(field "$TMP/o13/rows.jsonl" status)" = replayed ]
check "run: judge flag copied to the row" [ "$(field "$TMP/o13/rows.jsonl" judge)" = true ]
check "run: {{WORKDIR}} becomes the workdir" bash -c 'grep -q "Review /.*/eval-[^/ ]* now\." "$1" && ! grep -q "{{WORKDIR}}" "$1"' _ "$FAKE_LOG"

# --- default cells: no matrix in case.json → agent 3 models x low..xhigh, skill opus low..xhigh; never max
for k in agent skill; do mkdir -p "$TMP/cases/d/$k"; cp -R "$EV/cases/pilot/sum/." "$TMP/cases/d/$k/"; done
echo '{"agent":"caveman:cavecrew-reviewer"}' > "$TMP/cases/d/agent/case.json"
echo '{"skill":"superpowers:systematic-debugging"}' > "$TMP/cases/d/skill/case.json"
run --cases 'd/*' --out "$TMP/o15" >/dev/null 2>&1
check "run: default cells stop at xhigh (12 agent, 4 skill, no max)" bash -c '[ "$(grep -c "\"case\":\"d/agent\"" "$1")" = 12 ] && [ "$(grep -c "\"case\":\"d/skill\"" "$1")" = 4 ] && ! grep -q "\"effort\":\"max\"" "$1"' _ "$TMP/o15/rows.jsonl"

# --- replays.mjs: recorded Agent calls (fake transcripts of a 3-commit repo) → local replay cases
G="$TMP/grepo"; mkdir -p "$G"; git -C "$G" init -q -b main
for n in 1 2 3; do echo "$n" > "$G/f$n"; git -C "$G" add -A; git -C "$G" -c user.email=t@t -c user.name=t -c commit.gpgsign=false commit -qm "chore: c$n"; done
c1=$(git -C "$G" rev-parse HEAD~2) c2=$(git -C "$G" rev-parse HEAD~1) c3=$(git -C "$G" rev-parse HEAD)
s1=${c1:0:7} s2=${c2:0:7} s3=${c3:0:7}
mkdir -p "$G/docs"; echo plan > "$G/docs/plan.md"   # untracked, like the local-only docs/superpowers plans
TP="$CLAUDE_CONFIG_DIR/projects/$(printf %s "$G" | sed 's/[^A-Za-z0-9]/-/g')"; mkdir -p "$TP"
agentcall() { node -e 'console.log(JSON.stringify({type:"assistant",timestamp:process.argv[1],message:{content:[{type:"tool_use",name:"Agent",input:{subagent_type:process.argv[2],prompt:process.argv[3]}}]}}))' "$@"; }
{
  agentcall 2026-01-01 caveman:cavecrew-reviewer "Review \`git diff main..HEAD\` in $G (commit $s2)."
  agentcall 2026-01-02 caveman:cavecrew-reviewer "Review \`git diff main..HEAD\` in $G (commit $s2). Read-only."
  agentcall 2026-01-03 general-purpose "Review BASE_SHA $s1 HEAD_SHA $s3 in $G-wt against $G/docs/plan.md."
  agentcall 2026-01-04 general-purpose "Implement task 2 in $G from $s3."
  agentcall 2026-01-05 caveman:cavecrew-reviewer "Review $s3 in $G with $G/.superpowers/sdd/p/review.diff."
  agentcall 2026-01-06 caveman:cavecrew-reviewer "Review the latest commit in $G."
  agentcall 2026-01-07 caveman:cavecrew-reviewer "Review \`git diff $s2..$s3\` in ~/grepo."   # HOME=$TMP below
  agentcall 2026-01-08 caveman:cavecrew-reviewer "Review \`git diff main..HEAD\` in $G (commits $s2, $s3)."
  agentcall 2026-01-09 general-purpose "Review $s3 in $G-wt. Do not read $G (a newer version lives there)."
} > "$TP/s.jsonl"
RP="$TMP/replays"
HOME="$TMP" node "$EV/replays.mjs" --repo "$G" --out "$RP" > "$TMP/ref.txt"
D1="$RP/cavecrew-reviewer/$s1-$s2" D2="$RP/sdd-reviewer/$s1-$s3"
want=$(printf '%s\n' "cavecrew-reviewer/$s1-$s2" "cavecrew-reviewer/$s1-$s3" "cavecrew-reviewer/$s2-$s3" "sdd-reviewer/$s1-$s3" | sort)
check "replays: one case per reviewed range (commit, BASE/HEAD, X..Y, branch commits), reviews only" [ "$(cd "$RP" 2>/dev/null && ls -d */* | sort)" = "$want" ]
check "replays: prints opus xhigh reference cells" [ "$(sed 's/ opus xhigh$//' "$TMP/ref.txt" | sort)" = "$want" ]
node "$EV/replays.mjs" --repo "$G" --out "$TMP/replays1" --per-role 1 >/dev/null
check "replays: --per-role keeps the newest calls" [ "$(cd "$TMP/replays1" && ls -d */* | tr '\n' ' ')" = "cavecrew-reviewer/$s1-$s3 sdd-reviewer/$s1-$s3 " ]
check "replays: newest of duplicate calls kept" grep -q 'Read-only\.' "$D1/prompt.md"
check "replays: checkout paths become {{WORKDIR}}" bash -c 'grep -q "in {{WORKDIR}} against {{WORKDIR}}/docs/plan.md" "$1" && ! grep -q "$2" "$1"' _ "$D2/prompt.md" "$G"
check "replays: ~ form of the checkout path becomes {{WORKDIR}}" grep -q "in {{WORKDIR}}\." "$RP/cavecrew-reviewer/$s2-$s3/prompt.md"
check "replays: call naming the bare checkout and a worktree dropped" [ ! -e "$RP/sdd-reviewer/$s2-$s3" ]
check "replays: children run node tests only" node -e 'const t=require(process.argv[1]).allowed_tools;process.exit(t.includes("Bash(node --test:*)")&&!t.includes("Bash(node:*)")?0:1)' "$D2/case.json"
check "replays: local-only file copied for setup" [ -f "$D2/extra/docs/plan.md" ]
check "replays: case is a judged replay of the recorded agent" node -e 'const c=require(process.argv[1]);process.exit(c.agent==="general-purpose"&&c.source==="replay"&&c.judge===true?0:1)' "$D2/case.json"
mkdir -p "$TMP/rw"; (cd "$TMP/rw" && CASE_DIR="$D2" bash "$D2/setup.sh" >/dev/null 2>&1)
check "replays: setup puts main at the base, HEAD at the tip, no origin" bash -c '[ "$(git -C "$1" rev-parse main HEAD | tr "\n" " ")" = "$2 $3 " ] && [ -z "$(git -C "$1" remote)" ] && [ -f "$1/docs/plan.md" ]' _ "$TMP/rw" "$c1" "$c3"
printf '%s\n' "cavecrew-reviewer/$s1-$s2 haiku low" > "$TMP/c.txt"
node "$EV/run.mjs" --root "$RP" --only "$TMP/c.txt" --out "$TMP/o14" >/dev/null 2>&1
check "run: generated replay runs from its setup.sh" [ "$(field "$TMP/o14/rows.jsonl" status)" = replayed ]

# --- routing cells: off disallows Agent, on/off are separate rows for resume and --only, `base` borrows a case
RC="$TMP/rc"; mkdir -p "$RC/t/src" "$RC/t/based" "$TMP/bad/t/nobase" "$TMP/bad2/t/typo"
cp -R "$EV/cases/pilot/sum/." "$RC/t/src/"; echo '{"role":"t","matrix":[{"model":"haiku","effort":"low"}]}' > "$RC/t/src/case.json"
cp -R "$RC/t/src" "$RC/t/route"
echo '{"role":"t","matrix":[{"model":"opus","effort":"medium","routing":"on"},{"model":"opus","effort":"medium","routing":"off"}]}' > "$RC/t/route/case.json"
echo '{"role":"t","base":"../src","matrix":[{"model":"haiku","effort":"low"}]}' > "$RC/t/based/case.json"; echo 'BASED PROMPT' > "$RC/t/based/prompt.md"
rr() { node "$EV/run.mjs" --root "$RC" "$@"; }
: > "$FAKE_LOG"
FAKE_PATCH="$SOL" rr --cases 't/route' --out "$TMP/o20" >/dev/null
check "routing: one row per on/off cell" [ "$(field "$TMP/o20/rows.jsonl" routing)" = "on off" ]
check "routing: off disallows Agent and sets EVAL_ROUTING" grep -q -- '--disallowedTools Agent.* ROUTING=off' "$FAKE_LOG"
check "routing: on keeps Agent" bash -c 'grep -q "ROUTING=on" "$1" && ! grep "ROUTING=on" "$1" | grep -q -- "--disallowedTools"' _ "$FAKE_LOG"
check "routing: cost split by model" grep -q '"costByModel":{"claude-opus":0.25}' "$TMP/o20/rows.jsonl"
n=$(calls); rr --cases 't/route' --out "$TMP/o20" >/dev/null
check "routing: re-run skips both cells" [ "$(calls)" = "$n" ]
echo 't/route opus medium off' > "$TMP/only-r.txt"
rr --cases 't/route' --only "$TMP/only-r.txt" --out "$TMP/o21" >/dev/null
check "routing: --only fourth word picks one cell" [ "$(field "$TMP/o21/rows.jsonl" routing)" = off ]
: > "$FAKE_LOG"
EVAL_ROUTING=off FAKE_PATCH="$SOL" rr --cases 't/based' --out "$TMP/o22" >/dev/null
check "routing: other cells clear a leaked EVAL_ROUTING" grep -q 'ROUTING= PATH-HEAD' "$FAKE_LOG"
check "base: own prompt, borrowed fixture and grader" bash -c 'grep -q "BASED PROMPT" "$1" && [ "$2" = pass ]' _ "$FAKE_LOG" "$(field "$TMP/o22/rows.jsonl" status)"
echo '{"role":"t","base":"../nope"}' > "$TMP/bad/t/nobase/case.json"; echo p > "$TMP/bad/t/nobase/prompt.md"
check "base: missing base stops before any run" bash -c '! node "$1/run.mjs" --root "$2" --out "$3" >/dev/null 2>&1' _ "$EV" "$TMP/bad" "$TMP/o23"
cp -R "$RC/t/src/." "$TMP/bad2/t/typo/"; echo '{"role":"t","matrix":[{"model":"opus","effort":"low","routing":"Off"}]}' > "$TMP/bad2/t/typo/case.json"
check "routing: unknown value stops before any run" bash -c '! node "$1/run.mjs" --root "$2" --out "$3" >/dev/null 2>&1' _ "$EV" "$TMP/bad2" "$TMP/o24"

# --- --only limits cells
printf 't/two sonnet high\n' > "$TMP/only.txt"
run --cases 't/*' --only "$TMP/only.txt" --out "$TMP/o7" >/dev/null
check "run: --only runs listed cells only" [ "$(field "$TMP/o7/rows.jsonl" model)" = sonnet ]

# --- judge.mjs: judged rows vs reference rows → scores.jsonl (the fake judge answers 0.5)
J="$TMP/jdg"; mkdir -p "$J/ref" "$J/err"
say() { printf '{"type":"assistant","message":{"id":"m","content":[{"type":"text","text":"%s"}]}}\n' "$2" > "$J/$1.jsonl"; }
say ref1 "ref one"; say cand1 "cand one"; : > "$J/empty.jsonl"
jrow() { printf '{"case":"%s","role":"j","model":"haiku","effort":"low","run":1,"status":"%s","judge":%s,"transcript":"%s"}\n' "$@"; }
{
  jrow j/a replayed true "$J/cand1.jsonl"   # judged
  jrow j/b fail true "$J/empty.jsonl"       # no output: 0 without a call
  jrow j/c pass false "$J/cand1.jsonl"      # not a judged case
  jrow j/d replayed true "$J/cand1.jsonl"   # no reference run
  jrow j/f errored true "$J/cand1.jsonl"    # errored run
  jrow j/e replayed true "$J/gone.jsonl"    # transcript deleted since
  jrow j/h replayed true "$J/cand1.jsonl"   # reference said nothing
} > "$J/rows.jsonl"
{ for k in a b e g; do jrow "j/$k" replayed true "$J/ref1.jsonl"; done; jrow j/h replayed true "$J/empty.jsonl"; } > "$J/ref/rows.jsonl"
: > "$FAKE_LOG"
node "$EV/judge.mjs" "$J/rows.jsonl" "$J/ref/rows.jsonl" >/dev/null 2>&1
check "judge: one call per judged row with output, transcript and reference" [ "$(calls)" = 1 ]
check "judge: fixed opus high cell, no tools, schema output" grep -q -- '--model opus --effort high --tools  --json-schema' "$FAKE_LOG"
check "judge: rubric scores a reference with no findings" grep -q "no substantive points" "$FAKE_LOG"
check "judge: prompt carries reference and candidate" bash -c 'grep -q "<reference> ref one </reference>" "$1" && grep -q "<candidate> cand one </candidate>" "$1"' _ "$FAKE_LOG"
check "judge: scores written, empty output scores 0" [ "$(field "$J/scores.jsonl" case) $(field "$J/scores.jsonl" score)" = "j/a j/b 0.5 0" ]
node "$EV/judge.mjs" "$J/rows.jsonl" "$J/ref/rows.jsonl" >/dev/null 2>&1
check "judge: re-run skips scored rows" [ "$(calls)" = 1 ]
{ jrow j/a replayed true "$J/cand1.jsonl"; jrow j/g replayed true "$J/cand1.jsonl"; } > "$J/err/rows.jsonl"
FAKE_MODE=error node "$EV/judge.mjs" "$J/err/rows.jsonl" "$J/ref/rows.jsonl" >/dev/null 2>&1; rc=$?
check "judge: two errors in a row stop with exit 3, nothing scored" bash -c '[ "$1" = 3 ] && [ ! -s "$2" ]' _ "$rc" "$J/err/scores.jsonl"

# --- report: selection rule on canned rows (best opus max 100%; four cells at 90-91%)
R="$TMP/rep"; mkdir -p "$R"
row() { printf '{"case":"r/%s","role":"r","agent":null,"model":"%s","effort":"%s","status":"%s","cost":%s,"turns":%s,"ms":1000,"outTokens":100,"claude":"9.9.9"}\n' "$@"; }
{
  for i in 1 2 3 4 5; do row A opus max pass 5 4; row B opus max pass 5 4; done
  for i in 1 2 3 4 5; do row A opus high pass 2 4; done; for i in 1 2 3 4; do row B opus high pass 2 4; done; row B opus high fail 2 4
  for i in 1 2 3 4 5; do row A sonnet high pass 1 3; done; for i in 1 2 3 4; do row B sonnet high pass 1 3; done; row B sonnet high fail 1 3
  for i in 1 2 3 4 5; do row A haiku high pass 1 2; done; for i in 1 2 3 4; do row B haiku high pass 1 2; done; row B haiku high fail 1 2
  for i in 1 2 3 4 5 6 7 8 9 10; do row A haiku medium pass 0.1 2; done; row B haiku medium fail 0.1 2
  row A haiku low pass 0.01 1; row B haiku low fail 0.01 1
  row A opus max invalid 5 4; row B haiku medium errored 0.1 2
  row A sonnet low invalid 1 1; row B sonnet low invalid 1 1
} > "$R/rows.jsonl"
node "$EV/report.mjs" "$R/rows.jsonl" >/dev/null
pk() { node -p "const p=require('$R/picks.json');$1"; }
check "report: cheapest within tolerance, tie broken by turns" [ "$(pk 'p.roles.r.model+" "+p.roles.r.effort')" = "haiku high" ]
check "report: a case that never passes disqualifies (haiku medium)" [ "$(pk 'p.roles.r.cost')" = 1 ]
check "report: best is top pass rate, invalid/errored ignored" [ "$(pk 'p.roles.r.best')" = "opus max" ]
check "report: main effort from skill roles" [ "$(pk 'p.main.effort')" = high ]
check "report: markdown marks winner" grep -q 'haiku high \*\*winner\*\*' "$R/report.md"
check "report: invalid and errored counted per cell" bash -c 'grep -q "^| opus max (best) | 10 | 100% .* | 1 | 0 |$" "$1" && grep -q "^| haiku medium | 11 | .* | 0 | 1 |$" "$1"' _ "$R/report.md"
check "report: cell with only invalid runs still listed" grep -q '^| sonnet low | 0 | - | .* | 2 | 0 |$' "$R/report.md"
# stage-B cells (5 runs) outrank a lucky single-run stage-A screen (review #1)
Q="$TMP/repq"; mkdir -p "$Q"
rowq() { printf '{"case":"q/%s","role":"q","agent":null,"model":"%s","effort":"%s","status":"%s","cost":1,"turns":1,"ms":1,"run":%s}\n' "$@"; }
{
  for n in 1 2 3 4 5; do for c in X Y Z; do s=fail; [ "$n" -le 3 ] && s=pass; rowq $c opus max $s $n; done; done
  rowq X haiku low pass 1; rowq Y haiku low pass 1; rowq Z haiku low fail 1
} > "$Q/rows.jsonl"
node "$EV/report.mjs" "$Q/rows.jsonl" >/dev/null
check "report: best taken among stage-B cells only" [ "$(node -p "require('$Q/picks.json').roles.q.best")" = "opus max" ]
node "$EV/report.mjs" "$R/rows.jsonl" --stage-b > "$R/b.txt"
check "report: stage B lists cells within tolerance per case" [ "$(wc -l < "$R/b.txt" | tr -d ' ')" = 10 ]
check "report: stage B skips out-of-tolerance cell" bash -c '! grep -q "haiku low" "$1"' _ "$R/b.txt"
# rule 4: a winner judged > 0.10 below best falls to the next cheapest qualifying cell judged near best
R4="$TMP/rep4"; mkdir -p "$R4"; cp "$R/rows.jsonl" "$R4/"
row X sonnet max replayed 1 1 >> "$R4/rows.jsonl"
srow() { printf '{"case":"r/x","role":"r","model":"%s","effort":"%s","run":%s,"score":%s}\n' "$@"; }
{ srow haiku high 1 0.5; srow opus high 1 0.85; srow opus max 1 0.9; srow opus max 2 0.9; } > "$R4/scores.jsonl"
node "$EV/report.mjs" "$R4/rows.jsonl" >/dev/null
check "report: rule 4 moves a flagged winner to the next cheapest cell judged near best" [ "$(node -p "const r=require('$R4/picks.json').roles.r;r.model+' '+r.effort+' '+r.flagged+' '+r.judge")" = "opus high haiku high 0.85" ]
check "report: judge column and flag in the markdown" bash -c 'grep -q "^| opus high \*\*winner\*\* | .* | 0.85 | 0 | 0 |$" "$1" && grep -q "flagged haiku high" "$1"' _ "$R4/report.md"
check "report: replayed rows are not listed as skipped" bash -c '! grep -q "^| sonnet max " "$1"' _ "$R4/report.md"
# stage C: agent roles replay at the winner, one effort below it, and the best cell
C="$TMP/repc"; mkdir -p "$C" "$TMP/rpl/c/x1" "$TMP/rpl/c/x2" "$TMP/rpl/r/x1"
rowc() { printf '{"case":"c/A","role":"c","agent":"general-purpose","model":"%s","effort":"%s","status":"pass","cost":%s,"turns":1,"ms":1}\n' "$@"; }
{ rowc opus max 5; rowc haiku high 1; } > "$C/rows.jsonl"
node "$EV/report.mjs" "$C/rows.jsonl" --stage-c --replays "$TMP/rpl" | sort > "$C/c.txt"
check "report: stage C = replays x winner, one effort below, best" [ "$(tr '\n' ' ' < "$C/c.txt")" = "c/x1 haiku high c/x1 haiku medium c/x1 opus max c/x2 haiku high c/x2 haiku medium c/x2 opus max " ]
check "report: stage C skips skill roles" [ -z "$(node "$EV/report.mjs" "$R/rows.jsonl" --stage-c --replays "$TMP/rpl")" ]

echo "evals: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
