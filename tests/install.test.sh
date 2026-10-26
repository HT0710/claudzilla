#!/usr/bin/env bash
# Offline install tests. Every case runs install.sh against a throwaway HOME.
#   bash tests/install.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
q() { node -p "JSON.stringify(require(process.argv[1])$2)" "$1"; }
clean_env() { env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME "$@"; }   # never reach a real Windows side
run_install() { clean_env HOME="$1" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$1/install.log" 2>&1; }
new_home() { mktemp -d "$TMP/home.XXXX"; }
notty() { perl -MPOSIX -e 'if (fork) { wait; exit $? >> 8 } POSIX::setsid(); exec @ARGV' "$@"; }   # run with no controlling terminal
seedbase() { mkdir -p "$1/.claude"; cp "$REPO/settings.base.json" "$1/.claude/.claudzilla-base.json"; }   # marks the home as an existing install
export CLAUDZILLA_FONT_URL="file://$TMP/nofont"   # never hit the network; font cases override
export CLAUDZILLA_TTY=/dev/null   # menu reads EOF = Full, so fresh cases need no terminal
export CLAUDZILLA_FONT=yes   # answer the font prompt; declined case overrides

# --- content ---
check "content: no home paths" \
  bash -c "! grep -rqE '/home/|/Users/' '$REPO/claude' '$REPO/settings.base.json'"
check "content: no emails" \
  bash -c "! grep -rqE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}' '$REPO/claude' '$REPO/settings.base.json' '$REPO/install.sh' '$REPO/README.md' '$REPO/CONFIGURATION.md'"
check "content: settings.base.json valid" node -e "require('$REPO/settings.base.json')"
mcpHooked() { node -e 'const t=process.argv[2],m=require(process.argv[1]).hooks.PreToolUse.map(e=>e.matcher);process.exit(m.some(x=>new RegExp(`^(?:${x})$`).test(t))?0:1)' "$1" "$2"; }
check "content: GitHub MCP PR tools hooked" mcpHooked "$REPO/settings.base.json" mcp__github__create_pull_request
notHooked() { ! mcpHooked "$@"; }
check "content: GitHub MCP reads not hooked" notHooked "$REPO/settings.base.json" mcp__github__get_pull_request
check "content: CLAUDE.md imports RTK via ~" grep -qx '@~/.claude/RTK.md' "$REPO/claude/CLAUDE.md"
check "content: CLAUDE.md imports local" grep -qx '@~/.claude/CLAUDE.local.md' "$REPO/claude/CLAUDE.md"
check "content: python.md scoped to Python files" bash -c "head -1 '$REPO/claude/rules/python.md' | grep -qx -e '---' && head -3 '$REPO/claude/rules/python.md' | grep -qx 'paths:'"
check "content: CLAUDE.md covers new Python projects" grep -q "New Python project before that" "$REPO/claude/CLAUDE.md"
check "content: hook cites superpowers.md by section" bash -c "grep -q 'superpowers.md Order' '$REPO/claude/hooks/rules-guard.mjs' && grep -q '^## Order' '$REPO/claude/rules/superpowers.md' && ! grep -q 'superpowers.md:[0-9]' '$REPO/claude/hooks/rules-guard.mjs'"
check "content: no CodeGraph section" bash -c "! grep -qi codegraph '$REPO/claude/CLAUDE.md'"
check "content: reviewNudge not documented under rules" bash -c "! grep -q '^| \`reviewNudge\`' '$REPO/CONFIGURATION.md'"
check "content: README documents every parse_args flag" bash -c "for f in \$(sed -n '/^parse_args/,/^}/p' '$REPO/install.sh' | grep -oE -e '--[a-z]+' | sort -u); do grep -q -e \"\\\`\$f\" '$REPO/README.md' || { echo missing \$f; exit 1; }; done"
check "content: no omc" bash -c "! grep -rqi omc '$REPO/claude' '$REPO/settings.base.json' '$REPO/README.md' '$REPO/CONFIGURATION.md'"

# --- parts ---
check "parts: every base key/hook/plugin claimed exactly once" node "$REPO/tests/parts-check.mjs" "$REPO"
check "parts: links == old LINKS set" [ "$(node -p 'Object.values(require(process.argv[1])).flatMap(p=>p.links||[]).sort().join(" ")' "$REPO/parts.json")" = "CLAUDE.md RTK.md hooks/claudzilla-update.sh hooks/md-display.pl hooks/rules-guard.mjs hooks/trace.mjs hooks/trace.pl hud rules skills/claudzilla-compact skills/claudzilla-report skills/pr skills/rule-review themes" ]
H=$(new_home); run_install "$H"; cp -a "$H/.claude" "$H/before"; run_install "$H"
check "existing: re-run byte-identical" diff -r --exclude=.claudzilla-backup "$H/before" "$H/.claude"

# --- fresh machine ---
H=$(new_home); run_install "$H"; rc=$?
check "fresh: exit 0" [ "$rc" -eq 0 ]
for f in CLAUDE.md RTK.md rules themes hud hooks/claudzilla-update.sh hooks/rules-guard.mjs hooks/trace.mjs hooks/trace.pl hooks/md-display.pl skills/pr skills/rule-review skills/claudzilla-report skills/claudzilla-compact; do
  check "fresh: $f linked" [ "$(readlink "$H/.claude/$f")" = "$REPO/claude/$f" ]
done
H2=$(new_home); mkdir -p "$H2/.claude/skills/mine"; echo x > "$H2/.claude/skills/mine/SKILL.md"; run_install "$H2"
check "skills: own skill kept" [ "$(cat "$H2/.claude/skills/mine/SKILL.md")" = x ]
check "skills: pr linked beside own" [ "$(readlink "$H2/.claude/skills/pr")" = "$REPO/claude/skills/pr" ]
check "fresh: CLAUDE.local.md created" [ -f "$H/.claude/CLAUDE.local.md" ]
check "fresh: settings == base" [ "$(q "$H/.claude/settings.json" '')" = "$(q "$REPO/settings.base.json" '')" ]
check "fresh: permissions ask by default" [ "$(q "$H/.claude/settings.json" .permissions.defaultMode)" = '"default"' ]
check "fresh: no bypass-prompt skip" [ "$(q "$H/.claude/settings.json" .skipDangerousModePermissionPrompt)" = undefined ]
check "fresh: update hook in settings" grep -q 'claudzilla-update.sh' "$H/.claude/settings.json"
ssMatcher() { node -e 'const [p,re,m]=process.argv.slice(1),e=require(p).hooks.SessionStart.filter(x=>x.hooks.some(h=>new RegExp(re).test(h.command)));process.exit(e.length===1&&e[0].matcher===m?0:1)' "$H/.claude/settings.json" "$1" "$2"; }
check "fresh: update hook runs on startup and /clear" ssMatcher claudzilla-update 'startup|clear'
check "fresh: rule-review nudge stays startup only" ssMatcher 'rule-review/scan' startup
check "fresh: nudge hook in settings" grep -q 'rule-review/scan.mjs\\" --nudge' "$H/.claude/settings.json"
nudge_cmd=$(node -p 'require(process.argv[1]).hooks.SessionStart.flatMap(e=>e.hooks).find(h=>h.command.includes("--nudge")).command' "$H/.claude/settings.json" 2>/dev/null)
mkdir -p "$H/.claude/projects"
run_nudge() { [ -n "$nudge_cmd" ] && echo '{}' | env -u CLAUDE_CONFIG_DIR HOME="$H" sh -c "$nudge_cmd"; }
check "fresh: nudge hook runs from install" run_nudge
RS="$H/.claude/.claudzilla-rules.json"
rule_ids() { node --input-type=module -e "import { DEFAULTS } from '$REPO/claude/hooks/rules-guard.mjs'; console.log(Object.keys(DEFAULTS.rules).sort().join(','))" </dev/null; }
check "fresh: every rule stamped" [ "$(node -p "Object.keys(require('$RS')).sort().join(',')" 2>/dev/null)" = "$(rule_ids)" ]
node -e 'const f=process.argv[1],s=require(f);s.tldr="2001-01-01T00:00:00.000Z";s.emoji=5;delete s.pushVerify;require("fs").writeFileSync(f,JSON.stringify(s))' "$RS" 2>/dev/null
run_install "$H"
check "rerun: rule date kept" [ "$(node -p "require('$RS').tldr" 2>/dev/null)" = 2001-01-01T00:00:00.000Z ]
check "rerun: missing rule stamped" node -e 'process.exit(/^\d{4}-\d\d-\d\dT.*Z$/.test(require(process.argv[1]).pushVerify) ? 0 : 1)' "$RS"
check "rerun: non-string stamp restamped" node -e 'process.exit(/^\d{4}-\d\d-\d\dT.*Z$/.test(require(process.argv[1]).emoji) ? 0 : 1)' "$RS"
H3=$(new_home); mkdir -p "$H3/.claude/.claudzilla-rules.json"; run_install "$H3"; rc=$?
check "stamp fail: install still exits 0" [ "$rc" -eq 0 ]
check "stamp fail: warns" grep -q 'rule dates not saved' "$H3/install.log"
check "stamp fail: install finishes" grep -q 'claudzilla installed' "$H3/install.log"
check "fresh: rules-guard hook in settings" grep -q 'rules-guard.mjs' "$H/.claude/settings.json"
check "fresh: md-display hook in settings" grep -q 'md-display.pl' "$H/.claude/settings.json"
check "fresh: one unfiltered Bash rules-guard hook" node -e 'const h=require(process.argv[1]).hooks.PreToolUse.filter(e=>e.matcher==="Bash").flatMap(e=>e.hooks).filter(x=>/rules-guard/.test(x.command));process.exit(h.length===1&&!h[0].if?0:1)' "$H/.claude/settings.json"
check "fresh: rtk hook kept once" [ "$(grep -c 'rtk hook claude' "$H/.claude/settings.json")" -eq 1 ]
check "fresh: no backup dir" [ ! -e "$H/.claude/.claudzilla-backup" ]
sl=$(cd /tmp && clean_env HOME="$H" sh -c "$(node -p 'require(process.argv[1]).statusLine.command' "$H/.claude/settings.json")" \
     <<<'{"cwd":"/tmp","session_id":"t","model":{"display_name":"M"}}' 2>/dev/null | perl -pe 's/\e\[[0-9;]*m//g')  # hud colours letters one by one
check "fresh: statusline shows ctx" grep -q '^ctx ' <<<"$sl" || printf '%s\n' "$sl" | sed -n 1,8p >&2

# --- existing machine with its own extras ---
H=$(new_home); S="$H/.claude/settings.json"; mkdir -p "$H/.claude"
echo old > "$H/.claude/CLAUDE.md"
echo 'keep me' > "$H/.claude/CLAUDE.local.md"
echo '{"permissions":{"defaultMode":"dontAsk"},"theme":"dark"}' > "$H/.claude/settings.overrides.json"
cat > "$S" <<'JSON'
{"model":"opus","env":{"FOO":"1"},
 "hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook claude"}]},
                        {"matcher":"Edit","hooks":[{"type":"command","command":"mine"}]}]},
 "enabledPlugins":{"extra@x":true}}
JSON
run_install "$H"
check "merge: repo scalar wins" [ "$(q "$S" .model)" = '"opus[1m]"' ]
check "merge: machine env kept" [ "$(q "$S" .env.FOO)" = '"1"' ]
check "merge: repo env added" [ "$(q "$S" .env.COLORTERM)" = '"truecolor"' ]
check "merge: machine hook kept" grep -q '"mine"' "$S"
check "merge: rtk hook not duplicated" [ "$(grep -c 'rtk hook claude' "$S")" -eq 1 ]
check "merge: machine plugin kept" [ "$(q "$S" '.enabledPlugins["extra@x"]')" = true ]
check "backup: old CLAUDE.md saved" grep -rqx old "$H/.claude/.claudzilla-backup"
check "backup: old settings saved" bash -c "ls '$H'/.claude/.claudzilla-backup/*/settings.json >/dev/null"
check "override: beats repo value" [ "$(q "$S" .permissions.defaultMode)" = '"dontAsk"' ]
check "override: beats repo theme" [ "$(q "$S" .theme)" = '"dark"' ]
check "local: CLAUDE.local.md untouched" grep -qx 'keep me' "$H/.claude/CLAUDE.local.md"

