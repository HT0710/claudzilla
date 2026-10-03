#!/usr/bin/env bash
# Hook tests: pipe one event JSON into a hook script and check its reply.
#   bash tests/hooks.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TMPDIR="$TMP" SID= CLAUDE_CONFIG_DIR="$TMP/cfg"
unset COLUMNS   # width tests set it per call
mkdir -p "$CLAUDE_CONFIG_DIR"
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
check "prompt: debug nudge is conditional" has "$out" "If the prompt reports a bug"
check "prompt: debug nudge names what to ignore" has "$out" "Otherwise ignore this reminder."
new_session; out=$(hook UserPromptSubmit prompt="review all rules")
check "prompt: plain review is silent" [ -z "$out" ]
new_session; out=$(hook UserPromptSubmit prompt='peer said "login bug" earlier')
check "prompt: quoted bug word is silent" [ -z "$out" ]
new_session; out=$(hook UserPromptSubmit prompt='rename `error` field')
check "prompt: code-span bug word is silent" [ -z "$out" ]
for p in "how far can we customize without broken every update" "make sure it never crashes" "this is not a bug"; do
  new_session; check "prompt: negated bug word is silent (${p:0:14})" [ -z "$(hook UserPromptSubmit "prompt=$p")" ]
done
for p in "no it crashes" "no error message, just a blank page" $'it does not compile\n\nerror[E0308]: mismatched types'; do
  new_session; check "prompt: report after no/not still triggers (${p:0:14})" has "$(hook UserPromptSubmit "prompt=$p")" "systematic-debugging"
done
new_session; out=$(hook UserPromptSubmit prompt="it is not working after the update")
check "prompt: 'not working' still triggers" has "$out" "systematic-debugging"
new_session; out=$(hook UserPromptSubmit prompt="reviewer said the loop is slow")
check "prompt: review feedback -> receiving-code-review" has "$out" "receiving-code-review"
new_session; out=$(hook UserPromptSubmit prompt="/superpowers:verification-before-completion the build is broken")
check "prompt: typed skill recorded" [ "$(state '.skills[0]')" = '"superpowers:verification-before-completion"' ]
check "prompt: typed skill skips triggers" [ -z "$out" ]
for p in $'<task-notification>\n<status>failed</status> build broken' \
  $'Another Claude session sent a message:\n<cross-session-message from="x">login is broken</cross-session-message>' \
  '[Cross-session idle notice] peer hit an error'; do
  new_session; check "prompt: machine-sent skips triggers (${p:0:12})" [ -z "$(hook UserPromptSubmit "prompt=$p")" ]
done

