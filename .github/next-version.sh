#!/bin/sh
# Next vX.Y.Z from the commit log (subjects and bodies) since tag $1; prints nothing when no release is due.
#   git log --format='%s%n%b' v1.2.3..HEAD | sh .github/next-version.sh v1.2.3
last=${1:-}
[ -n "$last" ] || { echo v1.0.0; exit 0; }
log=$(cat)
IFS=. read -r ma mi pa <<EOF
${last#v}
EOF
has() { printf '%s\n' "$log" | grep -qE "$1"; }
if has '^[a-z]+(\([^)]*\))?!:|^BREAKING'; then echo "v$((ma + 1)).0.0"
elif has '^feat(\([^)]*\))?:'; then echo "v$ma.$((mi + 1)).0"
elif has '^(fix|perf|refactor)(\([^)]*\))?:'; then echo "v$ma.$mi.$((pa + 1))"
fi
