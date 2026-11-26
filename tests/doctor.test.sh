#!/usr/bin/env bash
# Doctor tests: state checks, modes and output against a fixture clone and config dir.
#   bash tests/doctor.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$REPO/tests/lib.sh"
TMP="$(cd "$TMP" && pwd -P)"
CL="$TMP/clone" CFG="$TMP/cfg" D="$TMP/clone/claude/hooks/doctor.mjs"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID

# js <json> <expr over r>: exit 0 when the expression is truthy.
js() { node -e 'const r=JSON.parse(process.argv[1]);process.exit(eval(process.argv[2])?0:1)' "$1" "$2" 2>/dev/null; }
# edit <file> <js statements over j>: rewrite a JSON file in place.
edit() { node -e 'const fs=require("fs"),f=process.argv[1];const j=JSON.parse(fs.readFileSync(f,"utf8"));eval(process.argv[2]);fs.writeFileSync(f,JSON.stringify(j))' "$1" "$2"; }

fixture() {
  rm -rf "$CL" "$CFG" "$TMP/home" "$TMP/tmp" "$TMP/elsewhere"
  mkdir -p "$CL" "$CFG/plugins" "$TMP/home/proj" "$TMP/tmp" "$TMP/elsewhere"
  cp -R "$REPO/claude" "$REPO/plugins" "$REPO/.claude-plugin" "$REPO/.github" "$REPO/parts.json" "$REPO/settings.base.json" "$CL/"
  [ -f "$REPO/claude/hooks/doctor.mjs" ] || rm -f "$D"
  git -C "$CL" init -q && git -C "$CL" add -A && git -C "$CL" commit -qm init
  [ "${1:-}" = notag ] || git -C "$CL" tag v9.9.9
  local head; head=$(git -C "$CL" rev-parse HEAD)
  node -e '
const fs=require("fs"),[cl,cfg,head]=process.argv.slice(1);
const b=JSON.parse(fs.readFileSync(cl+"/settings.base.json","utf8"));
const plugins={};for(const id of Object.keys(b.enabledPlugins))plugins[id]=[{scope:"user",installPath:"/x",version:head.slice(0,12),installedAt:"2026-01-01T00:00:00.000Z",lastUpdated:"2026-01-01T00:00:00.000Z",gitCommitSha:head}];
fs.writeFileSync(cfg+"/plugins/installed_plugins.json",JSON.stringify({version:2,plugins}));
fs.writeFileSync(cfg+"/plugins/known_marketplaces.json",JSON.stringify({claudzilla:{source:{source:"directory",path:cl}}}));
fs.writeFileSync(cfg+"/settings.json",JSON.stringify(b));
fs.writeFileSync(cfg+"/claudzilla.json",JSON.stringify({install:{skip:["rtk"]}}));
for(const p of Object.values(JSON.parse(fs.readFileSync(cl+"/parts.json","utf8"))))for(const l of p.links||[]){
  const d=cfg+"/"+l;fs.mkdirSync(require("path").dirname(d),{recursive:true});fs.symlinkSync(cl+"/claude/"+l,d)}' "$CL" "$CFG" "$head"
}
IP() { echo "$CFG/plugins/installed_plugins.json"; }
run() { ( cd "${CWD:-$TMP/home/proj}" && HOME="${H:-$TMP/home}" CLAUDE_CONFIG_DIR="$CFG" TMPDIR="$TMP/tmp" node "${DD:-$D}" "$@" </dev/null ); }
row() { js "$1" "r.some(x=>$2)"; }
stale_margin() { echo x >>"$CL/plugins/margin/README.md"; git -C "$CL" commit -qam change; }
proj_entry() { P="$1" edit "$(IP)" "j.plugins['margin@claudzilla'].push({scope:'project',projectPath:process.env.P,gitCommitSha:j.plugins['margin@claudzilla'][0].gitCommitSha})"; }

fixture
check "healthy: plain --quick prints nothing" [ -z "$(run --quick)" ]
run --quick >/dev/null; check "healthy: --quick exits 0" [ $? -eq 0 ]
out=$(run --quick --json)
check "healthy: --quick --json parses to an array with every row ok" js "$out" 'Array.isArray(r)&&r.length>0&&r.every(x=>x.ok)'

fixture; edit "$(IP)" "j.plugins['margin@claudzilla'][0].lastUpdated='2026-12-01T00:00:00.000Z'"
check "plugin: newer lastUpdated with same content is ok" js "$(run --json)" '!r.some(x=>x.check=="plugin"&&!x.ok)'

