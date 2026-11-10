#!/usr/bin/env bash
# Experimental loader tests: hook mode and --list against a fake clone.
#   bash tests/experimental.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$REPO/tests/lib.sh"
CL="$TMP/clone"; FEAT="$CL/claude/experimental"; SCRIPT="$CL/claude/hooks/experimental.mjs"
export CLAUDE_CONFIG_DIR="$TMP/cfg"
fresh() {
  rm -rf "$TMP/clone" "$TMP/cfg" "$TMP/my cfg"
  mkdir -p "$FEAT" "$CL/claude/hooks" "$CLAUDE_CONFIG_DIR"
  cp "$REPO/claude/hooks/experimental.mjs" "$SCRIPT"
  printf '# Alpha\n\nFirst feature.\n\nAlpha body.\n' >"$FEAT/alpha.md"
  printf '# Beta\n\nSecond feature.\n\nBeta body.\n' >"$FEAT/beta.md"
  : >"$FEAT/empty.md"
  echo x >"$FEAT/Bad-name.md"; echo x >"$FEAT/notes.txt"
}
conf() { printf '%s' "$1" >"$CLAUDE_CONFIG_DIR/claudzilla.json"; }
ctx() { node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).hookSpecificOutput.additionalContext)'; }
ALPHA=$(printf '# Alpha\n\nFirst feature.\n\nAlpha body.')
BETA=$(printf '# Beta\n\nSecond feature.\n\nBeta body.')

fresh
out=$(node "$SCRIPT" 2>&1); rc=$?
check "hook: nothing on prints nothing" [ -z "$out" -a $rc -eq 0 ]

fresh; conf '{"experimental":{"alpha":true}}'
out=$(node "$SCRIPT")
check "hook: one on prints its text" [ "$(node -e 'const o=JSON.parse(process.argv[1]).hookSpecificOutput;process.stdout.write(o.hookEventName)' "$out")" = SessionStart -a "$(ctx <<<"$out")" = "$ALPHA" ]

fresh; conf '{"experimental":{"alpha":true,"beta":true}}'
check "hook: two on, alphabetical, blank line between" [ "$(node "$SCRIPT" | ctx)" = "$ALPHA"$'\n\n'"$BETA" ]

fresh; conf '{"experimental":{"alpha":"true","beta":1}}'
check "hook: non-true values are off" [ -z "$(node "$SCRIPT")" ]

fresh; conf '{'
out=$(node "$SCRIPT"); rc=$?
check "hook: invalid JSON is off" [ -z "$out" -a $rc -eq 0 ]

fresh; conf '{"experimental":true}'
out=$(node "$SCRIPT"); rc=$?
check "hook: experimental not an object is off" [ -z "$out" -a $rc -eq 0 ]

fresh; conf '{"experimental":{"empty":true}}'
check "hook: empty feature file skipped" [ -z "$(node "$SCRIPT")" ]

fresh; conf '{"experimental":{"../../cfg/secret":true}}'; echo secret >"$TMP/cfg/secret.md"
check "hook: traversal key loads nothing" [ -z "$(node "$SCRIPT")" ]

fresh; conf '{"experimental":{"gone":true}}'
out=$(node "$SCRIPT" 2>&1); rc=$?
check "hook: key with no feature file is ignored" [ -z "$out" -a $rc -eq 0 ]

fresh; conf '{"experimental":{"Bad-name":true}}'
check "hook: bad file name is not a feature" [ -z "$(node "$SCRIPT")" ]

fresh; export CLAUDE_CONFIG_DIR="$TMP/my cfg"; mkdir -p "$CLAUDE_CONFIG_DIR"; conf '{"experimental":{"alpha":true}}'
check "hook: config dir with a space" grep -qF 'Alpha body.' <(node "$SCRIPT")
export CLAUDE_CONFIG_DIR="$TMP/cfg"