# --- compact nudge ---
mkdir -p "$TMP/cn"; git -C "$TMP/cn" init -q; cd "$TMP/cn" || exit 1
TX="$TMP/tx.jsonl"
usage() { printf '{"type":"assistant","message":{"usage":{"input_tokens":2,"cache_creation_input_tokens":%s,"cache_read_input_tokens":%s}}}\n' "$2" "$3" >> "$1"; }
cn() { new_session; hook UserPromptSubmit prompt=next "transcript_path=$1"; }
: > "$TX"; usage "$TX" 50000 49000
check "compact: below threshold silent" [ -z "$(cn "$TX")" ]
: > "$TX"; usage "$TX" 60000 100000; out=$(cn "$TX")
check "compact: tier 1 optional" has "$out" '## Compact — optional'
check "compact: bold Why, size as code" has "$out" "- **Why:** \`~160k\` tokens re-sent every turn"
check "compact: own section before Next" has "$out" "right before **Next:**"
check "compact: section heading" has "$out" "## Compact"
check "compact: command highlighted, no block" has "$out" '`/compact` **Keep:**'
check "compact: keep conversation-only facts" has "$out" "**Keep:** <only what exists nowhere but this conversation"
check "compact: files by path" has "$out" "anything in a file → its path"
check "compact: skip reloaded instructions" has "$out" "Skip CLAUDE.md, rules and memory"
check "compact: clear when nothing carries over" has "$out" '`/clear` alone'
check "compact: Drop bold" has "$out" "**Drop:** <finished detail>"
check "compact: no fenced block" [ "$(grep -c '```' <<<"$out")" = 0 ]
check "compact: copy rules outside template line" has "$out" "Rules: whole /compact line on one line; bold only Keep and Drop"
check "compact: next step from own Next" has "$out" "your **Next:**"
check "compact: no Next still counts" has "$out" "at the end when there is no **Next:**"
check "compact: heading on short replies" has "$out" "even on a short reply"
check "compact: tier 1 no stale clause" [ "$(grep -c "clearly stale" <<<"$out")" = 0 ]
: > "$TX"; usage "$TX" 20000 300000
check "compact: tier 2 suggest" has "$(cn "$TX")" '## Compact — suggest'
: > "$TX"; usage "$TX" 50000 600000; out=$(cn "$TX")
check "compact: tier 3 recommend" has "$out" '## Compact — recommend'
check "compact: tier 3 stale context counts" has "$out" "clearly stale"
: > "$TX"; usage "$TX" 60000 100000; printf '{"type":"system","subtype":"compact_boundary"}\n' >> "$TX"
check "compact: after compact boundary silent" [ -z "$(cn "$TX")" ]
: > "$TX"; usage "$TX" 50000 49000; printf '{"type":"assistant","isSidechain":true,"message":{"usage":{"input_tokens":900000}}}\n' >> "$TX"
check "compact: sidechain usage ignored" [ -z "$(cn "$TX")" ]
: > "$TX"; usage "$TX" 60000 100000; printf '{"type":"assistant","message":{"model":"<synthetic>","usage":{"input_tokens":0,"cache_read_input_tokens":0}}}\n' >> "$TX"
check "compact: synthetic zero-usage reply skipped" has "$(cn "$TX")" "## Compact"
: > "$TX"; usage "$TX" 60000 100000; new_session
check "compact: machine prompt silent" [ -z "$(hook UserPromptSubmit 'prompt=<task-notification>x</task-notification>' "transcript_path=$TX")" ]
check "compact: no transcript_path silent" [ -z "$(new_session; hook UserPromptSubmit prompt=next)" ]
check "compact: missing transcript silent" [ -z "$(cn "$TMP/nope.jsonl")" ]
: > "$TX"; usage "$TX" 60000 100000; mkdir -p .claude; printf '{"rulesGuard":{"compactNudge":0}}' > .claude/claudzilla.local.json
check "compact: 0 turns it off" [ -z "$(cn "$TX")" ]
rm -rf .claude

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
NOCHECK="only a command run after the skill counts"
out=$(sh_ 'git push -u origin feat/x')
check "push: verify skill, no check after -> deny" denied "$out"
check "push: deny asks for a check after the skill" has "$out" "$NOCHECK"
check "push: git command is not a check" has "$(sh_ 'git status && git push')" "$NOCHECK"
check "push: check after push in same command -> deny" denied "$(sh_ 'git push && npm test')"
check "push: denied command's check not counted" has "$(sh_ 'git push')" "$NOCHECK"
check "push: cd is not a check" has "$(sh_ 'cd && git push')" "$NOCHECK"
check "push: heredoc commit message is not a check" has "$(sh_ $'git commit -m "$(cat <<\'EOF\'\nfix: x\nEOF\n)" && git push')" "$NOCHECK"
check "gh pr create: heredoc body is not a check" has "$(sh_ $'gh pr create --title t --body "$(cat <<\'EOF\'\nbody\nEOF\n)"')" "$NOCHECK"
check "push: piped text is not a check" has "$(sh_ 'echo x | git push')" "$NOCHECK"
check "push: check before push in same command -> allowed" [ -z "$(sh_ 'npm test && git push')" ]
check "push: verified -> allowed" [ -z "$(sh_ 'git push -u origin feat/x')" ]
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:verification-before-completion >/dev/null
check "push: re-invoked verify needs a new check" denied "$(sh_ 'git push')"
sh_ 'npm test' >/dev/null
out=$(sh_ 'gh pr create --fill')
check "gh pr create: no pr skill -> deny" denied "$out"
check "gh pr create: deny names pr skill" has "$out" "invoke the pr skill"
hook PostToolUse tool_name=Skill tool_input.skill=pr >/dev/null
check "gh pr create: pr + verified -> allowed" [ -z "$(sh_ 'gh pr create --fill')" ]
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
mkdir -p .claude; printf '{"rulesGuard":{"allowMain":true}}' > .claude/claudzilla.local.json
check "commit: main with allowMain allowed" [ -z "$(sh_ 'git commit -m "fix: x"')" ]
rm -rf .claude; git switch -q -c feat/x
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
check "gh pr edit: no pr skill -> deny" denied "$(sh_ 'gh pr edit 1 --title x')"
hook PostToolUse tool_name=Skill tool_input.skill=pr >/dev/null
check "gh pr edit: pr skill -> allowed" [ -z "$(sh_ 'gh pr edit 1 --title x')" ]
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "gh pr edit: label only, no pr skill -> allowed" [ -z "$(sh_ 'gh pr edit 1 --add-label bug')" ]
check "gh pr edit: --body-file needs pr skill" denied "$(sh_ 'gh pr edit 1 --body-file m.md')"
check "gh pr edit: bash -c wrapped -> deny" denied "$(sh_ "bash -c 'gh pr edit 1 -t x'")"
check "gh pr view: allowed" [ -z "$(sh_ 'gh pr view 1')" ]
out=$(sh_ 'gh pr create --fill')
check "gh pr create: deny names verification" has "$out" "verification-before-completion"
check "gh pr create: deny names pr skill too" has "$out" "invoke the pr skill"
check "gh -R before pr: create -> deny" denied "$(sh_ 'gh -R o/r pr create --fill')"
check "gh --repo= before pr: edit -> deny" denied "$(sh_ 'gh --repo=o/r pr edit 1 -t x')"
check "gh api: POST pulls via fields -> deny" denied "$(sh_ 'gh api repos/o/r/pulls -f title=x -f head=a -f base=main')"
check "gh api: -X POST pulls --input -> deny" denied "$(sh_ 'gh api -X POST /repos/o/r/pulls --input b.json')"
check "gh api: GET pulls allowed" [ -z "$(sh_ 'gh api repos/o/r/pulls')" ]
check "gh api: PATCH pull title -> deny" denied "$(sh_ 'gh api --method PATCH repos/o/r/pulls/1 -f title=x')"
check "gh api: PATCH pull state only allowed" [ -z "$(sh_ 'gh api repos/o/r/pulls/1 -X PATCH -f state=closed')" ]
check "gh api: graphql createPullRequest -> deny" denied "$(sh_ "gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'")"
check "gh pr -R after pr: create -> deny" denied "$(sh_ 'gh pr -R o/r create --fill')"
check "gh api: full URL POST pulls -> deny" denied "$(sh_ "gh api 'https://api.github.com/repos/o/r/pulls?x=1' -f title=x")"
check "gh api: graphql updatePullRequest -> deny" denied "$(sh_ "gh api graphql -f query='mutation { updatePullRequest(input: {body: \"x\"}) { clientMutationId } }'")"
check "gh api: full URL GET pulls allowed" [ -z "$(sh_ "gh api 'https://api.github.com/repos/o/r/pulls?state=open'")" ]
mcp() { hook PreToolUse "tool_name=mcp__github__$1" "${@:2}"; }
out=$(mcp create_pull_request tool_input.title=x tool_input.head=a tool_input.base=main)
check "mcp create PR: no verification -> deny" has "$out" "verification-before-completion"
check "mcp create PR: no pr skill -> deny" has "$out" "invoke the pr skill"
check "mcp update PR: session link -> deny" has "$(mcp update_pull_request tool_input.pullNumber=1 'tool_input.body=see claude.ai/code/session_x')" "No Claude session link"
check "mcp update PR: state only allowed" [ -z "$(mcp update_pull_request tool_input.pullNumber=1 tool_input.state=closed)" ]
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:verification-before-completion >/dev/null
sh_ 'npm test' >/dev/null
hook PostToolUse tool_name=Skill tool_input.skill=x:pr >/dev/null
check "gh pr create: plugin x:pr is not the pr skill" denied "$(sh_ 'gh pr create --fill')"
hook PostToolUse tool_name=Skill tool_input.skill=pr >/dev/null
check "mcp create PR: pr + verified -> allowed" [ -z "$(mcp create_pull_request tool_input.title=x)" ]
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
out=$(hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js)
check "edit: first edit in debug turn nudged" has "$out" "Phase 3"
check "edit: debug gate is conditional" has "$out" "If this turn debugs a reported bug"
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
out=$(stop "Fixed the parser.")
check "stop: done claim continues now" has "$out" '"hookEventName":"Stop","additionalContext":"If this reply claims'
check "stop: done claim says what to do otherwise" has "$out" "Otherwise reply only: no claim."
check "stop: done claim fixed now, not flagged" [ "$(state .flags.length)" = 0 ]
out=$(stop "Fixed the parser 🚀")
check "stop: other slips folded into continuation" has "$out" "decorative emoji"
check "stop: slips still fixed when no claim" has "$out" "Otherwise skip verification. Also fix:"
check "stop: folded slips not flagged" [ "$(state .flags.length)" = 0 ]
hook Stop "last_assistant_message=Fixed the parser 🚀" stop_hook_active=true >/dev/null
check "stop: judged text not re-flagged" [ "$(state '.flags.join().includes("verification")')" = false ]
hook Stop "last_assistant_message=Fixed the parser." stop_hook_active=true >/dev/null
check "stop: done claim on continuation flagged" has "$(state .flags)" "verification"
out=$(hook UserPromptSubmit prompt=$'<task-notification>\nbug')
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
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "#$long" >/dev/null
check "stop: missing TL;DR flagged under ### only" has "$(state .flags)" "TL;DR"
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
# rendered width = widest cell per column + 3 per column + 1; budget = COLUMNS - 4
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| aaaaaaaaaa | b |\n|---|---|\n| c | dddddddddd |' >/dev/null
check "stop: table wider than terminal flagged" has "$(state .flags)" "table wider than terminal (27 > 20 cols)"
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| **aaaa** | `bbbb` |\n|---|---|' >/dev/null
check "stop: table within terminal ok (markup not counted)" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop $'| aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | b |\n|---|---|' >/dev/null
check "stop: no COLUMNS, no width flag" [ "$(state .flags.length)" = 0 ]
new_session; out=$(COLUMNS=100 hook UserPromptSubmit prompt=q)
check "prompt: terminal width told" has "$out" "Terminal 100 cols: keep each table within 96 cols"
check "prompt: width told every prompt (survives /compact)" has "$(COLUMNS=100 hook UserPromptSubmit prompt=q)" "Terminal 100 cols"
check "prompt: no COLUMNS, no width line" [ -z "$(hook UserPromptSubmit prompt=q)" ]
wide=$'| aaaaaaaaaa | b |\n|---|---|\n| c | dddddddddd |'
for f in '```' '~~~'; do
  new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop "$f"$'\n'"$wide"$'\n'"$f" >/dev/null
  check "stop: table in $f fence not measured" [ "$(state .flags.length)" = 0 ]
