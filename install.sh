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
merge_settings() {  # $1: base to apply
  local base="$1" dst="$DEST/settings.json" tmp="$DEST/.settings.json.claudzilla" rec="$DEST/.claudzilla-base.json"
  node -e '
const fs=require("fs"),[base,dst,out,over,rec,ids]=process.argv.slice(1);
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
// v1.5 plugin ids: Claude Code moves their settings only while the old id is enabled, and the prune below drops it first
for(const o of [d.enabledPlugins,d.pluginConfigs])if(isObj(o))for(const r of ids.split(" ")){const[a,n]=r.split(":").map(x=>x+"@claudzilla");
  if(a in o){if(!(n in o))o[n]=o[a];delete o[a]}}
fs.writeFileSync(out,JSON.stringify(merge(merge(old?prune(d,old,b):d,b),read(over)),null,2)+"\n")' \
    "$base" "$dst" "$tmp" "$DEST/settings.overrides.json" "$rec" "$OLD_IDS"
  if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then rm -f "$tmp"
  else
    [ -f "$dst" ] && save settings.json
    mv "$tmp" "$dst"
    echo "settings.json merged"
  fi
  cmp -s "$base" "$rec" || cp "$base" "$rec"
}

# Run before any link is touched: merge_settings throws on a settings file it cannot parse.
check_settings() {
  local f
  f=$(node -e '
const fs=require("fs");for(const f of process.argv.slice(1))if(fs.existsSync(f))try{JSON.parse(fs.readFileSync(f,"utf8"))}catch{console.log(f);process.exit(1)}' \
    "$DEST/settings.json" "$DEST/settings.overrides.json") ||
    { echo "claudzilla: $f is not valid JSON - fix or remove it, then re-run" >&2; exit 1; }
}

# parts.json maps every link, setting and hook to a part; primer ships always.
ALL_PARTS=""
all_parts() { node -p 'Object.keys(require(process.argv[1])).filter(p=>p!="primer").join(" ")' "$REPO/parts.json"; }

part_links() {  # $@: parts; prints their links plus the primer's
  node -p 'const m=require(process.argv[1]);[...process.argv.slice(2),"primer"].flatMap(p=>m[p].links||[]).join(" ")' "$REPO/parts.json" "$@"
}

# shortcut: maps pre-v1.6 part and plugin names; the updater can jump any older version to the newest tag
# (claudzilla-update.sh:20), so keep until a major version requires updating through v1.6+.
RENAMED="dividers:folio panel:margin picks:ballot toast:herald attribution:byline updater:primer"
OLD_IDS="response-dividers:folio panel:margin picks:ballot guide:primer update-toast:herald attribution:byline"
renamed() { local r; for r in $RENAMED; do [ "${r%%:*}" != "$1" ] || { echo "${r#*:}"; return 0; }; done; echo "$1"; }

# Old names in a saved choice would be dropped, or fail an only-list; never fatal: the update merged already.
migrate_choice() {
  node -e '
const fs=require("fs"),[f,ren]=process.argv.slice(1),R=new Map(ren.split(" ").map(r=>r.split(":")));
let j;try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{process.exit(0)}
const ins=j&&typeof j=="object"&&!Array.isArray(j)?j.install:null;let hit=0;
for(const k of ["only","skip"])if(Array.isArray(ins?.[k]))ins[k]=ins[k].map(p=>R.has(p)?(hit=1,R.get(p)):p);
if(hit){fs.writeFileSync(f+".claudzilla",JSON.stringify(j,null,2)+"\n");fs.renameSync(f+".claudzilla",f)}' "$DEST/claudzilla.json" "$RENAMED" 2>/dev/null || true
}

# Prints the base to apply for the picked parts: the repo file itself when all are picked.
base_for() {
  local out="$DEST/.settings.base.claudzilla" p
  for p in $ALL_PARTS; do case " $* " in *" $p "*) ;; *) p=; break ;; esac; done
  [ -z "$p" ] || { echo "$REPO/settings.base.json"; return 0; }
  node -e '
const fs=require("fs"),[man,basef,out,...picked]=process.argv.slice(1);
const m=JSON.parse(fs.readFileSync(man,"utf8")),b=JSON.parse(fs.readFileSync(basef,"utf8"));
const on=new Set([...picked,"primer"]),off=Object.keys(m).filter(p=>!on.has(p));
const claimed=new Set(Object.values(m).flatMap(p=>p.keys||[])),box=["env","extraKnownMarketplaces","enabledPlugins","hooks"];
const del=path=>{const s=path.split(".");let o=b;for(const k of s.slice(0,-1)){o=o?.[k]}if(o)delete o[s.at(-1)]};
for(const p of off){for(const k of m[p].keys||[])del(k);for(const k of m[p].plugins||[])del("enabledPlugins."+k);
  for(const ev in b.hooks||{})b.hooks[ev]=b.hooks[ev].filter(e=>!e.hooks.some(h=>(m[p].hooks||[]).some(s=>h.command.includes(s))))}
if(!on.has("core"))for(const k in b)if(!claimed.has(k)&&!box.includes(k))delete b[k];
for(const ev in b.hooks||{})if(!b.hooks[ev].length)delete b.hooks[ev];
for(const k of box)if(b[k]&&!Object.keys(b[k]).length)delete b[k];
fs.writeFileSync(out,JSON.stringify(b,null,2)+"\n")' "$REPO/parts.json" "$REPO/settings.base.json" "$out" "$@"
  echo "$out"
}