fixture; stale_margin
check "plugin: changed content gives update-plugin" row "$(run --json)" 'x.check=="plugin"&&x.label=="margin"&&!x.ok&&x.fix.kind=="update-plugin"&&x.fix.id=="margin@claudzilla"'

fixture; rm -rf "$CL/plugins/margin"; git -C "$CL" commit -qam rm
check "plugin: missing folder gives install" row "$(run --json)" 'x.check=="plugin"&&x.label=="margin"&&x.fix?.kind=="install"'

fixture; edit "$(IP)" "j.plugins['margin@claudzilla'][0].gitCommitSha='0000000000000000000000000000000000000000'"
check "plugin: sha unknown to the clone gives install" row "$(run --json)" 'x.check=="plugin"&&x.label=="margin"&&x.fix?.kind=="install"'

fixture; proj_entry "$TMP/home/proj"; stale_margin
out=$(run --json)
check "project: entry at cwd gives uninstall-project" row "$out" "x.check=='project'&&!x.ok&&x.fix.kind=='uninstall-project'&&x.fix.id=='margin@claudzilla'&&x.fix.scope=='project'&&x.fix.cwd=='$TMP/home/proj'"
check "--json: fix.cwd is absolute" row "$out" "x.check=='project'&&x.fix.cwd.startsWith('/')"
check "render: project fix line" grep -qxF '  fix: cd ~/proj && claude plugin uninstall margin@claudzilla --scope project' <<<"$(run)"
check "render: plugin fix line" grep -qxF '  fix: claude plugin update margin@claudzilla' <<<"$(run)"
check "render: Fix all footer" [ "$(run | tail -1)" = 'Fix all: /claudzilla doctor fix' ]

fixture; proj_entry "$TMP/home"; stale_margin
check "project: entry at a parent of cwd is not a row" js "$(run --json)" '!r.some(x=>x.check=="project"&&!x.ok)'

fixture; proj_entry "$TMP/elsewhere"
edit "$(IP)" "j.plugins['margin@claudzilla'][1].gitCommitSha='0000000000000000000000000000000000000000'"
check "project: entry for an unrelated folder gives no plugin row" js "$(run --json)" '!r.some(x=>!x.ok)'

fixture; proj_entry "$TMP/home/proj"; stale_margin; ln -s "$TMP/home/proj" "$TMP/home/link"
check "project: symlinked cwd matches its real path" row "$(CWD="$TMP/home/link" run --json)" 'x.check=="project"&&!x.ok'

fixture; proj_entry "$TMP/home/proj"; stale_margin; mkdir -p "$TMP/home/proj/.claude"
printf '{"enabledPlugins":{"margin@claudzilla":true}}' >"$TMP/home/proj/.claude/settings.json"
check "project: a project settings file alone still gives uninstall-project" row "$(run --json)" 'x.check=="project"&&x.fix?.kind=="uninstall-project"'
mkdir -p "$TMP/home/proj/.claude/plugins"; printf '{"version":2,"plugins":{}}' >"$TMP/home/proj/.claude/plugins/installed_plugins.json"
out=$(run --json)
check "project: profile overlap gives no fix" row "$out" "x.check=='project'&&!x.ok&&!('fix' in x)&&x.why==\"removing it edits that profile's settings\"&&x.text.includes('also a profile')"
check "render: no automatic fix line" grep -qxF "  no automatic fix: removing it edits that profile's settings" <<<"$(run)"

fixture; rm "$CFG/rules"
check "links: missing rules gives install" row "$(run --json)" 'x.check=="links"&&!x.ok&&x.fix.kind=="install"'

fixture; rm "$CFG/rules"; ln -s "$TMP/elsewhere" "$CFG/rules"
check "links: target outside the clone gives install" row "$(run --json)" 'x.check=="links"&&!x.ok&&x.fix.kind=="install"'

fixture; edit "$CFG/settings.json" "j.hooks.UserPromptSubmit=j.hooks.UserPromptSubmit.filter(e=>!e.hooks.some(h=>h.command.includes('rules-guard.mjs')))"
check "settings: missing base hook gives install" row "$(run --json)" 'x.check=="settings"&&!x.ok&&x.fix.kind=="install"'

fixture; edit "$CFG/settings.json" "j.hooks.SessionStart.push({hooks:[{type:'command',command:'echo mine'}]})"
check "settings: user-added hook is ok" js "$(run --json)" '!r.some(x=>x.check=="settings"&&!x.ok)'

fixture; edit "$CFG/settings.json" "j.statusLine.command='echo other'"
check "settings: statusLine differs gives install" row "$(run --json)" 'x.check=="settings"&&!x.ok&&x.fix.kind=="install"'

