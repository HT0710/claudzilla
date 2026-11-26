#!/usr/bin/env bash
# next-version tests: commit subjects and bodies in, next tag out. release-notes tests: generated notes in, trimmed notes out.
#   bash tests/release.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO/tests/lib.sh"
nv() { printf '%b' "$2" | sh "$REPO/.github/next-version.sh" "$1"; }
rn() { printf '%b' "$1" | sh "$REPO/.github/release-notes.sh"; }

check_eq "first tag is v1.0.0" v1.0.0 "$(nv '' 'docs: a\n')"
check_eq "feat bumps minor" v1.3.0 "$(nv v1.2.3 'fix: a\nfeat(picks): b\n')"
check_eq "fix bumps patch" v1.2.4 "$(nv v1.2.3 'fix(hooks): a\n')"
check_eq "perf bumps patch" v1.2.4 "$(nv v1.2.3 'perf: a\n')"
check_eq "refactor bumps patch" v1.2.4 "$(nv v1.2.3 'refactor(panel): a\n')"
check_eq "bang bumps major" v2.0.0 "$(nv v1.2.3 'feat!: a\n')"
check_eq "scoped bang bumps major" v2.0.0 "$(nv v1.2.3 'refactor(install)!: a\n')"
check_eq "BREAKING body line bumps major" v2.0.0 "$(nv v1.2.3 'fix: a\n\nBREAKING: key renamed\n')"
check "docs, test, chore, ci: no tag" [ -z "$(nv v1.2.3 'docs: a\ntest: b\nchore: c\nci: d\n')" ]
check "indented feat in a body: no tag" [ -z "$(nv v1.2.3 'docs: a\n  feat: quoted\n')" ]
U=https://github.com/o/r/pull/7
check_eq "change line drops author and PR" '* fix(a): b' "$(rn "* fix(a): b by @x-y in $U\n")"
check "New Contributors line kept" [ "$(rn "* @x made their first contribution in $U\n")" = "* @x made their first contribution in $U" ]
check_eq "Full Changelog line kept" '**Full Changelog**: https://github.com/o/r/compare/v1...v2' "$(rn '**Full Changelog**: https://github.com/o/r/compare/v1...v2\n')"
check "CI release trims notes" grep -q 'release-notes.sh' "$REPO/.github/workflows/test.yml"
check "CI runs release tests" grep -q 'printf .* tests/\*\.test\.sh' "$REPO/.github/workflows/test.yml"
# The matrix lists suites by hand, so a new test file or plugin must be added there.
check "CI runs every test file and plugin" bash -c 'cd "$1" && eval "$(grep "^ *list=" .github/workflows/test.yml)" && for t in tests/*.test.sh plugins/*/tests; do grep -qF "\"${t%/tests}\"" <<<"$list" || { echo "not in CI: $t"; exit 1; }; done' _ "$REPO"
check "CI release skips a run behind main" grep -q 'origin/main' "$REPO/.github/workflows/test.yml"
check "CI release waits for tests" grep -q 'needs: \[test, macos\]' "$REPO/.github/workflows/test.yml"
check "CI release has no schedule" bash -c "! grep -q 'schedule:' '$REPO/.github/workflows/test.yml'"
check "CI release runs on demand" grep -q '^  workflow_dispatch:' "$REPO/.github/workflows/test.yml"
check "CI releases per push" grep -q "if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'" "$REPO/.github/workflows/test.yml"

summary release