done
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| just a long prose line that starts with a pipe |' >/dev/null
check "stop: pipe line without separator row not a table" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=30 stop $'| a | b |\n|-----------------|---|\n| c | d | extra extra extra extra |' >/dev/null
check "stop: separator and extra cells not measured" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| [link](https://example.com/very/long/path) | b |\n|---|---|' >/dev/null
check "stop: link URL not counted" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=28 stop $'| 一二三四五六七八九十 | b |\n|---|---|' >/dev/null
check "stop: wide chars count 2 cols" has "$(state .flags)" "(30 > 24 cols)"
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=28 stop $'| ひらがなひらがなひら | b |\n|---|---|' >/dev/null
check "stop: kana count 2 cols" has "$(state .flags)" "(30 > 24 cols)"
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| *unverified* | b |\n|---|---|' >/dev/null
check "stop: *italic* markers not counted" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop $'| 👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧 | b |\n|---|---|' >/dev/null
check "stop: joined emoji count 2 cols each" bash -c "! grep -q 'table wider' <<<'$(state .flags)'"
new_session; hook UserPromptSubmit prompt=q >/dev/null; COLUMNS=24 stop '```'$'\n''```js'$'\n'"$wide"$'\n''```' >/dev/null
check "stop: fence line with info string does not close" [ "$(state .flags.length)" = 0 ]
new_session; hook UserPromptSubmit prompt=q >/dev/null
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
stop 'Peer wrote "Fixed the probe." in its reply.' >/dev/null
check "stop: quoted done claim ok" [ "$(state .flags.length)" = 0 ]
check "stop: real claim beside code span still caught" has "$(stop 'Fixed the parser; see `fixed` flag.')" "Claimed done"
good=$'```text\n┌─ A ─┐  ┌──┐\n│ x   │  │y │\n└─────┘  └──┘\n```'
bad=$'```text\n┌───┐\n│ x  │\n└───┘\n```'
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "$good" >/dev/null
check "stop: aligned boxes ok" [ "$(state .flags.length)" = 0 ]
stop "$bad" >/dev/null
check "stop: misaligned box flagged" has "$(state .flags)" "line 3"

# --- config layers ---
mcfg() { printf '%s' "$1" > "$CLAUDE_CONFIG_DIR/claudzilla.json"; }
rcfg() { mkdir -p "$1/.claude"; printf '%s' "$3" > "$1/.claude/claudzilla$2.json"; }
reminded() { ! denied "$1" && has "$1" "Reminder: "; }
mcfg '{"rulesGuard":{"rules":{"tableWidth":"off"}}}'
new_session; check "config: tableWidth off, no width line" [ -z "$(COLUMNS=100 hook UserPromptSubmit prompt=q)" ]
COLUMNS=24 stop $'| aaaaaaaaaa | bbbbbbbbbbbbbbb |\n|---|---|' >/dev/null
check "config: tableWidth off, no flag" [ "$(state .flags.length)" = 0 ]
rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"
C=$(repo); git -C "$C" switch -q -c feat/c; cd "$C"
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "config: no files keeps push gate" denied "$(sh_ 'git push')"
mcfg '{"rulesGuard":{"rules":{"pushVerify":"off"}}}'
check "config: machine off disables push gate" [ -z "$(sh_ 'git push')" ]
rcfg "$C" "" '{"rulesGuard":{"rules":{"pushVerify":"deny"}}}'
check "config: repo deny beats machine off" denied "$(sh_ 'git push')"
rcfg "$C" ".local" '{"rulesGuard":{"rules":{"pushVerify":"remind"}}}'
check "config: local remind beats repo deny" reminded "$(sh_ 'git push')"
O=$(repo); rcfg "$O" "" '{"rulesGuard":{"rules":{"pushVerify":"off"}}}'
check "config: cd into other repo uses its config" [ -z "$(sh_ "cd $O && git push")" ]
rm -f "$C/.claude/"*.json "$CLAUDE_CONFIG_DIR/claudzilla.json"
git switch -q main
git config claudzilla.allowMain true
check "config: git config allowMain ignored" denied "$(sh_ 'git commit -m "fix: x"')"
git config --unset claudzilla.allowMain
rcfg "$C" ".local" '{"rulesGuard":{"allowMain":true}}'
check "config: allowMain in local file" [ -z "$(sh_ 'git commit -m "fix: x"')" ]
rcfg "$C" "" '{"rulesGuard":{"commitTypes":["feat","fix","refactor","chore","docs","test","ci"],"subjectMax":72}}'
check "config: extra commit type allowed" [ -z "$(sh_ 'git commit -m "ci: x"')" ]
check "config: subject under subjectMax allowed" [ -z "$(sh_ "git commit -m \"fix: $(printf 'a%.0s' {1..55})\"")" ]
check "config: subject over subjectMax denied" denied "$(sh_ "git commit -m \"fix: $(printf 'a%.0s' {1..70})\"")"
rm -f "$C/.claude/"*.json
mcfg '{"rulesGuard":{"keywords":{"debug":["kaboom","c++"]}}}'
new_session; check "config: custom keyword with suffix" has "$(hook UserPromptSubmit prompt='login kaboomed')" "systematic-debugging"
new_session; check "config: regex chars in keyword escaped" has "$(hook UserPromptSubmit prompt='the c++ build')" "systematic-debugging"
new_session; check "config: keyword list replaced" [ -z "$(hook UserPromptSubmit prompt='login is broken')" ]
mcfg '{"rulesGuard":{"rules":{"debugTrigger":"off"}}}'
new_session; check "config: debugTrigger off" [ -z "$(hook UserPromptSubmit prompt='login is broken')" ]
mcfg '{"rulesGuard":{"tldrMinLines":40,"rules":{"doneClaim":"off"}}}'
new_session; hook UserPromptSubmit prompt=q >/dev/null
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
stop "$long" >/dev/null; stop "Fixed it." >/dev/null
check "config: tldrMinLines and doneClaim off" [ "$(state .flags.length)" = 0 ]
mcfg '{"rulesGuard":{"rules":{"doneClaim":"flag"}}}'
new_session; hook UserPromptSubmit prompt=q >/dev/null
hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
check "config: doneClaim flag stays silent" [ -z "$(stop 'Fixed it.')" ]
check "config: doneClaim flag saves flag" has "$(state .flags)" "verification"
mcfg '{"rulesGuard":{"rules":{"prSkill":"off"}}}'
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "config: prSkill off" [ -z "$(sh_ 'gh pr edit 1 --title x')" ]
mcfg '{"rulesGuard":{"rules":{"specExclude":"off"}}}'
X=$(repo); hook PreToolUse tool_name=Write tool_input.file_path="$X/docs/superpowers/s.md" >/dev/null
check "config: specExclude off" [ "$(grep -c superpowers "$X/.git/info/exclude")" -eq 0 ]
mcfg '{"statusline":{"x":1}}'
new_session; check "config: file without rulesGuard is silent" [ -z "$(hook UserPromptSubmit prompt=hi)" ]
printf '{bad' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
new_session; out=$(hook UserPromptSubmit prompt=hi)
check "config: bad JSON warned" has "$out" "claudzilla config: $CLAUDE_CONFIG_DIR/claudzilla.json ignored: invalid JSON"
check "config: bad JSON keeps defaults" denied "$(sh_ 'git push')"
printf 'null' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
new_session; check "config: JSON null warned" has "$(hook UserPromptSubmit prompt=hi)" "not a JSON object"
mcfg '{"rulesGuard":{"rules":{"pushVerify":"maybe"},"subjectMax":"x","commitTypes":["c+"]}}'
new_session; out=$(hook UserPromptSubmit prompt=hi)
check "config: bad level warned" has "$out" "rulesGuard.rules.pushVerify ignored"
check "config: bad param warned" has "$out" "rulesGuard.subjectMax ignored"
check "config: bad commit type warned" has "$out" "rulesGuard.commitTypes ignored"
check "config: bad level keeps deny" denied "$(sh_ 'git push')"
mcfg '{"rulesGuard":{"rules":{"toString":"off","__proto__":"off"},"constructor":1,"hasOwnProperty":2}}'
new_session; check "config: inherited key names ignored" has "$(hook UserPromptSubmit prompt='login is broken')" "systematic-debugging"
check "config: inherited key names keep gates" denied "$(sh_ 'git push --force')"
mcfg '{"rulesGuard":{"rules":{"forcePush":"remind"}}}'
check "config: remind does not hide later deny" denied "$(sh_ 'git push --force; git reset --hard')"
hook PostToolUse tool_name=Skill tool_input.skill=superpowers:verification-before-completion >/dev/null
sh_ 'npm test' >/dev/null
check "config: remind alone still reminds" reminded "$(sh_ 'git push -f')"
rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"
new_session; check "config: default keywords skip unrelated suffixes" [ -z "$(hook UserPromptSubmit prompt='exceptional work, add failover, bugfix release')" ]
new_session; check "config: default keywords keep plural and tense" has "$(hook UserPromptSubmit prompt='tests failed with errors')" "systematic-debugging"
mcfg '{"rulesGuard":{"rules":{"debugTrigger":"off"}}}'
N=$(mktemp -d "$TMP/nogit.XXXX"); new_session
check "config: machine layer outside repo" [ -z "$(cd "$N" && hook UserPromptSubmit prompt='login is broken')" ]
rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"; cd "$REPO"

