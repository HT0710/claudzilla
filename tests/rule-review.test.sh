#!/usr/bin/env bash
# rule-review tests: fixture transcripts in, per-rule counts out.
#   bash tests/rule-review.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export CLAUDE_CONFIG_DIR="$TMP/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
has_() { grep -qF -- "$2" <<<"$1"; }
RG="$REPO/claude/hooks/rules-guard.mjs"
# js <expr>: evaluate with rules-guard exports in scope as `m`, print result
js() { node --input-type=module -e "import * as m from '$RG'; console.log(JSON.stringify(await (async () => $1)()))" </dev/null; }

# --- rules-guard exports ---
check "import: does not run the hook" [ -z "$(echo '{"session_id":"x","hook_event_name":"UserPromptSubmit","prompt":"login is broken"}' | node --input-type=module -e "import '$RG'")" ]
check "firedRules: deny reason" [ "$(js 'm.firedRules("PreToolUse:Bash hook error: " + m.WHY.pushVerify)')" = '["pushVerify"]' ]
check "firedRules: joined reasons" [ "$(js 'm.firedRules(m.WHY.pushVerify + " " + m.WHY.prSkill)')" = '["pushVerify","prSkill"]' ]
check "firedRules: subject reason" [ "$(js 'm.firedRules("Commit subject is 52 chars; max 50 (git.md:19).")')" = '["commitSubject"]' ]
check "firedRules: prompt trigger" [ "$(js 'm.firedRules(m.MSG.debugTrigger)')" = '["debugTrigger"]' ]
check "firedRules: conditional nudge" [ "$(js 'm.firedRules(m.nudge("doneClaim"))')" = '["doneClaim"]' ]
check "firedRules: previous-reply flags" [ "$(js 'm.firedRules("Previous reply broke: missing TL;DR; diagram box edge misaligned at line 3. Apply from this reply on.")')" = '["tldr","boxAlign"]' ]
check "firedRules: unrelated text" [ "$(js 'm.firedRules("CAVEMAN MODE ACTIVE")')" = '[]' ]
check "formatFlags: emoji" [ "$(js 'm.formatFlags("Shipped 🚀", {rules: m.DEFAULTS.rules, tldrMinLines: 15}).map(f => f[0])')" = '["emoji"]' ]
check "gitParse: -C and sub" [ "$(js 'm.gitParse(["git","-C","x","push","-f"], "/r").sub')" = '"push"' ]
check "forceFlag: +refspec" [ "$(js 'm.forceFlag(["origin","+main"])')" = true ]
check "prDescribes: label edit" [ "$(js 'm.prDescribes(["gh","pr","edit","1","--add-label","x"])')" = false ]
check "hooks: suite unchanged" bash -c "bash '$REPO/tests/hooks.test.sh' | tail -1 | grep -q ' 0 failed'"

