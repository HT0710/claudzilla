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
LINKS="CLAUDE.md RTK.md rules themes hud hooks/claudzilla-update.sh hooks/rules-guard.mjs hooks/md-display.pl skills/pr skills/rule-review"

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
# stops shipping get removed. Repeated copies of a base entry collapse.
# settings.overrides.json (machine-local, never in the repo) wins over both.
merge_settings() {
  local dst="$DEST/settings.json" tmp="$DEST/.settings.json.claudzilla" rec="$DEST/.claudzilla-base.json"
  node -e '
const fs=require("fs"),[base,dst,out,over,rec]=process.argv.slice(1);
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
let old=null;try{old=JSON.parse(fs.readFileSync(rec,"utf8"))}catch{}
const b=read(base),d=read(dst);
fs.writeFileSync(out,JSON.stringify(merge(merge(old?prune(d,old,b):d,b),read(over)),null,2)+"\n")' \
    "$REPO/settings.base.json" "$dst" "$tmp" "$DEST/settings.overrides.json" "$rec"
  if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then rm -f "$tmp"
  else
    [ -f "$dst" ] && save settings.json
    mv "$tmp" "$dst"
    echo "settings.json merged"
  fi
  cmp -s "$REPO/settings.base.json" "$rec" || cp "$REPO/settings.base.json" "$rec"
}

# When each rule first reached this machine; rule-review counts a rule only from then on.
# Paths go in env: rules-guard.mjs treats argv[1] as "am I the hook?".
stamp_rules() {
  GUARD="$REPO/claude/hooks/rules-guard.mjs" STAMPS="$DEST/.claudzilla-rules.json" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { DEFAULTS } = await import(pathToFileURL(process.env.GUARD).href);
let s = {};
try { s = JSON.parse(readFileSync(process.env.STAMPS, "utf8")); } catch { /* first run */ }
if (!s || typeof s !== "object" || Array.isArray(s)) s = {};
const now = new Date().toISOString(), fresh = Object.keys(DEFAULTS.rules).filter((id) => typeof s[id] !== "string");
for (const id of fresh) s[id] = now;
if (fresh.length) writeFileSync(process.env.STAMPS, `${JSON.stringify(s, null, 2)}\n`);' </dev/null
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
  claude plugin marketplace update >/dev/null 2>&1 || true
  # install skips plugins already present; update moves them to the latest version.
  for p in $(node -e 'for(const[k,v]of Object.entries(require(process.argv[1]).enabledPlugins||{}))if(v)console.log(k)' "$REPO/settings.base.json"); do
    claude plugin install "$p" && claude plugin update "$p" >/dev/null || echo "  ! $p failed - retry: claude plugin install $p && claude plugin update $p" >&2
  done
}

# Claude Code picks colour depth before settings.json env applies, and WSL
# terminals don't export COLORTERM - so the theme falls back to 256 colours.
truecolor() {
  [ -n "${WSL_DISTRO_NAME:-}" ] || return 0
  local rc; for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$rc" ] && ! grep -q COLORTERM "$rc" || continue
    if [ -w "$rc" ]; then
      [ -z "$(tail -c1 "$rc")" ] || echo >> "$rc"
      echo 'export COLORTERM=truecolor' >> "$rc"; echo "COLORTERM=truecolor -> $rc (open a new shell)"
    else echo "claudzilla: $rc is read-only - add 'export COLORTERM=truecolor' yourself" >&2; fi
  done
}

# MesloLGS NF draws every glyph the HUD uses except U+2387 (font fallback covers it).
# Pinned to a commit, each file sha256-checked.
FONT_URL="${CLAUDZILLA_FONT_URL:-https://raw.githubusercontent.com/romkatv/powerlevel10k-media/145eb9fbc2f42ee408dacd9b22d8e6e0e553f83d}"
FONT_FACE="MesloLGS NF"

font() {
  local dir sum style f tmp got new=0 ans="${CLAUDZILLA_FONT:-}" basic="$DEST/.claudzilla-basic-glyphs"
  case "$(uname -s)" in Darwin) dir="$HOME/Library/Fonts" ;; *) dir="$HOME/.local/share/fonts" ;; esac
  # Ask once: a "no" is remembered by the marker, which also switches the HUD to basic symbols.
  [ -z "$ans" ] && [ -e "$basic" ] && return 0
  if [ -z "$ans" ] && [ ! -f "$dir/$FONT_FACE Regular.ttf" ]; then
    if ! { : </dev/tty; } 2>/dev/null; then   # no terminal, e.g. Claude ran the install: let Claude ask in a dialog
      echo "font: $FONT_FACE not installed - no terminal to ask. Claude: ask the user with AskUserQuestion (install the recommended font, or use basic statusline symbols), then run: CLAUDZILLA_FONT=yes $REPO/install.sh (or CLAUDZILLA_FONT=no)"
      return 0
    fi
    printf 'claudzilla: install font %s so the statusline draws its symbols (recommended)? [Y/n] ' "$FONT_FACE"
    read -r ans </dev/tty || true; ans="${ans:-y}"
  fi
  case "$ans" in [nN]*|0|false|off)
    : > "$basic"; echo "font: skipped - statusline uses basic symbols (re-run with CLAUDZILLA_FONT=yes to install)"; return 0 ;;
  esac
  rm -f "$basic"
  mkdir -p "$dir" || { echo "font: cannot create $dir" >&2; return 0; }
  while IFS='|' read -r sum style; do
    f="$dir/$FONT_FACE $style.ttf"
    [ -f "$f" ] && continue
    tmp="$(mktemp "$dir/.font.XXXXXX")"   # same filesystem: mv is atomic
    if ! curl -fsSL "$FONT_URL/${FONT_FACE// /%20}%20${style// /%20}.ttf" -o "$tmp" 2>/dev/null; then
      rm -f "$tmp"; echo "font: download failed - $FONT_FACE not in $dir" >&2; return 0
    fi
    got="$( (sha256sum "$tmp" 2>/dev/null || shasum -a 256 "$tmp") | cut -d' ' -f1)" || true
    if [ "$got" != "$sum" ]; then rm -f "$tmp"; echo "font: $FONT_FACE $style checksum mismatch - skipped" >&2; return 0; fi
    mv "$tmp" "$f" || { rm -f "$tmp"; echo "font: cannot write $f" >&2; return 0; }; new=1
  done <<'EOF'