fresh; conf '{"experimental":{"alpha":true}}'; mkdir -p "$TMP/cfg/hooks"; ln -s "$SCRIPT" "$TMP/cfg/hooks/experimental.mjs"
check "hook: runs through a symlink" [ "$(node "$TMP/cfg/hooks/experimental.mjs")" = "$(node "$SCRIPT")" -a -n "$(node "$SCRIPT")" ]

fresh; conf '{"experimental":{"alpha":true}}'
check "list: ids, descriptions, state" [ "$(node "$SCRIPT" --list)" = '[{"id":"alpha","description":"First feature.","on":true},{"id":"beta","description":"Second feature.","on":false},{"id":"empty","description":"","on":false}]' ]

fresh; rm -rf "$FEAT"
out=$(node "$SCRIPT" --list); rc=$?
check "list: no features folder" [ "$out" = '[]' -a $rc -eq 0 ]

CFG() { printf '%s/claudzilla.json' "$CLAUDE_CONFIG_DIR"; }
has() { [[ $1 == *"$2"* ]] && echo y; }
jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(eval(process.argv[2])))' "$(CFG)" "$1"; }

fresh
node "$SCRIPT" --set alpha on; rc=$?
check "set: creates a missing file" [ $rc -eq 0 -a "$(jget j)" = '{"experimental":{"alpha":true}}' ]

node "$SCRIPT" --set alpha off
check "set: off writes false" [ "$(jget j.experimental.alpha)" = false ]

fresh; conf '{"install":{"skip":["hud"]},"rulesGuard":{"rules":{"tldr":"off"}}}'
node "$SCRIPT" --set alpha on
check "set: keeps other keys" [ "$(jget '[j.install,j.rulesGuard,j.experimental.alpha]')" = '[{"skip":["hud"]},{"rules":{"tldr":"off"}},true]' ]

fresh; conf '{"experimental":{"beta":true}}'
node "$SCRIPT" --set alpha on
check "set: keeps other features" [ "$(jget '[j.experimental.alpha,j.experimental.beta]')" = '[true,true]' ]

fresh; conf '{"experimental":true,"install":{}}'
node "$SCRIPT" --set alpha on
check "set: replaces a non-object experimental" [ "$(jget '[j.experimental,j.install]')" = '[{"alpha":true},{}]' ]

fresh; conf '{'
err=$(node "$SCRIPT" --set alpha on 2>&1 >/dev/null); rc=$?
check "set: invalid file refused" [ $rc -eq 2 -a "$(cat "$(CFG)")" = '{' -a "$(has "$err" 'is not valid JSON')" = y ]

fresh
err=$(node "$SCRIPT" --set nope on 2>&1 >/dev/null); rc=$?
check "set: unknown id refused" [ $rc -eq 3 -a "$err" = 'No experimental feature "nope". Known: alpha, beta, empty' -a ! -e "$(CFG)" ]

fresh
node "$SCRIPT" --set alpha maybe 2>/dev/null; rc=$?
check "set: bad state refused" [ $rc -eq 4 ]

fresh; mkdir -p "$TMP/dot"; printf '{}' >"$TMP/dot/claudzilla.json"; ln -s "$TMP/dot/claudzilla.json" "$(CFG)"
node "$SCRIPT" --set alpha on
check "set: writes through a symlink" [ -L "$(CFG)" -a "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).experimental.alpha))' "$TMP/dot/claudzilla.json")" = true ]

has_alpha_only() { [[ "$(node "$SCRIPT" | ctx)" == *'Alpha body.'* ]]; }
fresh; conf '{"experimental":{"alpha":true}}'; mkdir "$FEAT/broken.md"
check "hook: unreadable feature file skipped" has_alpha_only
list_skips() { local o; o=$(node "$SCRIPT" --list) || return 1; [ "$(node -e 'const l=JSON.parse(process.argv[1]).map(f=>f.id);process.stdout.write(String(l.includes("alpha")&&!l.includes("broken")))' "$o")" = true ]; }
check "list: unreadable feature file skipped" list_skips

