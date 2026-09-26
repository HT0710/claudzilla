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
LINKS="CLAUDE.md RTK.md rules themes hud .omc/hud-config.json hooks/claudzilla-update.sh hooks/rules-guard.mjs hooks/md-display.pl"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || pwd)"
BACKUP="$DEST/.claudzilla-backup/$(date +%Y%m%d-%H%M%S)"
ORIG_PATH="$PATH"

# Piped from curl: no checkout next to us, so clone one and run from it.
if [ ! -f "$REPO/settings.base.json" ]; then
  command -v git >/dev/null || { echo "claudzilla: git is required" >&2; exit 1; }
  if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only
  elif [ -e "$DIR" ]; then echo "claudzilla: $DIR exists but is not a git clone - move it or set CLAUDZILLA_DIR" >&2; exit 1
  else git clone --depth 1 "$REPO_URL" "$DIR"; fi
  exec bash "$DIR/install.sh" "$@"
fi

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
# Entries are compared with keys sorted: Claude Code rewrites settings.json.
# .claudzilla-base.json records the last base applied, so entries claudzilla
# stops shipping get removed; without it, hook entries whose every command
# runs a claudzilla hook script are. Repeated copies of a base entry collapse.
# settings.overrides.json (machine-local, never in the repo) wins over both.
merge_settings() {
  local dst="$DEST/settings.json" tmp="$DEST/.settings.json.claudzilla" rec="$DEST/.claudzilla-base.json"
  node -e '
const fs=require("fs"),[base,dst,out,over,rec,hookDir]=process.argv.slice(1);
const read=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
const isObj=v=>v&&typeof v=="object"&&!Array.isArray(v);
const canon=v=>JSON.stringify(v,(k,x)=>isObj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const merge=(mine,repo)=>{
  if(Array.isArray(mine)&&Array.isArray(repo)){const ours=new Set(repo.map(canon)),seen=new Set();
    const kept=mine.filter(v=>{const c=canon(v);if(ours.has(c)&&seen.has(c))return false;seen.add(c);return true});
    return [...kept,...repo.filter(v=>!seen.has(canon(v)))]}
  if(isObj(mine)&&isObj(repo)){const o={...mine};for(const k in repo)o[k]=k in mine?merge(mine[k],repo[k]):repo[k];return o}
  return repo};
const prune=(mine,old,repo)=>{
  if(Array.isArray(mine)&&Array.isArray(old)){const had=new Set(old.map(canon)),keep=new Set((Array.isArray(repo)?repo:[]).map(canon));
    return mine.filter(v=>!had.has(canon(v))||keep.has(canon(v)))}
  if(isObj(mine)&&isObj(old)){const o={...mine},r=isObj(repo)?repo:{};
    for(const k in old){if(!(k in o))continue;
      if(!(k in r)&&canon(o[k])===canon(old[k])){delete o[k];continue}
      o[k]=prune(o[k],old[k],r[k])}
    return o}
  return mine};
const files=fs.existsSync(hookDir)?fs.readdirSync(hookDir):[];
const ours=e=>{const hs=e&&e.hooks||[];return hs.length>0&&hs.every(h=>typeof(h&&h.command)=="string"&&files.some(f=>h.command.includes("hooks/"+f)))};
const bootstrap=(mine,repo)=>{
  if(!isObj(mine.hooks))return mine;
  const o={...mine,hooks:{...mine.hooks}},rh=isObj(repo.hooks)?repo.hooks:{};
  for(const e in o.hooks){if(!Array.isArray(o.hooks[e]))continue;const keep=new Set((rh[e]||[]).map(canon));
    o.hooks[e]=o.hooks[e].filter(x=>keep.has(canon(x))||!ours(x))}
  return o};
let old=null;try{old=JSON.parse(fs.readFileSync(rec,"utf8"))}catch{}
const b=read(base),d=read(dst);
fs.writeFileSync(out,JSON.stringify(merge(merge(old?prune(d,old,b):bootstrap(d,b),b),read(over)),null,2)+"\n")' \
    "$REPO/settings.base.json" "$dst" "$tmp" "$DEST/settings.overrides.json" "$rec" "$REPO/claude/hooks"
  if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then rm -f "$tmp"
  else
    [ -f "$dst" ] && save settings.json
    mv "$tmp" "$dst"
    echo "settings.json merged"
  fi
  cmp -s "$REPO/settings.base.json" "$rec" || cp "$REPO/settings.base.json" "$rec"
}

# node runs the statusline + this script's JSON merge; rtk backs the Bash hook.
# No sudo: official node build (SHA-256 checked) into ~/.local.
deps() {
  export PATH="$HOME/.local/bin:$PATH"
  local c; for c in curl tar; do command -v "$c" >/dev/null || { echo "claudzilla: $c is required" >&2; exit 1; }; done
  command -v perl >/dev/null || echo "claudzilla: perl missing - the statusline needs it" >&2
  if ! command -v node >/dev/null; then
    local os arch base sum file tmp dir got
    case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "claudzilla: install node yourself" >&2; exit 1 ;; esac
    case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "claudzilla: install node yourself" >&2; exit 1 ;; esac
    base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
    read -r sum file < <(curl -fsSL "$base/SHASUMS256.txt" | grep " node-v[0-9.]*-$os-$arch\.tar\.gz\$") || true
    [ -n "${file:-}" ] || { echo "claudzilla: no node $NODE_MAJOR build for $os-$arch at $base - install node yourself" >&2; exit 1; }
    tmp="$(mktemp -d)"; curl -fsSL "$base/$file" -o "$tmp/$file"
    got="$( (sha256sum "$tmp/$file" 2>/dev/null || shasum -a 256 "$tmp/$file") | cut -d' ' -f1)"
    [ "$got" = "$sum" ] || { rm -rf "$tmp"; echo "claudzilla: node checksum mismatch" >&2; exit 1; }
    dir="$HOME/.local/share/${file%.tar.gz}"; mkdir -p "$dir" "$HOME/.local/bin"
    tar xzf "$tmp/$file" -C "$dir" --strip-components=1; rm -rf "$tmp"
    ln -sf "$dir/bin/node" "$HOME/.local/bin/node"
    echo "node $(node --version) -> $HOME/.local/bin/node"
  fi
  command -v rtk >/dev/null || curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh
}

plugins() {
  command -v claude >/dev/null || { echo "plugins skipped: install Claude Code, then re-run install.sh" >&2; return 0; }
  local m p
  for m in $(node -e 'for(const m of Object.values(require(process.argv[1]).extraKnownMarketplaces||{}))console.log(m.source.repo||m.source.url)' "$REPO/settings.base.json"); do
    claude plugin marketplace add "$m" >/dev/null 2>&1 && echo "marketplace: $m" || true
  done
  for p in $(node -e 'for(const[k,v]of Object.entries(require(process.argv[1]).enabledPlugins||{}))if(v)console.log(k)' "$REPO/settings.base.json"); do
    claude plugin install "$p" || echo "  ! $p failed - retry: claude plugin install $p" >&2
  done
}

main() {
  mkdir -p "$DEST"
  [ "$OFFLINE" = 1 ] || deps
  command -v node >/dev/null || { echo "claudzilla: node is required" >&2; exit 1; }
  for f in $LINKS; do link "$f"; done
  [ -e "$DEST/CLAUDE.local.md" ] || : > "$DEST/CLAUDE.local.md"
  merge_settings
  [ "$OFFLINE" = 1 ] || plugins
  [ -d "$BACKUP" ] && echo "replaced files backed up -> $BACKUP"
  [ "$OFFLINE" = 1 ] || case ":$ORIG_PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: add ~/.local/bin to PATH (node/rtk live there)" ;; esac
  echo "claudzilla installed -> $DEST (from $REPO)"
}

main "$@"
