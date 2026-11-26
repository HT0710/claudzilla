#!/usr/bin/env bash
# agent-name hook tests: fallback names, reminders, state, safety.
#   bash tests/agent-name.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$REPO/tests/lib.sh"
H="$REPO/claude/hooks/agent-name.mjs"
export TMPDIR="$TMP"
ST="$TMP/agent-name-$(id -u)"
unset CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
# Empty SID leaves session_id out of the event. Variables, not literals: bash 3.2 keeps the backslash in "${1:-{\}}".
NONE='{}'; SID=s1
ev() { node -e 'const [s,e,x]=process.argv.slice(1);const o={hook_event_name:e,tool_name:"Agent",tool_use_id:"t1",tool_input:{description:"d",prompt:"p",subagent_type:"t"},...JSON.parse(x)};if(s)o.session_id=s;process.stdout.write(JSON.stringify(o))' "$SID" "$1" "${2:-$NONE}" | node "$H"; }
call() { ev PreToolUse "${1:-$NONE}"; }
field() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const o=JSON.parse(s);console.log(eval("o."+process.argv[1]))})' "$1"; }
count() { ls "$ST/s1" 2>/dev/null | grep -v '^%s' | wc -l | tr -d ' '; }
# Reads names on stdin, prints how many distinct styles they use.
styles() { HOOK="$H" node --input-type=module -e '
const { STYLES } = await import(process.env.HOOK);
let s = ""; for await (const c of process.stdin) s += c;
const kind = (n) => /^[a-z]+-\d+$/.test(n) ? "codename" : n.includes("-the-") ? "epithet"
  : ["fantasy", "animal"].find((k) => STYLES[k][0].includes(n.split("-")[0]) && STYLES[k][1].includes(n.split("-")[1]));
console.log(new Set(s.split("\n").filter(Boolean).map(kind)).size)'; }
empty() { [ -z "$1" ]; }
nonempty() { [ -n "$1" ]; }
kebab24() { [[ "$1" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] && [ "${#1}" -le 24 ]; }
reset() { rm -rf "$ST"; }
SEED_RE='^Start the next subagent names with these letters, in order: ([bcdfghjklmnprstw]), ([bcdfghjklmnprstw]), ([bcdfghjklmnprstw]), ([bcdfghjklmnprstw])\.$'
# A seed line: 4 distinct letters from the easy-start set.
seed() { [[ "$1" =~ $SEED_RE ]] && [ "$(printf '%s\n' "${BASH_REMATCH[@]:1}" | sort -u | wc -l | tr -d ' ')" = 4 ]; }
ctx() { printf '%s' "$1" | field hookSpecificOutput.additionalContext; }

reset; out=$(CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 call); rc=$?
check "teams 1: no output" empty "$out"
check "teams 1: rc 0 and no record" eq "$rc$(count)" 00
for v in 0 ""; do
  reset; out=$(CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="$v" call)
  check "teams '$v': fills a name" nonempty "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput.name)"
done

reset; out=$(call '{"agent_id":"a"}'); rc=$?
check "subagent call: no output" empty "$out"
check "subagent call: rc 0, no record" eq "$rc$(count)" 00

reset; out=$(call '{"tool_input":{"name":"brave-otter"}}')
check "named and unused: no updatedInput" eq "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput)" undefined
check "named and unused: seed line" seed "$(ctx "$out")"
check "named and unused: file created" [ -e "$ST/s1/brave-otter" ]

reset; out=$(call)
name=$(printf '%s' "$out" | field hookSpecificOutput.updatedInput.name)
check "missing name: input kept" eq "$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const u=JSON.parse(s).hookSpecificOutput.updatedInput;delete u.name;console.log(JSON.stringify(u))})')" '{"description":"d","prompt":"p","subagent_type":"t"}'
check "missing name: kebab, <= 24" kebab24 "$name"
check "missing name: reminder" eq "$(ctx "$out" | head -1)" "This Agent call had no \`name\`, so the hook picked \`$name\`. Next time, give each subagent a playful character name of your own, 1 to 3 words in kebab case, like \`brave-otter\`."
check "missing name: seed line after reminder" seed "$(ctx "$out" | sed -n 2p)"
check "missing name: event name" eq "$(printf '%s' "$out" | field hookSpecificOutput.hookEventName)" PreToolUse
check "no permissionDecision (fill)" eq "$(printf '%s' "$out" | field hookSpecificOutput.permissionDecision)" undefined

reset; call '{"tool_input":{"name":"brave-otter"}}' >/dev/null; out=$(call '{"tool_input":{"name":"brave-otter"}}')
name=$(printf '%s' "$out" | field hookSpecificOutput.updatedInput.name)
check "taken name: replaced" test "$name" != brave-otter
check "taken name: replacement is kebab" kebab24 "$name"
check "taken name: reminder" eq "$(ctx "$out" | head -1)" "The name \`brave-otter\` was already used this session, so the hook picked \`$name\`. Next time, give each subagent a new playful character name of your own, 1 to 3 words in kebab case, like \`brave-otter\`."
check "no permissionDecision (taken)" eq "$(printf '%s' "$out" | field hookSpecificOutput.permissionDecision)" undefined

for n in '""' 7; do
  reset; out=$(call "{\"tool_input\":{\"name\":$n}}")
  check "name $n counts as missing" nonempty "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput.name)"
done

reset; out=$(call '{"tool_input":{"name":"Bad Name!"}}')
check "malformed name passes through" eq "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput)" undefined

reset; call '{"tool_input":{"name":"../escape"}}' >/dev/null
check "slash name stays in the dir" bash -c "[ ! -e '$TMP/escape' ] && [ \$(ls -A '$ST/s1' | grep -vc '^%s') -eq 1 ]"

reset; names=$(for i in $(seq 30); do call | field hookSpecificOutput.updatedInput.name; done | sort -u | wc -l | tr -d ' ')
check "fallback never repeats" eq "$names/$(count)" 30/30

reset; names=$(for i in 1 2 3 4; do call | field hookSpecificOutput.updatedInput.name; done | styles)
check "four sequential fallbacks use four styles" eq "$names" 4

reset; for i in 1 2 3 4; do call >"$TMP/q$i" & done; wait
names=$(for i in 1 2 3 4; do field hookSpecificOutput.updatedInput.name <"$TMP/q$i"; done | styles)
check "four parallel fallbacks use four styles" eq "$names" 4

reset; for i in 1 2 3 4 5 6; do call >"$TMP/p$i" & done; wait
names=$(for i in 1 2 3 4 5 6; do field hookSpecificOutput.updatedInput.name <"$TMP/p$i"; done | sort -u | wc -l | tr -d ' ')
check "six parallel calls: six names, six files" eq "$names/$(count)" 6/6

reset; call '{"tool_input":{"name":"brave-otter"}}' >/dev/null
out=$(ev UserPromptSubmit)
check "other event: no output" empty "$out"
out=$(call '{"tool_input":{"name":"brave-otter"}}')
check "other event: state kept" nonempty "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput.name)"

reset; out=$(ev SessionStart)
check "session start: event name" eq "$(printf '%s' "$out" | field hookSpecificOutput.hookEventName)" SessionStart
check "session start: seed line" seed "$(ctx "$out")"
check "session start: no updatedInput" eq "$(printf '%s' "$out" | field hookSpecificOutput.updatedInput)" undefined
out=$(CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ev SessionStart)
check "session start, teams 1: no output" empty "$out"
lines=$(for i in 1 2 3 4 5 6; do ev SessionStart | field hookSpecificOutput.additionalContext; done | sort -u | wc -l | tr -d ' ')
check "seed letters vary between calls" test "$lines" -gt 1
check "settings: agent-name on SessionStart" node -e 'process.exit(require(process.argv[1]).hooks.SessionStart.some(e=>e.hooks.some(h=>h.command.includes("agent-name.mjs")))?0:1)' "$REPO/settings.base.json"

check "word lists: longest name fits 24" env HOOK="$H" node --input-type=module -e '
const { STYLES, nameFrom } = await import(process.env.HOOK);
const longest = (l) => l.reduce((a, b) => (b.length > a.length ? b : a));
for (const s of Object.keys(STYLES)) {
  const n = nameFrom(s, longest);
  if (n.length > 24 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) { console.error(s, n); process.exit(1); }
}'

check "bad JSON: exit 0" bash -c "echo nope | node '$H' >/dev/null"
check "bad JSON: no output" empty "$(echo nope | node "$H")"
reset; mkdir -p "$TMP/evil"; ln -s "$TMP/evil" "$ST"; out=$(call)
check "planted symlink: no output" empty "$out"
check "planted symlink: no write through it" empty "$(ls "$TMP/evil")"
reset; out=$(SID= call)
check "no session id: no output" empty "$out"

check "settings: base env sets agent teams 0" eq "$(node -p 'require(process.argv[1]).env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' "$REPO/settings.base.json")" 0

summary agent-name