# Flags set these; resolve_parts turns them into PICKED. CHOSEN = this run changed the choice.
TTY="${CLAUDZILLA_TTY:-/dev/tty}"
has_tty() { { : <"$TTY"; } 2>/dev/null; }
MODE=install YES=0 ADD="" REMOVE="" CUSTOM=0 FULL=0 PICKED="" FORM=skip CHOSEN=0 FONT_NEW=0

parse_args() {
  local a list p
  while [ $# -gt 0 ]; do
    a=$1; shift
    case $a in
      --full) FULL=1 ;; --custom) CUSTOM=1 ;; --yes) YES=1 ;; --uninstall) MODE=uninstall ;;
      --add|--remove)
        [ $# -gt 0 ] || { echo "claudzilla: $a needs a part list - parts: $ALL_PARTS" >&2; exit 1; }
        list=""; for p in ${1//,/ }; do list="${list:+$list }$(renamed "$p")"; done; shift
        for p in $list; do case " $ALL_PARTS " in *" $p "*) ;; *) echo "claudzilla: unknown part '$p' - parts: $ALL_PARTS" >&2; exit 1 ;; esac; done
        if [ "$a" = --add ]; then ADD="${ADD:+$ADD }$list"; else REMOVE="${REMOVE:+$REMOVE }$list"; fi ;;
      *) echo "claudzilla: unknown flag '$a' - flags: --full --custom --add --remove --uninstall --yes" >&2; exit 1 ;;
    esac
  done
}

# Saved choice (claudzilla.json "install": {"skip":[..]} or {"only":[..]}; none = Full), then the flags.
resolve_parts() {
  local out fresh=0
  [ -f "$DEST/.claudzilla-base.json" ] || fresh=1
  out=$(node -e '
const fs=require("fs"),[cfg,all,fresh,full,add,rem]=process.argv.slice(1),A=all.split(" "),W=s=>s.split(" ").filter(Boolean);
let ins;try{ins=JSON.parse(fs.readFileSync(cfg,"utf8")).install}catch{}
const L=v=>Array.isArray(v)?v.filter(p=>A.includes(p)):[];
for(const k of ["only","skip"])if(ins&&typeof ins=="object"&&k in ins&&!Array.isArray(ins[k]))process.exit(2);
if(ins?.only?.length&&!L(ins.only).length)process.exit(2);
let form=ins?.only?"only":"skip",pick=ins?.only?L(ins.only):ins?.skip?A.filter(p=>!L(ins.skip).includes(p)):A;
if(full==="1"){pick=A;form="skip"}
else if(fresh==="1"&&!ins&&add){pick=[];form="only"}
const set=new Set(pick);for(const p of W(add))set.add(p);for(const p of W(rem))set.delete(p);
console.log(form+" "+A.filter(p=>set.has(p)).join(" "))' "$DEST/claudzilla.json" "$ALL_PARTS" "$fresh" "$FULL" "$ADD" "$REMOVE") ||
    { echo "claudzilla: saved choice names no known part - fix \"install\" in $DEST/claudzilla.json or run --full" >&2; exit 1; }
  read -r FORM PICKED <<<"$out"
  if [ "$FULL" = 1 ] || [ -n "$ADD$REMOVE" ]; then CHOSEN=1; save_choice; fi
}

save_choice() {  # PICKED + FORM -> "install" key; every part picked clears it; other keys stay
  local f="$DEST/claudzilla.json" tmp="$DEST/.claudzilla.json.claudzilla" rc=0
  node -e '
const fs=require("fs"),[f,out,all,picked,form]=process.argv.slice(1),A=all.split(" "),P=picked.split(" ").filter(Boolean);
let j={};if(fs.existsSync(f))try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{process.exit(2)}
if(!j||typeof j!="object"||Array.isArray(j))process.exit(2);
const before=JSON.stringify(j);
if(A.every(p=>P.includes(p)))delete j.install;
else j.install=form==="only"?{only:P}:{skip:A.filter(p=>!P.includes(p))};
if(JSON.stringify(j)===before)process.exit(3);
fs.writeFileSync(out,JSON.stringify(j,null,2)+"\n")' "$f" "$tmp" "$ALL_PARTS" "$PICKED" "$FORM" || rc=$?
  case $rc in
    0) mv "$tmp" "$f" ;;
    3) ;;
    *) echo "claudzilla: $f is not a JSON object - fix or remove it, then re-run" >&2; exit 1 ;;
  esac
}

unlink_part() {  # $1: part; drops its links only while they still point into this repo
  local f
  for f in $(node -p '(require(process.argv[1])[process.argv[2]].links||[]).join(" ")' "$REPO/parts.json" "$1"); do
    case "$(readlink "$DEST/$f" 2>/dev/null || true)" in "$REPO/claude/"*) rm -f "$DEST/$f" ;; esac
  done
}

# Claude's Bash tool has no terminal: print what Claude should ask, change nothing.
claude_stop() {
  cat <<EOF
claudzilla: no terminal to ask which parts to install.
Claude: ask the user with AskUserQuestion: "Full (recommended)" or "Custom".
  Full: run $REPO/install.sh --full
  Custom: one AskUserQuestion call with three multiSelect questions, ticked = install:
    Screen: hud margin ballot
    Replies: caveman ponytail folio
    Background: rtk herald byline ledger
  Then run $REPO/install.sh --full --remove <unticked parts, comma-separated> (all ticked: --full).
core (rules, hooks, settings) is always installed.
Parts:
  hud - statusline
  margin - side panel
  ballot - suggested next steps
  caveman - terse replies
  ponytail - smallest-change coding
  folio - response dividers
  rtk - token-saving command filter
  herald - update and usage notices
  byline - commit credit
  ledger - pause edits another session made
EOF
  exit 2
}