# --- scanner ---
SCAN="$REPO/claude/skills/rule-review/scan.mjs"
PROJ="$TMP/projects/p"; mkdir -p "$PROJ"
# session <name> <js array>: write transcript <name>.jsonl from short event specs
#   ["user", text, {daysAgo, branch, meta, cwd}] ["skill", name] ["bash", cmd, {denied, branch}] ["edit"] ["tool", name, input]
#   ["text", reply] ["ctx", event, text] ["stop", text] ["raw", line]
session() {
  node - "$PROJ/$1.jsonl" "$2" <<'EOF'
const fs = require("fs");
const [file, spec] = process.argv.slice(2);
let n = 0, day = 0, branch = "feat/x", cwd;
const ts = () => new Date(Date.now() - day * 864e5).toISOString();
const lines = [];
const push = (o) => lines.push(JSON.stringify({ timestamp: ts(), gitBranch: branch, cwd, ...o }));
const use = (name, input) => { const id = `t${++n}`; push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } }); return id; };
const result = (id, text, is_error) => push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
for (const [kind, a, o = {}] of eval(spec)) {
  if (kind === "user") { day = o.daysAgo ?? 0; branch = o.branch ?? "feat/x"; cwd = o.cwd; push({ type: "user", isMeta: o.meta, message: { role: "user", content: a } }); }
  if (kind === "skill") result(use("Skill", { skill: a }), "Launching skill");
  if (kind === "bash") { if (o.branch) branch = o.branch; const id = use("Bash", { command: a }); result(id, o.denied ? `PreToolUse:Bash hook error: ${o.denied}` : "ok", !!o.denied); }
  if (kind === "edit") result(use("Edit", { file_path: "/x/a.js" }), "ok");
  if (kind === "tool") result(use(a, o), "ok");
  if (kind === "text") push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: a }] } });
  if (kind === "ctx") push({ type: "attachment", attachment: { type: "hook_additional_context", hookEvent: a, content: [o] } });
  if (kind === "stop") push({ type: "system", subtype: "stop_hook_summary", hookAdditionalContext: [a] });
  if (kind === "queued") push({ type: "attachment", attachment: { type: "queued_command", commandMode: a, prompt: o } });
  if (kind === "raw") lines.push(a);
}
fs.writeFileSync(file, lines.join("\n") + "\n");
EOF
}
# rule <id> <field>: value from the last scan
scan() { node "$SCAN" --dir "$TMP/projects" "$@" > "$TMP/r.json"; }
rule() { node -p "require('$TMP/r.json').rules.$1.$2"; }
top() { node -p "JSON.stringify(require('$TMP/r.json').$1)"; }
reset_proj() { rm -rf "$TMP/projects"; mkdir -p "$PROJ"; }
# JSON string literals, ready to splice into session specs
J_VERIFY=$(js 'm.WHY.pushVerify'); J_DEBUG=$(js 'm.MSG.debugTrigger'); J_DONE=$(js 'm.MSG.doneClaim')
# stamp [json]: every rule reached this machine in 2000, then apply overrides (null = drop the rule)
SINCE="$CLAUDE_CONFIG_DIR/.claudzilla-rules.json"
stamp() {
  OVR=${1:-'{}'} node --input-type=module -e "import { DEFAULTS } from '$RG';
const s = Object.fromEntries(Object.keys(DEFAULTS.rules).map((id) => [id, '2000-01-01T00:00:00.000Z']));
for (const [k, v] of Object.entries(JSON.parse(process.env.OVR))) { if (v === null) delete s[k]; else s[k] = v; }
console.log(JSON.stringify(s));" </dev/null > "$SINCE"
}
stamp