fixture; edit "$CFG/settings.json" "j.enabledPlugins['margin@claudzilla']=false"
check "plugins: disabled picked plugin gives install" row "$(run --json)" 'x.check=="plugins"&&!x.ok&&x.fix.kind=="install"'

fixture; printf '{}' >"$CFG/plugins/known_marketplaces.json"
check "marketplace: missing gives install" row "$(run --json)" 'x.check=="marketplace"&&!x.ok&&x.fix.kind=="install"'

fixture; edit "$(IP)" "j.plugins['panel@claudzilla']=j.plugins['margin@claudzilla']"
check "oldid: panel@claudzilla installed gives install" row "$(run --json)" 'x.check=="oldid"&&!x.ok&&x.fix.kind=="install"&&x.text.includes("panel@claudzilla")'

fixture; printf '{"install":{"skip":["hud","rtk"]}}' >"$CFG/claudzilla.json"; rm "$CFG/hud" "$CFG/themes"
check "skip: a skipped part is not a row" js "$(run --json)" '!r.some(x=>x.check=="links"&&!x.ok)'

fixture; mkdir -p "$TMP/bin"; ln -sf "$(command -v node)" "$TMP/bin/node"; ln -sf "$(command -v git)" "$TMP/bin/git"
out=$(PATH="$TMP/bin" run --json)
check "tools: a missing command gives a row with no fix" row "$out" 'x.check=="tools"&&!x.ok&&x.text.includes("perl")&&!("fix" in x)&&x.why'

fixture; printf '{' >"$(IP)"
out=$(run --json); rc=$?
check "read: malformed installed_plugins.json gives one read row" js "$out" 'r.filter(x=>x.check=="read").length==1&&r.some(x=>x.check=="read"&&x.text.includes("could not read"))'
check "read: malformed file still exits 0" [ "$rc" -eq 0 ]

fixture notag
out=$(run); rc=$?
check "header: no tag prints the short commit only" grep -qE '^claudzilla doctor +@ [0-9a-f]{7}$' <<<"$(head -1 <<<"$out")"
check "header: no tag exits 0" [ "$rc" -eq 0 ]

fixture; mkdir -p "$TMP/home/u" "$TMP/home/u2/p"; proj_entry "$TMP/home/u2/p"; stale_margin
out=$(H="$TMP/home/u" CWD="$TMP/home/u2/p" run)
check "home: whole segments only" sh -c 'grep -qF "$1" <<EOF && ! grep -qF "~2/p" <<EOF2
$2
EOF
$2
EOF2' _ "$TMP/home/u2/p" "$out"

SD="$TMP/tmp/claudzilla-rules-$(id -u)"
hook() { ( cd "$TMP/home/proj" && HOME="$TMP/home" CLAUDE_CONFIG_DIR="$CFG" TMPDIR="$TMP/tmp" node "$D" --hook <<<"$1" ); }
sid() { ( cd "$TMP/home/proj" && HOME="$TMP/home" CLAUDE_CONFIG_DIR="$CFG" TMPDIR="$TMP/tmp" CLAUDE_CODE_SESSION_ID="$1" node "$D" "${@:2}" </dev/null ); }
bump_margin() { stale_margin; edit "$(IP)" "j.plugins['margin@claudzilla'][0].gitCommitSha='$(git -C "$CL" rev-parse HEAD)'"; }

fixture; hook '{"session_id":"s1"}' >/dev/null
check "note: --hook writes doctor-<sid>.json with one record per claudzilla entry" js "$(cat "$SD/doctor-s1.json")" 'r.length==7&&r.every(x=>x.id.endsWith("@claudzilla")&&x.sha)'
cp "$SD/doctor-s1.json" "$TMP/note1"; bump_margin; hook '{"session_id":"s1"}' >/dev/null
check "note: a second run keeps the first record" cmp -s "$SD/doctor-s1.json" "$TMP/note1"
out=$(sid s1 --json)
check "restart: a plugin changed after the note gives restart" row "$out" 'x.check=="restart"&&!x.ok&&x.fix.kind=="restart"&&x.text=="margin changed since this session started"'
check "restart: the margin plugin row is ok" row "$out" 'x.check=="plugin"&&x.label=="margin"&&x.ok'
check "restart: CLAUDE_CODE_SESSION_ID is read in --quick and --json" row "$(sid s1 --quick --json)" 'x.check=="restart"&&!x.ok'
check "restart: no note gives no restart row" js "$(sid s2 --json)" '!r.some(x=>x.check=="restart")'
check "restart: no session id gives no restart row" js "$(run --json)" '!r.some(x=>x.check=="restart")'

