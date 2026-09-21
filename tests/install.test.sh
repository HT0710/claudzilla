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

echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