reset_proj; session a '[["user","ship"],["bash","git push"]]'; scan
check "push without verify: slip" [ "$(rule pushVerify slips)" = 1 ]
reset_proj; session a '[["user","ship"],["skill","superpowers:verification-before-completion"],["bash","git push"]]'; scan
check "push after verify: applies" [ "$(rule pushVerify applies)" = 1 ]
check "push after verify: no slip" [ "$(rule pushVerify slips)" = 0 ]
reset_proj; session a "[[\"user\",\"ship\"],[\"bash\",\"git push\",{denied:$J_VERIFY}]]"; scan
check "denied push: no slip" [ "$(rule pushVerify slips)" = 0 ]
check "denied push: hook fire" [ "$(rule pushVerify hookFires)" = 1 ]
reset_proj; session a '[["user","ship"],["bash","git push",{denied:"Run superpowers:verification-before-completion this turn before push/PR (superpowers.md:47)."}]]'; scan
check "hook fire under older citation still counted" [ "$(rule pushVerify hookFires)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git push -f"]]'; scan
check "force push: slip" [ "$(rule forcePush slips)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git commit -m \"update stuff\""]]'; scan
check "bad subject: slip" [ "$(rule commitSubject slips)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git commit -m \"fix: x\"",{branch:"main"}]]'; scan
check "commit on main: slip" [ "$(rule mainCommit slips)" = 1 ]
check "good subject: no slip" [ "$(rule commitSubject slips)" = 0 ]
reset_proj; session a '[["user","go"],["skill","superpowers:verification-before-completion"],["bash","gh pr create --fill"]]'; scan
check "pr without pr skill: slip" [ "$(rule prSkill slips)" = 1 ]
check "pr: pushVerify applies" [ "$(rule pushVerify applies)" = 1 ]
reset_proj; session a '[["user","go"],["bash","gh pr edit 1 --add-label x"]]'; scan
check "label edit: prSkill n/a" [ "$(rule prSkill applies)" = 0 ]
reset_proj; session a '[["user","go"],["bash","gh -R o/r pr create --fill"]]'; scan
check "gh -R pr create: pushVerify slip" [ "$(rule pushVerify slips)" = 1 ]
reset_proj; session a '[["user","go"],["bash","gh api repos/o/r/pulls -f title=x -f head=a -f base=main"]]'; scan
check "gh api pulls POST: pushVerify slip" [ "$(rule pushVerify slips)" = 1 ]
check "gh api pulls POST: prSkill slip" [ "$(rule prSkill slips)" = 1 ]
reset_proj; session a '[["user","go"],["bash","gh api graphql -f query=q1 && gh api graphql -f query=\"mutation{createPullRequest}\""]]'; scan
check "graphql: one PR among two calls counted once" [ "$(rule pushVerify applies)" = 1 ]
reset_proj; session a '[["user","go"],["tool","mcp__github__create_pull_request",{title:"x"}]]'; scan
check "mcp create PR: pushVerify slip" [ "$(rule pushVerify slips)" = 1 ]
check "mcp create PR: prSkill slip" [ "$(rule prSkill slips)" = 1 ]
reset_proj; session a '[["user","go"],["skill","superpowers:verification-before-completion"],["skill","pr"],["tool","mcp__github__create_pull_request",{title:"x"}]]'; scan
check "mcp create PR after skills: no slip" [ "$(rule prSkill slips)$(rule pushVerify slips)" = 00 ]
reset_proj; session a '[["user","go"],["skill","superpowers:verification-before-completion"],["skill","x:pr"],["bash","gh pr create --fill"]]'; scan
check "plugin x:pr is not the pr skill" [ "$(rule prSkill slips)" = 1 ]
reset_proj; session a '[["user","go"],["edit"],["text","Fixed the parser."]]'; scan
check "done claim: slip" [ "$(rule doneClaim slips)" = 1 ]
reset_proj; session a '[["user","go"],["edit"],["skill","superpowers:verification-before-completion"],["text","Fixed the parser."]]'; scan
check "verified claim: no slip" [ "$(rule doneClaim slips)" = 0 ]
reset_proj; session a '[["user","q"],["text","Shipped 🚀"]]'; scan
check "emoji: slip" [ "$(rule emoji slips)" = 1 ]
check "emoji: applies per reply" [ "$(rule emoji applies)" = 1 ]
reset_proj; session a "[[\"user\",\"login is broken\"],[\"ctx\",\"UserPromptSubmit\",$J_DEBUG],[\"skill\",\"superpowers:systematic-debugging\"]]"; scan
check "debug followed: applies" [ "$(rule debugTrigger applies)" = 1 ]
check "debug followed: no slip" [ "$(rule debugTrigger slips)" = 0 ]
check "debug followed: hook fire" [ "$(rule debugTrigger hookFires)" = 1 ]
reset_proj; session a "[[\"user\",\"go\"],[\"user\",\"<task-notification>\\nbuild broken\"],[\"ctx\",\"UserPromptSubmit\",$J_DEBUG]]"; scan
check "machine prompt: no turn" [ "$(top turns)" = 1 ]
check "machine prompt: trigger n/a" [ "$(rule debugTrigger applies)" = 0 ]
check "machine prompt: false fire" [ "$(rule debugTrigger falseFires)" = 1 ]
reset_proj; session a '[["user","Another Claude session sent a message:\nbug",{meta:true}],["user","go"]]'; scan
check "meta prompt: no turn" [ "$(top turns)" = 1 ]
reset_proj; session a '[["user","go"],["queued","prompt","login is broken"],["skill","superpowers:systematic-debugging"]]'; scan
check "queued prompt: starts a turn" [ "$(top turns)" = 2 ]
check "queued prompt: trigger applies" [ "$(rule debugTrigger applies)" = 1 ]
reset_proj; session a "[[\"user\",\"go\"],[\"queued\",\"task-notification\",\"<task-notification>\\nx\"],[\"user\",\"Base directory for this skill: y\",{meta:true}],[\"queued\",\"prompt\",\"login is broken\"],[\"ctx\",\"UserPromptSubmit\",$J_DEBUG]]"; scan
check "meta line: machine not stale" [ "$(rule debugTrigger falseFires)" = 0 ]
check "queued notification: no turn" [ "$(top turns)" = 2 ]
reset_proj; session a "[[\"user\",\"go\"],[\"user\",\"Another Claude session sent a message:\\nbug\",{meta:true}],[\"ctx\",\"UserPromptSubmit\",$J_DEBUG]]"; scan
check "meta peer message: still machine" [ "$(rule debugTrigger falseFires)" = 1 ]
reset_proj; session a "[[\"user\",\"go\"],[\"edit\"],[\"stop\",$J_DONE]]"; scan
check "stop continue: hook fire" [ "$(rule doneClaim hookFires)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git commit -m \"fix: x\"",{denied:"Branch first: git switch -c <type>/<slug>. Solo repo that commits to main: user runs `git config claudzilla.allowMain true` (git.md:6)."}]]'; scan
check "hook fire under older wording still counted" [ "$(rule mainCommit hookFires)" = 1 ]
reset_proj; session a '[["user","go"],["edit"],["stop","Claimed done without verification-before-completion. Invoke superpowers:verification-before-completion now and report its evidence, or retract the claim."]]'; scan
check "stop fire under older wording still counted" [ "$(rule doneClaim hookFires)" = 1 ]
check "firedRules: each hook text maps to one rule" [ "$(js '[...Object.values(m.WHY), ...Object.values(m.MSG), ...["debugTrigger", "debugGate", "doneClaim"].map((k) => m.nudge(k))].every((t) => m.firedRules(t).length === 1)')" = true ]
reset_proj; session a '[["user","go"],["bash","cd ../other && git commit -m \"fix: x\"",{branch:"main"}],["bash","git -C ../other commit -m \"fix: y\"",{branch:"main"}]]'; scan
check "commit after cd / -C: branch unknown, not counted" [ "$(rule mainCommit applies)$(rule mainCommit slips)" = 00 ]
reset_proj; session a '[["user","go",{branch:"main"}],["bash","git switch -c fix/x && git commit -m \"fix: x\""],["bash","git checkout -b fix/y && git commit -m \"fix: y\""]]'; scan
check "branch then commit from main: not a slip" [ "$(rule mainCommit slips)" = 0 ]
AM="$TMP/am"; mkdir -p "$AM/.claude"; git -C "$AM" init -q; echo '{"rulesGuard":{"allowMain":true}}' > "$AM/.claude/claudzilla.local.json"
reset_proj; session a "[[\"user\",\"go\",{cwd:\"$AM\"}],[\"bash\",\"git commit -m \\\"fix: x\\\"\",{branch:\"main\"}]]"; scan
check "commit on main with allowMain: not a slip" [ "$(rule mainCommit slips)" = 0 ]
reset_proj; session a '[["user","<command-name>/clear</command-name>"],["user","<command-name>/rule-review</command-name>"],["text","ok"]]'; scan
check "built-in command with no reply: no turn" [ "$(top turns)" = 1 ]
session b '[["user","<command-name>/login</command-name>"]]'; scan
check "built-in only session: not a session" [ "$(top sessions)" = 1 ]
reset_proj; session a '[["user","old",{daysAgo:30}],["bash","git push"],["user","new"]]'; scan
check "window: old turn skipped" [ "$(top turns)" = 1 ]
check "window: old push skipped" [ "$(rule pushVerify applies)" = 0 ]
scan --days 60
check "window: --days widens" [ "$(top turns)" = 2 ]
reset_proj; session a '[["user","go"],["raw","{not json"]]'; scan
check "bad line: unparsed" [ "$(top unparsed)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git push"],["raw","{\"type\":\"assistant\",\"message\":{\"content\":[null]}}"],["raw","{\"type\":\"user\",\"message\":{\"content\":[null]}}"],["raw","{\"type\":\"user\",\"message\":{\"content\":[null,{\"type\":\"text\",\"text\":\"hi\"}]}}"]]'
check "null content items: scan survives" scan
check "null content items: turn still counted" [ "$(rule pushVerify slips)" = 1 ]
reset_proj; session a '[["user","go"],["bash","git push"],["raw","null"],["raw","{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":null}]}}"],["raw","{\"type\":\"attachment\",\"attachment\":{\"type\":\"hook_additional_context\",\"content\":5}}"],["raw","{\"type\":\"system\",\"subtype\":\"stop_hook_summary\",\"hookAdditionalContext\":5}"]]'
check "odd lines (null, text:null, non-array context): scan survives" scan
check "odd lines: turn still counted" [ "$(rule pushVerify slips)" = 1 ]
reset_proj; mkdir -p "$PROJ/sess/subagents"; session a '[["user","go"]]'; cp "$PROJ/a.jsonl" "$PROJ/sess/subagents/x.jsonl"; scan
check "subagent transcripts skipped" [ "$(top sessions)" = 1 ]
check "missing dir: exit 1" bash -c "! node '$SCAN' --dir '$TMP/nope' 2>/dev/null"
check "missing dir: one-line error" [ "$(node "$SCAN" --dir "$TMP/nope" 2>&1 | wc -l | tr -d ' ')" = 1 ]
check "--dir is a file: one-line error" [ "$(node "$SCAN" --dir "$PROJ/a.jsonl" 2>&1 | grep -c '^rule-review: ')" = 1 ]
check "bad --days: exit 1" bash -c "! node '$SCAN' --dir '$TMP/projects' --days x 2>/dev/null"
reset_proj; session a '[["user","SECRET-TOKEN-123 login"],["bash","git commit -m \"SECRET-TOKEN-123\""],["text","SECRET-TOKEN-123"]]'; scan
check "no text leak: report" bash -c "! grep -q SECRET '$TMP/r.json'"
check "report: only schema fields" [ "$(node -p "Object.keys(require('$TMP/r.json')).join(',')")" = "schema,claudzilla,window,sessions,turns,unparsed,rules" ]

