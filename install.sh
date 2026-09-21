#!/usr/bin/env bash
# claudzilla installer: links ~/.claude/* to this repo, merges settings,
# installs node + rtk + plugins. Safe to re-run.
#   git clone https://github.com/HT0710/claudzilla ~/claudzilla && ~/claudzilla/install.sh
#   curl -fsSL https://raw.githubusercontent.com/HT0710/claudzilla/main/install.sh | bash
set -euo pipefail

REPO_URL="${CLAUDZILLA_REPO:-https://github.com/HT0710/claudzilla}"
DIR="${CLAUDZILLA_DIR:-$HOME/claudzilla}"
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
NODE_MAJOR="${NODE_MAJOR:-24}"
OFFLINE="${CLAUDZILLA_OFFLINE:-0}"   # 1 = skip node/rtk/plugins (tests)
LINKS="CLAUDE.md RTK.md rules themes hud .omc/hud-config.json"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || pwd)"
BACKUP="$DEST/.claudzilla-backup/$(date +%Y%m%d-%H%M%S)"

save() {  # move $DEST/$1 into this run's backup dir
  mkdir -p "$(dirname "$BACKUP/$1")"
  mv "$DEST/$1" "$BACKUP/$1"
}

link() {  # $DEST/$1 -> $REPO/claude/$1
  local src="$REPO/claude/$1" dst="$DEST/$1"
  [ "$(readlink "$dst" 2>/dev/null || true)" = "$src" ] && return 0
  mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] || [ -L "$dst" ]; then save "$1"; fi
  ln -s "$src" "$dst"
}

# Repo wins on scalars, objects merge key by key, arrays union - so keys a
# machine adds on its own (extra hooks, env, plugins) survive every re-run.
merge_settings() {
  local dst="$DEST/settings.json" tmp="$DEST/.settings.json.claudzilla"
  node -e '
const fs=require("fs"),[base,dst,out]=process.argv.slice(1);
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
const isObj=v=>v&&typeof v=="object"&&!Array.isArray(v);
const merge=(mine,repo)=>{
  if(Array.isArray(mine)&&Array.isArray(repo)){const seen=new Set(mine.map(v=>JSON.stringify(v)));
    return [...mine,...repo.filter(v=>!seen.has(JSON.stringify(v)))]}
  if(isObj(mine)&&isObj(repo)){const o={...mine};for(const k in repo)o[k]=k in mine?merge(mine[k],repo[k]):repo[k];return o}
  return repo};
fs.writeFileSync(out,JSON.stringify(merge(read(dst),read(base)),null,2)+"\n")' \
    "$REPO/settings.base.json" "$dst" "$tmp"
  if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then rm -f "$tmp"; return 0; fi
  [ -f "$dst" ] && save settings.json
  mv "$tmp" "$dst"
  echo "settings.json merged"
}

deps() { :; }
plugins() { :; }

main() {
  mkdir -p "$DEST"
  [ "$OFFLINE" = 1 ] || deps
  command -v node >/dev/null || { echo "claudzilla: node is required" >&2; exit 1; }
  for f in $LINKS; do link "$f"; done
  [ -e "$DEST/CLAUDE.local.md" ] || : > "$DEST/CLAUDE.local.md"
  merge_settings
  [ "$OFFLINE" = 1 ] || plugins
  [ -d "$BACKUP" ] && echo "replaced files backed up -> $BACKUP"
  echo "claudzilla installed -> $DEST (from $REPO)"
}

main "$@"
