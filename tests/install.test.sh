#!/usr/bin/env bash
# Offline install tests. Every case runs install.sh against a throwaway HOME.
#   bash tests/install.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; fi; }
q() { node -p "JSON.stringify(require(process.argv[1])$2)" "$1"; }
clean_env() { env -u CLAUDE_CONFIG_DIR -u OMC_PLUGIN_ROOT -u OMC_STATE_DIR "$@"; }
run_install() { clean_env HOME="$1" CLAUDZILLA_OFFLINE=1 bash "$REPO/install.sh" >"$1/install.log" 2>&1; }
new_home() { mktemp -d "$TMP/home.XXXX"; }

# --- content ---
check "content: no home paths" \
  bash -c "! grep -rqE '/home/|/Users/' --exclude-dir=omc-vendor '$REPO/claude' '$REPO/settings.base.json'"
check "content: no emails" \
  bash -c "! grep -rqE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}' --exclude-dir=omc-vendor '$REPO/claude' '$REPO/settings.base.json' '$REPO/install.sh' '$REPO/README.md'"
check "content: settings.base.json valid" node -e "require('$REPO/settings.base.json')"
check "content: CLAUDE.md imports RTK via ~" grep -qx '@~/.claude/RTK.md' "$REPO/claude/CLAUDE.md"
check "content: CLAUDE.md imports local" grep -qx '@~/.claude/CLAUDE.local.md' "$REPO/claude/CLAUDE.md"
check "content: no CodeGraph section" bash -c "! grep -qi codegraph '$REPO/claude/CLAUDE.md'"
check "content: vendor license" grep -q 'MIT License' "$REPO/claude/hud/omc-vendor/LICENSE"

# --- fresh machine ---
H=$(new_home); run_install "$H"; rc=$?
check "fresh: exit 0" [ "$rc" -eq 0 ]
for f in CLAUDE.md RTK.md rules themes hud .omc/hud-config.json; do
  check "fresh: $f linked" [ "$(readlink "$H/.claude/$f")" = "$REPO/claude/$f" ]
done
check "fresh: CLAUDE.local.md created" [ -f "$H/.claude/CLAUDE.local.md" ]
check "fresh: settings == base" [ "$(q "$H/.claude/settings.json" '')" = "$(q "$REPO/settings.base.json" '')" ]
check "fresh: no backup dir" [ ! -e "$H/.claude/.claudzilla-backup" ]
sl=$(cd /tmp && clean_env HOME="$H" sh -c "$(node -p 'require(process.argv[1]).statusLine.command' "$H/.claude/settings.json")" \
     <<<'{"cwd":"/tmp","session_id":"t","model":{"display_name":"M"}}' 2>/dev/null)
check "fresh: statusline shows ctx" grep -q 'ctx' <<<"$sl"

# --- existing machine with its own extras ---
H=$(new_home); S="$H/.claude/settings.json"; mkdir -p "$H/.claude"
echo old > "$H/.claude/CLAUDE.md"
echo 'keep me' > "$H/.claude/CLAUDE.local.md"
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
check "local: CLAUDE.local.md untouched" grep -qx 'keep me' "$H/.claude/CLAUDE.local.md"

# --- re-run is a no-op ---
nb=$(ls "$H/.claude/.claudzilla-backup" | wc -l); cp "$S" "$H/s1"; sleep 1
run_install "$H"
check "rerun: no new backup" [ "$(ls "$H/.claude/.claudzilla-backup" | wc -l)" -eq "$nb" ]
check "rerun: settings unchanged" cmp -s "$S" "$H/s1"

# --- curl | bash bootstrap (clones committed HEAD of $REPO) ---
H=$(new_home)
(cd "$H" && clean_env HOME="$H" CLAUDZILLA_OFFLINE=1 CLAUDZILLA_REPO="$REPO" bash < "$REPO/install.sh" >"$H/install.log" 2>&1); rc=$?
check "bootstrap: exit 0" [ "$rc" -eq 0 ]
check "bootstrap: cloned" [ -f "$H/claudzilla/settings.base.json" ]
check "bootstrap: links point at clone" [ "$(readlink "$H/.claude/CLAUDE.md")" = "$H/claudzilla/claude/CLAUDE.md" ]

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