# --- rule arrival dates ---
future=$(node -p 'new Date(Date.now() + 864e5).toISOString()')
reset_proj; session a '[["user","ship"],["bash","git push"]]'
stamp "{\"pushVerify\":\"$future\"}"; scan
check "since: rule stamped after session -> no applies" [ "$(rule pushVerify applies)" = 0 ]
check "since: rule stamped after session -> no slips" [ "$(rule pushVerify slips)" = 0 ]
check "since: other rules still counted" [ "$(rule forcePush applies)" = 1 ]
stamp '{"pushVerify":null}'; scan
check "since: rule missing -> not counted" [ "$(rule pushVerify applies)" = 0 ]
rm -f "$SINCE"; scan
check "since: no file -> nothing counted" [ "$(node -p "Object.values(require('$TMP/r.json').rules).every((v) => v.applies === 0 && v.slips === 0)")" = true ]
echo '[1,2]' > "$SINCE"; scan
check "since: invalid file -> nothing counted" [ "$(rule pushVerify applies)" = 0 ]
reset_proj; session a "[[\"user\",\"ship\"],[\"bash\",\"git push\",{denied:$J_VERIFY}]]"
stamp "{\"pushVerify\":\"$future\"}"; scan
check "since: fires before stamp still counted" [ "$(rule pushVerify hookFires)" = 1 ]
stamp

