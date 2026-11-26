#!/usr/bin/env bash
# Nerd Font icons in plugin hooks go through kit.tsx nf(), so basic glyphs can swap them.
#   bash tests/glyphs.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO/tests/lib.sh"

# Private Use Area chars, or - escapes, outside kit.tsx: "file:line: text".
raw() {
  find "$REPO"/plugins/*/hooks -name '*.ts' -o -name '*.tsx' | grep -v '/kit\.tsx$' | sort | xargs perl -CSD -ne '
    print "$ARGV:$.: $_" if /[\x{E000}-\x{F8FF}]/ || /\\u\{?([eE][0-9a-fA-F]|[fF][0-8])[0-9a-fA-F]{2}\b/; close ARGV if eof'
}
none_raw() { local hits; hits="$(raw)"; [ -z "$hits" ] || { echo "$hits"; return 1; }; }
check "no raw Nerd Font icons outside kit.tsx" none_raw

summary glyphs