# Full (default) or Custom; Custom is Full minus the unticked parts (skip form).
menu() {
  local g p n=0 ans on="" mode=1
  [ "$CUSTOM" = 1 ] && mode=2
  exec 3<"$TTY"   # one open: a file stand-in must not rewind between prompts
  for p in $PICKED; do on="$on $p "; done
  if [ "$mode" = 1 ]; then
    printf 'claudzilla: install\n  1) Full (recommended)\n  2) Custom\n> '
    read -r ans <&3 || true; [ "${ans:-1}" = 2 ] && mode=2
  fi
  if [ "$mode" = 2 ]; then
    for g in "Screen:hud margin ballot" "Replies:caveman ponytail folio" "Background:rtk herald byline ledger"; do
      echo "${g%%:*}"
      for p in ${g#*:}; do n=$((n+1)); case "$on" in *" $p "*) echo "  $n) [x] $p" ;; *) echo "  $n) [ ] $p" ;; esac; done
    done
    printf 'numbers to toggle, space separated (Enter keeps these): '
    read -r ans <&3 || true
    n=0
    for p in hud margin ballot caveman ponytail folio rtk herald byline ledger; do
      n=$((n+1)); case " $ans " in *" $n "*) case "$on" in *" $p "*) on="${on/ $p / }" ;; *) on="$on $p " ;; esac ;; esac
    done
  else on=" $ALL_PARTS "; fi
  PICKED=core; for p in $ALL_PARTS; do [ "$p" = core ] || case "$on" in *" $p "*) PICKED="$PICKED $p" ;; esac; done
  exec 3<&-
  FORM=skip CHOSEN=1; save_choice
}

picked() { case " $PICKED " in *" $1 "*) ;; *) return 1 ;; esac; }

# alt+o/h/l/g open the margin tabs, alt+k focuses the band (the ballot card),
# alt+q toggles the guide. Each is left alone if the user chose: the key under
# any alias in Chat or Global (null unbinds), the action on another key, or a
# symlink (a dotfiles tool owns it).
keybindings() {
  local dst="$DEST/keybindings.json" tmp="$DEST/.keybindings.json.claudzilla" rc=0 added verb
  added=$(node -e '
const fs=require("fs"),[dst,out,picked]=process.argv.slice(1),has=p=>picked.split(" ").includes(p);
const isObj=v=>v&&typeof v=="object"&&!Array.isArray(v);
let j={bindings:[]};
if(fs.existsSync(dst))try{j=JSON.parse(fs.readFileSync(dst,"utf8"))}catch{process.exit(2)}
if(!isObj(j)||!Array.isArray(j.bindings)||!j.bindings.every(b=>isObj(b)&&isObj(b.bindings)))process.exit(2);
const chat=j.bindings.filter(b=>b.context==="Chat");
const keys=[["o","command:margin-overview","margin"],["h","command:margin-history","margin"],["l","command:margin-file","margin"],["g","command:margin-git","margin"],["k","abovePrompt:focus","ballot"],["q","command:claudzilla","primer"]],msg=[];
for(const b of j.bindings)if(["Chat","Global"].includes(b.context))for(const x in b.bindings)if(b.bindings[x]==="command:panel"){b.bindings[x]="command:margin";msg.push(`${x} -> command:margin`)}
const A=b=>b.bindings;for(const b of chat){if(A(b)["alt+h"]==="command:margin"){A(b)["alt+h"]="command:margin-history";msg.push("alt+h -> command:margin-history")}
  // alt+q judged by key only: the action-on-another-key rule would always hold while alt+g keeps the guide
  if(A(b)["alt+g"]==="command:claudzilla"&&(!has("primer")||!j.bindings.some(c=>["Chat","Global"].includes(c.context)&&Object.keys(c.bindings).some(x=>/^(alt|opt|option|meta)\+q$/i.test(x))))){delete A(b)["alt+g"];msg.push(has("primer")?"alt+g -> alt+q":"alt+g removed")}}
for(const[k,a,p]of keys)if(!has(p))for(const b of chat)if(b.bindings[`alt+${k}`]===a){delete b.bindings[`alt+${k}`];msg.push(`alt+${k} removed`)}
j.bindings=j.bindings.filter(b=>b.context!=="Chat"||Object.keys(b.bindings).length||!msg.length);
const own=(k,a)=>j.bindings.some(b=>(["Chat","Global"].includes(b.context)&&Object.keys(b.bindings).some(x=>new RegExp(`^(alt|opt|option|meta)\\+${k}$`,"i").test(x)))||Object.values(b.bindings).includes(a));
const add=keys.filter(([k,a,p])=>has(p)&&!own(k,a));
if(!add.length&&!msg.length)process.exit(3);
if(add.length){let c=j.bindings.find(b=>b.context==="Chat");if(!c)j.bindings.push(c={context:"Chat",bindings:{}});
  for(const[k,a]of add){c.bindings[`alt+${k}`]=a;msg.push(`alt+${k} -> ${a}`)}}
fs.writeFileSync(out,JSON.stringify(j,null,2)+"\n");
console.log(msg.join(", "))' "$dst" "$tmp" "$PICKED") || rc=$?
  case $rc in
    0) if [ -L "$dst" ]; then rm -f "$tmp"; verb=add; case "$added" in *"->"*) ;; *) verb=remove ;; esac
         if grep -qE 'command:panel|"command:margin"|"alt\+g": *"command:claudzilla"' "$dst"; then echo "claudzilla: $dst is a symlink - move alt+h to command:margin-history and /claudzilla to alt+q yourself (see CONFIGURATION.md)" >&2
         else echo "claudzilla: $dst is a symlink - $verb alt+o/h/l/g (margin tabs), alt+k (card focus) and alt+q (/claudzilla) yourself (see CONFIGURATION.md)" >&2; fi
       else [ -f "$dst" ] && save keybindings.json
         mv "$tmp" "$dst"; echo "keybindings: $added"; fi ;;
    3) ;;
    *) rm -f "$tmp"; echo "claudzilla: $dst unreadable - add alt+o/h/l/g (margin tabs), alt+k (card focus) and alt+q (/claudzilla) yourself (see CONFIGURATION.md)" >&2 ;;
  esac
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