# --- save / issue / share ---
REPORTS="$CLAUDE_CONFIG_DIR/claudzilla-reports"
reset_proj; session a '[["user","ship"],["bash","git push"]]'
node "$SCAN" --dir "$TMP/projects" --save > "$TMP/s.json"
check "save: first run previous null" [ "$(node -p "require('$TMP/s.json').previous")" = null ]
check "save: file written" [ "$(ls "$REPORTS" | wc -l | tr -d ' ')" = 1 ]
echo '{"schema":3,"window":{"from":"2000-01-01","to":"2000-01-15"},"rules":{"pushVerify":{"applies":9,"slips":9,"hookFires":0,"falseFires":0}}}' > "$REPORTS/2000-01-15.json"
echo '{"schema":3,"window":{"from":"2000-01-01","to":"2000-01-31"},"rules":{"pushVerify":{"applies":7,"slips":7,"hookFires":0,"falseFires":0}}}' > "$REPORTS/2000-01-31.json"
node "$SCAN" --dir "$TMP/projects" --save > "$TMP/s.json"
check "save: previous is older report, same window" [ "$(node -p "require('$TMP/s.json').previous.rules.pushVerify.slips")" = 9 ]
echo '{"schema":1,"window":{"from":"2000-01-02","to":"2000-01-16"},"rules":{"pushVerify":{"applies":5,"slips":5,"hookFires":0,"falseFires":0}}}' > "$REPORTS/2000-01-16.json"
node "$SCAN" --dir "$TMP/projects" --save > "$TMP/s.json"
check "save: previous skips old schema" [ "$(node -p "require('$TMP/s.json').previous.rules.pushVerify.slips")" = 9 ]
rm -f "$REPORTS/2000-01-16.json"
rm -f "$REPORTS/2000-01-15.json" "$REPORTS/2000-01-31.json"
issue=$(node "$SCAN" --issue)
check "issue: title line" grep -q '^rule-report ' <<<"$(head -1 <<<"$issue")"
check "issue: table row" grep -q '^| pushVerify | 1 | 1 |' <<<"$issue"
check "issue: json on one line" grep -q '^{"schema":3,' <<<"$issue"
check "issue: json drops zero rules" bash -c "! grep '^{\"schema\"' <<<'$issue' | grep -q envStaged"
check "issue: json collapsed" grep -q '^<details>' <<<"$issue"
brief=$(node "$SCAN" --issue --brief)
check "brief: title line" grep -q '^rule-report ' <<<"$(head -1 <<<"$brief")"
check "brief: no table rows" bash -c "! grep -q '^| pushVerify' <<<'$brief'"
check "brief: no json line" bash -c "! grep -q '^{' <<<'$brief'"
check "brief: summary line" grep -q '^claudzilla ' <<<"$brief"
reset_proj; session a '[["user","SECRET-TOKEN-123"],["bash","git push SECRET-TOKEN-123"]]'
node "$SCAN" --dir "$TMP/projects" --save >/dev/null
check "no text leak: saved + issue" bash -c "! grep -rq SECRET '$REPORTS' && ! node '$SCAN' --issue | grep -q SECRET"
BIN="$TMP/bin"; mkdir -p "$BIN"
printf '#!/bin/sh\nprintf "%%s\\n" "$@" > "%s/gh-args"\necho https://github.com/o/r/issues/1\n' "$TMP" > "$BIN/gh"; chmod +x "$BIN/gh"
SLUG=$(git -C "$REPO" remote get-url origin | sed -E 's#.*github\.com[:/]##; s#\.git$##')
out=$(PATH="$BIN:$PATH" node "$SCAN" --share)
check "share: gh called with label" grep -qx 'rule-report' "$TMP/gh-args"
check "share: gh repo from origin" grep -qxF "$SLUG" "$TMP/gh-args"
check "share: prints issue url" has_ "$out" "issues/1"
printf '#!/bin/sh\nexit 1\n' > "$BIN/gh"
out=$(PATH="$BIN:$PATH" node "$SCAN" --share); rc=$?
check "share: gh fails -> exit 0" [ "$rc" -eq 0 ]
check "share: gh fails -> prefilled url" has_ "$out" "github.com/$SLUG/issues/new?labels=rule-report"
echo '{broken' > "$REPORTS/2999-01-01.json"
check "issue: corrupt report -> one-line error" [ "$(node "$SCAN" --issue 2>&1 | grep -c '^rule-review: ')" = 1 ]
d="$REPORTS/$(node -p 'new Date().toISOString().slice(0,10)').json"; rm -f "$REPORTS/2999-01-01.json" "$d"; mkdir -p "$d"
check "save fails: one-line error" [ "$(node "$SCAN" --dir "$TMP/projects" --save 2>&1 | grep -c '^rule-review: ')" = 1 ]
check "save fails: no tmp left" [ -z "$(ls "$REPORTS" | grep '\.tmp$')" ]
rm -rf "$REPORTS"
check "issue: no saved report -> exit 1" bash -c "! node '$SCAN' --issue 2>/dev/null"