# --- re-run is a no-op ---
nb=$(ls "$H/.claude/.claudzilla-backup" | wc -l); cp "$S" "$H/s1"; sleep 1
run_install "$H"
check "rerun: no new backup" [ "$(ls "$H/.claude/.claudzilla-backup" | wc -l)" -eq "$nb" ]
check "rerun: settings unchanged" cmp -s "$S" "$H/s1"

# --- key-order-safe merge + prune of stale claudzilla entries ---
hasCmd() { node -e 'const s=require(process.argv[1]);process.exit(Object.values(s.hooks||{}).flat().some(e=>(e.hooks||[]).some(h=>h.command===process.argv[2]))?0:1)' "$1" "$2"; }
lacksCmd() { ! hasCmd "$@"; }
rgBash() { node -p 'require(process.argv[1]).hooks.PreToolUse.filter(x=>x.matcher==="Bash"&&x.hooks.some(h=>/rules-guard/.test(h.command))).length' "$1"; }
H=$(new_home); S="$H/.claude/settings.json"; R="$H/.claude/.claudzilla-base.json"; mkdir -p "$H/.claude"
node -e '
const b=require(process.argv[1]),e=b.hooks.PreToolUse.find(x=>x.matcher==="Bash"&&x.hooks.some(h=>/rules-guard/.test(h.command)));
e.hooks=e.hooks.map(({type,command,...r})=>({command,...r,type}));
b.hooks.PreToolUse.push({matcher:"Edit",hooks:[{type:"command",command:"mine"}]});
require("fs").writeFileSync(process.argv[2],JSON.stringify(b))' "$REPO/settings.base.json" "$S"
run_install "$H"
check "order: reordered base entry merged once" [ "$(rgBash "$S")" -eq 1 ]
check "no record: machine hook kept" hasCmd "$S" mine
check "record: written as base" cmp -s "$R" "$REPO/settings.base.json"
node -e '
const fs=require("fs"),[r,s]=process.argv.slice(1),old={matcher:"Old",hooks:[{type:"command",command:"old"}]};
const b=JSON.parse(fs.readFileSync(r,"utf8"));b.hooks.Stop.push(old);b.x=1;b.y=1;fs.writeFileSync(r,JSON.stringify(b));
const d=JSON.parse(fs.readFileSync(s,"utf8"));d.hooks.Stop.push(old);d.x=1;d.y=2;fs.writeFileSync(s,JSON.stringify(d))' "$R" "$S"
run_install "$H"
check "prune: stale entry from record removed" lacksCmd "$S" old
check "prune: machine hook kept with record" hasCmd "$S" mine
check "prune: removed key deleted when unchanged" [ "$(q "$S" .x)" = undefined ]
check "prune: removed key kept when changed" [ "$(q "$S" .y)" = 2 ]
check "record: rewritten as base" cmp -s "$R" "$REPO/settings.base.json"
run_install "$H"
check "prune: rerun is a no-op" bash -c "! grep -q 'settings.json merged' '$H/install.log'"
node -e '
const fs=require("fs"),s=process.argv[1],d=JSON.parse(fs.readFileSync(s,"utf8"));
const e=d.hooks.PreToolUse.find(x=>x.matcher==="Bash"&&x.hooks.some(h=>/rules-guard/.test(h.command)));
d.hooks.PreToolUse.push({...e,hooks:e.hooks.map(({type,command,...r})=>({command,...r,type}))});
fs.writeFileSync(s,JSON.stringify(d))' "$S"
run_install "$H"
check "prune: existing duplicate collapsed (record)" [ "$(rgBash "$S")" -eq 1 ]
H2=$(new_home); S2="$H2/.claude/settings.json"; mkdir -p "$H2/.claude"
node -e '
const b=require(process.argv[1]),e=b.hooks.PreToolUse.find(x=>x.matcher==="Bash"&&x.hooks.some(h=>/rules-guard/.test(h.command)));
b.hooks.PreToolUse.push({...e,hooks:e.hooks.map(({type,command,...r})=>({command,...r,type}))});
require("fs").writeFileSync(process.argv[2],JSON.stringify(b))' "$REPO/settings.base.json" "$S2"
run_install "$H2"
check "no record: existing duplicate collapsed" [ "$(rgBash "$S2")" -eq 1 ]
echo '{bad' > "$R"; run_install "$H"; rc=$?
check "record: unparsable record falls back" [ "$rc" -eq 0 ]
check "record: unparsable record rewritten" cmp -s "$R" "$REPO/settings.base.json"

# --- keybindings: alt+h toggles the panel, alt+k focuses the band, alt+g opens the guide ---
key() { node -p 'const [f,c,k]=process.argv.slice(1);JSON.stringify(require(f).bindings.filter(b=>b.context===c).map(b=>b.bindings[k]).find(v=>v!==undefined))' "$1/.claude/keybindings.json" "$2" "$3" 2>/dev/null; }
K=$(new_home); run_install "$K"
check "keys: fresh alt+h opens panel" [ "$(key "$K" Chat alt+h)" = '"command:panel"' ]
check "keys: fresh alt+k focuses band" [ "$(key "$K" Chat alt+k)" = '"abovePrompt:focus"' ]
check "keys: fresh alt+g opens guide" [ "$(key "$K" Chat alt+g)" = '"command:claudzilla"' ]
K=$(new_home); mkdir -p "$K/.claude"
echo '{"bindings":[{"context":"Global","bindings":{"ctrl+t":"app:toggleTodos"}},{"context":"Chat","bindings":{"ctrl+e":"chat:externalEditor"}}]}' > "$K/.claude/keybindings.json"
run_install "$K"
check "keys: own binding kept" [ "$(key "$K" Global ctrl+t)" = '"app:toggleTodos"' ]
check "keys: own Chat binding kept" [ "$(key "$K" Chat ctrl+e)" = '"chat:externalEditor"' ]
check "keys: alt+h added beside own" [ "$(key "$K" Chat alt+h)" = '"command:panel"' ]
check "keys: alt+k added beside own" [ "$(key "$K" Chat alt+k)" = '"abovePrompt:focus"' ]
check "keys: added to existing Chat block" node -e 'process.exit(require(process.argv[1]).bindings.filter(b=>b.context==="Chat").length===1?0:1)' "$K/.claude/keybindings.json"
check "keys: own file backed up" bash -c "ls '$K'/.claude/.claudzilla-backup/*/keybindings.json >/dev/null"
cp "$K/.claude/keybindings.json" "$K/k1"; nb=$(ls "$K/.claude/.claudzilla-backup" | wc -l); sleep 1; run_install "$K"
check "keys: rerun unchanged" cmp -s "$K/.claude/keybindings.json" "$K/k1"
check "keys: rerun no new backup" [ "$(ls "$K/.claude/.claudzilla-backup" | wc -l)" -eq "$nb" ]
# Each key is judged alone: the user's own alt+h leaves alt+k still added, and the reverse.
n() { grep -o "$2" "$1" | wc -l; }
for own in '{"bindings":[{"context":"Chat","bindings":{"alt+h":null}}]}' \
           '{"bindings":[{"context":"Chat","bindings":{"opt+h":null}}]}' \
           '{"bindings":[{"context":"Global","bindings":{"Meta+H":"app:toggleTodos"}}]}' \
           '{"bindings":[{"context":"Global","bindings":{"ctrl+p":"command:panel"}}]}'; do
  K=$(new_home); mkdir -p "$K/.claude"; printf '%s\n' "$own" | tee "$K/k0" > "$K/.claude/keybindings.json"; run_install "$K"
  check "keys: alt+h left alone: $own" [ "$(n "$K/.claude/keybindings.json" command:panel)" -eq "$(n "$K/k0" command:panel)" ]
  check "keys: alt+k still added: $own" [ "$(key "$K" Chat alt+k)" = '"abovePrompt:focus"' ]
done
for own in '{"bindings":[{"context":"Chat","bindings":{"alt+k":null}}]}' \
           '{"bindings":[{"context":"Global","bindings":{"ctrl+f":"abovePrompt:focus"}}]}'; do
  K=$(new_home); mkdir -p "$K/.claude"; printf '%s\n' "$own" | tee "$K/k0" > "$K/.claude/keybindings.json"; run_install "$K"
  check "keys: alt+k left alone: $own" [ "$(n "$K/.claude/keybindings.json" abovePrompt:focus)" -eq "$(n "$K/k0" abovePrompt:focus)" ]
  check "keys: alt+h still added: $own" [ "$(key "$K" Chat alt+h)" = '"command:panel"' ]
done
K=$(new_home); mkdir -p "$K/.claude"; echo '{"bindings":[{"context":"Chat","bindings":{"alt+h":null,"alt+k":null,"alt+g":null}}]}' | tee "$K/k0" > "$K/.claude/keybindings.json"; run_install "$K"
check "keys: all own, file untouched" cmp -s "$K/.claude/keybindings.json" "$K/k0"
for own in '{"bindings":[{"context":"Chat","bindings":"x"}]}' '{bad'; do
  K=$(new_home); mkdir -p "$K/.claude"; printf '%s\n' "$own" | tee "$K/k0" > "$K/.claude/keybindings.json"; run_install "$K"; rc=$?
  check "keys: left alone: $own" cmp -s "$K/.claude/keybindings.json" "$K/k0"
done
check "keys: bad file, install exits 0" [ "$rc" -eq 0 ]
check "keys: bad file warns" grep -q 'keybindings.json' "$K/install.log"
K=$(new_home); mkdir -p "$K/.claude" "$K/dots"; echo '{"bindings":[]}' | tee "$K/k0" > "$K/dots/kb.json"
ln -s "$K/dots/kb.json" "$K/.claude/keybindings.json"; run_install "$K"
check "keys: symlink kept" [ "$(readlink "$K/.claude/keybindings.json")" = "$K/dots/kb.json" ]
check "keys: symlink target untouched" cmp -s "$K/dots/kb.json" "$K/k0"
check "keys: symlink warns" grep -q 'symlink' "$K/install.log"