# node runs the statusline + this script's JSON merge; rtk (deps_rtk) backs the Bash hook.
# No sudo: official node build (SHA-256 checked) into ~/.local.
NODE_NEW_DIR="" NODE_NEW_LINK=""
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
    dir="$HOME/.local/share/${file%.tar.gz}"
    # Only what did not exist is ours; main records these once $DEST is validated and created.
    [ -e "$dir" ] || NODE_NEW_DIR="$dir"; [ -e "$HOME/.local/bin/node" ] || [ -L "$HOME/.local/bin/node" ] || NODE_NEW_LINK="$HOME/.local/bin/node"
    mkdir -p "$dir" "$HOME/.local/bin"
    tar xzf "$tmp/$file" -C "$dir" --strip-components=1; rm -rf "$tmp"
    ln -sf "$dir/bin/node" "$HOME/.local/bin/node"
    echo "node $(node --version) -> $HOME/.local/bin/node"
  fi
}

# After flag validation: a bad flag must not reach the network.
deps_rtk() {
  command -v rtk >/dev/null && return 0
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh
  ! command -v rtk >/dev/null || record_or_warn files "$(command -v rtk)"
}

# What claudzilla itself added, for --uninstall to undo. rcLines value is file|line.
# winFonts value is file|registry value name.
record() {  # $1: kind, $2: value, $3: "del" removes it; adds skip duplicates
  local f="$DEST/.claudzilla-installed.json"
  node -e '
const fs=require("fs"),[f,kind,val,del]=process.argv.slice(1);
const r={files:[],rcLines:[],plugins:[],marketplaces:[],winFonts:[],wtFont:[],seeds:[]};
if(fs.existsSync(f))Object.assign(r,JSON.parse(fs.readFileSync(f,"utf8")));
if(!Array.isArray(r[kind]))process.exit(1);
const v=kind=="rcLines"?(([file,...l])=>({file,line:l.join("|")}))(val.split("|")):kind=="winFonts"?(([file,...l])=>({file,reg:l.join("|")}))(val.split("|")):val;
const same=x=>JSON.stringify(x)==JSON.stringify(v);
if(del)r[kind]=r[kind].filter(x=>!same(x));else if(!r[kind].some(same))r[kind].push(v);
fs.writeFileSync(f+".tmp",JSON.stringify(r,null,2)+"\n")' "$f" "$1" "$2" "${3:-}" && mv "$f.tmp" "$f"
}

# A bad record must not abort the install.
record_or_warn() { record "$@" || echo "claudzilla: could not update the install record" >&2; }

# ponytail's band and its CSV ledger start off, once: the "ponytail" seed marks it done, so a later
# `/ponytail band on` (deletes the flag) or `ledger` in /config stays the user's choice.
ponytail_defaults() {
  local f="$DEST/.ponytail-band" s="$DEST/settings.json"
  node -e 'process.exit(require(process.argv[1]).seeds?.includes("ponytail")?0:1)' "$DEST/.claudzilla-installed.json" 2>/dev/null && return 0
  node -e '
const fs=require("fs"),f=process.argv[1],j=JSON.parse(fs.readFileSync(f,"utf8"));
const o=((j.pluginConfigs??={})["ponytail@ponytail"]??={}).options??={};
if(!("ledger" in o)){o.ledger=false;fs.writeFileSync(f+".claudzilla",JSON.stringify(j,null,2)+"\n");fs.renameSync(f+".claudzilla",f)}' "$s" 2>/dev/null &&
    record seeds ponytail || return 1
  # Only after the seed is recorded: an unrecordable seed must not re-hide the band on every run.
  [ -e "$f" ] || printf off > "$f"
}