# --- minors: quote-aware split, branch tracking, checkout <file>, state, claims, diagrams, keywords ---
M=$(repo); git -C "$M" switch -q -c feat/m; cd "$M"
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "split: ; inside quoted message is not a command" [ -z "$(sh_ 'git commit -m "docs: x; git push later"')" ]
check "split: | inside quoted message is not a command" [ -z "$(sh_ 'git commit -m "fix: a | git stash drop"')" ]
check "branch: switch main then commit denied" denied "$(sh_ 'git switch main && git commit -m "fix: x"')"
git switch -q main
check "branch: switch -c then commit allowed" [ -z "$(sh_ 'git switch -c feat/z && git commit -m "fix: x"')" ]
echo a > a.txt; git add a.txt; git -c user.name=t -c user.email=t@t commit -qm "chore: a"
check "checkout: file path denied" denied "$(sh_ 'git checkout a.txt')"
check "checkout: branch name allowed" [ -z "$(sh_ 'git checkout feat/m')" ]
SP="$TMP/sp ace"; mkdir -p "$SP"; git -C "$SP" init -q -b main
cd "$REPO"
check "split: -C quoted path with space" denied "$(sh_ "git -C \"$SP\" commit -m \"fix: x\"")"
check "split: subshell cd honoured" denied "$(sh_ "(cd \"$SP\" && git commit -m \"fix: x\")")"
new_session; out=$(TMPDIR=/dev/null/x hook UserPromptSubmit prompt='login is broken')
check "state: reminder survives unwritable state dir" has "$out" "systematic-debugging"
new_session; hook UserPromptSubmit prompt=q >/dev/null; hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
check "claim: mention mid-sentence ignored" [ -z "$(stop "Say so if you want it fixed.")" ]
check "claim: 'is fixed' caught" has "$(stop "The bug is fixed.")" "Claimed done"
new_session; hook UserPromptSubmit prompt=q >/dev/null; hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
check "claim: bullet claim caught" has "$(stop $'Summary:\n- Fixed the parser')" "Claimed done"
loop=$'```text\n┌────┐\n▼    │\nA ──▶ B ─┘\n```'
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "$loop" >/dev/null
check "diagram: loop-back arrow not a box" [ "$(state .flags.length)" = 0 ]
mcfg '{"rulesGuard":{"keywords":{"debug":[".env","#bug"]}}}'
new_session; check "keyword: symbol-start keyword matches" has "$(hook UserPromptSubmit prompt='check my .env file')" "systematic-debugging"
new_session; check "keyword: symbol-start not inside word" [ -z "$(hook UserPromptSubmit prompt='see foo.env there')" ]
rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"; cd "$REPO"

