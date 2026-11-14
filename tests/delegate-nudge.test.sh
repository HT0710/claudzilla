#!/usr/bin/env bash
# delegate-nudge hook tests: gate, search detection, message, no log.
#   bash tests/delegate-nudge.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$REPO/tests/lib.sh"
H="$REPO/claude/hooks/delegate-nudge.mjs"; SID=s1; CWD=/
export CLAUDE_CONFIG_DIR="$TMP/cfg" TMPDIR="$TMP"
mkdir -p "$CLAUDE_CONFIG_DIR"
on() { printf '%s' '{"experimental":{"agentRouting":true}}' >"$CLAUDE_CONFIG_DIR/claudzilla.json"; }
# Empty SID leaves session_id out of the event.
# A variable, not a literal: bash 3.2 (macOS) keeps the backslash in "${3:-{\}}".
NO_INPUT='{}'
ev() { node -e 'const [s,e,t,c,x]=process.argv.slice(1);const o={hook_event_name:e,tool_name:t,cwd:c,...JSON.parse(x)};if(s)o.session_id=s;process.stdout.write(JSON.stringify(o))' "$SID" "$1" "${2:-}" "$CWD" "${3:-$NO_INPUT}" | node "${HOOK:-$H}"; }
prompt() { ev UserPromptSubmit; }
warm() { prompt; ev PreToolUse Grep >/dev/null; ev PreToolUse Grep >/dev/null; }
denied() { [[ "$1" == *'"deny"'* ]] && echo yes || echo no; }
bash_ev() { ev PreToolUse Bash "$(node -e 'process.stdout.write(JSON.stringify({tool_input:{command:process.argv[1]}}))' "$1")"; }
grepTool() { ev PreToolUse Grep "$(node -e 'process.stdout.write(JSON.stringify({tool_input:{path:process.argv[1]}}))' "$1")"; }
eq() { [ "$1" = "$2" ]; }
on