# Third-party plugins/marketplaces are recorded only when absent before this run; claudzilla's own never are,
# nor is claude-plugins-official (the user's other official plugins live there).
# Unpicked plugins are uninstalled, not disabled: install skips present plugins, so a disabled one would never come back enabled.
plugins() {
  command -v claude >/dev/null || { echo "plugins skipped: install Claude Code, then re-run install.sh" >&2; return 0; }
  local ids='try{for(const p of JSON.parse(require("fs").readFileSync(0,"utf8")))console.log(p.id||p.name)}catch{process.exit(1)}'
  local have_p have_m plan k a b o ours=0 trust=1
  # A list we cannot read must not make everything look new: record nothing, still install.
  have_p=$(claude plugin list --json </dev/null 2>/dev/null | node -e "$ids" 2>/dev/null) || trust=0
  have_m=$(claude plugin marketplace list --json </dev/null 2>/dev/null | node -e "$ids" 2>/dev/null) || trust=0
  [ "$trust" = 1 ] || echo "claudzilla: cannot read claude's plugin lists - installing, but not recording plugins as ours" >&2
  plan=$(node -e '
const m=require(process.argv[1]),b=require(process.argv[2]),on=new Set([...process.argv.slice(3),"primer"]),seen=new Set();
for(const[p,v]of Object.entries(m))for(const id of v.plugins||[]){
  if(!on.has(p)){console.log("D",id);continue}
  console.log("P",id);const n=id.split("@")[1],s=(b.extraKnownMarketplaces||{})[n]?.source;
  if(n!="claudzilla"&&s&&!seen.has(n)){seen.add(n);console.log("M",n,(s.repo||s.url)+(s.ref?"#"+s.ref:""))}}' "$REPO/parts.json" "$REPO/settings.base.json" $PICKED)
  while read -r k a b; do case $k in
    M) case $'\n'"$have_m"$'\n' in *$'\n'"$a"$'\n'*) ;; *)
         if claude plugin marketplace add "$b" >/dev/null 2>&1 </dev/null; then echo "marketplace: $b"; [ "$trust" = 0 ] || [ "$a" = claude-plugins-official ] || record_or_warn marketplaces "$a"
         else echo "  ! $b failed - retry: claude plugin marketplace add $b" >&2; fi ;; esac ;;
    P) case $a in *@claudzilla) ours=1 ;; esac ;;
  esac; done <<<"$plan"
  # claudzilla's own plugins load in place from this clone, so a pull updates them; no version bump.
  if [ "$ours" = 1 ]; then claude plugin marketplace add "$REPO" >/dev/null 2>&1 </dev/null && echo "marketplace: $REPO" || true; fi
  claude plugin marketplace update >/dev/null 2>&1 </dev/null || true
  local failed=
  while read -r k a b; do case $k in
    P) case $'\n'"$have_p"$'\n' in *$'\n'"$a"$'\n'*) had=1 ;; *) had=0 ;; esac
       # install skips plugins already present; update moves them to the version the marketplace offers (the `ref` tag when pinned).
       if claude plugin install "$a" </dev/null && claude plugin update "$a" >/dev/null </dev/null; then
         [ "$had" = 1 ] || [ "$trust" = 0 ] || case $a in *@claudzilla) ;; *) record_or_warn plugins "$a" ;; esac
       else failed="$failed $a"; echo "  ! $a failed - retry: claude plugin install $a && claude plugin update $a" >&2; fi ;;
    D) case $a in
         *@claudzilla) case $'\n'"$have_p"$'\n' in *$'\n'"$a"$'\n'*) claude plugin uninstall "$a" >/dev/null 2>&1 </dev/null || true ;; esac ;;
         *) node -e 'process.exit((require(process.argv[1]).plugins||[]).includes(process.argv[2])?0:1)' "$DEST/.claudzilla-installed.json" "$a" 2>/dev/null \
              && { ! claude plugin uninstall "$a" >/dev/null 2>&1 </dev/null || record_or_warn plugins "$a" del; } ;;
       esac ;;
  esac; done <<<"$plan"
  # a failed new id leaves the old record as the only copy (it still loads via `renames`)
  for o in $OLD_IDS; do n="${o#*:}@claudzilla"; o="${o%%:*}@claudzilla"
    case " $failed " in *" $n "*) continue ;; esac
    case $'\n'"$have_p"$'\n' in *$'\n'"$o"$'\n'*) claude plugin uninstall "$o" >/dev/null 2>&1 </dev/null || true ;; esac
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
      record_or_warn rcLines "$rc|export COLORTERM=truecolor"
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
    # Installed another way (distro package, Nerd Fonts release, brew): nothing to do.
    # Not on WSL: there the font must still reach Windows, which draws the terminal.
    if [ -z "${WSL_DISTRO_NAME:-}" ]; then
      case "$(fc-list : family 2>/dev/null)" in *'MesloLGS N'*) return 0 ;; esac
      for f in "$dir"/MesloLGS{\ NF,NerdFont}* /Library/Fonts/MesloLGS{\ NF,NerdFont}*; do [ -e "$f" ] && return 0; done
    fi
    if [ "$FONT_NEW" = 1 ]; then ans=yes   # HUD newly chosen this run = the "y" answer, after the guard above
    elif ! has_tty; then   # no terminal, e.g. Claude ran the install: let Claude ask in a dialog
      echo "font: $FONT_FACE not installed - no terminal to ask. Claude: ask the user with AskUserQuestion (install the recommended font, or use basic statusline symbols), then run: CLAUDZILLA_FONT=yes $REPO/install.sh (or CLAUDZILLA_FONT=no)"
      return 0
    fi
    printf 'claudzilla: install font %s so the statusline draws its symbols (recommended)? [Y/n] ' "$FONT_FACE"
    read -r ans <"$TTY" || true; ans="${ans:-y}"
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
    record_or_warn files "$f"
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
    { [ -f "$win/$n" ] || { cp "$f" "$win/" && copied=1 && record_or_warn winFonts "$win/$n|${n%.ttf} (TrueType)"; }; } && reg.exe add 'HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts' /v "${n%.ttf} (TrueType)" /t REG_SZ /d "$(wslpath -w "$win/$n")" /f >/dev/null 2>&1 ||
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
    then set=1; record_or_warn wtFont "$wt"; echo "font: Windows Terminal font -> $FONT_FACE (restart it; sign out and in if the font is missing)"
    elif [ $? = 3 ]; then set=1; fi
  done
  [ "$set" = 1 ] || [ "$copied" = 0 ] || echo "font: set your terminal font to $FONT_FACE"
}