# --- install modes: --full, --add, --remove ---
inst() { local h=$1; shift; clean_env HOME="$h" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" "$@" >"$h/install.log" 2>&1; }
A=$(new_home); inst "$A" --add hud
check "add: hud linked" [ -L "$A/.claude/hud" ]
check "add: no rules" [ ! -e "$A/.claude/rules" ]
check "add: updater linked" [ -L "$A/.claude/hooks/claudzilla-update.sh" ]
check "add: alt+g without core" [ "$(key "$A" Chat alt+g)" = '"command:claudzilla"' ]
check "add: only saved" [ "$(q "$A/.claude/claudzilla.json" .install)" = '{"only":["hud"]}' ]
inst "$A" --add panel
check "add: stacks" [ "$(q "$A/.claude/claudzilla.json" .install.only)" = '["hud","panel"]' ]
check "add: alt+h with panel" [ "$(key "$A" Chat alt+h)" = '"command:panel"' ]
check "add: no alt+k without picks" [ "$(key "$A" Chat alt+k)" = undefined ]
inst "$A" --remove hud
check "remove: hud unlinked" [ ! -e "$A/.claude/hud" ]
check "remove: statusLine gone" [ "$(q "$A/.claude/settings.json" .statusLine)" = undefined ]
inst "$A" --remove panel
check "remove panel: alt+h gone, alt+g kept" [ "$(key "$A" Chat alt+h)$(key "$A" Chat alt+g)" = 'undefined"command:claudzilla"' ]
R=$(new_home); inst "$R" --remove rtk
check "remove fresh: skip saved" [ "$(q "$R/.claude/claudzilla.json" .install)" = '{"skip":["rtk"]}' ]
check "remove fresh: rtk hook absent" bash -c "! grep -q 'rtk hook' '$R/.claude/settings.json'"
check "remove fresh: rules-guard hooks kept" bash -c "grep -q 'rules-guard' '$R/.claude/settings.json' && [ \"\$(node -p 'require(process.argv[1]).hooks.PreToolUse.length' '$R/.claude/settings.json')\" -ge 2 ]"
inst "$R"; check "saved: re-run keeps skip" bash -c "! grep -q 'rtk hook' '$R/.claude/settings.json'"
inst "$R" --full; check "full: clears install key" [ "$(q "$R/.claude/claudzilla.json" .install)" = undefined ]
X=$(new_home); inst "$X" --add nope; rc=$?
check "unknown part: exit 1" [ "$rc" -eq 1 ]; check "unknown part: no change" [ ! -e "$X/.claude" ]
B=$(new_home); (cd "$B" && clean_env HOME="$B" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_REPO="$REPO" bash -s -- --add hud < "$REPO/install.sh" >"$B/install.log" 2>&1)
check "bootstrap: flags forwarded" [ ! -e "$B/.claude/rules" ]
J=$(new_home); mkdir -p "$J/.claude"; echo '{"rulesGuard":{"allowMain":true}}' > "$J/.claude/claudzilla.json"; inst "$J" --remove rtk
check "save: keeps rulesGuard" [ "$(q "$J/.claude/claudzilla.json" .rulesGuard.allowMain)" = true ]
I=$(new_home); mkdir -p "$I/.claude"; echo '{bad' > "$I/.claude/claudzilla.json"; inst "$I" --remove rtk; rc=$?
check "save: invalid json exit 1, untouched" bash -c "[ $rc -eq 1 ] && [ \"\$(cat '$I/.claude/claudzilla.json')\" = '{bad' ]"
D=$(new_home); inst "$D" --remove rtk
node -e 'const f=process.argv[1],j=require(f);j.install.skip=["rtk","gone"];require("fs").writeFileSync(f,JSON.stringify(j))' "$D/.claude/claudzilla.json"; inst "$D"; rc=$?
check "saved: dropped part ignored" [ "$rc" -eq 0 ]
E=$(new_home); inst "$E"
node -e 'const f=process.argv[1],j=require(f);j.statusLine.command="mine";require("fs").writeFileSync(f,JSON.stringify(j))' "$E/.claude/settings.json"; inst "$E" --remove hud
check "remove: user-edited key kept" [ "$(q "$E/.claude/settings.json" .statusLine.command)" = '"mine"' ]

# Bad flag on a real run: no rtk download, nothing under ~/.local.
S="$TMP/stub"; mkdir -p "$S/bin"; printf '#!/bin/sh\necho "$@" >> "%s/curl.log"\nexit 1\n' "$S" > "$S/bin/curl"; chmod +x "$S/bin/curl"
ln -s "$(command -v node)" "$S/bin/node"
N=$(new_home); clean_env HOME="$N" PATH="$S/bin:/usr/bin:/bin" bash "$REPO/install.sh" --add nope >"$N/install.log" 2>&1; rc=$?
check "unknown part online: exit 1" [ "$rc" -eq 1 ]
check "unknown part online: curl never called" [ ! -e "$S/curl.log" ]
check "unknown part online: nothing written" bash -c "[ ! -e '$N/.claude' ] && [ ! -e '$N/.local' ]"
# Node + rtk: recorded when this run installed them; present or unpicked = nothing.
OB="$TMP/onb"; mkdir -p "$OB/bin" "$OB/pkg/bin"
printf '#!/bin/sh\nexec %s "$@"\n' "$(command -v node)" > "$OB/pkg/bin/node"; chmod +x "$OB/pkg/bin/node"
case "$(uname -m)" in aarch64|arm64) NA=arm64 ;; *) NA=x64 ;; esac
case "$(uname -s)" in Darwin) NOS=darwin ;; *) NOS=linux ;; esac
NF="node-v1.0.0-$NOS-$NA.tar.gz"; tar czf "$OB/$NF" -C "$OB" pkg
SUM="$( (sha256sum "$OB/$NF" 2>/dev/null || shasum -a 256 "$OB/$NF") | cut -d' ' -f1)"
cat > "$OB/bin/curl" <<'S'
#!/bin/sh
echo "$*" >> "$LOG"
case "$*" in
  *SHASUMS256*) echo "$SUM  $NF" ;;
  *"$NF"*) while [ $# -gt 0 ]; do [ "$1" = -o ] && o=$2; shift; done; cp "$OB/$NF" "$o" ;;
  *rtk-ai*) echo 'mkdir -p "$HOME/.local/bin"; printf "#!/bin/sh\n" > "$HOME/.local/bin/rtk"; chmod +x "$HOME/.local/bin/rtk"' ;;
  *) exit 1 ;;
esac
S
chmod +x "$OB/bin/curl"
online() { local h=$1; shift; clean_env HOME="$h" LOG="$h/curl.log" OB="$OB" SUM="$SUM" NF="$NF" PATH="$OB/bin:/usr/bin:/bin" bash "$REPO/install.sh" "$@" >"$h/install.log" 2>&1; }
O=$(new_home); online "$O"; rc=$?
check "deps: online install exit 0" [ "$rc" -eq 0 ]
check "deps: node dir, link and rtk recorded" [ "$(q "$O/.claude/.claudzilla-installed.json" .files)" = "[\"$O/.local/share/node-v1.0.0-$NOS-$NA\",\"$O/.local/bin/node\",\"$O/.local/bin/rtk\"]" ]
online "$O"
check "deps: re-run records nothing new" [ "$(q "$O/.claude/.claudzilla-installed.json" .files.length)" = 3 ]
O2=$(new_home); online "$O2" --remove rtk
check "deps: rtk not picked, not downloaded" bash -c "! grep -q rtk-ai '$O2/curl.log' && [ ! -e '$O2/.local/bin/rtk' ]"
check "deps: node still recorded without rtk" [ "$(q "$O2/.claude/.claudzilla-installed.json" .files.length)" = 2 ]
O3=$(new_home); mkdir -p "$O3/.local/bin"; printf '#!/bin/sh\n' > "$O3/.local/bin/rtk"; chmod +x "$O3/.local/bin/rtk"; online "$O3"
check "deps: rtk already present not recorded" bash -c "! grep -q '/rtk' '$O3/.claude/.claudzilla-installed.json'"
O4=$(new_home); mkdir -p "$O4/.claude"; echo '{bad' > "$O4/.claude/.claudzilla-installed.json"; online "$O4"; rc=$?
check "deps: corrupt record warns, install exits 0" bash -c "[ $rc -eq 0 ] && grep -q 'could not update the install record' '$O4/install.log'"
N5=$(new_home); online "$N5" --add nope; rc=$?
check "deps: bad flag, no node: exit 1, DEST absent" bash -c "[ $rc -eq 1 ] && [ ! -e '$N5/.claude' ]"
O6=$(new_home); mkdir -p "$O6/.local/share/node-v1.0.0-$NOS-$NA" "$O6/.local/bin"; ln -s /nonexistent "$O6/.local/bin/node"; online "$O6"
check "deps: existing node dir and link not recorded" [ "$(q "$O6/.claude/.claudzilla-installed.json" .files)" = "[\"$O6/.local/bin/rtk\"]" ]
mkdir -p "$OB/cl"; printf '#!/bin/sh\ncase "$*" in *"list --json"*) echo "[]" ;; esac\nexit 0\n' > "$OB/cl/claude"; chmod +x "$OB/cl/claude"
O7=$(new_home); mkdir -p "$O7/.claude"; echo '{bad' > "$O7/.claude/.claudzilla-installed.json"
clean_env HOME="$O7" LOG="$O7/curl.log" OB="$OB" SUM="$SUM" NF="$NF" PATH="$OB/cl:$OB/bin:/usr/bin:/bin" bash "$REPO/install.sh" >"$O7/install.log" 2>&1; rc=$?
check "plugins: corrupt record warns, install exits 0" bash -c "[ $rc -eq 0 ] && grep -q 'could not update the install record' '$O7/install.log' && grep -q 'claudzilla installed' '$O7/install.log'"
for bad in '{"only":["gone"]}' '{"only":"hud"}' '{"skip":"rtk"}'; do
  Y=$(new_home); inst "$Y"; echo "{\"install\":$bad}" > "$Y/.claude/claudzilla.json"; cp -a "$Y/.claude" "$Y/before"; inst "$Y"; rc=$?
  check "bad saved choice $bad: exit 1" [ "$rc" -eq 1 ]
  check "bad saved choice $bad: message" grep -q 'saved choice names no known part' "$Y/install.log"
  check "bad saved choice $bad: no change" diff -r --exclude=.claudzilla-backup "$Y/before" "$Y/.claude"
done
Z=$(new_home); inst "$Z"; echo '{"install":{"only":[]}}' > "$Z/.claude/claudzilla.json"; inst "$Z"; rc=$?
check "only []: valid, exit 0" [ "$rc" -eq 0 ]
check "only []: core unlinked, updater kept" bash -c "[ ! -e '$Z/.claude/rules' ] && [ -L '$Z/.claude/hooks/claudzilla-update.sh' ]"

# --- curl | bash bootstrap (clones committed HEAD of $REPO) ---
H=$(new_home)
(cd "$H" && clean_env HOME="$H" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_REPO="$REPO" bash < "$REPO/install.sh" >"$H/install.log" 2>&1); rc=$?
check "bootstrap: exit 0" [ "$rc" -eq 0 ]
check "bootstrap: cloned" [ -f "$H/claudzilla/settings.base.json" ]
check "bootstrap: links point at clone" [ "$(readlink "$H/.claude/CLAUDE.md")" = "$H/claudzilla/claude/CLAUDE.md" ]

# --- home path with a space ---
H="$(new_home)/sp ace"; mkdir -p "$H"; run_install "$H"
sl=$(cd /tmp && clean_env HOME="$H" sh -c "$(node -p 'require(process.argv[1]).statusLine.command' "$H/.claude/settings.json")" \
     <<<'{"cwd":"/tmp","session_id":"t","model":{"display_name":"M"}}' 2>/dev/null | perl -pe 's/\e\[[0-9;]*m//g')  # hud colours letters one by one
check "space: statusline shows ctx" grep -q '^ctx ' <<<"$sl" || printf '%s\n' "$sl" | sed -n 1,8p >&2