fixture; hook '{"session_id":"s3"}' >/dev/null
edit "$SD/doctor-s3.json" "j.find(x=>x.id=='margin@claudzilla').sha='0000000000000000000000000000000000000000'"
check "restart: noted sha unknown to the clone gives no restart row" js "$(sid s3 --json)" '!r.some(x=>x.check=="restart"&&!x.ok)'

fixture; rm -rf "$SD"
out=$(hook '{"session_id":"s4"}'); rc=$?
check "hook: all ok prints nothing and exits 0" [ -z "$out" -a "$rc" -eq 0 ]
stale_margin; out=$(hook '{"session_id":"s4"}')
check "hook: a failure prints one JSON line" js "$out" 'r.systemMessage&&r.hookSpecificOutput.hookEventName=="SessionStart"&&r.hookSpecificOutput.additionalContext=="claudzilla doctor found problems. If the user asks to fix claudzilla, run the claudzilla-doctor skill."'
check "hook: one line only" [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 1 ]
check "hook: systemMessage names the failing plugin" js "$out" 'r.systemMessage=="claudzilla: margin out of date. Run /claudzilla-doctor, or ask Claude to fix claudzilla."'

fixture; rm -rf "$SD"; hook '{"session_id":"../x"}' >/dev/null; rc=$?
check "hook: session id with a slash or .. writes no file" [ "$rc" -eq 0 -a -z "$(ls -A "$SD" 2>/dev/null)" -a ! -e "$TMP/tmp/x.json" ]

fixture; rm -rf "$SD"; mkdir -m 0755 "$SD"; hook '{"session_id":"s5"}' >/dev/null; rc=$?
check "hook: state dir with mode 0755 writes no note and skips restart" [ "$rc" -eq 0 -a ! -e "$SD/doctor-s5.json" ]
chmod 700 "$SD"

fixture; start=$(date +%s)
( cd "$TMP/home/proj" && HOME="$TMP/home" CLAUDE_CONFIG_DIR="$CFG" TMPDIR="$TMP/tmp" node "$D" --hook < <(sleep 6) >/dev/null ); rc=$?
check "hook: stdin held open exits within 3 s" [ "$rc" -eq 0 -a $(( $(date +%s) - start )) -lt 4 ]

fixture; stale_margin
check "hook: stdin without session_id still runs the state checks" js "$(hook '{}')" 'r.systemMessage.includes("margin")'

GD() { git -C "$CL" rev-parse --absolute-git-dir; }
events() { printf '%b' "$1" >"$(GD)/claudzilla-update.events"; }

fixture
check "full: status line row shows the clone version" row "$(run --json)" 'x.check=="statusline"&&x.ok'
fixture notag; out=$(run --json); rc=$?
check "full: no tag gives no statusline row" js "$out" '!r.some(x=>x.check=="statusline")'
check "full: no tag exits 0" [ "$rc" -eq 0 ]

fixture; printf 'function (\n' >"$CL/claude/hooks/trace.mjs"
check "full: a hook that does not parse gives hooks with no fix" row "$(run --json)" 'x.check=="hooks"&&!x.ok&&!("fix" in x)'
fixture; printf 'sub {\n' >"$CL/claude/hooks/trace.pl"
check "full: a perl syntax error in hooks/trace.pl gives hooks with no fix" row "$(run --json)" 'x.check=="hooks"&&!x.ok&&!("fix" in x)&&x.text.includes("trace.pl")'
fixture; rm "$CL/claude/hooks/cost-trace.mjs"
check "full: a missing hook file gives hooks with install" row "$(run --json)" 'x.check=="hooks"&&!x.ok&&x.fix?.kind=="install"'

fixture; events '1\tfail\tsecret log text\n'
check "full: newest fail with no success gives update with no fix" row "$(run --json)" "x.check=='update'&&!x.ok&&!('fix' in x)&&x.text.includes('$(GD)/claudzilla-update.log')&&!x.text.includes('secret')"
events '1\tfail\tx\n2\tlive\tclaudzilla: updating to v9.9.9\n'
check "full: a fail then an updating line is still a failure" row "$(run --json)" 'x.check=="update"&&!x.ok'
events '1\tfail\tx\n2\tlive\tclaudzilla: updating to v9.9.9\n3\tlive\tclaudzilla: updated to v9.9.9\n'
check "full: a fail then the success line is ok" js "$(run --json)" '!r.some(x=>x.check=="update"&&!x.ok)'

