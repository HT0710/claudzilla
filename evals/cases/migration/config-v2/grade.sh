#!/usr/bin/env bash
# Pass: migrated files validate and hold the exact v2 values; rollback.sh then restores both v1 files byte for byte.
C="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKDIR" || exit 1
node "$C/fixture/validate.mjs" >/dev/null 2>&1 || exit 1
node "$C/expect.mjs" >/dev/null 2>&1 || exit 1
[ -f rollback.sh ] && bash rollback.sh >/dev/null 2>&1 || exit 1
cmp -s config.json "$C/fixture/config.json" && cmp -s data/users.json "$C/fixture/data/users.json"