# --- update notice (SessionStart hook) ---
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@" >/dev/null 2>&1; }
U="$TMP/upd"; mkdir -p "$U"; g init --bare "$U/origin.git"; g clone "$U/origin.git" "$U/seed"
g -C "$U/seed" commit --allow-empty -m one; g -C "$U/seed" push origin main
g clone "$U/origin.git" "$U/clone"; mkdir -p "$U/clone/claude/hooks" "$U/home/.claude/hooks"
cp "$REPO/claude/hooks/claudzilla-update.sh" "$U/clone/claude/hooks/"
ln -s "$U/clone/claude/hooks/claudzilla-update.sh" "$U/home/.claude/hooks/claudzilla-update.sh"
cp "$REPO/claude/hooks/rules-guard.mjs" "$U/clone/claude/hooks/"
notice() { clean_env HOME="$U/home" sh "$U/home/.claude/hooks/claudzilla-update.sh"; }
ev="$(git -C "$U/clone" rev-parse --absolute-git-dir)/claudzilla-update.events"
# The update-toast mod's repo lookup, run as the mod runs it (sh -c, the session's cwd).
FIND=$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(eval(s.match(/const FIND = (\x27.*\x27)\n/)[1]))' "$REPO/plugins/update-toast/hooks/register.ts")
find_repo() { (cd "$1" && clean_env "${@:2}" sh -c "$FIND" 2>/dev/null); }
# The lookup resolves links (macOS: /var -> /private/var), so expect the physical path.
mkdir -p "$U/nohome"; clone=$(cd "$U/clone" && pwd -P); gdir=$(git -C "$clone" rev-parse --absolute-git-dir)
check "toast find: clone via the linked hook" [ "$(find_repo /tmp HOME="$U/home")" = "$(printf '%s\n%s' "$clone" "$gdir")" ]
check "toast find: honours CLAUDE_CONFIG_DIR" [ "$(find_repo /tmp HOME="$U/nohome" CLAUDE_CONFIG_DIR="$U/home/.claude")" = "$(printf '%s\n%s' "$clone" "$gdir")" ]
check "toast find: no link never falls back to the cwd repo" [ -z "$(find_repo "$U/seed" HOME="$U/nohome")" ]
echo '{"rulesGuard":{"autoUpdate":false}}' > "$U/home/.claude/claudzilla.json"
check "update: silent when current" [ -z "$(notice)" ]
g -C "$U/seed" commit --allow-empty -m two; g -C "$U/seed" push origin main
touch -t 200001010000 "$(git -C "$U/clone" rev-parse --absolute-git-dir)/FETCH_HEAD"
check "update: silent until the fetch lands" [ -z "$(notice)" ]
for i in 1 2 3 4 5 6 7 8 9 10; do [ -n "$(notice)" ] && break; sleep 0.5; done
out=$(notice)
check "update: stale fetch refreshed in background" [ -n "$out" ]
check "update: user sees 'update available'" node -e 'const j=JSON.parse(process.argv[1]);if(!/update [0-9a-f]{7,} available/.test(j.systemMessage)||/\d+ update/.test(j.systemMessage))process.exit(1)' "$out"
check "update: Claude gets the update command" node -e 'const h=JSON.parse(process.argv[1]).hookSpecificOutput;if(h.hookEventName!=="SessionStart"||!/merge --ff-only @\{u\}/.test(h.additionalContext)||!/install\.sh/.test(h.additionalContext))process.exit(1)' "$out"
check "events: available is a start line" grep -qE $'^[0-9]+\tstart\tclaudzilla: update [0-9a-f]{7,} available - ' "$ev"
mkdir -p "$U/nogit"; cp "$REPO/claude/hooks/claudzilla-update.sh" "$U/nogit/"
check "update: not a git repo is silent" [ -z "$(clean_env HOME="$U/home" sh "$U/nogit/claudzilla-update.sh" 2>&1)" ]
# autoUpdate on (default): background pull + install.sh, result shown next session
res="$(git -C "$U/clone" rev-parse --absolute-git-dir)/claudzilla-update.result"
waitres() { for i in $(seq 20); do [ -f "$res" ] && break; sleep 0.5; done; }
rm "$U/home/.claude/claudzilla.json"
printf 'echo ran > "$HOME/ran"\n' > "$U/clone/install.sh"
out=$(notice); waitres
check "auto: user told it updates in background" grep -qE 'updating to [0-9a-f]{7,} in background' <<<"$out"
check "auto: pulled to upstream" [ "$(git -C "$U/clone" rev-parse HEAD)" = "$(git -C "$U/seed" rev-parse HEAD)" ]
check "auto: install.sh ran" [ -f "$U/home/ran" ]
check "events: updating is a live line" grep -qE $'^[0-9]+\tlive\tclaudzilla: updating to [0-9a-f]{7,}$' "$ev"
check "events: updated is a live line" grep -qE $'^[0-9]+\tlive\tclaudzilla: updated to [0-9a-f]{7,} - restart Claude to apply$' "$ev"
check "events: background update is no line" bash -c '! grep -q "updating in background" "$1"' _ "$ev"
check "auto: next session reports update" grep -q "updated to [0-9a-f]\\{7,\\} - for changes: /claudzilla news\"" <<<"$(notice)"
check "events: consumed result is a start line" grep -qE $'^[0-9]+\tstart\tclaudzilla: updated to [0-9a-f]{7,} - for changes: /claudzilla news$' "$ev"
check "auto: report shown once" [ -z "$(notice)" ]
printf 'x\n' > "$U/seed/f"; g -C "$U/seed" add f; g -C "$U/seed" commit -m three; g -C "$U/seed" push origin main
g -C "$U/clone" pull --ff-only; echo local >> "$U/clone/f"
g -C "$U/seed" commit --allow-empty -m four; g -C "$U/seed" push origin main
g -C "$U/clone" fetch
out=$(notice); sleep 1
check "auto: local changes skip update" [ "$(git -C "$U/clone" log -1 --format=%s)" = three ]
check "auto: local changes keep notice" grep -qE 'update [0-9a-f]{7,} available.*local changes' <<<"$out"
check "events: skipped is a start line" grep -qE $'\tstart\tclaudzilla: update [0-9a-f]{7,} available \\(auto-update skipped: local changes\\) - ' "$ev"
g -C "$U/clone" checkout f; printf 'exit 3\n' > "$U/clone/install.sh"
notice >/dev/null; waitres
check "events: failure is a fail line" grep -qE $'^[0-9]+\tfail\tclaudzilla: auto-update to [0-9a-f]{7,} failed - ask Claude to debug it \\(log: .*claudzilla-update\\.log\\)$' "$ev"
out=$(notice)
check "auto: failed install reported" grep -qE 'auto-update to [0-9a-f]{7,} failed - ask Claude to debug it \(log: .*claudzilla-update.log\)' <<<"$out"
check "auto: Claude gets the failure log" node -e 'const h=JSON.parse(process.argv[1]).hookSpecificOutput;if(!/claudzilla-update\.log/.test(h.additionalContext)||!/install\.sh/.test(h.additionalContext))process.exit(1)' "$out"
check "events: consumed failure is a start line" grep -qE $'^[0-9]+\tstart\tclaudzilla: auto-update to [0-9a-f]{7,} failed - ' "$ev"
printf 'echo ran > "$HOME/ran"\n' > "$U/clone/install.sh"
g -C "$U/clone" commit --allow-empty -m mine
g -C "$U/seed" commit --allow-empty -m five; g -C "$U/seed" push origin main; g -C "$U/clone" fetch
out=$(notice); sleep 1
check "auto: local commit skips update" [ "$(git -C "$U/clone" log -1 --format=%s)" = mine ]
check "auto: local commit keeps notice" grep -q 'local changes' <<<"$out"
g -C "$U/clone" reset -q --hard origin/main
printf 'up\n' > "$U/seed/u"; g -C "$U/seed" add u; g -C "$U/seed" commit -m six; g -C "$U/seed" push origin main
g -C "$U/clone" fetch; printf 'mine\n' > "$U/clone/u"
notice >/dev/null; waitres
check "auto: failure still behind is reported" grep -qE 'auto-update to [0-9a-f]{7,} failed.*updating to [0-9a-f]{7,} in background' <<<"$(notice)"
# A local branch with no upstream: notice against origin's default branch, never auto-update.
waitres; rm -f "$res" "$U/clone/u"; g -C "$U/clone" switch -c feat/x
out=$(notice)
check "no upstream: user sees 'update available'" grep -qE 'update [0-9a-f]{7,} available' <<<"$out"
check "no upstream: hint switches to main first" grep -q 'git switch main && git merge --ff-only origin/main' <<<"$out"
check "no upstream: no auto-update" bash -c '! grep -q "updating in background" <<<"$1"' _ "$out"
check "events: no upstream hint is a start line" grep -qE $'\tstart\tclaudzilla: update [0-9a-f]{7,} available - ask Claude to update, or run: cd ' "$ev"
# Tagged upstream: auto-update stops at the newest release tag, not the branch tip.
g -C "$U/clone" switch main; g -C "$U/seed" tag v1.0.0; g -C "$U/seed" commit --allow-empty -m seven; g -C "$U/seed" push origin main v1.0.0
g -C "$U/clone" fetch --tags; g -C "$U/clone" reset -q --hard v1.0.0
check "release: untagged commits are no update" [ -z "$(notice)" ]
g -C "$U/seed" tag v1.1.0; g -C "$U/seed" commit --allow-empty -m eight; g -C "$U/seed" push origin main v1.1.0
touch -t 200001010000 "$(git -C "$U/clone" rev-parse --absolute-git-dir)/FETCH_HEAD"
notice >/dev/null; waitres
check "release: background fetch gets new tags" git -C "$U/clone" rev-parse -q --verify v1.1.0
check "release: updated to the tag, not the tip" [ "$(git -C "$U/clone" log -1 --format=%s)" = seven ]
check "release: report names the tag" grep -qx 'claudzilla: updated to v1.1.0' "$res"
rm -f "$res"; g -C "$U/seed" tag v1.2.0; g -C "$U/seed" tag aa-old; g -C "$U/seed" push origin v1.2.0 aa-old
echo '{"rulesGuard":{"autoUpdate":false}}' > "$U/home/.claude/claudzilla.json"; g -C "$U/clone" fetch
check "release: hint updates to the tag" grep -q 'git merge --ff-only v1.2.0 && ./install.sh' <<<"$(notice)"
check "release: toast names the tag" grep -q 'update v1.2.0 available' "$ev"
g -C "$U/seed" commit --allow-empty -m nine; g -C "$U/seed" tag backup; g -C "$U/seed" push origin main backup; g -C "$U/clone" fetch
check "release: non-release tag is no target" grep -q 'merge --ff-only v1.2.0' <<<"$(notice)"
rm "$U/home/.claude/claudzilla.json"; g -C "$U/clone" pull --ff-only
check "release: ahead of tag is no update" [ -z "$(notice)" ]
check "release: ahead of tag keeps HEAD" [ "$(git -C "$U/clone" log -1 --format=%s)" = nine ]
# A curl install is a --depth 1 clone with no tags: the background fetch fills in history, so it still waits for a tag.
S="$TMP/shallow"; g clone --depth 1 "file://$U/origin.git" "$S/clone"; mkdir -p "$S/clone/claude/hooks" "$S/home/.claude/hooks"
cp "$REPO/claude/hooks/claudzilla-update.sh" "$REPO/claude/hooks/rules-guard.mjs" "$S/clone/claude/hooks/"
ln -s "$S/clone/claude/hooks/claudzilla-update.sh" "$S/home/.claude/hooks/claudzilla-update.sh"
g -C "$U/seed" commit --allow-empty -m ten; g -C "$U/seed" push origin main
sgd=$(git -C "$S/clone" rev-parse --absolute-git-dir)
touch "$sgd/FETCH_HEAD"   # an older curl install that fetched today: shallow alone must trigger the fetch
clean_env HOME="$S/home" sh "$S/home/.claude/hooks/claudzilla-update.sh" >/dev/null
for i in $(seq 20); do [ ! -f "$sgd/shallow" ] && [ ! -d "$sgd/claudzilla-update.lock" ] && break; sleep 0.5; done
check "shallow: background fetch unshallows" [ ! -f "$sgd/shallow" ]
check "shallow: background fetch gets tags" git -C "$S/clone" rev-parse -q --verify v1.2.0
check "shallow: untagged commit is no update" [ "$(git -C "$S/clone" log -1 --format=%s)" = nine ]
for i in $(seq 150); do printf '0\tlive\tx%s\n' "$i"; done > "$ev"; notice >/dev/null
check "events: trimmed past 100 lines" [ "$(wc -l < "$ev" | tr -d ' ')" -le 22 ]
check "events: trim keeps the newest" grep -qF $'0\tlive\tx150' "$ev"

