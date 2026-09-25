#!/usr/bin/env bash
# Hook tests: pipe one event JSON into a hook script and check its reply.
#   bash tests/hooks.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TMPDIR="$TMP" SID=
pass=0 fail=0 n=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
RG="$REPO/claude/hooks/rules-guard.mjs"
STATE="$TMP/claudzilla-rules"
# hook <event> [key=value ...]: build the event JSON (dotted keys nest) and run rules-guard in $PWD
hook() {
  node -e '
const [event, ...kv] = process.argv.slice(1);
const o = { session_id: process.env.SID, hook_event_name: event, cwd: process.cwd() };
for (const p of kv) {
  const i = p.indexOf("="), ks = p.slice(0, i).split(".");
  let t = o; while (ks.length > 1) { const k = ks.shift(); t = t[k] ??= {}; }
  t[ks[0]] = p.slice(i + 1);
}
console.log(JSON.stringify(o));' "$@" | node "$RG"
}
new_session() { SID="s$((++n))"; }
has() { grep -qF -- "$2" <<<"$1"; }
denied() { has "$1" '"permissionDecision":"deny"'; }
state() { node -p "JSON.stringify(require('$STATE/$SID.json')$1)"; }

# --- UserPromptSubmit ---
new_session; out=$(hook UserPromptSubmit prompt="login is broken")
check "prompt: bug word -> systematic-debugging" has "$out" "systematic-debugging"
check "prompt: bug word sets debug" [ "$(state .debug)" = true ]
new_session; out=$(hook UserPromptSubmit prompt="review all rules")
check "prompt: plain review is silent" [ -z "$out" ]
new_session; out=$(hook UserPromptSubmit prompt='peer said "login bug" earlier')
check "prompt: quoted bug word is silent" [ -z "$out" ]
new_session; out=$(hook UserPromptSubmit prompt='rename `error` field')
check "prompt: code-span bug word is silent" [ -z "$out" ]
new_session; out=$(hook UserPromptSubmit prompt="reviewer said the loop is slow")
check "prompt: review feedback -> receiving-code-review" has "$out" "receiving-code-review"
new_session; out=$(hook UserPromptSubmit prompt="/superpowers:verification-before-completion the build is broken")
check "prompt: typed skill recorded" [ "$(state '.skills[0]')" = '"superpowers:verification-before-completion"' ]
check "prompt: typed skill skips triggers" [ -z "$out" ]

# --- PostToolUse ---
new_session; hook UserPromptSubmit prompt=hi >/dev/null
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:brainstorming >/dev/null
check "skill: recorded" [ "$(state '.skills[0]')" = '"superpowers:brainstorming"' ]

# --- fail open ---
check "bad json: silent" bash -c "[ -z \"\$(echo nope | node '$RG')\" ]"
SID="../evil" hook UserPromptSubmit prompt=hi >/dev/null
check "session id cannot escape state dir" bash -c "[ ! -e '$TMP/evil.json' ] && [ -e '$STATE/evil.json' ]"

# --- PreToolUse: git / gh ---
repo() { local r; r=$(mktemp -d "$TMP/repo.XXXX"); git -C "$r" init -q -b main; git -C "$r" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init; echo "$r"; }
sh_() { hook PreToolUse tool_name=Bash "tool_input.command=$1"; }
R=$(repo); cd "$R"
new_session; hook UserPromptSubmit prompt=ship >/dev/null
check "push: no verification -> deny" denied "$(sh_ 'git push')"
check "gh pr create: no verification -> deny" denied "$(sh_ 'gh pr create --fill')"
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:verification-before-completion >/dev/null
check "push: verified -> allowed" [ -z "$(sh_ 'git push -u origin feat/x')" ]
check "push: compound --force -> deny" denied "$(sh_ 'npm test && git push --force')"
check "push: -f -> deny" denied "$(sh_ 'git push -f')"
check "push: +refspec -> deny" denied "$(sh_ 'git push origin +main')"
check "push: --force-with-lease allowed" [ -z "$(sh_ 'git push --force-with-lease')" ]
for c in 'git reset --hard' 'git clean -fd' 'git checkout -- .' 'git checkout .' 'git checkout -f main' 'git switch --discard-changes main' 'git switch -f main' 'git restore a.txt' 'git stash drop' 'git stash clear'; do
  check "discard: $c -> deny" denied "$(sh_ "$c")"