d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d|Regular
b6c0199cf7c7483c8343ea020658925e6de0aeb318b89908152fcb4d19226003|Bold
6f357bcbe2597704e157a915625928bca38364a89c22a4ac36e7a116dcd392ef|Italic
56b4131adecec052c4b324efb818dd326d586dbc316fc68f98f1cae2eb8d1220|Bold Italic
EOF
  [ "$new" = 0 ] || ! command -v fc-cache >/dev/null || fc-cache -f "$dir" >/dev/null 2>&1 || true
  if [ -n "${WSL_DISTRO_NAME:-}" ]; then font_windows "$dir"
  elif [ "$new" = 1 ]; then echo "font: $FONT_FACE -> $dir - set it as your terminal font where the terminal runs"; fi
}

# WSL: Windows draws the terminal, so the font goes on the Windows side too (per user, no admin).
font_windows() {  # $1: dir holding the .ttf files
  local la win f n wt set=0 copied=0
  la="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')" && [ -n "$la" ] && la="$(wslpath -u "$la")" && [ -d "$la" ] ||
    { echo "font: Windows not reachable - install $FONT_FACE on Windows and set it as your terminal font" >&2; return 0; }
  win="$la/Microsoft/Windows/Fonts"; mkdir -p "$win" || { echo "font: cannot create $win" >&2; return 0; }
  for f in "$1/$FONT_FACE"*.ttf; do
    n="$(basename "$f")"
    # reg add is idempotent: re-run repairs an earlier failed registration
    { [ -f "$win/$n" ] || { cp "$f" "$win/" && copied=1; }; } && reg.exe add 'HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts' /v "${n%.ttf} (TrueType)" /t REG_SZ /d "$(wslpath -w "$win/$n")" /f >/dev/null 2>&1 ||
      echo "font: could not register $n on Windows" >&2
  done
  # Windows Terminal: set the default face only when the user hasn't picked one. Exit 0 set, 3 already ours, else leave alone.
  for wt in "$la"/Packages/Microsoft.WindowsTerminal*_8wekyb3d8bbwe/LocalState/settings.json "$la/Microsoft/Windows Terminal/settings.json"; do
    [ -f "$wt" ] || continue
    if node -e '
const fs=require("fs"),path=require("path"),[p,bak,face]=process.argv.slice(1);
let j;try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch{process.exit(2)}
const pr=j.profiles??={};if(typeof pr!="object"||Array.isArray(pr))process.exit(2);
const d=pr.defaults??={},cur=d.font?.face??d.fontFace;
if(cur)process.exit(cur===face?3:2);
try{fs.mkdirSync(path.dirname(bak),{recursive:true});fs.copyFileSync(p,bak);
(d.font??={}).face=face;fs.writeFileSync(p,JSON.stringify(j,null,4)+"\n")}catch{process.exit(2)}' "$wt" "$BACKUP/windows-terminal/${wt#"$la"/}" "$FONT_FACE"
    then set=1; echo "font: Windows Terminal font -> $FONT_FACE (restart it; sign out and in if the font is missing)"
    elif [ $? = 3 ]; then set=1; fi
  done
  [ "$set" = 1 ] || [ "$copied" = 0 ] || echo "font: set your terminal font to $FONT_FACE"
}

main() {
  mkdir -p "$DEST"
  [ "$OFFLINE" = 1 ] || deps
  command -v node >/dev/null || { echo "claudzilla: node is required" >&2; exit 1; }
  for f in $LINKS; do link "$f"; done
  [ -e "$DEST/CLAUDE.local.md" ] || : > "$DEST/CLAUDE.local.md"
  merge_settings
  truecolor
  font
  stamp_rules || echo "claudzilla: rule dates not saved - /rule-review skips undated rules until the next install" >&2
  [ "$OFFLINE" = 1 ] || plugins
  [ -d "$BACKUP" ] && echo "replaced files backed up -> $BACKUP"
  [ "$OFFLINE" = 1 ] || case ":$ORIG_PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: add ~/.local/bin to PATH (node/rtk live there)" ;; esac
  echo "claudzilla installed -> $DEST (from $REPO)"
}

main "$@"
