#!/usr/bin/env bash
# Offline eval-harness tests: case graders, run.mjs against a fake `claude`, report.mjs on canned rows.
#   bash tests/evals.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
EV="$REPO/evals"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }

# --- graders: bare fixture fails, fixture + solution.patch passes
graded=0
for d in "$EV"/cases/*/*/; do
  [ -f "$d/solution.patch" ] || continue
  n=${d%/}; n=${n#"$EV"/cases/}; graded=$((graded+1))
  w="$TMP/grade/$n"; mkdir -p "$w"; cp -R "$d/fixture/." "$w/"
  check "grader rejects bare fixture: $n" bash -c '! WORKDIR="$1" TRANSCRIPT= bash "$2/grade.sh" >/dev/null 2>&1' _ "$w" "$d"
  (cd "$w" && patch -s -p1 < "$d/solution.patch")
  check "grader accepts solution: $n" bash -c 'WORKDIR="$1" TRANSCRIPT= bash "$2/grade.sh" >/dev/null 2>&1' _ "$w" "$d"
done
check "graders: at least one synthetic case" [ "$graded" -gt 0 ]

echo "evals: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
