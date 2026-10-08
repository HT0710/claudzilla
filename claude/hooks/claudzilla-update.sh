#!/bin/sh
# SessionStart hook: keep the claudzilla clone current. A background job fetches
# (at most daily) and, with rulesGuard.autoUpdate on (default), pulls and re-runs
# install.sh; the next session reports the result. Startup never waits on the network.
here=$(dirname "$(readlink "$0" || echo "$0")")
repo=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || exit 0
gd=$(git -C "$repo" rev-parse --absolute-git-dir)
log=$gd/claudzilla-update.log res=$gd/claudzilla-update.result lock=$gd/claudzilla-update.lock

json() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
behind() { git -C "$repo" rev-list --count HEAD..@{u} 2>/dev/null; }
# Untracked files don't block: a fast-forward only fails if upstream adds the same path.
dirty() { git -C "$repo" status --porcelain --untracked-files=no 2>/dev/null; }
auto=$(GUARD="$here/rules-guard.mjs" node --input-type=module -e 'const { loadConfig } = await import(process.env.GUARD); process.stdout.write(String(loadConfig("").cfg.autoUpdate))' 2>/dev/null)
[ "$auto" = false ] || auto=true

user="" claude=""
[ -f "$res" ] && user=$(cat "$res") && rm -f "$res"
n=$(behind)
if [ "${n:-0}" -gt 0 ]; then
  if [ "$auto" = true ] && [ -z "$(dirty)" ]; then
    user="claudzilla: updating in background - applies next session"
  else
    [ "$auto" = true ] && why=" (auto-update skipped: local changes)"
    user="claudzilla: update available${why:-} - ask Claude to update, or run: cd $repo && git pull && ./install.sh"
    claude="A claudzilla update is available (repo: $repo). Only if the user asks to update claudzilla, run: git -C $repo pull --ff-only && $repo/install.sh - then report the result."
  fi
fi
if [ -n "$claude" ]; then
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json "$user")" "$(json "$claude")"
elif [ -n "$user" ]; then
  printf '{"systemMessage":"%s"}\n' "$(json "$user")"
fi

stale=$([ -z "$(find "$gd/FETCH_HEAD" -mmin -1440 2>/dev/null)" ] && echo 1)
[ -n "$stale" ] || { [ "$auto" = true ] && [ "${n:-0}" -gt 0 ]; } || exit 0
find "$lock" -maxdepth 0 -mmin +60 -exec rmdir {} \; 2>/dev/null   # left by a killed job
(
  mkdir "$lock" 2>/dev/null || exit 0   # another session's job is running
  trap 'rmdir "$lock"' EXIT
  [ -z "$stale" ] || GIT_TERMINAL_PROMPT=0 git -C "$repo" fetch -q
  [ "$auto" = true ] && [ "$(behind)" -gt 0 ] 2>/dev/null && [ -z "$(dirty)" ] || exit 0
  if { git -C "$repo" pull -q --ff-only && bash "$repo/install.sh"; } >"$log" 2>&1
  then echo "claudzilla: updated to $(git -C "$repo" log -1 --format='%h %s')" >"$res"
  else echo "claudzilla: auto-update failed - see $log" >"$res"; fi
) </dev/null >/dev/null 2>&1 &
exit 0