# Removes what the record lists, one entry at a time; exit 1 if any entry was malformed.
# Prints "R <reg value>" per Windows font file deleted, "N <path>" per path refused (never a command),
# "C <text>" per manual step. files and rcLines must resolve under $HOME; Windows paths sit outside it,
# so those need an absolute path, the expected name and a parent dir named Fonts / a settings.json.
undo_record() {
  node -e '
const fs=require("fs"),path=require("path"),[rec,home]=process.argv.slice(1);
const warn=m=>console.error("claudzilla: "+m);let bad=0;
let r;try{r=JSON.parse(fs.readFileSync(rec,"utf8"));if(!r||typeof r!="object"||Array.isArray(r))throw 0}catch{warn("install record unreadable");process.exit(1)}
const homeOk=typeof home=="string"&&home!==""&&home!=="/";
if(!homeOk)warn("HOME is empty or / - refusing every deletion");
const A=k=>Array.isArray(r[k])?r[k]:[],abs=p=>typeof p=="string"&&path.isAbsolute(p),inHome=p=>homeOk&&abs(p)&&path.resolve(p).startsWith(home+"/");
const each=(k,fn)=>{for(const e of A(k))try{fn(e)}catch{bad=1;warn("bad "+k+" entry in the install record - skipped")}};
const refuse=(f,why)=>{console.log("N\t"+f);warn("refused "+f+" ("+why+") - not touched")};
each("files",f=>{if(typeof f!="string")throw 0;
  if(!inHome(f))return refuse(f,"outside "+home);
  try{fs.rmSync(path.resolve(f),{recursive:true,force:true})}catch{console.log("N\t"+f);warn("cannot remove "+f)}});
each("rcLines",({file,line})=>{if(!abs(file)||typeof line!="string")throw 0;
  const hint="remove the line \x27"+line+"\x27 from "+file;
  if(!inHome(file)){console.log("C\t"+hint);warn("refused to edit "+file+" (outside "+home+")");return}
  try{const t=fs.readFileSync(file,"utf8").split("\n"),i=t.lastIndexOf(line);if(i>=0){t.splice(i,1);fs.writeFileSync(file,t.join("\n"))}}
  catch{console.log("C\t"+hint);warn("cannot edit "+file)}});
const okWin=(f,name)=>homeOk&&abs(f)&&name.test(path.basename(f));
each("winFonts",({file,reg})=>{if(typeof reg!="string"||!abs(file))throw 0;
  if(!okWin(file,/^MesloLGS NF .*\.ttf$/)||path.basename(path.dirname(file))!=="Fonts")return refuse(file,"not a MesloLGS NF file in a Fonts folder");
  try{fs.rmSync(file,{force:true});console.log("R\t"+reg)}catch{console.log("C\tdelete "+file+" yourself");warn("cannot remove "+file)}});
each("wtFont",f=>{if(!abs(f))throw 0;
  if(!okWin(f,/^settings\.json$/))return refuse(f,"not a settings.json");
  try{const j=JSON.parse(fs.readFileSync(f,"utf8")),d=j.profiles?.defaults;
    if(d?.font?.face==="MesloLGS NF"){delete d.font.face;if(!Object.keys(d.font).length)delete d.font;fs.writeFileSync(f,JSON.stringify(j,null,4)+"\n")}}
  catch{console.log("C\tset the terminal font yourself in "+f);warn("cannot edit "+f)}});
process.exit(bad)' "$DEST/.claudzilla-installed.json" "$HOME"
}

# What --uninstall deletes outside $DEST, from the record; shown before the confirm.
record_summary() {
  node -e '
const fs=require("fs");let r;try{r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch{process.exit(0)}
const A=k=>Array.isArray(r&&r[k])?r[k]:[],o=[];
for(const f of A("files"))o.push("  "+f+(/\/node-v[^\/]*$/.test(String(f))?" (node dir: includes globally installed npm packages)":""));
for(const e of A("rcLines"))o.push("  line \x27"+e?.line+"\x27 in "+e?.file);
for(const e of A("winFonts"))o.push("  Windows font "+e?.file+" and its registry value");
for(const f of A("wtFont"))o.push("  Windows Terminal font setting in "+f);
for(const p of A("plugins"))o.push("  plugin "+p);
for(const m of A("marketplaces"))o.push("  marketplace "+m);
if(o.length)console.log("It also deletes, outside the config dir (installed by claudzilla):\n"+o.join("\n"))' "$DEST/.claudzilla-installed.json" 2>/dev/null || true
}

rm_cmd() { if [ -d "$1" ] && [ ! -L "$1" ]; then printf '  rm -rf %q\n' "$1"; else printf '  rm -f %q\n' "$1"; fi; }

# Part plugins/marketplaces claude lists but the record never held ($1 ids, $2 marketplaces to be removed): printed as commands, not run.
unrecorded_plugins() {
  local ids='try{for(const p of JSON.parse(require("fs").readFileSync(0,"utf8")))console.log(p.id||p.name)}catch{}' hp hm cand k a
  hp=$(claude plugin list --json </dev/null 2>/dev/null | node -e "$ids" 2>/dev/null) || true
  hm=$(claude plugin marketplace list --json </dev/null 2>/dev/null | node -e "$ids" 2>/dev/null) || true
  cand=$(node -e '
const m=require(process.argv[1]),b=require(process.argv[2]);
for(const v of Object.values(m))for(const id of v.plugins||[])if(!id.endsWith("@claudzilla"))console.log("P",id);
for(const n of Object.keys(b.extraKnownMarketplaces||{}))if(n!="claudzilla"&&n!="claude-plugins-official")console.log("M",n)' "$REPO/parts.json" "$REPO/settings.base.json")
  while read -r k a; do case $k in
    P) case $'\n'"$hp"$'\n' in *$'\n'"$a"$'\n'*) case " $1 " in *" $a "*) ;; *) echo "  claude plugin uninstall $a" ;; esac ;; esac ;;
    M) case $'\n'"$hm"$'\n' in *$'\n'"$a"$'\n'*) case " $2 " in *" $a "*) ;; *) echo "  claude plugin marketplace remove $a" ;; esac ;; esac ;;
  esac; done <<<"$cand"
}