fresh; mkdir -p "$(CFG)"
err=$(node "$SCRIPT" --set alpha on 2>&1 >/dev/null); rc=$?
check "set: config path a directory fails cleanly" [ $rc -eq 1 -a "$(has "$err" 'Could not write')" = y -a -z "$(printf '%s\n' "$err" | grep '^    at ')" -a "${err:0:15}" = 'Could not write' ]

fresh; mkdir -p "$TMP/dang"; ln -s "$TMP/dang/new.json" "$(CFG)"
node "$SCRIPT" --set alpha on
check "set: dangling symlink stays a symlink" [ -L "$(CFG)" -a "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).experimental.alpha))' "$TMP/dang/new.json")" = true ]

if [ "$(id -u)" != 0 ]; then
  fresh; conf '{}'; chmod 555 "$CLAUDE_CONFIG_DIR"
  err=$(node "$SCRIPT" --set alpha on 2>&1 >/dev/null); rc=$?
  chmod 755 "$CLAUDE_CONFIG_DIR"
  check "set: unwritable folder" [ $rc -eq 1 -a "$(cat "$(CFG)")" = '{}' -a "$(has "$err" 'Could not write')" = y ]
fi

fresh; node "$SCRIPT" --set alpha on
check "set then hook" grep -qF 'Alpha body.' <(node "$SCRIPT" | ctx)

# Hook additionalContext is capped at 10000 characters per string (code.claude.com/docs/en/hooks.md, "Output cap").
LIMIT=10000
RF="$REPO/claude/experimental"
fresh; rm -rf "$TMP/rcfg"; mkdir -p "$TMP/rcfg"
check "repo: agentRouting listed and off by default" [ "$(has "$(CLAUDE_CONFIG_DIR="$TMP/rcfg" node "$REPO/claude/hooks/experimental.mjs" --list)" '{"id":"agentRouting","description":"Picks, per task, whether to delegate to a subagent and at which model and effort.","on":false}')" = y ]
all_under_limit() {
  local d="$TMP/allcfg" ids
  rm -rf "$d"; mkdir -p "$d"
  ids=$(CLAUDE_CONFIG_DIR="$d" node "$REPO/claude/hooks/experimental.mjs" --list | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify({experimental:Object.fromEntries(l.map(f=>[f.id,true]))}))')
  printf '%s' "$ids" >"$d/claudzilla.json"
  CLAUDE_CONFIG_DIR="$d" node "$REPO/claude/hooks/experimental.mjs" | LIMIT=$LIMIT node -e 'const n=JSON.parse(require("fs").readFileSync(0,"utf8")).hookSpecificOutput.additionalContext.length;process.exit(n>0&&n<=Number(process.env.LIMIT)?0:1)'
}
titled() { local f n=0; for f in "$RF"/*.md; do [ -f "$f" ] || return 1; [[ "$(head -n 1 "$f")" == "# "* ]] || return 1; n=1; done; [ $n -eq 1 ]; }
valid_names() { [ -d "$RF" ] && [ -n "$(ls "$RF")" ] && [ -z "$(ls "$RF" | grep -Ev '^[a-z][A-Za-z0-9]*\.md$')" ]; }
AR="$RF/agentRouting.md"
no_machine_parts() { [ -f "$AR" ] && ! grep -Eq 'hook blocks|effort-eval-results|\$[0-9]|20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]|nested|1 or 2 searches|third search' "$AR"; }
names_fallback() { grep -qF 'caveman:cavecrew-investigator' "$AR" && grep -qF 'Explore' "$AR"; }
has_authority() { grep -qF 'counts as the user asking' "$AR" && grep -qF 'authorize setting `effort`' "$AR"; }
check "repo: all features together under the size limit" all_under_limit
check "repo: every feature starts with a title line" titled
check "repo: every feature file name is a valid id" valid_names
check "agentRouting: no machine-only parts" no_machine_parts
check "agentRouting: names the fallback" names_fallback
check "agentRouting: carries the authority lines" has_authority

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