fixture; proj_entry "$TMP/home/proj"; stale_margin
out=$(run --quick --json)
check "--quick --json: no full-only rows" js "$out" '!r.some(x=>["statusline","hooks","update"].includes(x.check))'
check "--quick --json: path tokens become <path>" grep -qF '<path>' <<<"$out"
check "--quick --json: no path left" sh -c '! printf "%s" "$1" | grep -qE "[\" ][/~]"' _ "$out"
check "--quick --json: counts stay" grep -qE '[0-9]+/[0-9]+' <<<"$out"
check "--json keeps the cwd" row "$(run --json)" "x.check=='project'&&x.fix.cwd=='$TMP/home/proj'"

fixture; proj_entry "$TMP/home/proj"; stale_margin; rm -rf "$TMP/tmp"; mkdir -p "$TMP/tmp" "$TMP/stub"
printf '#!/bin/sh\ntouch "%s/claude-called"\n' "$TMP" >"$TMP/stub/claude"; chmod +x "$TMP/stub/claude"
rm -rf "$TMP/cfg.before" "$TMP/clone.before"; cp -R "$CFG" "$TMP/cfg.before"; cp -R "$CL" "$TMP/clone.before"
PATH="$TMP/stub:$PATH" run --quick >/dev/null
( cd "$TMP/home/proj" && PATH="$TMP/stub:$PATH" HOME="$TMP/home" CLAUDE_CONFIG_DIR="$CFG" TMPDIR="$TMP/tmp" node "$D" --hook <<<"{\"session_id\":\"s1\",\"cwd\":\"$TMP/home/proj\"}" >/dev/null )
PATH="$TMP/stub:$PATH" run >/dev/null
check "anti-goal: no claude call in any mode" [ ! -e "$TMP/claude-called" ]
diff -r "$CFG" "$TMP/cfg.before" >"$TMP/cfgdiff" 2>&1; cat "$TMP/cfgdiff" >&2; check "anti-goal: config unchanged" [ ! -s "$TMP/cfgdiff" ]
check "anti-goal: clone unchanged" diff -r --exclude=index "$CL" "$TMP/clone.before"
check "anti-goal: only the session note is written" [ "$(ls -A "$TMP/tmp")" = "claudzilla-rules-$(id -u)" -a "$(ls -A "$SD")" = doctor-s1.json ]

fixture; git -C "$CL" worktree add -q "$TMP/wt" 2>/dev/null
out=$(DD="$TMP/wt/claude/hooks/doctor.mjs" run --json)
check "worktree: no install fix, says why" row "$out" 'x.check=="links"&&!x.ok&&!("fix" in x)&&x.why.includes("worktree")'
check "worktree: no row offers install" js "$out" '!r.some(x=>x.fix?.kind=="install")'

pidfile() { mkdir -p "$CFG/sessions"; printf '{"pid":123,"sessionId":"%s"}' "$1" >"$CFG/sessions/123.json"; }
fixture; rm -rf "$SD"; pidfile s1; hook '{"session_id":"s1","source":"startup"}' >/dev/null
bump_margin; pidfile s2; hook '{"session_id":"s2","source":"clear"}' >/dev/null
check "note: /clear keeps the startup note" [ "$(ls "$SD")" = doctor-p123.json ]
check "restart: still flagged after /clear" row "$(sid s2 --json)" 'x.check=="restart"&&!x.ok'
hook '{"session_id":"s2","source":"resume"}' >/dev/null
check "note: resume rewrites the note" js "$(sid s2 --json)" '!r.some(x=>x.check=="restart"&&!x.ok)'

fixture; printf '{"version":2,"plugins":{"margin@claudzilla":{}}}' >"$(IP)"; out=$(run --json); rc=$?
check "shape: plugin entry not an array, rc 0" [ "$rc" -eq 0 ]
check "shape: plugin entry not an array still reports" js "$out" 'Array.isArray(r)'
fixture; edit "$CFG/settings.json" "j.hooks.SessionStart={}"; out=$(run --json); rc=$?
check "shape: hooks event not an array, rc 0" [ "$rc" -eq 0 ]
check "shape: hooks event not an array gives settings row" row "$out" 'x.check=="settings"&&!x.ok'

fixture; mkdir -p "$TMP/home/it's"; proj_entry "$TMP/home/it's"; stale_margin
check "quote: a project path with ' gets no fix" row "$(CWD="$TMP/home/it's" run --json)" 'x.check=="project"&&!("fix" in x)&&x.why.includes("quote")'

summary doctor