# --- seen marker ---
SEEN="$REPORTS/.nudged"
rm -rf "$REPORTS"; reset_proj; session a '[["user","ship"],["bash","git push"]]'
node "$SCAN" --dir "$TMP/projects" --save >/dev/null
check "save: marks report seen" [ "$(cat "$SEEN" 2>/dev/null)" = "$(ls "$REPORTS")" ]
rm -rf "$REPORTS"
out=$(node "$SCAN" --dir "$TMP/projects" --save --background)
check "background: no output" [ -z "$out" ]
check "background: report written" [ "$(ls "$REPORTS" | grep -c '\.json$')" = 1 ]
check "background: not marked seen" [ ! -e "$SEEN" ]

# --- nudge ---
today=$(node -p 'new Date().toISOString().slice(0,10)')
old=$(node -p 'new Date(Date.now() - 10 * 864e5).toISOString().slice(0,10)')
# report <date> <tldr slips> <pushVerify slips> [schema]: fixture report, 14-day window, 3 sessions
report() {
  mkdir -p "$REPORTS"
  printf '{"schema":%s,"claudzilla":"t","window":{"from":"2026-09-01","to":"2026-09-15"},"sessions":3,"turns":9,"unparsed":0,"rules":{"tldr":{"applies":9,"slips":%s,"hookFires":0,"falseFires":0},"pushVerify":{"applies":2,"slips":%s,"hookFires":0,"falseFires":0}}}\n' "${4:-3}" "$2" "$3" > "$REPORTS/$1.json"
}
nudge() { local p=${1:-'{}'}; printf '%s' "$p" | node "$SCAN" --nudge; }   # bash 3.2 keeps the backslash in "${1:-{\}}"
# background scan finished = today's report exists
scanned() { for _ in $(seq 50); do [ -e "$REPORTS/$today.json" ] && return 0; sleep 0.2; done; return 1; }
mkdir -p "$CLAUDE_CONFIG_DIR/projects"   # default --dir of the background scan