# Everything the installer added, undone. Leftovers (not ours to delete) are printed last with their rm commands.
uninstall() {
  local rec="$DEST/.claudzilla-installed.json" p f k v lo="" nt="" cl="" ans fd="$HOME/.local/share/fonts" ids out wl bad=0
  if [ "$YES" != 1 ]; then
    has_tty || { echo "claudzilla: --uninstall removes claudzilla from $DEST. Claude: ask the user to confirm, then run $REPO/install.sh --uninstall --yes"; record_summary; exit 2; }
    record_summary
    printf 'claudzilla: remove claudzilla from %s? [y/N] ' "$DEST"
    read -r ans <"$TTY" || true
    case "$ans" in [yY]|[yY][eE][sS]) ;; *) echo "uninstall cancelled"; exit 0 ;; esac
  fi
  [ -d "$DEST" ] || { echo "claudzilla: nothing in $DEST"; return 0; }
  check_settings
  if [ -f "$DEST/.claudzilla-base.json" ] && [ -f "$DEST/settings.json" ]; then echo '{}' > "$DEST/.settings.base.claudzilla"; merge_settings "$DEST/.settings.base.claudzilla"; rm -f "$DEST/.settings.base.claudzilla"; fi
  for p in $ALL_PARTS primer; do unlink_part "$p"; done
  PICKED="" keybindings
  ids=$(node -p 'Object.values(require(process.argv[1])).flatMap(p=>p.plugins||[]).filter(i=>i.endsWith("@claudzilla")).join(" ")' "$REPO/parts.json")
  ids="$ids $(node -p 'try{(require(process.argv[1]).plugins||[]).join(" ")}catch{""}' "$rec" 2>/dev/null)"
  k="claudzilla"; for v in $(node -p 'try{(require(process.argv[1]).marketplaces||[]).join(" ")}catch{""}' "$rec" 2>/dev/null); do [ "$v" = claude-plugins-official ] || k="$k $v"; done
  if [ "$OFFLINE" != 1 ] && command -v claude >/dev/null; then
    v="$(unrecorded_plugins "$ids" "$k")"; [ -z "$v" ] || lo="$v"$'\n'
    # v1.5 ids too: a failed rename keeps the old one installed
    for v in $ids $(for o in $OLD_IDS; do printf '%s@claudzilla ' "${o%%:*}"; done); do claude plugin uninstall "$v" >/dev/null 2>&1 </dev/null || true; done
    for v in $k; do claude plugin marketplace remove "$v" >/dev/null 2>&1 </dev/null || true; done
  else
    for v in $ids; do cl="$cl  claude plugin uninstall $v"$'\n'; done
    for v in $k; do cl="$cl  claude plugin marketplace remove $v"$'\n'; done
  fi
  if [ -f "$rec" ]; then
    out=$(undo_record) || { bad=1; echo "claudzilla: install record problems - record kept at $rec" >&2; }
    while IFS=$'\t' read -r k v; do case $k in
      R) ! command -v reg.exe >/dev/null || reg.exe delete 'HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts' /v "$v" /f >/dev/null 2>&1 </dev/null || true ;;
      N) nt="$nt  $v"$'\n' ;;
      C) lo="$lo  $v"$'\n' ;;
    esac; done <<<"$out"
  fi
  rm -rf "$DEST/.claudzilla-base.json" "$DEST/.claudzilla-rules.json" "$DEST/.claudzilla-basic-glyphs" "$DEST/claudzilla-reports"; [ "$bad" = 1 ] || rm -f "$rec"
  [ -f "$DEST/CLAUDE.local.md" ] && [ ! -s "$DEST/CLAUDE.local.md" ] && rm -f "$DEST/CLAUDE.local.md"
  node -e '
