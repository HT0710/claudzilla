# Sourced by tests/*.test.sh: counters, check helpers and summary.
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
# check_eq <name> <want> <got>: like check, and shows both values on failure.
check_eq() {
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1"; echo "  want: $2"; echo "  got:  $3"; return 1; fi
}
has() { grep -qF -- "$2" <<<"$1"; }
eq() { [ "$1" = "$2" ]; }
not() { ! "$@"; }
# silent <cmd...>: passes only if cmd exits 0 and writes nothing to stdout or stderr.
silent() {
  local ef out rc; ef=$(mktemp)
  out=$("$@" 2>"$ef"); rc=$?
  [ "$rc" -eq 0 ] && [ -z "$out" ] && [ ! -s "$ef" ]; rc=$?
  rm -f "$ef"; return "$rc"
}
# wait_for <file> [tries]: poll every 0.25s until the file is non-empty.
wait_for() { local i; for i in $(seq "${2:-20}"); do [ -s "$1" ] && return 0; sleep 0.25; done; return 1; }
# summary <suite>: print the totals; non-zero when a check failed.
summary() { echo "$1: $pass passed, $fail failed"; [ "$fail" -eq 0 ]; }