# --- minors review fixes ---
new_session; hook UserPromptSubmit prompt=q >/dev/null; hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
for m in '**TL;DR** — token check fixed.' 'Tests: 120/120 passing.' 'I fixed the parser.' 'Everything works now.' '| 1 | x | fixed |' 'All 3 findings fixed.'; do
  check "claim: '$m' caught" has "$(stop "$m")" "Claimed done"
  hook UserPromptSubmit prompt=q >/dev/null; hook PreToolUse tool_name=Edit tool_input.file_path=/x/a.js >/dev/null
done
shift1=$'```text\n┌────┐\n │ A  │\n└────┘\n```'
new_session; hook UserPromptSubmit prompt=q >/dev/null; stop "$shift1" >/dev/null
check "diagram: shifted left edge still flagged" has "$(state .flags)" "misaligned"
side=$'```text\n┌──┐  ┌──┐\n│a │   │b │\n└──┘  └──┘\n```'
hook UserPromptSubmit prompt=q >/dev/null; stop "$side" >/dev/null
check "diagram: side-by-side misaligned second box flagged" has "$(state .flags)" "misaligned"
cd "$M"; git switch -q main
check "shell -c: inner reset --hard denied" denied "$(sh_ 'bash -c "git status; git reset --hard"')"
check "shell -c: inner force push denied" denied "$(sh_ "sh -c 'cd /tmp && git push --force'")"
check "eval: inner reset denied" denied "$(sh_ 'eval "git reset --hard"')"
check "branch: switch to missing branch keeps main" denied "$(sh_ 'git switch nope; git commit -m "fix: x"')"
git switch -q feat/m
check "checkout: ref + path is a discard" denied "$(sh_ 'git checkout HEAD a.txt')"
check "checkout: branch + path is a discard, not a switch" has "$(sh_ 'git checkout main a.txt && git commit -m "fix: x"')" "Discards work"
check "split: line continuation joins words" denied "$(sh_ $'git switch \\\n  main && git commit -m "fix: x"')"
check "split: line continuation in worktree path" [ -z "$(sh_ $'git worktree add \\\n  ../'"$(basename "$M")"'-x -b feat/q')" ]
cd "$REPO"

