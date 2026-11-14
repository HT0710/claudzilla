#!/bin/sh
# SessionStart hook: keep the claudzilla clone current. A background job fetches
# (at most hourly) and, with rulesGuard.autoUpdate on (default), fast-forwards to the
# newest release tag and re-runs install.sh; the next session reports the result.
# Startup never waits on the network.
# Each notice is also a line in the events file, which the herald mod toasts.
here=$(dirname "$(readlink "$0" || echo "$0")")
repo=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || exit 0
gd=$(git -C "$repo" rev-parse --absolute-git-dir)
log=$gd/claudzilla-update.log res=$gd/claudzilla-update.result lock=$gd/claudzilla-update.lock
ev=$gd/claudzilla-update.events seen=$gd/claudzilla-update.seen
# Set by herald's timer in an open session: no SessionStart notices, which belong to the next session.
timer=${CLAUDZILLA_UPDATE_TIMER:-}
# Local trace line for this stage; no session id, since reading stdin would hang a caller that keeps it open; never changes output or exit code.
trace() { perl "$here/trace.pl" nosession update "$@" >/dev/null 2>&1 </dev/null || true; }

json() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
# <epoch>\t<kind>\t<text>; kind start|live|fail, read by plugins/herald.
emit() { printf '%s\t%s\t%s\n' "$(date +%s)" "$1" "$2" >> "$ev"; trace "update.$1" "$([ "$1" = fail ] && echo error || echo info)" "text=$2"; }
ver() { git -C "$repo" describe --tags --always "$@" 2>/dev/null; }
# Newest release tag on upstream; a fork with no tags follows the branch.
rel() { git -C "$repo" describe --tags --abbrev=0 --match 'v[0-9]*' "$up" 2>/dev/null || echo "$up"; }
behind() { git -C "$repo" rev-list --count "HEAD..$(rel)" 2>/dev/null; }
# The release a session was last told of, by commit: any fetch can bring a tag, not only this hook's.
relsha() { git -C "$repo" rev-parse -q --verify "$(rel)^{commit}"; }
told() { relsha > "$seen"; }
list() { paste -sd, - | sed 's/,/, /g'; }
# A path's part: its first two segments (plugins/margin, claude/hud), or the path itself.
parts() { sed -E 's#^([^/]+/[^/]+)/.*#\1#' | sort -u; }
# Why the update must wait: local commits, or edits in a part the release changes, since
# files in one part depend on each other. Other edits stay and ride along. Untracked files
# don't block: a fast-forward only fails if upstream adds the same path.
blocked() {
  [ -n "$(git -C "$repo" log --oneline @{u}..HEAD 2>/dev/null)" ] && { echo "local commits"; return; }
  p=$({ git -C "$repo" diff --no-renames --name-only HEAD | parts; git -C "$repo" diff --no-renames --name-only HEAD "$(rel)" | parts; } 2>/dev/null | sort | uniq -d | list)
  [ -z "$p" ] || echo "local changes in $p"
}
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
if [ -z "$timer" ] && [ -f "$res" ]; then
  user=$(cat "$res"); rm -f "$res"
  # Added on read: the job that wrote it ran the hook from before the update.
  case $user in *": updated to "*) user="$user - for changes: /claudzilla news" ;; esac
  emit start "$user"
  case $user in *auto-update*failed*)
    claude="The last claudzilla auto-update failed (log: $log). Only if the user asks, read the log, fix the cause, then run: $cpull && $repo/install.sh - then report the result." ;;
  esac
fi
n=$(behind)
trace update.check info "behind=${n:-0}" "auto=$auto" "target=$to"
if [ -z "$timer" ] && [ "${n:-0}" -gt 0 ]; then
  told
  [ "$auto" = true ] && why=$(blocked)
  if [ "$auto" = true ] && [ -z "$why" ]; then
    user="${user:+$user | }claudzilla: updating to $(ver --match 'v[0-9]*' "$to") in background - restart Claude to apply"
  else
    v=$(ver --match 'v[0-9]*' "$to")
    if [ -n "$why" ]; then
      msg="claudzilla: update $v skipped (${why%% in *}) - ask Claude to update"
      claude="${claude:+$claude }A claudzilla update to $v was skipped: $why (repo: $repo). Only if the user asks to update claudzilla, bring those changes onto $to (stash edits, or rebase local commits), show the user any conflict, then run: $repo/install.sh - then report the result."
    else
      msg="claudzilla: update $v available - ask Claude to update, or run: cd $repo && $pull && ./install.sh"
      claude="${claude:+$claude }A claudzilla update is available (repo: $repo). Only if the user asks to update claudzilla, run: $cpull && $repo/install.sh - then report the result."
    fi
    user="${user:+$user | }$msg"; emit start "$msg"
  fi
fi
if [ -n "$claude" ]; then
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json "$user")" "$(json "$claude")"
elif [ -n "$user" ]; then
  printf '{"systemMessage":"%s"}\n' "$(json "$user")"
fi

stale=$({ [ -f "$gd/shallow" ] || [ -z "$(find "$gd/FETCH_HEAD" -mmin -60 2>/dev/null)" ]; } && echo 1)
[ -n "$stale" ] || [ "${n:-0}" -gt 0 ] || exit 0
find "$lock" -maxdepth 0 -mmin +60 -exec rmdir {} \; 2>/dev/null   # left by a killed job
(
  mkdir "$lock" 2>/dev/null || exit 0   # another session's job is running
  trap '' HUP   # Claude exiting mid-install must not leave a half install and a stuck lock
  trap 'rmdir "$lock"' EXIT
  # A curl install is a --depth 1 clone: no tags until its history is fetched.
  if [ -n "$stale" ]; then
    # No prompt can hang it. GIT_SSH (plink) beats core.sshCommand in git and takes no ssh options, so it stays as is.
    [ -n "${GIT_SSH:-}" ] && [ -z "${GIT_SSH_COMMAND:-}" ] || export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-$(git -C "$repo" config core.sshCommand || echo ssh)} -o BatchMode=yes"
    GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= git -C "$repo" fetch -q $([ -f "$gd/shallow" ] && echo --unshallow --tags)
  fi
  [ "$(behind)" -gt 0 ] 2>/dev/null || exit 0
  moved=$([ "$(relsha)" = "$(cat "$seen" 2>/dev/null)" ] || echo 1)
  # A release no session was told of: open sessions hear of it now, not only the next session.
  if [ "$auto" != true ] || [ -n "$(blocked)" ]; then
    [ -z "$moved" ] || { told; emit live "claudzilla: $(ver --match 'v[0-9]*' "$(rel)") released - ask Claude to update"; }
    exit 0
  fi
  # A failed update retries at the next session start, not on every timer tick.
  [ -z "$timer" ] || [ -n "$moved" ] || exit 0
  told
  to=$(ver --match 'v[0-9]*' "$(rel)"); emit live "claudzilla: updating to $to"
  if { git -C "$repo" merge -q --ff-only "$to" && bash "$repo/install.sh"; } >"$log" 2>&1
  then kept=$(git -C "$repo" diff --no-renames --name-only HEAD); msg="claudzilla: updated to $(ver)${kept:+, your edits kept}"; emit live "$msg - restart Claude to apply"
  else msg="claudzilla: auto-update to $to failed - ask Claude to debug it (log: $log)"; emit fail "$msg"; fi
  echo "$msg" >"$res.tmp"
  mv "$res.tmp" "$res"
) </dev/null >/dev/null 2>&1 &
exit 0
