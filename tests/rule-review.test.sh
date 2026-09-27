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

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
