#!/usr/bin/env bash
# Base commit, then HEAD = Task 3 as implemented (missing --limit and unknown-flag handling); review package in .sdd/.
set -e
git init -q -b feat/cleanup-flags
git config user.email eval@example.com
git config user.name eval
printf '.sdd/\n' >> .git/info/exclude
git add -A
git commit -qm "feat: add cleanup command"
cp -R "$CASE_DIR/change/." .
git add -A
git commit -qm "feat(cleanup): add dry-run, limit and flag checks"
{
  echo "# Review package: HEAD~1..HEAD"
  echo
  echo "## Commits"
  git log --oneline HEAD~1..HEAD
  echo
  echo "## Files changed"
  git diff --stat HEAD~1..HEAD
  echo
  echo "## Diff"
  git diff -U10 HEAD~1..HEAD
} > .sdd/review.diff
