#!/usr/bin/env bash
# Task 1 committed on feat/csv; the SDD brief and report live in the git-ignored .sdd/.
set -e
git init -q -b feat/csv
git config user.email eval@example.com
git config user.name eval
printf '.sdd/\n' >> .git/info/exclude
git add -A
git commit -qm "feat(csv): add formatCsvLine"
