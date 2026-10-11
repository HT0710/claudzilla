#!/usr/bin/env bash
# main with one pushed commit; feat/shout one commit ahead, unpushed; fake gh in bin/ (git-ignored).
set -e
git init -q -b main
git config user.email eval@example.com
git config user.name eval
printf 'bin/\n.gh.log\n' >> .git/info/exclude
git add -A
git commit -qm "feat: add greet command"
git init -q --bare .git/origin.git
git remote add origin "$PWD/.git/origin.git"
git push -q -u origin main
git switch -qc feat/shout
cp -R "$CASE_DIR/branch/." .
git add -A
git commit -qm "feat: add shout command"
mkdir -p bin
cp "$CASE_DIR/gh" bin/gh
chmod +x bin/gh