rm -rf "$REPORTS"
check "nudge: no report -> silent" [ -z "$(nudge)" ]
check "nudge: no report -> background scan" scanned
rm -rf "$REPORTS"; report "$today" 5 1
out=$(nudge)
check "nudge: line" [ "$out" = '{"systemMessage":"claudzilla: 6 rule slips in 3 sessions (14 days) · most: tldr 5× · /rule-review to see and share"}' ]
check "nudge: marks seen" [ "$(cat "$SEEN")" = "$today.json" ]
check "nudge: shown once" [ -z "$(nudge)" ]
rm -rf "$REPORTS"; report "$today" 0 0
check "nudge: zero slips -> silent" [ -z "$(nudge)" ]
rm -rf "$REPORTS"; report "$today" 0 2
check "nudge: top rule by slips" has_ "$(nudge)" "most: pushVerify 2×"
rm -rf "$REPORTS"; reset_proj; session a '[["user","ship"],["bash","git push"]]'
node "$SCAN" --dir "$TMP/projects" --save >/dev/null
check "nudge: after manual save -> silent" [ -z "$(nudge)" ]
rm -rf "$REPORTS"; report "$old" 3 0; echo "$old.json" > "$SEEN"
check "nudge: stale seen report -> silent" [ -z "$(nudge)" ]
check "nudge: stale report -> background scan" scanned
rm -rf "$REPORTS"; report "$old" 3 0
check "nudge: stale unseen report -> silent, refreshed instead" [ -z "$(nudge)" ]
scanned   # let the refresh it started finish before the next case
rm -rf "$REPORTS"; report "$today" 3 0 1
check "nudge: old-schema report -> silent" [ -z "$(nudge)" ]
check "nudge: old-schema report -> background scan" bash -c "for _ in \$(seq 50); do node -e 'process.exit(require(process.argv[1]).schema === 1 ? 1 : 0)' '$REPORTS/$today.json' 2>/dev/null && exit 0; sleep 0.2; done; exit 1"
rm -rf "$REPORTS"; report "$today" 2 0
echo '{"rulesGuard":{"reviewNudge":false}}' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
check "nudge: machine opt-out -> silent" [ -z "$(nudge)" ]
rm -rf "$REPORTS"
nudge >/dev/null; sleep 1
check "nudge: opt-out -> no scan" [ ! -e "$REPORTS/$today.json" ]
echo '{"rulesGuard":{"reviewNudge":"no"}}' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
report "$today" 2 0
check "nudge: invalid value -> stays on" has_ "$(nudge)" "systemMessage"
rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"
R="$TMP/optout"; mkdir -p "$R/.claude"; git -C "$R" init -q
echo '{"rulesGuard":{"reviewNudge":false}}' > "$R/.claude/claudzilla.json"
rm -rf "$REPORTS"; report "$today" 2 0
check "nudge: repo opt-out via cwd" [ -z "$(nudge "{\"cwd\":\"$R\"}")" ]
check "nudge: garbage stdin -> exit 0" bash -c "echo nope | node '$SCAN' --nudge >/dev/null"
rm -rf "$REPORTS"; report "$today" 2 0; echo '{broken' > "$REPORTS/$today.json"
check "nudge: unreadable report -> exit 0, silent" [ -z "$(nudge)" ]
check "nudge: unreadable report -> refreshed" bash -c "for _ in \$(seq 50); do node -e 'require(process.argv[1])' '$REPORTS/$today.json' 2>/dev/null && exit 0; sleep 0.2; done; exit 1"
rm -rf "$REPORTS"; echo x > "$REPORTS"
check "nudge: reports path not a dir -> exit 0, silent" [ -z "$(nudge 2>&1)" ]
rm -f "$REPORTS"

# --- skill file ---
SK="$REPO/claude/skills/rule-review/SKILL.md"
check "skill: user-only" grep -qx 'disable-model-invocation: true' "$SK"
check "skill: name" grep -qx 'name: rule-review' "$SK"
check "skill: CI runs tests" grep -q 'tests/rule-review.test.sh' "$REPO/.github/workflows/test.yml"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
