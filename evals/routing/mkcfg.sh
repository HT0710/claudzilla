#!/usr/bin/env bash
# Build a CLAUDE_CONFIG_DIR that mirrors ~/.claude but loads rules, CLAUDE.md and claudzilla hooks from a claudzilla worktree.
#   mkcfg.sh <out-dir> <worktree>
set -euo pipefail
out=$1 wt=$(realpath "$2") src=$HOME/.claude clone=$(realpath "$HOME/claudzilla")
rm -rf "$out"; mkdir -p "$out/hooks"
for e in "$src"/* "$src"/.[!.]*; do
  n=$(basename "$e")
  case $n in CLAUDE.md|rules|hooks|.claude.json) continue ;; esac
  ln -s "$e" "$out/$n"
done
ln -s "$wt/claude/CLAUDE.md" "$out/CLAUDE.md"
ln -s "$wt/claude/rules" "$out/rules"
# Outside CLAUDE_CONFIG_DIR, the CLI keeps this file in $HOME.
ln -s "$HOME/.claude.json" "$out/.claude.json"
for h in "$src"/hooks/*; do
  t=$(readlink -f "$h")
  ln -s "${t/#$clone\//$wt/}" "$out/hooks/$(basename "$h")"
done
