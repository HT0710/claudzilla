#!/usr/bin/env bash
# rule-review tests: fixture transcripts in, per-rule counts out.
#   bash tests/rule-review.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export CLAUDE_CONFIG_DIR="$TMP/cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
RG="$REPO/claude/hooks/rules-guard.mjs"
# js <expr>: evaluate with rules-guard exports in scope as `m`, print result
js() { node --input-type=module -e "import * as m from '$RG'; console.log(JSON.stringify(await (async () => $1)()))" </dev/null; }

# --- rules-guard exports ---
check "import: does not run the hook" [ -z "$(echo '{"session_id":"x","hook_event_name":"UserPromptSubmit","prompt":"login is broken"}' | node --input-type=module -e "import '$RG'")" ]
check "firedRules: deny reason" [ "$(js 'm.firedRules("PreToolUse:Bash hook error: " + m.WHY.verify)')" = '["pushVerify"]' ]
check "firedRules: joined reasons" [ "$(js 'm.firedRules(m.WHY.verify + " " + m.WHY.pr)')" = '["pushVerify","prSkill"]' ]
check "firedRules: subject reason" [ "$(js 'm.firedRules("Commit subject is 52 chars; max 50 (git.md:19).")')" = '["commitSubject"]' ]
check "firedRules: prompt trigger" [ "$(js 'm.firedRules(m.MSG.debug)')" = '["debugTrigger"]' ]
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
#   ["user", text, {daysAgo, branch, meta}] ["skill", name] ["bash", cmd, {denied, branch}] ["edit"]
#   ["text", reply] ["ctx", event, text] ["stop", text] ["raw", line]
session() {
  node - "$PROJ/$1.jsonl" "$2" <<'EOF'
const fs = require("fs");
const [file, spec] = process.argv.slice(2);
let n = 0, day = 0, branch = "feat/x";
const ts = () => new Date(Date.now() - day * 864e5).toISOString();
const lines = [];
const push = (o) => lines.push(JSON.stringify({ timestamp: ts(), gitBranch: branch, ...o }));
const use = (name, input) => { const id = `t${++n}`; push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } }); return id; };
const result = (id, text, is_error) => push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
for (const [kind, a, o = {}] of eval(spec)) {
  if (kind === "user") { day = o.daysAgo ?? 0; branch = o.branch ?? "feat/x"; push({ type: "user", isMeta: o.meta, message: { role: "user", content: a } }); }
  if (kind === "skill") result(use("Skill", { skill: a }), "Launching skill");
  if (kind === "bash") { if (o.branch) branch = o.branch; const id = use("Bash", { command: a }); result(id, o.denied ? `PreToolUse:Bash hook error: ${o.denied}` : "ok", !!o.denied); }
  if (kind === "edit") result(use("Edit", { file_path: "/x/a.js" }), "ok");
  if (kind === "text") push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: a }] } });
  if (kind === "ctx") push({ type: "attachment", attachment: { type: "hook_additional_context", hookEvent: a, content: [o] } });
  if (kind === "stop") push({ type: "system", subtype: "stop_hook_summary", hookAdditionalContext: [a] });
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
J_VERIFY=$(js 'm.WHY.verify'); J_DEBUG=$(js 'm.MSG.debug'); J_DONE=$(js 'm.MSG.doneClaim')

reset_proj; session a '[["user","ship"],["bash","git push"]]'; scan
check "push without verify: slip" [ "$(rule pushVerify slips)" = 1 ]
reset_proj; session a '[["user","ship"],["skill","superpowers:verification-before-completion"],["bash","git push"]]'; scan
check "push after verify: applies" [ "$(rule pushVerify applies)" = 1 ]
check "push after verify: no slip" [ "$(rule pushVerify slips)" = 0 ]
reset_proj; session a "[[\"user\",\"ship\"],[\"bash\",\"git push\",{denied:$J_VERIFY}]]"; scan
check "denied push: no slip" [ "$(rule pushVerify slips)" = 0 ]
check "denied push: hook fire" [ "$(rule pushVerify hookFires)" = 1 ]
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
reset_proj; session a "[[\"user\",\"go\"],[\"edit\"],[\"stop\",$J_DONE]]"; scan
check "stop continue: hook fire" [ "$(rule doneClaim hookFires)" = 1 ]
reset_proj; session a '[["user","old",{daysAgo:30}],["bash","git push"],["user","new"]]'; scan
check "window: old turn skipped" [ "$(top turns)" = 1 ]
check "window: old push skipped" [ "$(rule pushVerify applies)" = 0 ]
scan --days 60
check "window: --days widens" [ "$(top turns)" = 2 ]
reset_proj; session a '[["user","go"],["raw","{not json"]]'; scan
check "bad line: unparsed" [ "$(top unparsed)" = 1 ]
reset_proj; mkdir -p "$PROJ/sess/subagents"; session a '[["user","go"]]'; cp "$PROJ/a.jsonl" "$PROJ/sess/subagents/x.jsonl"; scan
check "subagent transcripts skipped" [ "$(top sessions)" = 1 ]
check "missing dir: exit 1" bash -c "! node '$SCAN' --dir '$TMP/nope' 2>/dev/null"
check "missing dir: one-line error" [ "$(node "$SCAN" --dir "$TMP/nope" 2>&1 | wc -l | tr -d ' ')" = 1 ]
check "bad --days: exit 1" bash -c "! node '$SCAN' --dir '$TMP/projects' --days x 2>/dev/null"
reset_proj; session a '[["user","SECRET-TOKEN-123 login"],["bash","git commit -m \"SECRET-TOKEN-123\""],["text","SECRET-TOKEN-123"]]'; scan
check "no text leak: report" bash -c "! grep -q SECRET '$TMP/r.json'"
check "report: only schema fields" [ "$(node -p "Object.keys(require('$TMP/r.json')).join(',')")" = "schema,claudzilla,window,sessions,turns,unparsed,rules" ]

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
