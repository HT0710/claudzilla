#!/usr/bin/env bash
# Trace writer tests: node module claude/hooks/trace.mjs and its perl twin trace.pl.
#   bash tests/trace.test.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export CLAUDE_CONFIG_DIR="$TMP/cfg" HOME="$TMP/home"
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOME"
T="$CLAUDE_CONFIG_DIR/claudzilla-trace"
TR="$REPO/claude/hooks/trace.mjs"
TP="$REPO/claude/hooks/trace.pl"
pass=0 fail=0
check() { local name=$1; shift; if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $name"; return 1; fi; }
# js <code>: run code as a module with trace.mjs exports in scope
js() { node --input-type=module -e "import * as t from '$TR'; $1" </dev/null; }
fresh() { rm -rf "$T"; }
# portable (no GNU stat/touch/truncate): mode <path>, sparse <path> <MB> [hours-old]
mode() { node -p '(require("fs").statSync(process.argv[1]).mode & 0o777).toString(8)' "$1"; }
sparse() { node -e 'const f=require("fs"),[p,mb,h]=process.argv.slice(1);f.writeFileSync(p,"");f.truncateSync(p,mb*1048576);if(h){const t=Date.now()/1e3-h*3600;f.utimesSync(p,t,t)}' "$@"; }
size() { node -p 'require("fs").statSync(process.argv[1]).size' "$1"; }

fresh; id=$(js "console.log(t.write({session:'s1',part:'hook',event:'e'}))")
f="$T/s1.hook.jsonl"
check "write appends one JSON line with ts id session part event level" \
  node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").trimEnd().split("\n");const o=JSON.parse(L[0]);
if(L.length!==1||o.id!==process.argv[2]||!/^[0-9a-f]{8}$/.test(o.id)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(o.ts)||o.session!=="s1"||o.part!=="hook"||o.event!=="e"||o.level!=="info")process.exit(1)' "$f" "$id"
check "file is 0600, dir 0700" [ "$(mode "$f")/$(mode "$T")" = 600/700 ]

fresh; js "t.write({session:'a',part:'p',event:'e'});t.write({session:'b',part:'p',event:'e'})"
check "two sessions, two files" bash -c '[ -f "$1/a.p.jsonl" ] && [ -f "$1/b.p.jsonl" ]' _ "$T"

fresh; js "t.write({session:'s',part:'p',event:'e',data:{v:'ab '.repeat(2000)}})"
check "long value cut" node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data.v;
if(v!=="ab ".repeat(2000).slice(0,2000)+"…[cut]")process.exit(1)' "$T/s.p.jsonl"

fresh
SHA=$(printf 'a%.0s' {1..40})
HEX=$(printf 'b%.0s' {1..48})
JWT="eyJhbGciOi.eyJzdWIiOiIx.abc_DEF-123"
out=$(node --input-type=module -e "import * as t from '$TR';
const m=t.mask;
const r=[m('sk-ant-api03-'+'A'.repeat(30)),m('ghp_'+'a'.repeat(36)),m('AKIA'+'A'.repeat(16)),m('Bearer abc.def'),m('$JWT'),m('$HEX'),m('$SHA'),m('$HOME/proj/x')];
console.log(JSON.stringify(r))" </dev/null)
check "mask: sk- ghp_ AKIA Bearer JWT long-hex masked, 40-hex sha kept, \$HOME → ~" \
  node -e 'const r=JSON.parse(process.argv[1]);
if(!r.slice(0,6).every(x=>x==="[masked]"))process.exit(1);
if(r[6]!==process.argv[2]||r[7]!=="~/proj/x")process.exit(1)' "$out" "$SHA"

fresh; mkdir -p "$T"; sparse "$T/s.p.jsonl" 6
js "t.write({session:'s',part:'p',event:'e'})"
check "rotation: >5 MB file becomes .1, new file starts" \
  bash -c '[ "$1" = 6291456 ] && [ "$(wc -l < "$2/s.p.jsonl" | tr -d " ")" = 1 ]' _ "$(size "$T/s.p.1.jsonl")" "$T"

fresh; mkdir -p "$T"
sparse "$T/old.p.jsonl" 0 192; : > "$T/fresh.p.jsonl"
js "t.cleanup()"
check "cleanup: 8-day-old file gone, fresh kept" bash -c '[ ! -e "$1/old.p.jsonl" ] && [ -e "$1/fresh.p.jsonl" ]' _ "$T"
fresh; mkdir -p "$T"
for i in 1 2 3; do sparse "$T/f$i.p.jsonl" 30 "$((i+3))"; done
js "t.cleanup()"
check "cleanup: oldest removed until < 50 MB" bash -c '[ ! -e "$1/f3.p.jsonl" ] && [ ! -e "$1/f2.p.jsonl" ] && [ -e "$1/f1.p.jsonl" ]' _ "$T"

fresh; echo '{"rulesGuard":{"trace":false}}' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
ln -s "$TR" "$TMP/link.mjs"; node "$TMP/link.mjs" --session-start </dev/null; rc=$?
check "--session-start with trace:false writes .off" bash -c '[ "$1" = 0 ] && [ -e "$2/.off" ]' _ "$rc" "$T"
echo '{"rulesGuard":{"trace":true}}' > "$CLAUDE_CONFIG_DIR/claudzilla.json"
node "$TR" --session-start </dev/null
check "--session-start with true removes .off" bash -c '[ ! -e "$1/.off" ] && [ "$2" = 700 ]' _ "$T" "$(mode "$T")"
rm "$CLAUDE_CONFIG_DIR/claudzilla.json"

fresh; mkdir -p "$T"; : > "$T/.off"
js "t.write({session:'s',part:'p',event:'e'})"
check ".off present → write creates nothing" [ -z "$(ls -A "$T" | grep -v '^.off$')" ]

fresh; mkdir -p "$T"; chmod 0500 "$T"
err=$(js "t.write({session:'s',part:'p',event:'e'})" 2>&1); rc=$?
chmod 0700 "$T"
check "unwritable dir: write is silent" bash -c '[ "$1" = 0 ] && [ -z "$2" ]' _ "$rc" "$err"

fresh; sid=$(js "const s=t.span({session:'s',part:'p'},'x',{a:1});s.end({b:2},'error');console.log(s.id)")
check "span end writes one entry with ts end status id" node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
const e=L[0];if(L.length!==1||!e.end||e.end<e.ts||e.status!=="error"||e.id!==process.argv[2]||e.data.a!==1||e.data.b!==2)process.exit(1)' "$T/s.p.jsonl" "$sid"

# --- perl twin ---
# mask runners: stdin lines -> masked lines. Add a runner (e.g. TS) and one check line.
mask_node() { node --input-type=module -e "import {mask} from '$TR';import {readFileSync} from 'node:fs';process.stdout.write(readFileSync(0,'utf8').split('\\n').slice(0,-1).map(mask).join('\\n')+'\\n')"; }
mask_ts() { node --experimental-strip-types --no-warnings -e "import {mask} from '$REPO/plugins/guide/hooks/trace.ts';import {readFileSync} from 'node:fs';process.stdout.write(readFileSync(0,'utf8').split('\\n').slice(0,-1).map(s=>mask(s,process.env.HOME)).join('\\n')+'\\n')" ; }
mask_perl() { perl -e 'require $ARGV[0]; while(<STDIN>){chomp; print trace_mask($_),"\n"}' "$TP"; }
: > "$TMP/mask.in"
while IFS= read -r line; do printf '%s\n' "${line//@HOME@/$HOME}" >> "$TMP/mask.in"; done < "$REPO/tests/fixtures/mask.txt"
mask_node < "$TMP/mask.in" > "$TMP/mask.node"; mask_perl < "$TMP/mask.in" > "$TMP/mask.perl"
mask_ts < "$TMP/mask.in" > "$TMP/mask.ts"
check "mask parity: node and perl outputs identical" cmp -s "$TMP/mask.node" "$TMP/mask.perl"
check "mask parity: node and ts outputs identical" cmp -s "$TMP/mask.node" "$TMP/mask.ts"
for p in margin picks update-toast folio attribution ledger; do
  check "trace.ts copy in $p identical to guide" cmp -s "$REPO/plugins/guide/hooks/trace.ts" "$REPO/plugins/$p/hooks/trace.ts"
done
for p in picks update-toast folio attribution guide ledger; do
  check "trace-io.ts copy in $p identical to margin" cmp -s "$REPO/plugins/margin/hooks/trace-io.ts" "$REPO/plugins/$p/hooks/trace-io.ts"
done
check "mask parity: fixture really masks (not a no-op)" bash -c '! grep -q -e sk-ant -e ghp_ -e AKIA -e eyJ "$1" && grep -q "~/proj/x" "$1" && grep -q "kept" "$1"' _ "$TMP/mask.perl"

ENTRY="{session:'s',part:'p',event:'e',ts:'2026-01-01T00:00:00.000Z',id:'0123abcd',turn:3,data:{tok:'sk-ant-api03-'+'A'.repeat(30),long:'x'.repeat(2500),n:{a:['$HOME/f',1]}}}"
fresh; js "t.write($ENTRY)"; cp "$T/s.p.jsonl" "$TMP/node.jsonl"
fresh; perl -e 'require $ARGV[0]; trace_write({session=>"s",part=>"p",event=>"e",ts=>"2026-01-01T00:00:00.000Z",id=>"0123abcd",turn=>3,data=>{tok=>"sk-ant-api03-".("A" x 30),long=>("x" x 2500),n=>{a=>["$ENV{HOME}/f",1]}}})' "$TP" </dev/null
check "perl write matches node shape" node -e 'const r=(p)=>JSON.parse(require("fs").readFileSync(p,"utf8"));
const o=(x)=>JSON.stringify(x,(k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort()):v);
if(o(r(process.argv[1]))!==o(r(process.argv[2])))process.exit(1)' "$T/s.p.jsonl" "$TMP/node.jsonl"
check "perl file is 0600, dir 0700" [ "$(mode "$T/s.p.jsonl")/$(mode "$T")" = 600/700 ]
# a string used as a number keeps its secret: mask by content, not type
fresh; perl -MJSON::PP -e 'require $ARGV[0];
my $a="sk-ant-api03-".("A" x 30); my $b="ghp_".("a" x 36); my $c="1" x 60; my $d="ab" x 40; my $e="y " x 1500; my $n="5";
{ no warnings; my $t = ($a == 0); $t = $b + 0; $t = $c + 0; $t = $d * 1; $t = $e + 0; }
trace_write({session=>"nm",part=>"p",event=>"e",data=>{a=>$a,b=>$b,c=>$c,d=>$d,e=>$e,i=>5,f=>1.5,t=>JSON::PP::true()}})' "$TP" </dev/null
check "perl numeric-used strings masked or cut; numbers and booleans kept" node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data;
for(const k of "abcd")if(d[k]!=="[masked]")process.exit(1);
if(!d.e.endsWith("…[cut]")||d.e.length>2010||d.i!==5||d.f!==1.5||d.t!==true)process.exit(1)' "$T/nm.p.jsonl"

fresh; out=$(perl "$TP" s2 hook ev warn a=1 'b=two words' 2>&1 </dev/null); rc=$?
check "perl CLI writes one entry, exit 0, silent" node -e 'const L=require("fs").readFileSync(process.argv[1],"utf8").trimEnd().split("\n");const o=JSON.parse(L[0]);
if(L.length!==1||o.level!=="warn"||o.event!=="ev"||o.part!=="hook"||o.session!=="s2"||o.data.a!=="1"||o.data.b!=="two words"||!/^[0-9a-f]{8}$/.test(o.id)||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(o.ts))process.exit(1);
if(process.argv[2]!=="0"||process.argv[3]!=="")process.exit(1)' "$T/s2.hook.jsonl" "$rc" "$out"
fresh; perl "$TP" a/../b "p q" ev info </dev/null
check "perl session/part sanitised, level default" bash -c '[ -f "$1/ab.pq.jsonl" ]' _ "$T"
ln -s "$TP" "$TMP/link.pl"; fresh
check "perl require works through a symlink" bash -c 'cd "$1" && perl -e "require q(./link.pl); trace_write({session=>q(l),part=>q(p),event=>q(e)})" && [ -f "$2/l.p.jsonl" ]' _ "$TMP" "$T"

fresh; mkdir -p "$T"; : > "$T/.off"
perl "$TP" s p e info x=1 </dev/null
check "perl .off -> nothing" [ -z "$(ls -A "$T" | grep -v '^.off$')" ]

fresh; mkdir -p "$T"; sparse "$T/s.p.jsonl" 6
perl "$TP" s p e info </dev/null
check "perl rotation: >5 MB file becomes .1" \
  bash -c '[ "$1" = 6291456 ] && [ "$(wc -l < "$2/s.p.jsonl" | tr -d " ")" = 1 ]' _ "$(size "$T/s.p.1.jsonl")" "$T"

fresh; mkdir -p "$T"; chmod 0500 "$T"
err=$(perl "$TP" s p e info 2>&1 </dev/null); rc=$?
chmod 0700 "$T"
check "perl unwritable dir: silent, exit 0" bash -c '[ "$1" = 0 ] && [ -z "$2" ]' _ "$rc" "$err"

fresh; err=$(perl -e 'require $ARGV[0]; eval{die "outer\n"}; trace_write({session=>"s",part=>"p",event=>"e"}); print $@' "$TP" 2>&1 </dev/null)
check "perl trace_write keeps caller's \$@" [ "$err" = outer ]
fresh; err=$(perl -e 'require $ARGV[0]; trace_write(undef); trace_write("x"); trace_write([]); print "ok"' "$TP" 2>&1 </dev/null)
check "perl trace_write with non-hashref: no die, no stderr" [ "$err" = ok ]

echo "trace: $pass passed, $fail failed"
[ "$fail" = 0 ]