# --- guard gaps: previous branch, --create=x, repo-wide tracking, hidden commands, graphql file ---
G=$(repo); git -C "$G" switch -q -c feat/g; mkdir -p "$G/sub"; cd "$G"
new_session; hook UserPromptSubmit prompt=go >/dev/null
check "branch: switch - to main then commit denied" denied "$(sh_ 'git switch - && git commit -m "fix: x"')"
check "branch: checkout - to main then commit denied" denied "$(sh_ 'git checkout - && git commit -m "fix: x"')"
check "branch: switch in subdir tracked repo-wide" denied "$(sh_ 'cd sub && git switch main && cd .. && git commit -m "fix: x"')"
git switch -q main
check "branch: --create=x then commit allowed" [ -z "$(sh_ 'git switch --create=feat/y && git commit -m "fix: x"')" ]
check "branch: -cx then commit allowed" [ -z "$(sh_ 'git switch -cfeat/y && git commit -m "fix: x"')" ]
check "branch: checkout -bx then commit allowed" [ -z "$(sh_ 'git checkout -bfeat/y && git commit -m "fix: x"')" ]
check "branch: checkout --orphan=x then commit allowed" [ -z "$(sh_ 'git checkout --orphan=feat/y && git commit -m "fix: x"')" ]
git switch -q feat/g
for c in 'echo `git push`' 'x="$(git push)"' 'if git push; then echo ok; fi' '{ git push; }' '! git push' \
  'timeout 60 git push' 'env A=1 git push' 'nohup git push' 'command git push' 'time git push' 'sudo git push' 'xargs git push' 'exec git push'; do
  check "hidden: $c denied" denied "$(sh_ "$c")"
