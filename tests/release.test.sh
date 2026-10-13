#!/usr/bin/env bash
# next-version tests: commit subjects and bodies in, next tag out.
#   bash tests/release.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
nv() { printf '%b' "$2" | sh "$REPO/.github/next-version.sh" "$1"; }

check "first tag is v1.0.0" [ "$(nv '' 'docs: a\n')" = v1.0.0 ]
check "feat bumps minor" [ "$(nv v1.2.3 'fix: a\nfeat(picks): b\n')" = v1.3.0 ]
check "fix bumps patch" [ "$(nv v1.2.3 'fix(hooks): a\n')" = v1.2.4 ]
check "perf bumps patch" [ "$(nv v1.2.3 'perf: a\n')" = v1.2.4 ]
check "refactor bumps patch" [ "$(nv v1.2.3 'refactor(panel): a\n')" = v1.2.4 ]
check "bang bumps major" [ "$(nv v1.2.3 'feat!: a\n')" = v2.0.0 ]
check "scoped bang bumps major" [ "$(nv v1.2.3 'refactor(install)!: a\n')" = v2.0.0 ]
check "BREAKING body line bumps major" [ "$(nv v1.2.3 'fix: a\n\nBREAKING: key renamed\n')" = v2.0.0 ]
check "docs, test, chore, ci: no tag" [ -z "$(nv v1.2.3 'docs: a\ntest: b\nchore: c\nci: d\n')" ]
check "indented feat in a body: no tag" [ -z "$(nv v1.2.3 'docs: a\n  feat: quoted\n')" ]
check "CI runs release tests" grep -q 'tests/release.test.sh' "$REPO/.github/workflows/test.yml"
check "CI release skips a run behind main" grep -q 'origin/main' "$REPO/.github/workflows/test.yml"
check "CI release waits for tests" grep -q 'needs: test' "$REPO/.github/workflows/test.yml"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