check "Read never counts" eq "$(prompt; denied "$(ev PreToolUse Read; ev PreToolUse Read; ev PreToolUse Read)")" no
check "plain Bash never counts" eq "$(prompt; denied "$(bash_ev 'git status'; bash_ev 'git log --find-renames'; bash_ev 'npm test')")" no
check "search past the free limit denied" eq "$(warm; denied "$(ev PreToolUse Grep)")" yes
check "Grep in one file allowed" eq "$(warm; denied "$(grepTool "$H")")" no
check "Bash grep in one file allowed" eq "$(warm; denied "$(bash_ev "grep -n x $H")")" no
check "Bash grep on a ~ path allowed" eq "$(warm; denied "$(bash_ev "grep -n x ~/${H#"$HOME"/}")")" no
check "Bash grep on a \$HOME path allowed" eq "$(warm; denied "$(bash_ev "grep -n x \$HOME/${H#"$HOME"/}"; bash_ev "grep -n x \${HOME}/${H#"$HOME"/}")")" no
check "relative path resolved from cwd" eq "$(warm; denied "$(CWD="$REPO/claude/hooks" bash_ev 'grep -n x delegate-nudge.mjs')")" no
check "pattern with | ( in quotes allowed" eq "$(warm; denied "$(bash_ev "grep -nE '^(a|b) *=' $H")")" no
check "file greps joined by ; and | head allowed" eq "$(warm; denied "$(bash_ev "grep -n x $H; ls /tmp; grep -n y $H 2>/dev/null | head -5")")" no
check "2>&1 after a file grep allowed" eq "$(warm; denied "$(bash_ev "grep -n x $H 2>&1")")" no
check "\$( elsewhere does not block a file grep" eq "$(warm; denied "$(bash_ev "cd \$(pwd) && grep -n x $H")")" no
check "heredoc text never counts" eq "$(warm; denied "$(bash_ev $'cat > /tmp/n.md <<\'EOF\'\nuse a; grep -r x here\nEOF')")" no
check "grep mentioned in quotes never counts" eq "$(warm; denied "$(bash_ev "echo 'a; grep -r b .'")")" no
check "grep in \$() on a variable denied" eq "$(warm; denied "$(bash_ev 'for f in a; do echo $(grep -c x $f); done')")" yes
check "search after a heredoc denied" eq "$(warm; denied "$(bash_ev $'cat <<EOF\nhi\nEOF\ngrep -rn x /etc')")" yes
check "search on a new line denied" eq "$(warm; denied "$(bash_ev $'echo hi\ngrep -rn x /etc')")" yes
check "search after do denied" eq "$(warm; denied "$(bash_ev 'for f in a; do grep -rn x /etc; done')")" yes
check "search after then denied" eq "$(warm; denied "$(bash_ev 'if true; then grep -rn x /etc; fi')")" yes
check "search after VAR= denied" eq "$(warm; denied "$(bash_ev 'LC_ALL=C grep -rn x /etc')")" yes
check "search by full path denied" eq "$(warm; denied "$(bash_ev '/usr/bin/grep -rn x /etc')")" yes
check "xargs grep denied" eq "$(warm; denied "$(bash_ev 'ls | xargs grep -l x')")" yes
check "search in ( ) denied" eq "$(warm; denied "$(bash_ev '(grep -rn x /etc)')")" yes
check "search in <( ) denied" eq "$(warm; denied "$(bash_ev 'diff <(grep -rn x /etc) /dev/null')")" yes
check "search in backticks denied" eq "$(warm; denied "$(bash_ev 'echo `grep -rn x /etc`')")" yes
check "escaped quote does not hide a search" eq "$(warm; denied "$(bash_ev "echo don\\'t && grep -rn x . && echo 'y'")")" yes
check "fd with no arguments denied" eq "$(warm; denied "$(bash_ev 'fd')")" yes
check "Bash grep -rn denied" eq "$(warm; denied "$(bash_ev "grep -rn x $H")")" yes
check "grep on piped input never counts" eq "$(warm; denied "$(bash_ev "cat $H | grep x")")" no
check "Bash grep on a dir denied" eq "$(warm; denied "$(bash_ev "grep x /etc")")" yes
check "Glob denied" eq "$(warm; denied "$(ev PreToolUse Glob)")" yes
check "new prompt still blocks" eq "$(warm; denied "$(bash_ev 'git grep x')")" yes
check "grep in text never counts" eq "$(warm; denied "$(bash_ev 'echo use grep here'; bash_ev 'cat a.jsonl')")" no
check "find counts" eq "$(warm; denied "$(bash_ev 'find . -name q')")" yes
check "Agent ends the count" eq "$(warm; ev PreToolUse Agent; denied "$(ev PreToolUse Grep)")" no
check "subagent never counts" eq "$(prompt; denied "$(for i in 1 2 3; do ev PreToolUse Grep '{"agent_id":"a"}'; done)")" no
check "subagent does not unblock main" eq "$(warm; ev PreToolUse Grep '{"agent_id":"a"}' >/dev/null; denied "$(ev PreToolUse Grep)")" yes
parallel() { warm; local o; o=$(for i in 1 2 3 4 5 6; do ev PreToolUse Grep & done; wait); grep -o '"deny"' <<<"$o" | wc -l | tr -d ' '; }
check "parallel: all denied" eq "$(parallel)" 6
pathesc() { local SID=../x; prompt; [ ! -e "$TMP/x" ]; }
check "session id cannot escape tmpdir" pathesc
private() { on; prompt; local d="$TMP/delegate-nudge-$(id -u)"; [ -f "$d/s1" ] && [ "$(ls -ld "$d" | cut -c1-10)" = drwx------ ]; }
check "the counter lives in a private per-user dir" private
planted() {
  local d="$TMP/delegate-nudge-$(id -u)"; rm -rf "$d"; mkdir -p "$TMP/victim"; ln -s "$TMP/victim" "$d"; on; prompt
  local ok=1; [ -z "$(ls -A "$TMP/victim")" ] || ok=0; rm "$d"; [ $ok -eq 1 ]
}
check "a planted symlink dir is never written through" planted
open_dir() {
  local d="$TMP/delegate-nudge-$(id -u)"; rm -rf "$d"; mkdir -p "$d"; chmod 777 "$d"; on; prompt
  local ok=1; [ -z "$(ls -A "$d")" ] || ok=0; rm -rf "$d"; [ $ok -eq 1 ]
}
check "a dir others can write is never used" open_dir
check "bad JSON exits 0" eq "$(echo nope | node "$H"; echo $?)" 0