# --- truecolor on WSL ---
W=$(new_home); echo 'alias x=y' > "$W/.bashrc"; echo 'export COLORTERM=24bit' > "$W/.zshrc"
wsl_install() { clean_env HOME="$1" WSL_DISTRO_NAME=Ubuntu CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$1/install.log" 2>&1; }
wsl_install "$W"; wsl_install "$W"
check "wsl: bashrc gets COLORTERM once" [ "$(grep -c '^export COLORTERM=truecolor$' "$W/.bashrc")" = 1 ]
check "wsl: rc with COLORTERM untouched" [ "$(cat "$W/.zshrc")" = 'export COLORTERM=24bit' ]
N=$(new_home); echo 'alias x=y' > "$N/.bashrc"; clean_env -u WSL_DISTRO_NAME HOME="$N" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >/dev/null 2>&1
check "non-wsl: bashrc untouched" [ "$(cat "$N/.bashrc")" = 'alias x=y' ]
M=$(new_home); wsl_install "$M"
check "wsl: missing rc not created" [ ! -e "$M/.bashrc" ] && [ ! -e "$M/.zshrc" ]
T=$(new_home); printf 'alias x=y' > "$T/.bashrc"; wsl_install "$T"
check "wsl: rc without trailing newline keeps last line" [ "$(cat "$T/.bashrc")" = $'alias x=y\nexport COLORTERM=truecolor' ]
R=$(new_home); echo 'alias x=y' > "$R/.bashrc"; chmod 444 "$R/.bashrc"; wsl_install "$R"; rc=$?
check "wsl: read-only rc does not abort install" [ "$rc" -eq 0 ]
check "wsl: read-only rc gets a manual hint" grep -q "export COLORTERM=truecolor' yourself" "$R/install.log"
check "wsl: appended rc line recorded" [ "$(q "$W/.claude/.claudzilla-installed.json" .rcLines)" = "[{\"file\":\"$W/.bashrc\",\"line\":\"export COLORTERM=truecolor\"}]" ]
check "wsl: read-only rc not recorded" bash -c "! grep -q bashrc '$R/.claude/.claudzilla-installed.json' 2>/dev/null"

# --- font ---
FD=".local/share/fonts"; STYLES=("Regular" "Bold" "Italic" "Bold Italic")
seed_fonts() { mkdir -p "$1/$FD"; for s in "${STYLES[@]}"; do echo x > "$1/$FD/MesloLGS NF $s.ttf"; done; }
mkdir -p "$TMP/badfont"; for s in "${STYLES[@]}"; do echo tampered > "$TMP/badfont/MesloLGS NF $s.ttf"; done
F=$(new_home); clean_env HOME="$F" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/badfont" bash "$REPO/install.sh" >"$F/install.log" 2>&1; rc=$?
check "font: checksum mismatch does not abort" [ "$rc" -eq 0 ]
check "font: tampered file not installed" bash -c "! ls '$F/$FD' '$F/Library/Fonts' 2>/dev/null | grep -q ttf"
check "font: mismatch warned" grep -q 'MesloLGS NF.*checksum' "$F/install.log"
U2=$(new_home); run_install "$U2"; rc=$?
check "font: unreachable exits 0" [ "$rc" -eq 0 ]
check "font: unreachable warned" grep -q 'font: download failed' "$U2/install.log"
mkdir -p "$TMP/linux" "$TMP/darwin"; printf '#!/bin/sh\necho Linux\n' > "$TMP/linux/uname"; printf '#!/bin/sh\necho Darwin\n' > "$TMP/darwin/uname"; chmod +x "$TMP/linux/uname" "$TMP/darwin/uname"
P=$(new_home); seed_fonts "$P"; clean_env HOME="$P" CLAUDZILLA_OFFLINE=1 PATH="$TMP/linux:$PATH" bash "$REPO/install.sh" >"$P/install.log" 2>&1
check "font: present fonts not re-downloaded" bash -c "! grep -q 'font:' '$P/install.log'"
check "font: seeded fonts not recorded" bash -c "! grep -q ttf '$P/.claude/.claudzilla-installed.json' 2>/dev/null"
# good fonts: file:// source + a sha256sum stub that returns the pinned sums in download order
mkdir -p "$TMP/goodfont" "$TMP/sha"; for s in "${STYLES[@]}"; do echo good > "$TMP/goodfont/MesloLGS NF $s.ttf"; done
cat > "$TMP/sha/sha256sum" <<'S'
#!/bin/sh
n=$(cat "$SHAN" 2>/dev/null || echo 0); echo $((n+1)) > "$SHAN"
set -- d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d b6c0199cf7c7483c8343ea020658925e6de0aeb318b89908152fcb4d19226003 6f357bcbe2597704e157a915625928bca38364a89c22a4ac36e7a116dcd392ef 56b4131adecec052c4b324efb818dd326d586dbc316fc68f98f1cae2eb8d1220
shift $n; echo "$1  -"
S
chmod +x "$TMP/sha/sha256sum"
G=$(new_home); clean_env HOME="$G" SHAN="$G/shan" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/goodfont" PATH="$TMP/sha:$TMP/linux:$PATH" bash "$REPO/install.sh" >"$G/install.log" 2>&1
check "font: new fonts recorded" [ "$(q "$G/.claude/.claudzilla-installed.json" .files)" = "[\"$G/$FD/MesloLGS NF Regular.ttf\",\"$G/$FD/MesloLGS NF Bold.ttf\",\"$G/$FD/MesloLGS NF Italic.ttf\",\"$G/$FD/MesloLGS NF Bold Italic.ttf\"]" ]
rm "$G/$FD/MesloLGS NF Bold.ttf"; echo 1 > "$G/shan"
clean_env HOME="$G" SHAN="$G/shan" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/goodfont" PATH="$TMP/sha:$TMP/linux:$PATH" bash "$REPO/install.sh" >"$G/install.log" 2>&1
check "font: re-download not recorded twice" [ "$(q "$G/.claude/.claudzilla-installed.json" .files.length)" = 4 ]
D=$(new_home); clean_env HOME="$D" CLAUDZILLA_OFFLINE=1 PATH="$TMP/darwin:$PATH" bash "$REPO/install.sh" >"$D/install.log" 2>&1
check "font: macOS targets ~/Library/Fonts" grep -q 'Library/Fonts' "$D/install.log"

# WSL: stub the Windows side
WB="$TMP/winbin"; mkdir -p "$WB"; cp "$TMP/linux/uname" "$WB/"
cat > "$WB/cmd.exe" <<'S'
#!/bin/sh
printf 'C:\\Users\\u\\AppData\\Local\r\n'
S
cat > "$WB/wslpath" <<'S'
#!/bin/sh
case $1 in -u) echo "$WINLA" ;; -w) printf 'C:\\fonts\\%s\n' "$(basename "$2")" ;; esac
S
cat > "$WB/reg.exe" <<'S'
#!/bin/sh
printf '%s\n' "$*" >> "$REGLOG"
S
chmod +x "$WB"/*
WTREL="Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"
wsl_font() {  # $1 home, $2 WT settings content ('' = none)
  local la="$1/win"; mkdir -p "$la/$(dirname "$WTREL")"; [ -n "$2" ] && printf '%s' "$2" > "$la/$WTREL"
  seed_fonts "$1"
  clean_env HOME="$1" WSL_DISTRO_NAME=Ubuntu WINLA="$la" REGLOG="$1/reg.log" PATH="$WB:$PATH" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$1/install.log" 2>&1
}
X=$(new_home); wsl_font "$X" '{"profiles":{"defaults":{},"list":[]}}'; rc=$?
check "wsl font: exit 0" [ "$rc" -eq 0 ]
check "wsl font: copied to Windows fonts" [ "$(ls "$X/win/Microsoft/Windows/Fonts" | grep -c 'MesloLGS NF')" = 4 ]
check "wsl font: registered per user" bash -c "grep -c 'HKCU.*Fonts.*/v MesloLGS NF Bold Italic (TrueType).*C:.fonts.MesloLGS NF Bold Italic.ttf' '$X/reg.log' | grep -qx 1 && [ \$(wc -l < '$X/reg.log') -eq 4 ]"
check "wsl font: Windows Terminal face set" [ "$(q "$X/win/$WTREL" .profiles.defaults.font.face)" = '"MesloLGS NF"' ]
check "wsl font: Windows Terminal settings backed up" bash -c "find '$X/.claude/.claudzilla-backup' -path '*windows-terminal/*/settings.json' | grep -q ."
: > "$X/reg.log"; wsl_font "$X" ''
check "wsl font: re-run re-registers (repairs)" [ "$(wc -l < "$X/reg.log" | tr -d ' ')" = 4 ]
check "wsl font: re-run is quiet" bash -c "! grep -q 'font:' '$X/install.log'"
check "wsl font: copies recorded with registry name" [ "$(q "$X/.claude/.claudzilla-installed.json" .winFonts)" = "[$(for s in "Bold Italic" Bold Italic Regular; do printf '{"file":"%s/win/Microsoft/Windows/Fonts/MesloLGS NF %s.ttf","reg":"MesloLGS NF %s (TrueType)"},' "$X" "$s" "$s"; done | sed 's/,$//')]" ]
check "wsl font: Windows Terminal path recorded" [ "$(q "$X/.claude/.claudzilla-installed.json" .wtFont)" = "[\"$X/win/$WTREL\"]" ]
check "wsl font: re-run copies nothing new" [ "$(ls "$X/win/Microsoft/Windows/Fonts" | wc -l | tr -d ' ')" = 4 ]
Y0=$(new_home); mkdir -p "$Y0/win/Microsoft/Windows/Fonts"; for s in "${STYLES[@]}"; do echo x > "$Y0/win/Microsoft/Windows/Fonts/MesloLGS NF $s.ttf"; done
wsl_font "$Y0" '{"profiles":{"defaults":{"font":{"face":"MesloLGS NF"}}}}'
check "wsl font: Windows fonts already there not recorded" bash -c "! grep -q 'Fonts/MesloLGS' '$Y0/.claude/.claudzilla-installed.json' 2>/dev/null"
check "wsl font: Windows Terminal already ours not recorded" bash -c "! grep -q settings.json '$Y0/.claude/.claudzilla-installed.json' 2>/dev/null"
Y=$(new_home); wsl_font "$Y" '{"profiles":{"defaults":{"font":{"face":"Fira Code"}}}}'
check "wsl font: user's own face kept" [ "$(q "$Y/win/$WTREL" .profiles.defaults.font.face)" = '"Fira Code"' ]
check "wsl font: own face gets a hint" grep -q 'MesloLGS NF' "$Y/install.log"
Z=$(new_home); wsl_font "$Z" $'{\n  // comment\n  "profiles": {}\n}'
check "wsl font: JSONC left untouched" grep -q '// comment' "$Z/win/$WTREL"
check "wsl font: JSONC gets a hint" grep -q 'set .*MesloLGS NF' "$Z/install.log"

printf '#!/bin/sh\nexit 1\n' > "$WB/cmd.exe"
V=$(new_home); wsl_font "$V" ''; rc=$?
check "wsl font: Windows unreachable exits 0" [ "$rc" -eq 0 ]
check "wsl font: Windows unreachable warned" grep -q 'Windows not reachable' "$V/install.log"

# declined: basic HUD symbols, never asked again
K=$(new_home); clean_env HOME="$K" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT=no bash "$REPO/install.sh" >"$K/install.log" 2>&1; rc=$?
check "font declined: exit 0" [ "$rc" -eq 0 ]
check "font declined: basic-glyph marker" [ -f "$K/.claude/.claudzilla-basic-glyphs" ]
check "font declined: no download" bash -c "! grep -q 'download failed' '$K/install.log'"
check "font declined: says how to undo" grep -q 'CLAUDZILLA_FONT=yes' "$K/install.log"
notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$K" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$K/install.log" 2>&1 </dev/null
check "font declined: not asked again" bash -c "! grep -q 'font:' '$K/install.log'"
clean_env HOME="$K" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT=yes bash "$REPO/install.sh" >"$K/install.log" 2>&1
check "font declined: yes later clears marker" [ ! -e "$K/.claude/.claudzilla-basic-glyphs" ]

