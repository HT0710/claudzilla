# Sourced by tests/*.test.sh: pass/fail counters and check <name> <command...>.
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