done
check "hidden: single-quoted backticks inert" [ -z "$(sh_ "git commit -m 'fix: use \`git push\` later'")" ]
check "hidden: single-quoted \$() inert" [ -z "$(sh_ "echo 'run \$(git push)'")" ]
check "hidden: quoted heredoc body inert" [ -z "$(sh_ $'git commit -F - <<\'EOF\'\nfix: x\n\nrun $(git push) later\nEOF')" ]
echo 'mutation { createPullRequest(input: {}) { clientMutationId } }' > q.graphql
check "graphql: -F query=@file create gated" denied "$(sh_ 'gh api graphql -F query=@q.graphql')"
check "graphql: -f query=@file is a literal" [ -z "$(sh_ 'gh api graphql -f query=@q.graphql')" ]
check "graphql: -F query=@- heredoc gated" denied "$(sh_ $'gh api graphql -F query=@- <<\'EOF\'\nmutation { createPullRequest(input: {}) { clientMutationId } }\nEOF')"
check "branch: switch main then - returns to feature" [ -z "$(sh_ 'git switch main && git switch - && git commit -m "fix: x"')" ]
check "branch: switch -c then - returns to feature" [ -z "$(sh_ 'git switch -c feat/t && git switch - && git commit -m "fix: x"')" ]
check "branch: detach after main not main" [ -z "$(sh_ 'git switch main && git switch --detach && git commit -m "fix: x"')" ]
check "comment: backticks after # inert" [ -z "$(sh_ $'# run `git push` later\ngit status')" ]
check "comment: trailing # comment inert" [ -z "$(sh_ 'git commit -m "fix: x" # `git push` next')" ]
git switch -q main
check "branch: feature then - back to main denied" denied "$(sh_ 'git switch feat/g && git switch - && git commit -m "fix: x"')"
check "subst: cd into \$(...) dir fails open" [ -z "$(sh_ 'cd "$(mktemp -d)" && git commit -m "fix: x"')" ]
git switch -q feat/g
cd "$REPO"