done
check "discard: checkout branch allowed" [ -z "$(sh_ 'git checkout main')" ]
check "discard: restore --staged allowed" [ -z "$(sh_ 'git restore --staged a.txt')" ]
check "commit: on main -> deny" denied "$(sh_ 'git commit -m "fix: x"')"
git config claudzilla.allowMain true
check "commit: main with allowMain allowed" [ -z "$(sh_ 'git commit -m "fix: x"')" ]
git config --unset claudzilla.allowMain; git switch -q -c feat/x
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "commit: on branch allowed" [ -z "$(sh_ 'git commit -m "fix: x"')" ]
check "commit: non-conventional -> deny" denied "$(sh_ 'git commit -m "update stuff"')"
check "commit: 51-char subject -> deny" denied "$(sh_ "git commit -m \"fix: $(printf 'a%.0s' {1..46})\"")"
check "commit: -F file skipped" [ -z "$(sh_ 'git commit -F msg.txt')" ]
check "commit: -m of other command ignored" [ -z "$(sh_ 'python3 -m pytest -q && git commit -m "fix: x"')" ]
check "commit: branch -m before -F ignored" [ -z "$(sh_ 'git branch -m a b && git commit -F msg')" ]
check "commit: -m \$VAR skipped" [ -z "$(sh_ 'git commit -m "$MSG"')" ]
check "commit: -m \$(cat file) skipped" [ -z "$(sh_ 'git commit -m "$(cat /tmp/msg.txt)"')" ]
check "commit: heredoc subject checked" denied "$(sh_ $'git commit -m "$(cat <<\'EOF\'\nupdate stuff\n\nbody\nEOF\n)"')"
check "commit: heredoc body not a push" [ -z "$(sh_ $'git commit -m "$(cat <<\'EOF\'\nfix: ok\n\ngit push later\nEOF\n)"')" ]
check "commit: session trailer -> deny" denied "$(sh_ $'git commit -m "fix: x\n\nClaude-Session: abc"')"
check "gh pr edit: session link -> deny" denied "$(sh_ 'gh pr edit 1 --body "see claude.ai/code/session_x"')"
touch .env .env.example; git add .env.example
check "commit: .env.example allowed" [ -z "$(sh_ 'git commit -m "fix: x"')" ]
git add .env
check "commit: .env staged -> deny" denied "$(sh_ 'git commit -m "fix: x"')"
git reset -q
check "worktree: inside repo -> deny" denied "$(sh_ 'git worktree add .worktrees/x -b feat/y')"
check "worktree: sibling allowed" [ -z "$(sh_ "git worktree add ../$(basename "$R")-y -b feat/y")" ]
U=$(mktemp -d "$TMP/unborn.XXXX"); git -C "$U" init -q -b main
check "commit: unborn main -> deny" denied "$(cd "$U" && sh_ 'git commit -m "fix: x"')"
cd "$REPO"

# --- PreToolUse: Edit / Write ---
new_session; hook UserPromptSubmit prompt="tests fail on CI" >/dev/null
check "edit: first edit in debug turn nudged" has "$(hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js)" "Phase 3"
check "edit: second edit silent" [ -z "$(hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js)" ]
check "edit: marks turn edited" [ "$(state .edited)" = true ]
S=$(repo); spec="$S/docs/superpowers/specs/x.md"
hook PreToolUse tool_name=Write tool_input.file_path="$spec" >/dev/null
hook PreToolUse tool_name=Write tool_input.file_path="$spec" >/dev/null
check "spec: excluded once" [ "$(grep -cx 'docs/superpowers/' "$S/.git/info/exclude")" -eq 1 ]
check "spec: now ignored" git -C "$S" check-ignore -q "$spec"
T=$(repo); mkdir -p "$T/docs/superpowers"; touch "$T/docs/superpowers/a.md"; git -C "$T" add docs
hook PreToolUse tool_name=Write tool_input.file_path="$T/docs/superpowers/b.md" >/dev/null
check "spec: tracked repo untouched" [ "$(grep -c superpowers "$T/.git/info/exclude")" -eq 0 ]

# --- Stop ---
stop() { hook Stop "last_assistant_message=$1"; }
new_session; hook UserPromptSubmit prompt=go >/dev/null
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
stop "Fixed the parser." >/dev/null
check "stop: done claim flagged" has "$(state .flags)" "verification"
out=$(hook UserPromptSubmit prompt=next)
check "flags: injected on next prompt" has "$out" "claimed done without verification"
check "flags: cleared after inject" [ "$(state .flags.length)" = 0 ]
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:verification-before-completion >/dev/null
stop "Fixed the parser." >/dev/null
check "stop: verified claim ok" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "Done." >/dev/null
check "stop: claim without edits ok" [ "$(state .flags.length)" = 0 ]
long=$'## A\n'"$(printf 'x\n%.0s' {1..16})"
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "$long" >/dev/null
check "stop: missing TL;DR flagged" has "$(state .flags)" "TL;DR"
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop $'**TL;DR** — x\n'"$long" >/dev/null
check "stop: TL;DR present ok" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "Shipped 🚀" >/dev/null
check "stop: emoji flagged" has "$(state .flags)" "emoji"
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop '| a | b<br>c |' >/dev/null
check "stop: <br> in table flagged" has "$(state .flags)" "<br>"
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop '| a | `x<br>y` |' >/dev/null
check "stop: <br> in code span ok" [ "$(state .flags.length)" = 0 ]
stop '| a | "x<br>y" |' >/dev/null
check "stop: quoted <br> ok" [ "$(state .flags.length)" = 0 ]
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
stop 'Peer wrote "Fixed the probe." in its reply.' >/dev/null
check "stop: quoted done claim ok" [ "$(state .flags.length)" = 0 ]
stop 'Fixed the parser; see `fixed` flag.' >/dev/null
check "stop: real claim beside code span still flagged" has "$(state .flags)" "verification"
good=$'```text\n┌─ A ─┐  ┌──┐\n│ x   │  │y │\n└─────┘  └──┘\n```'
bad=$'```text\n┌───┐\n│ x  │\n└───┘\n```'
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "$good" >/dev/null
check "stop: aligned boxes ok" [ "$(state .flags.length)" = 0 ]
stop "$bad" >/dev/null
check "stop: misaligned box flagged" has "$(state .flags)" "line 3"

# --- MessageDisplay ---
MD="$REPO/claude/hooks/md-display.pl"
md() { node -e 'console.log(JSON.stringify({hook_event_name:"MessageDisplay",delta:process.argv[1]}))' "$1" | perl "$MD"; }
out=$(md $'| a | b<br>c |\ntext<br>\n')
check "md: <br> in table row replaced" has "$out" 'b · c'
check "md: <br> outside table kept" has "$out" 'text<br>'
check "md: plain batch silent" [ -z "$(md $'hello\n')" ]
check "md: bad json silent" bash -c "[ -z \"\$(echo '<br' | perl '$MD')\" ]"

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
