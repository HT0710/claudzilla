#!/bin/sh
# SessionStart hook: keep the claudzilla clone current. A background job fetches
# (at most daily) and, with rulesGuard.autoUpdate on (default), fast-forwards to the
# newest release tag and re-runs install.sh; the next session reports the result.
# Startup never waits on the network.
# Each notice is also a line in the events file, which the update-toast mod toasts.
here=$(dirname "$(readlink "$0" || echo "$0")")
repo=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || exit 0
gd=$(git -C "$repo" rev-parse --absolute-git-dir)
log=$gd/claudzilla-update.log res=$gd/claudzilla-update.result lock=$gd/claudzilla-update.lock
ev=$gd/claudzilla-update.events

json() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
# <epoch>\t<kind>\t<text>; kind start|live|fail, read by plugins/update-toast.
emit() { printf '%s\t%s\t%s\n' "$(date +%s)" "$1" "$2" >> "$ev"; }
ver() { git -C "$repo" describe --tags --always "$@" 2>/dev/null; }
# Newest release tag on upstream; a fork with no tags follows the branch.
rel() { git -C "$repo" describe --tags --abbrev=0 --match 'v[0-9]*' "$up" 2>/dev/null || echo "$up"; }
behind() { git -C "$repo" rev-list --count "HEAD..$(rel)" 2>/dev/null; }
# Uncommitted edits or local commits. Untracked files don't block: a fast-forward
# only fails if upstream adds the same path.
dirty() { git -C "$repo" status --porcelain --untracked-files=no 2>/dev/null; git -C "$repo" log --oneline @{u}..HEAD 2>/dev/null; }
auto=$(GUARD="$here/rules-guard.mjs" node --input-type=module -e 'const { loadConfig } = await import(process.env.GUARD); process.stdout.write(String(loadConfig("").cfg.autoUpdate))' 2>/dev/null)
[ "$auto" = true ] || auto=false   # node failed: never run upstream code unasked
up=@{u} sw=""
# A local branch with no upstream: notice against origin's default branch, never auto-update.
git -C "$repo" rev-parse -q --verify "$up" >/dev/null 2>&1 || {
  up=$(git -C "$repo" rev-parse --abbrev-ref origin/HEAD 2>/dev/null) auto=false sw="switch ${up#origin/}"
}
# Manual updates stop at the release too.
to=$(rel)
pull="${sw:+git $sw && }git merge --ff-only $to" cpull="${sw:+git -C $repo $sw && }git -C $repo merge --ff-only $to"
# The mod drops lines it already showed, so a trim never re-toasts.
[ -f "$ev" ] && [ $(wc -l < "$ev") -gt 100 ] && tail -n 20 "$ev" > "$ev.tmp" && mv "$ev.tmp" "$ev"

user="" claude="" why=""
if [ -f "$res" ]; then
  user=$(cat "$res"); rm -f "$res"; emit start "$user"
  case $user in *auto-update*failed*)
    claude="The last claudzilla auto-update failed (log: $log). Only if the user asks, read the log, fix the cause, then run: $cpull && $repo/install.sh - then report the result." ;;
  esac
fi
n=$(behind)
if [ "${n:-0}" -gt 0 ]; then
  if [ "$auto" = true ] && [ -z "$(dirty)" ]; then
    user="${user:+$user | }claudzilla: updating to $(ver --match 'v[0-9]*' "$to") in background - restart Claude to apply"
  else
    [ "$auto" = true ] && why=" (auto-update skipped: local changes)"
    msg="claudzilla: update $(ver --match 'v[0-9]*' "$to") available${why:-} - ask Claude to update, or run: cd $repo && $pull && ./install.sh"
    user="${user:+$user | }$msg"; emit start "$msg"
    claude="${claude:+$claude }A claudzilla update is available (repo: $repo). Only if the user asks to update claudzilla, run: $cpull && $repo/install.sh - then report the result."
  fi
fi
if [ -n "$claude" ]; then
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json "$user")" "$(json "$claude")"
elif [ -n "$user" ]; then
  printf '{"systemMessage":"%s"}\n' "$(json "$user")"
fi

stale=$({ [ -f "$gd/shallow" ] || [ -z "$(find "$gd/FETCH_HEAD" -mmin -1440 2>/dev/null)" ]; } && echo 1)
[ -n "$stale" ] || { [ "$auto" = true ] && [ "${n:-0}" -gt 0 ]; } || exit 0
find "$lock" -maxdepth 0 -mmin +60 -exec rmdir {} \; 2>/dev/null   # left by a killed job
(
  mkdir "$lock" 2>/dev/null || exit 0   # another session's job is running
  trap '' HUP   # Claude exiting mid-install must not leave a half install and a stuck lock
  trap 'rmdir "$lock"' EXIT
  # A curl install is a --depth 1 clone: no tags until its history is fetched.
  [ -z "$stale" ] || GIT_TERMINAL_PROMPT=0 git -C "$repo" fetch -q $([ -f "$gd/shallow" ] && echo --unshallow --tags)
  [ "$auto" = true ] && [ "$(behind)" -gt 0 ] 2>/dev/null && [ -z "$(dirty)" ] || exit 0
  to=$(ver --match 'v[0-9]*' "$(rel)"); emit live "claudzilla: updating to $to"
  if { git -C "$repo" merge -q --ff-only "$to" && bash "$repo/install.sh"; } >"$log" 2>&1
  then msg="claudzilla: updated to $(ver)"; emit live "$msg - restart Claude to apply"
  else msg="claudzilla: auto-update to $to failed - ask Claude to debug it (log: $log)"; emit fail "$msg"; fi
  echo "$msg" >"$res.tmp"
  mv "$res.tmp" "$res"
) </dev/null >/dev/null 2>&1 &
exit 0
