#!/usr/bin/env bash
# Base commit, then HEAD = the change under review: pageCount (bug: one page too many when items divide evenly) + a clean money.mjs tidy-up.
set -e
git init -q -b feat/paging
git config user.email eval@example.com
git config user.name eval
git add -A
git commit -qm "feat: add page helper"
cp -R "$CASE_DIR/change/." .
git add -A
git commit -qm "feat: add pageCount, tidy money padding"