# no terminal (Claude's Bash tool): don't guess, hand the question to Claude
# fc-list stubs: the host's own fonts must not decide these cases
mkdir -p "$TMP/nofc" "$TMP/fc"; printf '#!/bin/sh\n' > "$TMP/nofc/fc-list"; printf '#!/bin/sh\necho "MesloLGS Nerd Font Mono"\n' > "$TMP/fc/fc-list"; chmod +x "$TMP/nofc/fc-list" "$TMP/fc/fc-list"
Q=$(new_home); seedbase "$Q"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$Q" CLAUDZILLA_OFFLINE=1 PATH="$TMP/nofc:$PATH" bash "$REPO/install.sh" >"$Q/install.log" 2>&1 </dev/null; rc=$?
check "font no tty: exit 0" [ "$rc" -eq 0 ]
check "font no tty: nothing downloaded" bash -c "! grep -q 'download failed' '$Q/install.log'"
check "font no tty: not recorded as declined" [ ! -e "$Q/.claude/.claudzilla-basic-glyphs" ]
check "font no tty: tells Claude to ask via AskUserQuestion" grep -q "AskUserQuestion.*CLAUDZILLA_FONT=yes $REPO/install.sh" "$Q/install.log"
# installed another way (Nerd Fonts release name): don't ask
N=$(new_home); seedbase "$N"; mkdir -p "$N/$FD"; echo x > "$N/$FD/MesloLGSNerdFont-Regular.ttf"
notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$N" CLAUDZILLA_OFFLINE=1 PATH="$TMP/nofc:$TMP/linux:$PATH" bash "$REPO/install.sh" >"$N/install.log" 2>&1 </dev/null
check "font: installed another way, not asked" bash -c "! grep -q 'font:' '$N/install.log'"
FC=$(new_home); seedbase "$FC"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$FC" CLAUDZILLA_OFFLINE=1 PATH="$TMP/fc:$TMP/linux:$PATH" bash "$REPO/install.sh" >"$FC/install.log" 2>&1 </dev/null
check "font: fontconfig has it, not asked" bash -c "! grep -q 'font:' '$FC/install.log'"
M=$(new_home); seedbase "$M"; mkdir -p "$M/$FD"; echo x > "$M/$FD/MesloLGS-Regular.ttf"
notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$M" CLAUDZILLA_OFFLINE=1 PATH="$TMP/nofc:$TMP/linux:$PATH" bash "$REPO/install.sh" >"$M/install.log" 2>&1 </dev/null
check "font: plain Meslo (no Nerd glyphs) still asked" grep -q 'AskUserQuestion' "$M/install.log"
W=$(new_home); seedbase "$W"; notty env -u CLAUDE_CONFIG_DIR -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$W" WSL_DISTRO_NAME=Ubuntu CLAUDZILLA_OFFLINE=1 PATH="$TMP/fc:$WB:$PATH" bash "$REPO/install.sh" >"$W/install.log" 2>&1 </dev/null
check "wsl font: Linux-side font still asked (Windows needs it)" grep -q 'AskUserQuestion' "$W/install.log"
O=$(new_home); clean_env HOME="$O" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT=off bash "$REPO/install.sh" >/dev/null 2>&1
check "font: CLAUDZILLA_FONT=off declines" [ -f "$O/.claude/.claudzilla-basic-glyphs" ]

# symlinked keybindings.json on a removal: the warning says remove, not add
K=$(new_home); mkdir -p "$K/dots"; inst "$K"; echo '{"bindings":[{"context":"Chat","bindings":{"alt+h":"command:panel","alt+k":"abovePrompt:focus","alt+g":"command:claudzilla"}}]}' > "$K/dots/kb.json"
rm -f "$K/.claude/keybindings.json"; ln -s "$K/dots/kb.json" "$K/.claude/keybindings.json"; inst "$K" --remove panel
check "keys: symlink on removal says remove" grep -q 'symlink - remove alt+h' "$K/install.log"
# bad flag with no terminal: the flag error, not the ask-the-user stop
K=$(new_home); notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY HOME="$K" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --bogus >"$K/install.log" 2>&1 </dev/null; rc=$?
check "bad flag no tty: exit 1, flag error, no change" bash -c "[ $rc -eq 1 ] && grep -q \"unknown flag '--bogus'\" '$K/install.log' && ! grep -q AskUserQuestion '$K/install.log' && [ ! -e '$K/.claude' ]"
# unparseable settings.json: exit 1 with a claudzilla message, nothing unlinked, no temp left
for fl in "--remove hud" "--uninstall --yes"; do
  K=$(new_home); inst "$K"; echo '{bad' > "$K/.claude/settings.json"; inst "$K" $fl; rc=$?
  check "bad settings ($fl): exit 1" [ "$rc" -eq 1 ]
  check "bad settings ($fl): links kept" bash -c "[ -L '$K/.claude/hud' ] && [ -L '$K/.claude/rules' ]"
  check "bad settings ($fl): claudzilla message, no node stack" bash -c "grep -q '^claudzilla: .*settings.json' '$K/install.log' && ! grep -qE 'SyntaxError|    at ' '$K/install.log'"
  check "bad settings ($fl): no temp base left" bash -c "! ls -a '$K/.claude' | grep -q 'claudzilla\$'"
done
# --- menu / Claude run ---
M=$(new_home); printf '2\n7 6\n' > "$M/ans"; clean_env HOME="$M" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_TTY="$M/ans" bash "$REPO/install.sh" >"$M/install.log" 2>&1
check "menu: custom skip saved" [ "$(q "$M/.claude/claudzilla.json" .install.skip)" = '["rtk","dividers"]' ]
C=$(new_home); notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY HOME="$C" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$C/install.log" 2>&1 </dev/null; rc=$?
check "claude run: exit 2" [ "$rc" -eq 2 ]
check "claude run: nothing written" [ ! -e "$C/.claude" ]
check "claude run: tells Claude to ask" grep -q 'AskUserQuestion.*multiSelect' "$C/install.log"
check "claude run: names --full and --remove" bash -c "grep -q -e '--full' '$C/install.log' && grep -q -e '--full --remove <unticked' '$C/install.log'"
F=$(new_home); notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$F" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/badfont" bash "$REPO/install.sh" --full >"$F/install.log" 2>&1 </dev/null
check "full no tty: font step runs without asking (hud chosen this run)" bash -c "grep -q 'checksum mismatch' '$F/install.log' && ! grep -q AskUserQuestion '$F/install.log'"
PARTS=$(node -p 'Object.keys(require(process.argv[1])).filter(p=>p!="updater").join(" ")' "$REPO/parts.json")
stop_lists() { local p; grep -q 'Full (recommended)' "$1" && grep -q Custom "$1" && grep -q -e '--full' "$1" && grep -q -e '--remove' "$1" || return 1; for p in $PARTS; do grep -qw "$p" "$1" || return 1; done; }
check "claude run: asks Full or Custom, lists every part" stop_lists "$C/install.log"
# --full --remove x = Full minus x, whatever was saved before
L=$(new_home); inst "$L" --full --remove rtk
check "full+remove fresh: skip only x" [ "$(q "$L/.claude/claudzilla.json" .install)" = '{"skip":["rtk"]}' ]
inst "$L" --full --remove panel
check "full+remove over saved skip: replaces, not stacks" [ "$(q "$L/.claude/claudzilla.json" .install)" = '{"skip":["panel"]}' ]
check "full+remove over saved skip: rtk linked back" bash -c "grep -q 'rtk hook' '$L/.claude/settings.json'"
L=$(new_home); inst "$L" --add hud; inst "$L" --full --remove panel
check "full+remove over saved only: skip only x" [ "$(q "$L/.claude/claudzilla.json" .install)" = '{"skip":["panel"]}' ]
check "full+remove over saved only: rules back" [ -L "$L/.claude/rules" ]
Y=$(new_home); seedbase "$Y"; cp -a "$Y/.claude" "$Y/copy"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY HOME="$Y" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --custom >"$Y/install.log" 2>&1 </dev/null; rc=$?
check "custom no tty: exit 2" [ "$rc" -eq 2 ]
check "custom no tty: DEST unchanged" diff -r "$Y/copy" "$Y/.claude"
R=$(new_home); seedbase "$R"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$R" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/badfont" PATH="$TMP/nofc:$PATH" bash "$REPO/install.sh" --remove rtk >"$R/install.log" 2>&1 </dev/null
check "remove on existing: no font download" bash -c "! grep -q 'checksum mismatch' '$R/install.log'"
check "remove on existing: font hint kept" grep -q AskUserQuestion "$R/install.log"
G=$(new_home); seedbase "$G"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY -u CLAUDZILLA_FONT HOME="$G" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_FONT_URL="file://$TMP/badfont" PATH="$TMP/fc:$TMP/linux:$PATH" bash "$REPO/install.sh" --full >"$G/install.log" 2>&1 </dev/null
check "full with font installed another way: no download" bash -c "! grep -q 'checksum mismatch' '$G/install.log'"

# --- plugins per part + ownership record ---
new_stub() {  # fake claude logs argv, prints list/mlist; fake rtk keeps deps offline
  local d; d=$(mktemp -d "$TMP/stub.XXXX")
  printf '#!/bin/sh\necho "$*" >> "$(dirname "$0")/log"\ncase "$1 $2 $3" in "plugin list"*) cat "$(dirname "$0")/list" ;; "plugin marketplace list") cat "$(dirname "$0")/mlist" ;; esac\n' > "$d/claude"
  printf '#!/bin/sh\n' > "$d/rtk"; chmod +x "$d/claude" "$d/rtk"; echo '[]' > "$d/list"; echo '[]' > "$d/mlist"; : > "$d/log"; echo "$d"
}
pinst() { local h=$1 s=$2; shift 2; clean_env HOME="$h" CLAUDZILLA_OFFLINE=0 PATH="$s:$PATH" bash "$REPO/install.sh" "$@" >"$h/install.log" 2>&1; }
S=$(new_stub); H=$(new_home); seedbase "$H"; echo '[{"id":"margin@claudzilla"}]' > "$S/list"; pinst "$H" "$S" --remove panel
check "plugins: remove panel uninstalls it" grep -q 'plugin uninstall margin@claudzilla' "$S/log"
S=$(new_stub); H=$(new_home); seedbase "$H"; pinst "$H" "$S" --remove panel
check "plugins: unpicked but not installed: no uninstall call" bash -c "! grep -q 'plugin uninstall' '$S/log'"
S=$(new_stub); H=$(new_home); seedbase "$H"; pinst "$H" "$S"
check "plugins: re-run with all picked: no uninstall call" bash -c "! grep -q 'plugin uninstall' '$S/log'"
S=$(new_stub); H=$(new_home); seedbase "$H"; pinst "$H" "$S" --remove panel
check "plugins: kept part still installed" grep -q 'plugin install ballot@claudzilla' "$S/log"
check "plugins: removed panel not installed" bash -c "! grep -q 'plugin install margin@claudzilla' '$S/log'"
S=$(new_stub); H=$(new_home); pinst "$H" "$S" --remove rtk,caveman,ponytail,dividers,panel,picks,toast,attribution,ledger
check "plugins: only core+hud installs just superpowers and primer" [ "$(grep 'plugin install' "$S/log")" = $'plugin install superpowers@claude-plugins-official\nplugin install primer@claudzilla' ]
check "plugins: unpicked third-party not recorded-uninstalled" bash -c "! grep -q 'plugin uninstall caveman' '$S/log'"
check "plugins: primer keeps the claudzilla marketplace added" grep -q "marketplace add $REPO" "$S/log"
S=$(new_stub); H=$(new_home); echo '[{"id":"caveman@caveman"}]' > "$S/list"; echo '[{"name":"caveman"}]' > "$S/mlist"; pinst "$H" "$S"
R="$H/.claude/.claudzilla-installed.json"
check "record: new superpowers+ponytail recorded, pre-existing caveman not" [ "$(q "$R" .plugins)" = '["superpowers@claude-plugins-official","ponytail@ponytail"]' ]
check "record: pre-existing caveman marketplace not recorded" bash -c "[ \"\$(node -p 'require(process.argv[1]).marketplaces.includes(\"caveman\")' '$R')\" = false ] && node -p 'require(process.argv[1]).marketplaces.includes(\"ponytail\")' '$R' | grep -q true"
check "record: claudzilla plugins never recorded" bash -c "! grep -q claudzilla '$R'"
check "record: shape has every key" [ "$(node -p 'Object.keys(require(process.argv[1])).join()' "$R")" = 'files,rcLines,plugins,marketplaces,winFonts,wtFont' ]
check "plugins: claudzilla marketplace added" grep -q "marketplace add $REPO" "$S/log"
pinst "$H" "$S"
check "record: re-run adds no duplicates" [ "$(q "$R" .plugins.length)" = 2 ]
: > "$S/log"; pinst "$H" "$S" --remove caveman,ponytail
check "plugins: unpicked recorded third-party uninstalled" grep -q 'plugin uninstall ponytail@ponytail' "$S/log"
check "plugins: unpicked pre-existing third-party kept" bash -c "! grep -q 'plugin uninstall caveman@caveman' '$S/log'"