# --- MessageDisplay ---
MD="$REPO/claude/hooks/md-display.pl"
md() { node -e 'console.log(JSON.stringify({hook_event_name:"MessageDisplay",delta:process.argv[1]}))' "$1" | perl "$MD"; }
out=$(md $'| a | b<br>c |\ntext<br>\n')
check "md: <br> in table row replaced" has "$out" 'b · c'
check "md: <br> outside table kept" has "$out" 'text<br>'
check "md: plain batch silent" [ -z "$(md $'hello\n')" ]
check "md: bad json silent" bash -c "[ -z \"\$(echo '<br' | perl '$MD')\" ]"
# mdm <message_id> <final 0|1> <delta>: displayContent only; COLUMNS=24 → frame 20, separator 10, group break 5
mdm() {
  node -e 'const [id, f, d] = process.argv.slice(1); console.log(JSON.stringify({ hook_event_name: "MessageDisplay", message_id: id, final: f === "1", delta: d }))' "$@" |
    COLUMNS=24 perl "$MD" | node -e 'let s = ""; process.stdin.on("data", (c) => s += c).on("end", () => process.stdout.write(s ? JSON.parse(s).hookSpecificOutput.displayContent : ""))'
}
# grep -F splits a multi-line pattern into lines; match the whole string
sub() { [[ $1 == *"$2"* ]]; }
H=$(printf '━%.0s' {1..20}) S=$(printf '─%.0s' {1..10}) G=$(printf '┈%.0s' {1..5})
out=$(mdm a 0 $'**TL;DR** x\n\n## H\n')
check "frame: heavy line above TL;DR" sub "$out" "$H"$'\n\n**TL;DR** x'
check "frame: separator below TL;DR" sub "$out" $'x\n\n'"$S"
out=$(mdm a 1 $'**Next:** go\n')
check "frame: separator above Next" sub "$out" "$S"$'\n\n**Next:** go'
check "frame: heavy line closes final batch" sub "$out" $'go\n\n'"$H"
check "frame: no TL;DR, no frame" [ -z "$(mdm b 1 $'**Next:** go\n')" ]
out=$(mdm c 1 $'text\n\n---\n\nmore\n')
check "frame: --- shown as quarter dotted line" bash -c "grep -qF -- '$G' <<<\"\$1\" && ! grep -qx -- '---' <<<\"\$1\"" _ "$out"
mdm d 0 $'```\n' >/dev/null
check "frame: fenced ---, TL;DR across batches untouched" [ -z "$(mdm d 1 $'---\n**TL;DR** y\n```\n')" ]
out=$(mdm e 0 '**TL;DR** par')
check "frame: split TL;DR line, no separator yet" bash -c "! grep -qF -- '$S' <<<\"\$1\"" _ "$out"
out=$(mdm e 1 $'t\n## H\n')
check "frame: separator after split TL;DR line ends" sub "$out" $'t\n\n'"$S"
out=$(mdm f 0 $'**TL;DR** x\n'; mdm f 1 $'**Picks:** 1A\n**Next:** go\n')
check "frame: one separator above Picks, none above Next" [ "$(grep -o "$S" <<<"$out" | wc -l)" -eq 2 ]
check "md: upper-case <BR> in table row replaced" sub "$(mdm g 1 $'| a<BR>b |\n')" 'a · b'
mdm h 0 $'```\n~~~\n' >/dev/null
check "frame: tilde line inside backtick fence does not close it" [ -z "$(mdm h 0 $'---\n')" ]
check "frame: matching fence closes it" sub "$(mdm h 1 $'```\n---\n')" "$G"
check "frame: no message_id, no frame" [ -z "$(md $'**TL;DR** x\n')" ]
check "frame: state removed after final" bash -c "! ls '$TMP'/claudzilla-rules/md-* 2>/dev/null"

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