const fs=require("fs"),f=process.argv[1];let j;try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{process.exit(0)}
if(!j||typeof j!="object"||Array.isArray(j)||!("install" in j))process.exit(0);
delete j.install;if(Object.keys(j).length)fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");else fs.rmSync(f)' "$DEST/claudzilla.json"
  echo "claudzilla uninstalled from $DEST"
  # Found but never recorded (installed before the record, or by the user): print, never delete.
  [ "$(uname -s)" != Darwin ] || fd="$HOME/Library/Fonts"
  for f in "$HOME/.local/bin/node" "$(command -v rtk 2>/dev/null || true)" "$fd"/MesloLGS\ NF*; do
    [ -n "$f" ] && { [ -e "$f" ] || [ -L "$f" ]; } || continue
    case "$lo" in *"$(rm_cmd "$f")"*) ;; *) lo="$lo$(rm_cmd "$f")"$'\n' ;; esac
  done
  for f in "$HOME/.bashrc" "$HOME/.zshrc"; do
    v="  remove the line 'export COLORTERM=truecolor' from $f"
    [ ! -f "$f" ] || ! grep -qx 'export COLORTERM=truecolor' "$f" || case "$lo" in *"$v"*) ;; *) lo="$lo$v"$'\n' ;; esac
  done
  if [ -n "${WSL_DISTRO_NAME:-}" ] && wl="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')" && [ -n "$wl" ] && wl="$(wslpath -u "$wl" 2>/dev/null)" && [ -n "$wl" ]; then
    for f in "$wl/Microsoft/Windows/Fonts"/MesloLGS\ NF*; do
      [ -e "$f" ] || continue
      case "$lo" in *"$(rm_cmd "$f")"*) ;; *) lo="$lo$(rm_cmd "$f")"$'\n' ;; esac
    done
  fi
  [ ! -e "$DEST/.claudzilla-backup" ] || lo="$lo$(rm_cmd "$DEST/.claudzilla-backup")"$'\n'
  lo="$lo$(printf '  rm -rf %q' "$REPO")"$'\n'
  [ -z "$cl" ] || printf 'Leftovers - claude is not available here, run:\n%s' "$cl"
  printf 'Leftovers - not removed, delete yourself if unwanted:\n%s' "$lo"
  [ -z "$nt" ] || printf 'Not touched (outside claudzilla'"'"'s reach), check by hand:\n%s' "$nt"
  [ "$bad" = 0 ] || exit 1
}

main() {
  local base f p a flagged=0 custom=0 fresh=0 ran=0 un=0 other=0 val=0
  [ -f "$DEST/.claudzilla-base.json" ] || fresh=1
  for a; do
    [ "$val" = 0 ] || { val=0; continue; }
    case $a in
      --custom) custom=1; other=1 ;; --full) flagged=1; other=1 ;; --add|--remove) flagged=1; other=1; val=1 ;;
      --uninstall) flagged=1; un=1 ;; --yes) ;;
      *) echo "claudzilla: unknown flag '$a' - flags: --full --custom --add --remove --uninstall --yes" >&2; exit 1 ;;
    esac
  done
  [ "$un$other" != 11 ] || { echo "claudzilla: --uninstall cannot be combined with --full, --custom, --add or --remove" >&2; exit 1; }
  if [ "$un" = 0 ] && ! has_tty && { [ "$custom" = 1 ] || { [ "$flagged" = 0 ] && [ "$fresh" = 1 ]; }; }; then claude_stop; fi
  export PATH="$HOME/.local/bin:$PATH"   # claudzilla's own node lives here; uninstall skips deps
  [ "$OFFLINE" = 1 ] || [ "$un" = 1 ] || deps
  command -v node >/dev/null || { echo "claudzilla: node is required" >&2; exit 1; }
  ALL_PARTS="$(all_parts)"
  parse_args "$@"
  [ "$MODE" != uninstall ] || { uninstall; return 0; }
  mkdir -p "$DEST"
  migrate_choice
  resolve_parts
  [ -z "$NODE_NEW_DIR" ] || record_or_warn files "$NODE_NEW_DIR"; [ -z "$NODE_NEW_LINK" ] || record_or_warn files "$NODE_NEW_LINK"
  if [ "$CUSTOM" = 1 ] || { [ "$fresh" = 1 ] && [ "$CHOSEN" = 0 ] && [ -z "$ADD$REMOVE" ]; }; then menu; ran=1; fi
  # The font question is auto-answered only when the HUD is newly chosen this run.
  case " $ADD " in *" hud "*) ran=1 ;; esac
  if picked hud && { [ "$FULL" = 1 ] || [ "$ran" = 1 ] || { [ "$fresh" = 1 ] && [ "$CHOSEN" = 1 ]; }; }; then FONT_NEW=1; fi
  [ "$OFFLINE" = 1 ] || ! picked rtk || deps_rtk
  check_settings
  for f in $(part_links $PICKED); do link "$f"; done
  if picked core; then [ -e "$DEST/CLAUDE.local.md" ] || : > "$DEST/CLAUDE.local.md"; fi
  base=$(base_for $PICKED) || exit 1
  merge_settings "$base"
  rm -f "$DEST/.settings.base.claudzilla"
  for p in $ALL_PARTS; do picked "$p" || unlink_part "$p"; done
  PICKED="$PICKED primer" keybindings
  if picked hud; then truecolor; font; fi
  if picked core; then stamp_rules || echo "claudzilla: rule dates not saved - /rule-review skips undated rules until the next install" >&2; fi
  if picked ponytail; then ponytail_defaults || echo "claudzilla: could not save ponytail's defaults - its band stays shown" >&2; fi
  [ "$OFFLINE" = 1 ] || plugins
  [ -d "$BACKUP" ] && echo "replaced files backed up -> $BACKUP"
  [ "$OFFLINE" = 1 ] || case ":$ORIG_PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "note: add ~/.local/bin to PATH (node/rtk live there)" ;; esac
  echo "claudzilla installed -> $DEST (from $REPO)"
}

main "$@"
