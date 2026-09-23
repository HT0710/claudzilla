#!/bin/sh
# SessionStart hook: tell the user when their claudzilla clone is behind upstream.
# Compares against the last fetch so startup never waits on the network; a stale
# fetch (>1 day) is refreshed in the background for the next session.
here=$(dirname "$(readlink "$0" || echo "$0")")
repo=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || exit 0

json() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
n=$(git -C "$repo" rev-list --count HEAD..@{u} 2>/dev/null)
if [ "${n:-0}" -gt 0 ]; then
  user="claudzilla: update available - ask Claude to update, or run: cd $repo && git pull && ./install.sh"
  claude="A claudzilla update is available (repo: $repo). Only if the user asks to update claudzilla, run: git -C $repo pull --ff-only && $repo/install.sh - then report the result."
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json "$user")" "$(json "$claude")"
fi

fh=$(git -C "$repo" rev-parse --absolute-git-dir)/FETCH_HEAD
if [ -z "$(find "$fh" -mmin -1440 2>/dev/null)" ]; then
  (GIT_TERMINAL_PROMPT=0 git -C "$repo" fetch -q </dev/null >/dev/null 2>&1 &)
fi
exit 0