# unreadable list: install as usual, record nothing
S=$(new_stub); H=$(new_home); printf '#!/bin/sh\necho "$*" >> "$(dirname "$0")/log"\ncase "$1 $2" in "plugin list") exit 1 ;; esac\n' > "$S/claude"; pinst "$H" "$S"
check "record: failing list still installs" grep -q 'plugin install ponytail@ponytail' "$S/log"
check "record: failing list records nothing" [ ! -e "$H/.claude/.claudzilla-installed.json" ]
check "record: failing list warns" grep -q 'cannot read claude' "$H/install.log"
S=$(new_stub); H=$(new_home); echo 'not json' > "$S/list"; pinst "$H" "$S"
check "record: unparseable list records nothing" [ ! -e "$H/.claude/.claudzilla-installed.json" ]
# removing a recorded plugin drops its record entry
check "record: removed plugin's entry gone, others kept" [ "$(q "$R" .plugins)" = '["superpowers@claude-plugins-official"]' ]

# --- uninstall ---
uninst() { local h=$1; shift; clean_env HOME="$h" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall "$@" >"$h/u.log" 2>&1; }
U=$(new_home); inst "$U" --remove rtk; mkdir -p "$U/.claude/skills/mine"; echo x > "$U/.claude/skills/mine/SKILL.md"; echo mine > "$U/.claude/CLAUDE.local.md"
mkdir -p "$U/.claude/.claudzilla-backup/x"
node -e 'const f=process.argv[1]+"/.claude/",fs=require("fs"),s=require(f+"settings.json"),c=require(f+"claudzilla.json");s.model="mine";c.keep=1;fs.writeFileSync(f+"settings.json",JSON.stringify(s));fs.writeFileSync(f+"claudzilla.json",JSON.stringify(c))' "$U"
inst "$U" --uninstall --yes; rc=$?
check "uninstall: exit 0" [ "$rc" -eq 0 ]
check "uninstall: no links into repo" bash -c "! find '$U/.claude' -lname '$REPO/*' | grep -q ."
check "uninstall: edited key kept" [ "$(q "$U/.claude/settings.json" .model)" = '"mine"' ]
check "uninstall: hooks gone" [ "$(q "$U/.claude/settings.json" .hooks)" = undefined ]
check "uninstall: state gone" bash -c "! ls -a '$U/.claude' | grep -E '^\.claudzilla-(base|rules|installed|basic)'"
check "uninstall: own skill kept" [ "$(cat "$U/.claude/skills/mine/SKILL.md")" = x ]
check "uninstall: non-empty CLAUDE.local.md kept" [ "$(cat "$U/.claude/CLAUDE.local.md")" = mine ]
check "uninstall: install key gone, other keys kept" [ "$(cat "$U/.claude/claudzilla.json" | node -p 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")))')" = '{"keep":1}' ]
check "uninstall: backup kept" [ -d "$U/.claude/.claudzilla-backup/x" ]
check "uninstall: prints clone rm" grep -q "rm -rf $REPO" "$U/install.log"
check "uninstall: prints backup rm" grep -q "rm -rf $U/.claude/.claudzilla-backup" "$U/install.log"
V=$(new_home); inst "$V"; inst "$V" --uninstall --yes
check "uninstall: empty CLAUDE.local.md removed" [ ! -e "$V/.claude/CLAUDE.local.md" ]
check "uninstall: keybindings gone" bash -c "! grep -qE 'alt\+[hkg]' '$V/.claude/keybindings.json' 2>/dev/null"
V2=$(new_home); inst "$V2" --remove rtk; inst "$V2" --uninstall --yes
check "uninstall: claudzilla.json removed when only install key" [ ! -e "$V2/.claude/claudzilla.json" ]
N=$(new_home); inst "$N"; notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY HOME="$N" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall >"$N/u.log" 2>&1 </dev/null; rc=$?
check "uninstall no tty: exit 2, kept" bash -c "[ $rc -eq 2 ] && [ -L '$N/.claude/rules' ]"
check "uninstall no tty: says run with --yes" grep -q 'install.sh --uninstall --yes' "$N/u.log"
echo n > "$TMP/ans"; C=$(new_home); inst "$C"; cp -a "$C/.claude" "$C/before"
clean_env HOME="$C" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_TTY="$TMP/ans" bash "$REPO/install.sh" --uninstall >"$C/u.log" 2>&1; rc=$?
check "uninstall: n cancels, exit 0, no change" bash -c "[ $rc -eq 0 ] && grep -q 'uninstall cancelled' '$C/u.log' && diff -r '$C/before' '$C/.claude'"
echo y > "$TMP/ans"; clean_env HOME="$C" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_TTY="$TMP/ans" bash "$REPO/install.sh" --uninstall >"$C/u.log" 2>&1
check "uninstall: y at the prompt proceeds" [ ! -e "$C/.claude/rules" ]
for fl in "--add hud" "--remove rtk" --full --custom; do
  C=$(new_home); inst "$C"; cp -a "$C/.claude" "$C/before"; clean_env HOME="$C" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall $fl >"$C/u.log" 2>&1; rc=$?
  check "uninstall + $fl: exit 1, no change" bash -c "[ $rc -eq 1 ] && diff -r '$C/before' '$C/.claude'"
done

# recorded items: removed; unrecorded and outside-HOME ones kept
W=$(new_home); inst "$W"; D="$W/.local/share/fonts"; WF="$W/win/Microsoft/Windows/Fonts"
mkdir -p "$W/.local/share/node-v9" "$W/.local/bin" "$D" "$WF" "$W/win/a" "$W/win/b"
echo n > "$W/.local/share/node-v9/x"; ln -s "$W/.local/share/node-v9/x" "$W/.local/bin/node"
echo x > "$D/MesloLGS NF Regular.ttf"; echo x > "$D/MesloLGS NF Bold.ttf"; echo x > "$WF/MesloLGS NF Regular.ttf"
OUT="$TMP/outside.$$"; echo x > "$OUT"
printf 'alias a=b\nexport COLORTERM=truecolor\nalias c=d\n' > "$W/.bashrc"; printf 'alias z=y\n' > "$W/.zshrc"
echo '{"profiles":{"defaults":{"font":{"face":"MesloLGS NF"},"opacity":90}}}' > "$W/win/a/settings.json"
echo '{"profiles":{"defaults":{"font":{"face":"Fira Code"}}}}' > "$W/win/b/settings.json"
node -e 'const [h,out]=process.argv.slice(1);require("fs").writeFileSync(h+"/.claude/.claudzilla-installed.json",JSON.stringify({files:[h+"/.local/share/node-v9",h+"/.local/bin/node",h+"/.local/share/fonts/MesloLGS NF Regular.ttf",out,h+"/gone"],
 rcLines:[{file:h+"/.bashrc",line:"export COLORTERM=truecolor"},{file:h+"/.zshrc",line:"export COLORTERM=truecolor"}],plugins:[],marketplaces:[],
 winFonts:[{file:h+"/win/Microsoft/Windows/Fonts/MesloLGS NF Regular.ttf",reg:"MesloLGS NF Regular (TrueType)"}],wtFont:[h+"/win/a/settings.json",h+"/win/b/settings.json"]}))' "$W" "$OUT"
clean_env HOME="$W" REGLOG="$W/reg.log" PATH="$WB:$PATH" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall --yes >"$W/install.log" 2>&1
check "uninstall rec: node dir and link gone" bash -c "[ ! -e '$W/.local/share/node-v9' ] && [ ! -L '$W/.local/bin/node' ]"
check "uninstall rec: recorded font gone, unrecorded kept" bash -c "[ ! -e '$D/MesloLGS NF Regular.ttf' ] && [ -f '$D/MesloLGS NF Bold.ttf' ]"
check "uninstall rec: unrecorded font listed" grep -q "rm .*MesloLGS.*Bold.ttf" "$W/install.log"
check "uninstall rec: outside-HOME path kept, refused, listed without a command" bash -c "[ -f '$OUT' ] && grep -q 'refused.*outside' '$W/install.log' && grep -q 'Not touched' '$W/install.log' && grep -q '$(basename "$OUT")' '$W/install.log' && ! grep -q 'rm .*$(basename "$OUT")' '$W/install.log'"
check "uninstall rec: rc line removed, rest intact" [ "$(cat "$W/.bashrc")" = $'alias a=b\nalias c=d' ]
check "uninstall rec: rc without the line untouched" [ "$(cat "$W/.zshrc")" = 'alias z=y' ]
check "uninstall rec: Windows font file gone" [ ! -e "$WF/MesloLGS NF Regular.ttf" ]
check "uninstall rec: registry value deleted" grep -q 'delete HKCU.*Fonts /v MesloLGS NF Regular (TrueType) /f' "$W/reg.log"
check "uninstall rec: WT face removed, rest kept" bash -c "[ \"\$(node -p 'JSON.stringify(require(process.argv[1]).profiles.defaults)' '$W/win/a/settings.json')\" = '{\"opacity\":90}' ]"
check "uninstall rec: WT other face kept" [ "$(q "$W/win/b/settings.json" .profiles.defaults.font.face)" = '"Fira Code"' ]
check "uninstall rec: gone record" [ ! -e "$W/.claude/.claudzilla-installed.json" ]

# plugins: claudzilla's always, recorded third-party only; unrecorded node/rtk listed, not deleted
S=$(new_stub); H=$(new_home); inst "$H"; mkdir -p "$H/.local/bin"; echo x > "$H/.local/bin/node"
echo '{"files":[],"rcLines":[],"plugins":["ponytail@ponytail"],"marketplaces":["ponytail"],"winFonts":[],"wtFont":[]}' > "$H/.claude/.claudzilla-installed.json"
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$S:$PATH" bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1; rc=$?
check "uninstall plugins: exit 0" [ "$rc" -eq 0 ]
check "uninstall plugins: claudzilla plugins removed" bash -c "for p in margin ballot update-toast attribution folio ledger; do grep -q \"plugin uninstall \$p@claudzilla\" '$S/log' || exit 1; done"
check "uninstall plugins: claudzilla marketplace removed" grep -q 'plugin marketplace remove claudzilla' "$S/log"
check "uninstall plugins: recorded third-party removed" bash -c "grep -q 'plugin uninstall ponytail@ponytail' '$S/log' && grep -q 'plugin marketplace remove ponytail' '$S/log'"
check "uninstall plugins: unrecorded third-party kept" bash -c "! grep -qE 'uninstall (caveman|superpowers)|remove (caveman|claude-plugins-official)' '$S/log'"
check "uninstall plugins: unrecorded node kept and listed" bash -c "[ -f '$H/.local/bin/node' ] && grep -q 'rm .*$H/.local/bin/node' '$H/install.log'"
check "uninstall plugins: rtk on PATH kept and listed" bash -c "[ -f '$S/rtk' ] && grep -q 'rm .*$S/rtk' '$H/install.log'"
H=$(new_home); inst "$H"; SB=$(mktemp -d "$TMP/nocl.XXXX"); for t in node bash env sh cat rm mkdir dirname readlink date uname perl find sed grep cmp mv tail cp ls; do ln -s "$(command -v $t)" "$SB/$t" 2>/dev/null; done
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$SB" "$SB/bash" "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1; rc=$?
check "uninstall no claude: leftovers with commands" bash -c "[ $rc -eq 0 ] && grep -q 'claude plugin marketplace remove claudzilla' '$H/install.log'"