third() { warm; ev PreToolUse Grep; }
gate_default() { rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"; prompt; local i o; for i in 1 2 3; do o=$(ev PreToolUse Grep); [ -z "$o" ] || return 1; done; }
check "gate: off by default" gate_default
nontrue() { printf '%s' '{"experimental":{"agentRouting":"true"}}' >"$CLAUDE_CONFIG_DIR/claudzilla.json"; [ "$(denied "$(third)")" = no ]; }
check "gate: non-true value is off" nontrue
on_blocks() { on; [[ "$(third)" == *'"permissionDecision":"deny"'* ]]; }
check "gate: on blocks the third search" on_blocks
evalwins() { on; [ "$(denied "$(EVAL_ROUTING=off third)")" = no ]; }
check "gate: EVAL_ROUTING=off wins" evalwins
msg_explore() { on; [[ "$(third)" == *Explore* ]]; }
check "message: names the Explore fallback" msg_explore
nolog() { on; third >/dev/null; [ -z "$(find "$TMP/cfg" -name 'delegate-nudge-denies.log')" ]; }
check "no deny log" nolog

bigdrain() {
  local big="$TMP/big.json"
  rm -f "$CLAUDE_CONFIG_DIR/claudzilla.json"
  node -e 'process.stdout.write(JSON.stringify({session_id:"s1",hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"x".repeat(200000)}}))' >"$big"
  local o; o=$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))' "$big" | node "$H"; echo "rc=${PIPESTATUS[*]}")
  [ "$o" = "rc=0 0" ]
}
check "gate: off drains large input" bigdrain
broken() {
  mkdir -p "$TMP/solo"; cp "$H" "$TMP/solo/delegate-nudge.mjs"; on
  local o rc; o=$(HOOK="$TMP/solo/delegate-nudge.mjs" third); rc=$?
  [ $rc -eq 0 ] && [ -z "$o" ]
}
check "gate: broken loader fails open" broken
nosid() {
  on; local SID="" o="" i
  for i in 1 2 3; do o+=$(ev PreToolUse Grep); done
  [ -z "$o" ] && [ ! -e "$TMP/delegate-nudge-$(id -u)/undefined" ]
}
check "no session id: never counts" nosid

# settings commands: node only starts when the feature key is in claudzilla.json
mkdir -p "$TMP/bin"; printf '#!/bin/sh\ncat > "%s/node.in"\necho called >> "%s/node.rec"\n' "$TMP" "$TMP" >"$TMP/bin/node"; chmod +x "$TMP/bin/node"
gate_cmd() { REPO="$REPO" node -p 'const h=require(process.env.REPO+"/settings.base.json").hooks; [h.UserPromptSubmit, h.PreToolUse].flat().flatMap(e=>e.hooks).map(x=>x.command).filter(c=>c.includes("delegate-nudge")).join("\n")' ; }
gated() {
  local c rc=0; rm -f "$TMP/node.rec" "$TMP/node.in"
  while IFS= read -r c; do
    rm -f "$TMP/node.rec" "$TMP/node.in"; : >"$CLAUDE_CONFIG_DIR/claudzilla.json"
    [ "$(echo '{"x":1}' | PATH="$TMP/bin:$PATH" sh -c "$c"; echo "rc$?")" = rc0 ] && [ ! -e "$TMP/node.rec" ] || rc=1
    on; echo '{"x":1}' | PATH="$TMP/bin:$PATH" sh -c "$c"
    [ -e "$TMP/node.rec" ] && [ "$(cat "$TMP/node.in")" = '{"x":1}' ] || rc=1
  done <<<"$(gate_cmd)"
  [ "$(gate_cmd | wc -l)" = 2 ] && return $rc
}
check "settings: both nudge commands skip node when off, pass stdin when on" gated
# Off, the shell gate exits before node, so it must drain the event itself: a big one must never meet a closed pipe.
gated_drain() {
  local c o; : >"$CLAUDE_CONFIG_DIR/claudzilla.json"
  while IFS= read -r c; do
    o=$(node -e 'process.stdout.write("x".repeat(200000))' | sh -c "$c"; echo "rc=${PIPESTATUS[*]}")
    [ "$o" = "rc=0 0" ] || return 1
  done <<<"$(gate_cmd)"
}
check "settings: off gate drains large input" gated_drain

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