# claude-plugins-official is the user's: never recorded, never removed
S=$(new_stub); H=$(new_home); pinst "$H" "$S"
check "official marketplace: added but not recorded" bash -c "grep -q 'marketplace add anthropics/claude-plugins-official' '$S/log' && [ \"\$(node -p 'require(process.argv[1]).marketplaces.includes(\"claude-plugins-official\")' '$H/.claude/.claudzilla-installed.json')\" = false ]"
S=$(new_stub); H=$(new_home); inst "$H"
echo '{"files":[],"rcLines":[],"plugins":[],"marketplaces":["claude-plugins-official","ponytail"],"winFonts":[],"wtFont":[]}' > "$H/.claude/.claudzilla-installed.json"
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$S:$PATH" bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1
check "official marketplace: seeded record, uninstall never removes it" bash -c "! grep -q 'marketplace remove claude-plugins-official' '$S/log' && grep -q 'marketplace remove ponytail' '$S/log'"
# unrecorded part plugins/marketplaces and the rc line are listed, never removed
S=$(new_stub); H=$(new_home); inst "$H"; echo '[{"id":"caveman@caveman"},{"id":"ponytail@ponytail"},{"id":"mine@other"}]' > "$S/list"; echo '[{"name":"caveman"},{"name":"claude-plugins-official"},{"name":"ponytail"}]' > "$S/mlist"
echo '{"files":[],"rcLines":[],"plugins":["ponytail@ponytail"],"marketplaces":["ponytail"],"winFonts":[],"wtFont":[]}' > "$H/.claude/.claudzilla-installed.json"
printf 'alias a=b\nexport COLORTERM=truecolor\n' > "$H/.bashrc"
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$S:$PATH" bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1
check "uninstall leftovers: unrecorded part plugin listed, not removed" bash -c "grep -q 'claude plugin uninstall caveman@caveman' '$H/install.log' && ! grep -q 'plugin uninstall caveman' '$S/log'"
check "uninstall leftovers: unrecorded marketplace listed, not removed" bash -c "grep -q 'claude plugin marketplace remove caveman' '$H/install.log' && ! grep -q 'marketplace remove caveman' '$S/log'"
check "uninstall leftovers: recorded and foreign ones not listed" bash -c "! grep -E '^  claude plugin (uninstall (ponytail|mine)|marketplace remove (ponytail|claude-plugins-official))' '$H/install.log'"
check "uninstall leftovers: unrecorded rc line listed, kept" bash -c "grep -q \"remove the line 'export COLORTERM=truecolor' from $H/.bashrc\" '$H/install.log' && grep -q '^export COLORTERM=truecolor\$' '$H/.bashrc'"
# WSL: unrecorded MesloLGS NF in the Windows fonts dir is listed
WX="$TMP/winlist"; mkdir -p "$WX"; cp "$TMP/linux/uname" "$WX/"; printf '#!/bin/sh\necho C:\\\\u\n' > "$WX/cmd.exe"; printf '#!/bin/sh\necho "$WINLA"\n' > "$WX/wslpath"; chmod +x "$WX"/*
H=$(new_home); inst "$H"; mkdir -p "$H/win/Microsoft/Windows/Fonts"; echo x > "$H/win/Microsoft/Windows/Fonts/MesloLGS NF Bold.ttf"
clean_env HOME="$H" WSL_DISTRO_NAME=Ubuntu WINLA="$H/win" PATH="$WX:$PATH" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1
check "uninstall leftovers: unrecorded Windows font listed, kept" bash -c "grep -q 'rm .*Windows/Fonts/MesloLGS.*Bold.ttf' '$H/install.log' && [ -f '$H/win/Microsoft/Windows/Fonts/MesloLGS NF Bold.ttf' ]"


# --- uninstall: review fixes ---
minpath() { local d t; d=$(mktemp -d "$TMP/min.XXXX"); for t in bash env sh cat rm mkdir dirname readlink date uname perl find sed grep cmp mv tail cp ls tr basename; do ln -s "$(command -v $t)" "$d/$t" 2>/dev/null; done; echo "$d"; }
# I1: only node is claudzilla's own, under ~/.local/bin; I4: online run never downloads
H=$(new_home); inst "$H"; SB=$(minpath); mkdir -p "$H/.local/bin" "$TMP/cs.$$"; ln -s "$(command -v node)" "$H/.local/bin/node"
printf '#!/bin/sh\necho "$@" >> "%s/curl.log"\nexit 1\n' "$TMP/cs.$$" > "$SB/curl"; chmod +x "$SB/curl"
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$SB" "$SB/bash" "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1; rc=$?
check "uninstall: only claudzilla's own node on PATH: exit 0" bash -c "[ $rc -eq 0 ] && [ ! -e '$H/.claude/.claudzilla-base.json' ]"
# curl check needs NO node on PATH: deps would run and reach curl (exit 1, node is required) if uninstall did not skip it
H=$(new_home); inst "$H"; SB=$(minpath); ln -s "$(command -v tar)" "$SB/tar"; CS="$TMP/cs2.$$"; mkdir -p "$CS"
printf '#!/bin/sh\necho "$@" >> "%s/curl.log"\nexit 1\n' "$CS" > "$SB/curl"; chmod +x "$SB/curl"
clean_env HOME="$H" CLAUDZILLA_OFFLINE=0 PATH="$SB" "$SB/bash" "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1; rc=$?
check "uninstall: no node anywhere: exit 1, node is required, curl never called" bash -c "[ $rc -eq 1 ] && grep -q 'node is required' '$H/install.log' && [ ! -e '$CS/curl.log' ]"
# wtFont entry that cannot be edited: not a record error
H=$(new_home); inst "$H"; mkdir -p "$H/w"; echo '{bad' > "$H/w/settings.json"
echo '{"files":[],"rcLines":[],"plugins":[],"marketplaces":[],"winFonts":[],"wtFont":["'"$H"'/w/settings.json","'"$H"'/w/gone/settings.json"]}' > "$H/.claude/.claudzilla-installed.json"
inst "$H" --uninstall --yes; rc=$?
check "uninstall wtFont unparseable/missing: exit 0, record deleted, hints" bash -c "[ $rc -eq 0 ] && [ ! -e '$H/.claude/.claudzilla-installed.json' ] && grep -q 'set the terminal font yourself in $H/w/settings.json' '$H/install.log' && grep -q 'yourself in $H/w/gone/settings.json' '$H/install.log'"
# S1 + M3: rc line outside HOME refused and listed as a manual step; empty HOME refuses everything
H=$(new_home); inst "$H"; RCO="$TMP/rcout.$$"; printf 'a\nexport FOO=1\n' > "$RCO"; echo x > "$TMP/keep.$$"
node -e 'require("fs").writeFileSync(process.argv[1]+"/.claude/.claudzilla-installed.json",JSON.stringify({files:[],rcLines:[{file:process.argv[2],line:"export FOO=1"}],plugins:[],marketplaces:[],winFonts:[],wtFont:[]}))' "$H" "$RCO"
inst "$H" --uninstall --yes
check "uninstall rc outside HOME: refused, untouched" bash -c "[ \"\$(cat '$RCO')\" = \$'a\nexport FOO=1' ] && grep -q 'refused to edit' '$H/install.log'"
check "uninstall rc outside HOME: listed as manual step, no rm" bash -c "grep -q \"remove the line 'export FOO=1' from $RCO\" '$H/install.log' && ! grep -q 'rm .*rcout' '$H/install.log'"
H=$(new_home); inst "$H"
node -e 'require("fs").writeFileSync(process.argv[1]+"/.claude/.claudzilla-installed.json",JSON.stringify({files:[process.argv[2]],rcLines:[],plugins:[],marketplaces:[],winFonts:[],wtFont:[]}))' "$H" "$TMP/keep.$$"
clean_env HOME="" DEST="$H/.claude" CLAUDE_CONFIG_DIR="$H/.claude" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1
check "uninstall: empty HOME deletes nothing from record" bash -c "[ -f '$TMP/keep.$$' ] && grep -q 'refusing every deletion' '$H/install.log'"
# I2: malformed entry; valid ones still handled; record kept; non-zero
H=$(new_home); inst "$H"; WF="$H/win/Microsoft/Windows/Fonts"; mkdir -p "$WF"; echo x > "$WF/MesloLGS NF Regular.ttf"; echo x > "$WF/MesloLGS NF Bold.ttf"; printf 'k\nexport A=1\n' > "$H/.bashrc"
node -e 'const h=process.argv[1];require("fs").writeFileSync(h+"/.claude/.claudzilla-installed.json",JSON.stringify({files:[],rcLines:[null,{file:h+"/.bashrc",line:"export A=1"}],plugins:[],marketplaces:[],
 winFonts:[{file:h+"/win/Microsoft/Windows/Fonts/MesloLGS NF Regular.ttf",reg:"R1"},{file:h+"/win/Microsoft/Windows/Fonts/MesloLGS NF Bold.ttf",reg:"R2"}],wtFont:[]}))' "$H"
RB="$TMP/regin"; mkdir -p "$RB"; cp "$WB/uname" "$RB/"; printf '#!/bin/sh\ncat >/dev/null\nprintf "%%s\\n" "$*" >> "$REGLOG"\n' > "$RB/reg.exe"; chmod +x "$RB/reg.exe"
clean_env HOME="$H" REGLOG="$H/reg.log" PATH="$RB:$PATH" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1; rc=$?
check "uninstall bad entry: non-zero, record kept" bash -c "[ $rc -ne 0 ] && [ -f '$H/.claude/.claudzilla-installed.json' ]"
check "uninstall bad entry: valid entries still handled" bash -c "[ \"\$(cat '$H/.bashrc')\" = k ] && [ ! -e '$WF/MesloLGS NF Bold.ttf' ]"
check "uninstall: every font's registry value deleted despite stdin-reading reg.exe" bash -c "grep -q '/v R1 ' '$H/reg.log' && grep -q '/v R2 ' '$H/reg.log'"
# M1: Windows font entry must be absolute, in a Fonts dir
H=$(new_home); inst "$H"; mkdir -p "$H/other"; echo x > "$H/other/MesloLGS NF Regular.ttf"
node -e 'const h=process.argv[1];require("fs").writeFileSync(h+"/.claude/.claudzilla-installed.json",JSON.stringify({files:[],rcLines:[],plugins:[],marketplaces:[],winFonts:[{file:h+"/other/MesloLGS NF Regular.ttf",reg:"X"},{file:"MesloLGS NF Bold.ttf",reg:"Y"}],wtFont:[]}))' "$H"
(cd "$H" && echo x > "MesloLGS NF Bold.ttf"; clean_env HOME="$H" PATH="$RB:$PATH" REGLOG="$H/reg.log" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall --yes >"$H/install.log" 2>&1)
check "uninstall: win font outside a Fonts dir / relative kept" bash -c "[ -f '$H/other/MesloLGS NF Regular.ttf' ] && [ -f '$H/MesloLGS NF Bold.ttf' ]"
# I3: listing before the prompt and in the no-terminal message
H=$(new_home); inst "$H"; echo '{"files":["'"$H"'/.local/share/node-v9"],"rcLines":[{"file":"'"$H"'/.bashrc","line":"export COLORTERM=truecolor"}],"plugins":["ponytail@ponytail"],"marketplaces":["ponytail"],"winFonts":[{"file":"'"$H"'/w/Fonts/MesloLGS NF Regular.ttf","reg":"r"}],"wtFont":["'"$H"'/w/settings.json"]}' > "$H/.claude/.claudzilla-installed.json"
echo n > "$TMP/ans"; clean_env HOME="$H" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_TTY="$TMP/ans" bash "$REPO/install.sh" --uninstall >"$H/u.log" 2>&1
check "uninstall prompt: lists what goes outside the config dir" bash -c "grep -q 'npm packages' '$H/u.log' && grep -q 'export COLORTERM=truecolor' '$H/u.log' && grep -q 'Windows font' '$H/u.log' && grep -q 'Windows Terminal font' '$H/u.log' && grep -q 'plugin ponytail@ponytail' '$H/u.log' && grep -q 'marketplace ponytail' '$H/u.log'"
notty env -u CLAUDE_CONFIG_DIR -u WSL_DISTRO_NAME -u CLAUDZILLA_TTY HOME="$H" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" --uninstall >"$H/u.log" 2>&1 </dev/null; rc=$?
check "uninstall no tty: message lists them too" bash -c "[ $rc -eq 2 ] && grep -q 'npm packages' '$H/u.log' && grep -q 'plugin ponytail@ponytail' '$H/u.log'"

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
