#!/usr/bin/env bash
# Cost trace tests: claude/hooks/cost-trace.mjs.
#   bash tests/cost-trace.test.sh
set -uo pipefail
set +B # bash 3.2 (macOS) brace-expands {a, b} inside the quoted js snippets
export TZ=UTC
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
. "$REPO/tests/lib.sh"
SCRIPT="$REPO/claude/hooks/cost-trace.mjs"
FX="$REPO/tests/fixtures/cost-trace"
export CLAUDE_CONFIG_DIR="$TMP/cfg"
mkdir -p "$CLAUDE_CONFIG_DIR"

js() { SCRIPT="$SCRIPT" FX="$FX" node --input-type=module -e "const m = await import(process.env.SCRIPT); const fs = await import('node:fs'); const A = fs.existsSync(process.env.FX + '/projects/-proj-a/s-a.jsonl') ? fs.readFileSync(process.env.FX + '/projects/-proj-a/s-a.jsonl', 'utf8') : ''; const out = (v) => console.log(JSON.stringify(v)); $1"; }

O=claude-opus-5-5 H=claude-haiku-5-5
check_eq "costOf: Opus 5.5 input price" 4 "$(js "out(m.costOf('$O', {input_tokens: 1e6}))")"
check_eq "costOf: Sonnet 5.5 output price" 10 "$(js "out(m.costOf('claude-sonnet-5-5', {output_tokens: 1e6}))")"
check_eq "costOf: Haiku 5.5 cache read" 0.001 "$(js "out(+m.costOf('$H', {cache_read_input_tokens: 1e5}).toFixed(4))")"
check_eq "costOf: Haiku over 100K cache read is 5x" 0.05 "$(js "out(+m.costOf('$H', {cache_read_input_tokens: 1e6}).toFixed(4))")"
check_eq "costOf: cache writes split, 1.25x and 2x" 6.2 "$(js "out(+m.costOf('$O', {cache_creation_input_tokens: 1e6, cache_creation: {ephemeral_5m_input_tokens: 6e5, ephemeral_1h_input_tokens: 4e5}}).toFixed(4))")"
check_eq "costOf: write with no split is 5 minute" 5 "$(js "out(m.costOf('$O', {cache_creation_input_tokens: 1e6}))")"
check_eq "costOf: Haiku over 100K prompt tokens" 0.1 "$(js "out(+m.costOf('$H', {input_tokens: 2e5}).toFixed(4))")"
check_eq "costOf: Haiku at exactly 100K is standard" 0.01 "$(js "out(+m.costOf('$H', {input_tokens: 1e5}).toFixed(4))")"
check_eq "costOf: unknown model" '"undefined"' "$(js "out(m.costOf('claude-foo-1', {input_tokens: 1e6}) ?? 'undefined')")"
check_eq "costOf: family name alone is not a price" '"undefined"' "$(js "out(m.costOf('claude-opus-9-9', {input_tokens: 1e6}) ?? 'undefined')")"
check_eq "costOf: non-standard speed is unpriced" '"undefined"' "$(js "out(m.costOf('$O', {input_tokens: 1e6, speed: 'fast'}) ?? 'undefined')")"
check_eq "costOf: missing speed is standard" 4 "$(js "out(m.costOf('$O', {input_tokens: 1e6}))")"
check_eq "costOf: Opus 4.8 input price" 5 "$(js "out(m.costOf('claude-opus-4-8', {input_tokens: 1e6}))")"
check_eq "costOf: Fable 5.1 cache read" 0.25 "$(js "out(m.costOf('claude-fable-5-1', {cache_read_input_tokens: 1e6}))")"
check_eq "costOf: Opus 4.8 cache read is 0.1x input" 0.5 "$(js "out(m.costOf('claude-opus-4-8', {cache_read_input_tokens: 1e6}))")"
check_eq "parseLines: last line per id wins" '[25]' "$(js "out(m.parseLines(A).requests.filter(r => r.id === 'm1').map(r => r.usage.output_tokens))")"
check_eq "parseLines: unfinished request (stop_reason null) is not billed" '["c"]' "$(js "const ln = (id, sr, c) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-12T10:00:00.000Z', message: { id, model: 'claude-opus-5-5', stop_reason: sr, content: c, usage: { output_tokens: 3 } } }); const r = m.parseLines([ln('a', null, [{ type: 'thinking' }]), ln('b', null, [{ type: 'tool_use' }]), ln('c', 'end_turn', [{ type: 'thinking' }])].join('\\n')).requests.map(q => q.id); out(r)")"
check_eq "parseLines: synthetic skipped" false "$(js "out(m.parseLines(A).requests.some(r => r.model === '<synthetic>'))")"
check_eq "parseLines: prompts (queued and suggestion_accepted count; rest excluded)" '["p1","p2"]' "$(js "out(m.parseLines(A).prompts.map(p => p.uuid))")"
check_eq "parseLines: torn last line adds nothing" true "$(js "out(m.parseLines(A + '\n{\"type\":\"assi').requests.length === m.parseLines(A).requests.length)")"
check_eq "parseLines: cost-state kept" 2.5 "$(js "out(m.parseLines(A).costStates[0].totalCostUSD)")"
check_eq "parseLines: lastType" '"cost-state"' "$(js "out(m.parseLines(A).lastType)")"
check_eq "parseLines: routing text" true "$(js "const r = m.parseLines(A).routing; out(r.startsWith('# Agent routing') && !r.includes('Other heading'))")"
check_eq "parseLines: Steward heading counts as routing" '"# Steward (agent routing) body"' "$(js "const q = JSON.stringify({ hookSpecificOutput: { additionalContext: 'pre # Steward (agent routing) body' } }); out(m.parseLines(JSON.stringify({ type: 'attachment', timestamp: '2026-11-22T10:00:00.000Z', attachment: { hookEvent: 'SessionStart', stdout: q } })).routing)")"
check "parseLines: routing only from SessionStart hook output" [ "$(js "const ln = (o) => JSON.stringify({ timestamp: '2026-11-12T10:00:00.000Z', ...o }); const q = '# Agent routing\\nx'; out([m.parseLines([ln({ type: 'user', uuid: 'u', message: { content: q } }), ln({ type: 'attachment', attachment: { hookEvent: 'SessionStart', stdout: q } }), ln({ type: 'attachment', attachment: { hookEvent: 'Stop', stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: q } }) } })].join('\\n')).routing, m.parseLines(ln({ type: 'attachment', attachment: { hookEvent: 'SessionStart', stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'a\\n' + q } }) } })).routing])")" = '[null,"# Agent routing\nx"]' ]
check_eq "activeMs: gap capped at 5 minutes" 360000 "$(js "out(m.activeMs([0, 60000, 960000]))")"
check_eq "activeMs: no gaps" 0 "$(js "out(m.activeMs([]))")"
check_eq "parseMeta: bad JSON" null "$(js "out(m.parseMeta('{'))")"
check_eq "parseMeta: fields" 2 "$(js "out(m.parseMeta('{\"agentType\":\"Explore\",\"description\":\"d\",\"spawnDepth\":2,\"effort\":null}').spawnDepth)")"

PRE="const PRJ = process.env.FX + '/projects/-proj-a'; const path = await import('node:path'); const files = fs.readdirSync(PRJ).filter(f => f.endsWith('.jsonl')).sort().map((f, i) => ({ sessionId: f.slice(0, -6), name: f, mtime: 1000 + i, parsed: m.parseLines(fs.readFileSync(PRJ + '/' + f, 'utf8')) })); const agents = []; for (const f of files) { const d = PRJ + '/' + f.sessionId + '/subagents'; if (!fs.existsSync(d)) continue; for (const a of fs.readdirSync(d).filter(x => x.endsWith('.jsonl')).sort()) { const id = a.slice(6, -6); const mp = d + '/agent-' + id + '.meta.json'; agents.push({ agentId: id, parentSession: f.sessionId, name: a, mtime: 5, parsed: m.parseLines(fs.readFileSync(d + '/' + a, 'utf8')), meta: fs.existsSync(mp) ? m.parseMeta(fs.readFileSync(mp, 'utf8')) : null }); } } const own = m.owners(files, new Map()); const asm = (run) => m.assembleRun({ run, project: '-proj-a', files: files.filter(f => f.parsed.costStates.some(c => c.startTime === run)), agents, owners: own }); const near = (a, b) => Math.abs(a - b) < 1e-9;"
RA=1794474000000 RO=1794472800000 RC1=1794483000000 RC2=1794486600000
check_eq "assembleRun: run total is the largest cost-state" '[5,1]' "$(js "$PRE out([asm($RC1).session.costUsd, asm($RC2).session.costUsd])")"
check_eq "runOf: largest startTime at or before ts" '[1794479400000,null]' "$(js "out([m.runOf([1794474000000, 1794479400000], 1794480000000), m.runOf([1794474000000], 1794473000000)])")"
check "owners: earliest unique line owns" [ "$(js "$PRE out(['m1','p1'].map(k => [own.get(k).sessionId, own.get(k).run]))")" = '[["s-a",'$RA'],["s-a",'$RA']]' ]
check "owners: copy before its run belongs to the earlier file" [ "$(js "$PRE out([own.get('m0').sessionId, own.get('m0').run])")" = '["s-old",'$RO']' ]
check "owners: input order has no effect" js "$PRE const E = (o) => [...o].sort((a, b) => a[0] < b[0] ? -1 : 1); (await import('node:assert')).deepStrictEqual(E(m.owners(files, new Map())), E(m.owners([...files].reverse(), new Map())))"
check_eq "owners: no run" '["s-x",null]' "$(js "$PRE out([own.get('m-x').sessionId, own.get('m-x').run])")"
check_eq "owners: tie goes to the lower sessionId" '["s-1","s-1"]' "$(js "const mk = (id) => ({ sessionId: id, parsed: m.parseLines(JSON.stringify({ type: 'user', uuid: 'shared', timestamp: '2026-11-12T10:00:00.000Z', turnOrigin: 'human', message: { content: 'x' } })) }); out([m.owners([mk('s-2'), mk('s-1')], new Map()).get('shared').sessionId, m.owners([mk('s-1'), mk('s-2')], new Map()).get('shared').sessionId])")"
check_eq "owners: a fork started after the request does not own its copy" '["orig",true]' "$(js "const t = (h) => '2026-11-12T' + h + ':00.000Z'; const L = (o) => JSON.stringify(o); const req = L({ type: 'assistant', uuid: 'u1', timestamp: t('10:00'), message: { id: 'r', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 1 } } }); const cs = (h, usd) => L({ type: 'cost-state', startTime: Date.parse(t(h)), totalCostUSD: usd, totalAPIDuration: 1 }); const usr = (u, h) => L({ type: 'user', uuid: u, timestamp: t(h), message: { content: 'x' } }); const mk = (id, ls) => ({ sessionId: id, parsed: m.parseLines(ls.join('\\n')) }); const o = m.owners([mk('orig', [req, usr('u3', '10:30'), cs('09:00', 1)]), mk('fork', [req, usr('u2', '10:15'), cs('10:10', 0.1)])], new Map()).get('r'); out([o.sessionId, o.run === Date.parse(t('09:00'))])")"
check_eq "owners and agents: a zero-cost process owns no request" '[true,[true]]' "$(js "const t = (h) => '2026-11-12T' + h + ':00.000Z'; const L = (o) => JSON.stringify(o); const req = (id, h) => L({ type: 'assistant', uuid: 'u' + id, timestamp: t(h), message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 1 } } }); const cs = (h, usd) => L({ type: 'cost-state', startTime: Date.parse(t(h)), totalCostUSD: usd, totalAPIDuration: usd ? 1 : 0 }); const f = { sessionId: 's', name: 's.jsonl', mtime: 1, parsed: m.parseLines([req('r', '10:20'), cs('10:10', 0), cs('10:00', 2)].join('\\n')) }; const ag = { agentId: 'agent-a', parentSession: 's', name: 'a', mtime: 1, parsed: m.parseLines(req('ra', '10:25')), meta: null }; const run = Date.parse(t('10:00')); const own = m.owners([f], new Map()); const r = m.assembleRun({ run, project: 'p', files: [f], agents: [ag], owners: own }); out([own.get('r').run === run, r.agents.map(a => a.run === run)])")"
check_eq "assembleRun: an unpriced agent request does not drop the priced ones" '[4,1,null]' "$(js "const t = (h) => '2026-11-12T' + h + ':00.000Z'; const L = (o) => JSON.stringify(o); const req = (id, h, model) => L({ type: 'assistant', uuid: 'u' + id, timestamp: t(h), message: { id, model, stop_reason: 'end_turn', usage: { input_tokens: 1e6 } } }); const cs = L({ type: 'cost-state', startTime: Date.parse(t('10:00')), totalCostUSD: 4, totalAPIDuration: 1 }); const f = { sessionId: 's', name: 's.jsonl', mtime: 1, parsed: m.parseLines(cs) }; const ag = { agentId: 'agent-a', parentSession: 's', name: 'a', mtime: 1, parsed: m.parseLines([req('r1', '10:20', 'claude-opus-5-5'), req('r2', '10:21', 'claude-foo-1')].join('\\n')), meta: null }; const run = Date.parse(t('10:00')); const r = m.assembleRun({ run, project: 'p', files: [f], agents: [ag], owners: m.owners([f], new Map()) }); out([r.session.agentUsd, r.session.unpriced, r.agents[0].usd])")"
check_eq "assembleRun: request keys carry their ts" true "$(js "$PRE const k = asm($RA).keys.find(k => k.key === 'm1'); out(k.ts === files.find(f => f.sessionId === 's-a').parsed.requests.find(r => r.id === 'm1').ts)")"
check_eq "owners: a logged row keeps its ts" 5 "$(js "out(m.owners([], new Map([['k', { type: 'request', sessionId: 's', run: 1, model: 'x', ts: 5, usd: 1 }]])).get('k').ts)")"
check_eq "assembleRun: each key counted once" '[3,true]' "$(js "$PRE const s = asm($RA).session; out([s.prompts, near(s.mainUsd, 0.00074)])")"
check_eq "assembleRun: run s-old ignores the s-b copy" true "$(js "$PRE out(near(asm($RO).session.mainUsd, 0.01))")"
check_eq "assembleRun: untracked is signed" true "$(js "$PRE out(near(asm($RC2).session.untrackedUsd, -1.02))")"
check "agent: active time, prompt, run" [ "$(js "$PRE const a = asm($RA).agents.find(a => a.id === 'x'); out([a.activeMs, a.prompt, a.run])")" = '[360000,1,'$RA']' ]
check_eq "agent: effort from lines, depth from meta" '["high",2]' "$(js "$PRE const a = asm($RA).agents.find(a => a.id === 'y'); out([a.effort, a.depth])")"
check_eq "agent: no meta" '["unknown",null,"",null,1]' "$(js "$PRE const r = asm($RA); const a = r.agents.find(a => a.id === 'z'); out([a.type, a.depth, a.description, a.usd, r.session.unpriced])")"
check_eq "assembleRun: synthetic lines add no tokens" false "$(js "$PRE out('<synthetic>' in asm($RA).session.tokens)")"
check_eq "assembleRun: routing on with hash, off without" '[true,true,false,null]' "$(js "$PRE const a = asm($RA).session, o = asm($RO).session; out([a.routing, /^[0-9a-f]{8}\$/.test(a.routingHash), o.routing, o.routingHash])")"
check_eq "assembleRun: zero prompts" 0 "$(js "$PRE out(asm($RC1).session.prompts)")"
check_eq "assembleRun: null-run key is returned" '[["m-x",null]]' "$(js "$PRE out(asm(1794474600000).keys.map(k => [k.key, k.run]))")"
check_eq "assembleRun: null-run agent kept once, with and without requests or parent" '[[["e",null,0.0002,0],["f",null,0,0],["g",null,0,0]],0]' "$(js "$PRE const mk = (id, ts, parent) => ({ agentId: 'agent-' + id, parentSession: parent, name: id, mtime: 5, parsed: m.parseLines(ts ? JSON.stringify({ type: 'assistant', uuid: 'u' + id, timestamp: ts, message: { id: 'i' + id, model: 'claude-opus-5-5', usage: { output_tokens: 10 } } }) : ''), meta: null }); const ag = [mk('e', '2026-11-12T09:05:00.000Z', 's-x'), mk('f', null, 's-x'), mk('g', null, 'ghost')]; const f = (run) => m.assembleRun({ run, project: 'p', files: files.filter(x => x.parsed.costStates.some(c => c.startTime === run)), agents: ag, owners: own }); const r = f(1794474600000); out([r.agents.map(a => [a.id, a.run, a.usd, a.activeMs]), r.session.agentUsd])")"
check_eq "assembleRun: logged null-run key with owner absent" true "$(js "$PRE const lg = new Map([['gone', { type: 'request', sessionId: 'ghost', run: null, model: 'claude-opus-5-5', tokens: {}, usd: 0.5, pending: false }]]); const ow = m.owners(files, lg); const f = (run) => m.assembleRun({ run, project: 'p', files: files.filter(x => x.parsed.costStates.some(c => c.startTime === run)), agents: [], owners: ow }).keys.some(k => k.key === 'gone'); out(f($RA))")"
check_eq "assembleRun: session tokens exclude agents" '["claude-opus-5-5"]' "$(js "$PRE out(Object.keys(asm($RA).session.tokens))")"
check "owners and assembleRun: 300k lines do not throw" js "$PRE const big = { sessionId: 'big', name: 'big', mtime: 1, parsed: { requests: [], prompts: [], costStates: [{ startTime: 1, totalCostUSD: 1 }], lines: Array.from({ length: 3e5 }, (_, i) => ({ uuid: 'x' + i, ts: i })), routing: null, lastType: 'cost-state' } }; m.owners([big], new Map()); m.assembleRun({ run: 1, project: 'p', files: [big], agents: [], owners: new Map() })"
check_eq "assembleRun: empty files" '[null,[],[]]' "$(js "$PRE const r = m.assembleRun({ run: 1, project: 'p', files: [], agents, owners: own }); out([r.session, r.agents, r.keys])")"

ROOT="$FX/projects"
IX="const root = process.env.FX + '/projects'; const log = process.env.LOG; const rl = () => m.readLog(log); const lines = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);"
cp -r "$FX" "$TMP/fx1"; LOG="$TMP/ix1.jsonl"
jx() { LOG="$LOG" FX="${FXD:-$FX}" js "$IX $1"; }
check_eq "walk: main files with agents; missing meta is null" '["-other/o1,-proj-a/s-a,-proj-a/s-b,-proj-a/s-c,-proj-a/s-d,-proj-a/s-live,-proj-a/s-old,-proj-a/s-x,-proj-a-wt/w1",true,null]' "$(js "const w = m.walk(process.env.FX + '/projects'); const a = w.find(f => f.sessionId === 's-a'); out([w.map(f => f.project + '/' + f.sessionId).join(), w.every(f => f.name === f.sessionId + '.jsonl'), a.agents.find(g => g.agentId === 'z').meta])")"
FXD="$TMP/fx1"; FXP="$FXD"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check_eq "index: fresh log has mode 600" 600 "$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$LOG")"
N1=$(wc -l <"$LOG")
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check "index: second run writes no rows" [ "$(wc -l <"$LOG")" = "$N1" ]
check_eq "index: live file stage 1" '[1,true,false]' "$(jx "const s = rl().sessions.get('-proj-a/file:s-live'); out([s.prompts, Math.abs(s.mainUsd - 0.002) < 1e-9, [...rl().ids.keys()].some(k => k === 'p9')])")"
check_eq "index: unassigned keys written with run null" '[null,false]' "$(jx "const k = rl().ids.get('m-x'); out([k.run, k.pending === true])")"
# append to s-b
printf '%s\n' '{"type":"user","uuid":"p5","timestamp":"2026-11-12T11:20:00.000Z","message":{"role":"user","content":"more"},"turnOrigin":"human"}' >>"$TMP/fx1/projects/-proj-a/s-b.jsonl"
N1=$(wc -l <"$LOG")
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check_eq "index: appended line in s-b writes one session row" '[["session",1794474000000]]' "$(tail -n +$((N1+1)) "$LOG" | node -e "const r = require('fs').readFileSync(0, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(x => x.kind !== 'ids'); console.log(JSON.stringify(r.map(x => [x.kind, x.run])))")"
printf '%s\n' '{"type":"assistant","uuid":"ux2","timestamp":"2026-11-12T10:30:00.000Z","message":{"id":"mx2","model":"claude-opus-5-5","usage":{"output_tokens":5}}}' >>"$TMP/fx1/projects/-proj-a/s-a/subagents/agent-x.jsonl"
N1=$(wc -l <"$LOG")
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check_eq "index: agent change re-assembles the parent run" '[["agent","x"],["session",1794474000000]]' "$(tail -n +$((N1+1)) "$LOG" | node -e "const r = require('fs').readFileSync(0, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(x => x.kind !== 'ids'); console.log(JSON.stringify(r.map(x => [x.kind, x.kind === 'agent' ? x.id : x.run])))")"
# live file stage 2
printf '%s\n' '{"type":"user","uuid":"p10","timestamp":"2026-11-12T10:50:00.000Z","message":{"role":"user","content":"live 2"},"turnOrigin":"human"}' '{"type":"assistant","uuid":"u-m10","timestamp":"2026-11-12T10:51:00.000Z","message":{"id":"m10","model":"claude-opus-5-5","usage":{"output_tokens":50}}}' '{"type":"cost-state","sessionId":"s-live","startTime":1794480300000,"totalCostUSD":0.5,"totalAPIDuration":1000,"totalDuration":2000,"modelUsage":{}}' >>"$TMP/fx1/projects/-proj-a/s-live.jsonl"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check_eq "index: live file, then its cost-state appears" '[false,2,true]' "$(jx "const r = rl(); const s = r.sessions.get('-proj-a/1794480300000'); out([r.sessions.has('-proj-a/file:s-live'), s.prompts, Math.abs(s.mainUsd - 0.003) < 1e-9])")"
# deleted owner
cp -r "$FX" "$TMP/fx2"; LOG="$TMP/ix2.jsonl"; FXD="$TMP/fx2"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
B=$(jx "const s = rl().sessions.get('-proj-a/1794474000000'); out([s.mainUsd, s.prompts])")
rm "$TMP/fx2/projects/-proj-a/s-a.jsonl"
printf '%s\n' '{"type":"user","uuid":"p4","timestamp":"2026-11-12T11:10:00.000Z","message":{"role":"user","content":"p4"},"turnOrigin":"human"}' >>"$TMP/fx2/projects/-proj-a/s-b.jsonl"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check_eq "index: deleted owner keeps its keys" '[true,1]' "$(jx "const s = rl().sessions.get('-proj-a/1794474000000'); const b = $B; out([Math.abs(s.mainUsd - b[0]) < 1e-9, s.prompts - b[1]])")"
# torn file and bad meta
cp -r "$FX" "$TMP/fx3"; LOG="$TMP/ix3.jsonl"; FXD="$TMP/fx3"
printf '{"type":"assi' >>"$TMP/fx3/projects/-proj-a/s-a.jsonl"; echo '{' >"$TMP/fx3/projects/-proj-a/s-a/subagents/agent-y.meta.json"
check "index: torn file and bad meta exit 0" jx "m.index({ root: process.env.FX + '/projects', log })"
echo '{"experimental":{"steward":true}}' >"$CLAUDE_CONFIG_DIR/claudzilla.json"
check "index: no projects folder" bash -c "node '$SCRIPT' && ! test -e '$CLAUDE_CONFIG_DIR/claudzilla-cost.jsonl'"
mkdir -p "$TMP/my cfg"; cp -r "$FX/projects" "$TMP/my cfg/projects"
echo '{"experimental":{"steward":true}}' >"$TMP/my cfg/claudzilla.json"; CLAUDE_CONFIG_DIR="$TMP/my cfg" node "$SCRIPT"
check "index: CLAUDE_CONFIG_DIR with a space" [ -s "$TMP/my cfg/claudzilla-cost.jsonl" ]
cp -r "$FX" "$TMP/fx5"; FXD="$TMP/fx5"; LOG="$TMP/ix5.jsonl"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
S5='const ser = () => JSON.stringify([...rl().sessions].sort(), (k, v) => v instanceof Map ? [...v] : v) + JSON.stringify([...rl().agents].sort()) + JSON.stringify([...rl().ids].sort());'
B5=$(jx "$S5 out(ser())")
cat "$LOG" "$LOG" "$LOG" >"$TMP/ix5.3x"; mv "$TMP/ix5.3x" "$LOG"; chmod 644 "$LOG"
jx "m.index({ root: process.env.FX + '/projects', log })" >/dev/null
check "index: a log with 3 versions of every row is rewritten to the live rows" [ "$(wc -l <"$LOG" | tr -d " ")|$(jx "$S5 out(ser())")" = "$(jx "const r = rl(); out(Math.ceil(r.ids.size / 200) + r.agents.size + r.sessions.size)")|$B5" ]
check_eq "index: rewritten log has mode 600" 600 "$(node -e 'console.log((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$LOG")"
check_eq "index: rewrite leaves no temp file" 0 "$(ls "$TMP" | grep -c '^ix5.jsonl\.')"
check_eq "readLog: ids flattened, later row wins, torn line skipped" '[2,5,2,3]' "$(js "const f = '$TMP/rl.jsonl'; fs.writeFileSync(f, [{kind:'ids',keys:[{key:'m1',usd:1},{key:'m2',usd:5}]},{kind:'ids',keys:[{key:'m1',usd:2}]},{kind:'session',project:'p',run:7,n:1},{kind:'session',project:'p',run:7,n:2},{kind:'session',project:'q',run:7,n:3}].map(x => JSON.stringify(x)).join('\n') + '\n{\"kind\":\"ids\",\"ke'); const r = m.readLog(f); out([r.ids.get('m1').usd, r.ids.get('m2').usd, r.sessions.get('p/7').n, r.sessions.get('q/7').n])" 2>&1 | tail -1)"
mkdir -p "$TMP/par"; cp -r "$FX/projects" "$TMP/par/projects"
echo '{"experimental":{"steward":true}}' >"$TMP/par/claudzilla.json"; for i in 1 2; do CLAUDE_CONFIG_DIR="$TMP/par" node "$SCRIPT" & done; wait
check_eq "index: two parallel runs leave a readable log" true "$(LOG="$TMP/par/claudzilla-cost.jsonl" FX="$FX" js "out(m.readLog(process.env.LOG).sessions.size >= 1)")"

# Report. State: fresh copy, s-d stripped of its cost-state (file run, running), s-live closed (stage 2 lines),
# s-b newest in run 1794474000000 and ending in m3 (running). w1 and o1 end in cost-state (closed).
CFG4="$TMP/cfg4"; mkdir -p "$CFG4"; cp -r "$FX/projects" "$CFG4/projects"; R4="$CFG4/projects/-proj-a"
perl -ni -e 'print unless /"type":"cost-state"/' "$R4/s-d.jsonl"
printf '%s\n' '{"type":"user","uuid":"p10","timestamp":"2026-11-12T10:50:00.000Z","message":{"role":"user","content":"live 2"},"turnOrigin":"human"}' '{"type":"assistant","uuid":"u-m10","timestamp":"2026-11-12T10:51:00.000Z","message":{"id":"m10","model":"claude-opus-5-5","usage":{"output_tokens":50}}}' '{"type":"cost-state","sessionId":"s-live","startTime":1794480300000,"totalCostUSD":0.5,"totalAPIDuration":1000,"totalDuration":2000,"modelUsage":{}}' >>"$R4/s-live.jsonl"
find "$CFG4/projects" -name '*.jsonl' -exec touch -t 202611121000 {} +
touch -t 202611121100 "$R4/s-b.jsonl"
rp() { CLAUDE_CONFIG_DIR="$CFG4" node "$SCRIPT" report "$@"; }
SA=$(rp --session s-a); SOLD=$(rp --session s-old); SC=$(rp --session s-c); SD=$(rp --session s-d); AL=$(rp all --cwd /proj/a)
check "session report: every line fits 80 columns" bash -c 'printf "%s\n" "$1" "$2" | awk "length > 80 { bad = 1 } END { exit bad }"' _ "$SA" "$AL"
check "session report: header fields" bash -c 'for w in "routing on" "prompts 3" API "computed list" "cost-state list" "untracked list" "per prompt list"; do grep -qF -- "$w" <<<"$1" || exit 1; done' _ "$SA"
check "every dollar line says list" bash -c '! { printf "%s\n" "$@" | grep "\\$" | grep -v list | grep -q .; }' _ "$SA" "$SOLD" "$SC" "$SD" "$AL"
check "running label" bash -c 'grep -qF "as of last write" <<<"$1" && ! grep -qF "as of last write" <<<"$2"' _ "$SA" "$SOLD"
check "negative untracked is signed" has "$SC" 'untracked list -$1.02'
check "zero prompts: n/a" bash -c 'grep -qF "per prompt list n/a" <<<"$1" && ! grep -qE "NaN|Infinity" <<<"$1"' _ "$SC"
check "null cost-state prints n/a" bash -c 'grep -qF "cost-state list n/a" <<<"$1" && grep -qF "untracked list n/a" <<<"$1" && ! grep -qE "null|NaN" <<<"$1"' _ "$SD"
check "unpriced rows show a count" has "$SA" "unpriced rows: 1 (unknown model ids)"
check "one line per agent" bash -c '[ "$(grep -c Explore <<<"$1")" = 1 ] && grep Explore <<<"$1" | grep -qF "prompt 1"' _ "$SA"
check "all report: groups and totals" bash -c 'on=$(grep -n "^routing on" <<<"$1" | cut -d: -f1); off=$(grep -n "^routing off" <<<"$1" | cut -d: -f1); t=$(grep -n "^unassigned list" <<<"$1" | cut -d: -f1); [ -n "$on" ] && [ -n "$off" ] && [ "$t" -lt "$on" ]' _ "$AL"
check "all report: running runs left out" has "$AL" "running left out: 2"
check "all report: unassigned total" has "$AL" 'unassigned list $0.50'
check "group with one agent" bash -c 'g=$(grep -A2 "claude-haiku-5-5 / Explore" <<<"$1"); grep -qF "count 1" <<<"$g" && grep median <<<"$g" | awk "{ if (\$3 != \$5 || \$3 != \$7) bad = 1 } END { exit bad }" && [ "$(grep -c median <<<"$g")" = 2 ]' _ "$AL"
check "groups use closed runs only" bash -c '! grep -qF "claude-sonnet-5-5 / Explore" <<<"$1"' _ "$AL"
check "totals per routing state" bash -c 'on=$(sed -n "/^routing on/,/^routing off/p" <<<"$1"); off=$(sed -n "/^routing off/,\$p" <<<"$1"); grep -qF "per prompt" <<<"$on" && grep -qF "agent share" <<<"$off" && grep -qF "sessions 0, prompts 0" <<<"$on" && grep -qF "cost-state list per prompt n/a" <<<"$on"' _ "$AL"
check_eq "null activeMs left out of time percentiles" '"    time: median 1m00s p10 1m00s p90 1m00s"' "$(js "const o = m.formatAll([{project:'p',run:1,routing:true,running:false,prompts:1,costUsd:1,mainUsd:0,agentUsd:0,untrackedUsd:1}], [{project:'p',run:1,model:'a',type:'t',effort:null,usd:1,activeMs:null},{project:'p',run:1,model:'a',type:'t',effort:null,usd:1,activeMs:60000}], 0, {}); out(o.find(l => l.includes('time:')))")"
check_eq "routing on and off totals, exact values" '["sessions 1, prompts 2","cost-state list per prompt $0.50","main chat list per prompt $0.30","agent share 20%, untracked share 20% of cost-state list","sessions 1, prompts 4","cost-state list per prompt $0.75","main chat list per prompt $0.50","agent share 17%, untracked share 17% of cost-state list"]' "$(js "const s = (routing, prompts, costUsd, mainUsd, agentUsd) => ({ project: 'p', run: routing ? 1 : 2, routing, running: false, prompts, costUsd, mainUsd, agentUsd, untrackedUsd: costUsd - mainUsd - agentUsd }); out(m.formatAll([s(true, 2, 1, 0.6, 0.2), s(false, 4, 3, 2, 0.5)], [], 0, {}).slice(1).filter(l => /sessions|per prompt|share/.test(l)).map(l => l.trim()))")"
check_eq "all report: unpriced count per routing block, only when above 0" '["  unpriced rows: 3 (unknown model ids)"]' "$(js "const s = (routing, unpriced) => ({ project: 'p', run: routing ? 1 : 2, routing, running: false, prompts: 1, costUsd: 1, mainUsd: 1, agentUsd: 0, untrackedUsd: 0, unpriced }); const o = m.formatAll([s(true, 2), s(true, 1), s(false, 0)], [], 0).filter(l => l.includes('unpriced')); out(o)")"
check "--session without a value prints usage" bash -c 'o=$(CLAUDE_CONFIG_DIR="$1" node "$2" report --session); rc=$?; [ $rc = 0 ] && [ $(wc -l <<<"$o") -eq 1 ] && grep -qF Usage <<<"$o"' _ "$CFG4" "$SCRIPT"
check "session lookup by any file" has "$(rp --session s-b)" "run 1794474000000"
NOPE=$(rp --session nope); check "unknown session: one line, exit 0" bash -c '[ $(wc -l <<<"$1") -eq 1 ] && grep -qF "No session" <<<"$1"' _ "$NOPE"
check_eq "date range: run start" "No sessions in this range." "$(rp all --until 2026-11-11 --cwd /proj/a)"
EXP=$(CLAUDE_CONFIG_DIR="$CFG4" js "const L = m.readLog(process.env.CLAUDE_CONFIG_DIR + '/claudzilla-cost.jsonl'); const c = (f) => [...L.sessions.values()].filter(s => !s.running && f(s.project)).length; out(c(p => p === '-proj-a' || p === '-proj-a-wt') + ',' + c(() => true))" | tr -d '"')
N() { grep -oE 'sessions [0-9]+' <<<"$1" | cut -d' ' -f2 | paste -sd+ - | bc; }
check "default project by prefix" [ "$(N "$AL"),$(N "$(rp all --project all)")" = "$EXP" ]
check "project prefix excludes other and keeps worktree" [ "$(N "$AL")" -gt "$(N "$(rp all --cwd /proj/a/wt)")" ] && [ "$(N "$AL")" != "$(N "$(rp all --project all)")" ]
mkdir -p "$TMP/cfg-empty"
check "empty config dir" bash -c '[ "$(CLAUDE_CONFIG_DIR="$1" node "$2" report all)" = "No sessions in this range." ]' _ "$TMP/cfg-empty" "$SCRIPT"

SPL="const T0 = 1794600000000; const cs = (sid, st, usd, api) => JSON.stringify({ type: 'cost-state', sessionId: sid, startTime: st, totalCostUSD: usd, totalAPIDuration: api, totalDuration: 1, modelUsage: {} }); const rq = (id, ms) => JSON.stringify({ type: 'assistant', uuid: 'u' + id, timestamp: new Date(T0 + ms).toISOString(), message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [], usage: { input_tokens: 1e6 } } }); const mk = (sid, lines) => ({ sessionId: sid, name: sid + '.jsonl', mtime: 1, parsed: m.parseLines(lines.join('\\n')) }); const asmAll = (files) => { m.splitRuns(files); const own = m.owners(files, new Map()); const keys = [...new Set(files.flatMap(f => f.parsed.costStates.map(c => c.run)))]; return keys.map(k => m.assembleRun({ run: k, project: 'p', files: files.filter(f => f.parsed.costStates.some(c => c.run === k)), agents: [], owners: own }).session); };"
check_eq "parallel files sharing a startTime: two runs, no double count" '[["1794600000000:f-1",4,4],["1794600000000:f-2",4.5,4]]' "$(js "$SPL const r = asmAll([mk('f-1', [rq('a', 1000), cs('f-1', T0, 4, 100)]), mk('f-2', [rq('b', 2000), cs('f-2', T0, 4.5, 200)])]); out(r.map(x => [x.run, x.costUsd, x.mainUsd]))")"
check_eq "chain sharing one snapshot stays one run" '[[1794600000000,8,8]]' "$(js "$SPL const r = asmAll([mk('c-1', [rq('a', 1000), cs('c-1', T0, 4, 100)]), mk('c-2', [cs('c-2', T0, 4, 100), rq('b', 2000), cs('c-2', T0, 8, 200)])]); out(r.map(x => [x.run, x.costUsd, x.mainUsd]))")"
check_eq "file without a snapshot joins the lone set" '[[1794600000000,4]]' "$(js "$SPL const r = asmAll([mk('d-1', [rq('a', 1000), cs('d-1', T0, 4, 100)]), mk('d-2', [rq('b', 2000), cs('d-2', T0, 0, 0)])]); out(r.map(x => [x.run, x.costUsd]))")"

PX="$TMP/px"; mkdir -p "$PX/projects/-p"
pl() { local sid=$1 id=$2 ms=$3 usd=$4 api=$5; printf '%s\n' "{\"type\":\"assistant\",\"uuid\":\"u$id\",\"timestamp\":\"2026-11-14T23:50:0$ms.000Z\",\"message\":{\"id\":\"$id\",\"model\":\"claude-opus-5-5\",\"stop_reason\":\"end_turn\",\"content\":[],\"usage\":{\"input_tokens\":1000000}}}" "{\"type\":\"cost-state\",\"sessionId\":\"$sid\",\"startTime\":1794700000000,\"totalCostUSD\":$usd,\"totalAPIDuration\":$api,\"totalDuration\":1,\"modelUsage\":{}}" >"$PX/projects/-p/$sid.jsonl"; }
PXJ() { LOG="$PX/log.jsonl" PXR="$PX/projects" js "const l = m.readLog(process.env.LOG); $1"; }
pl p-1 ra 1 4 100; jx_px() { LOG="$PX/log.jsonl" PXR="$PX/projects" js "m.index({ root: process.env.PXR, log: process.env.LOG })" >/dev/null; }
jx_px
check_eq "index: lone file keeps the numeric run" '["-p/1794700000000"]' "$(PXJ "out([...l.sessions.keys()])")"
pl p-2 rb 2 4.5 200; jx_px
check_eq "index after split: two string runs, old numeric row gone" '["-p/1794700000000:p-1","-p/1794700000000:p-2"]' "$(PXJ "out([...l.sessions.keys()].sort())")"
check_eq "index after split: each run has its own main total" '[[4,4],[4,4.5]]' "$(PXJ "out([...l.sessions.values()].map(s => [s.mainUsd, s.costUsd]).sort())")"
check_eq "index after split: every key on a split run, none twice" '["1794700000000:p-1","1794700000000:p-2"]' "$(PXJ "out([...l.ids.values()].map(k => k.run).sort())")"
PB="$TMP/pb"; mkdir -p "$PB/projects/-p"; PX="$PB"; pl q-1 qa 1 0 0; pl q-2 qb 2 0 0; jx_px
check_eq "group with no snapshot at all stays one run" '["-p/1794700000000"]' "$(PXJ "out([...l.sessions.keys()])")"
P2="$TMP/p2"; mkdir -p "$P2/projects/-p" "$P2/projects/-q"; PX="$P2"
pl q-1 qa 1 4 100; cp "$P2/projects/-p/q-1.jsonl" "$P2/projects/-q/q-9.jsonl"; perl -pi -e 's/"qa"/"qz"/;s/"uqa"/"uqz"/' "$P2/projects/-q/q-9.jsonl"; jx_px
check_eq "index: same startTime in two projects keeps both rows" '["-p/1794700000000","-q/1794700000000"]' "$(PXJ "out([...l.sessions.keys()].sort())")"

IC="$TMP/inc"; mkdir -p "$IC/projects/-p"
ICJ="const d = process.env.ICD + '/projects/-p', log = process.env.ICD + '/cost.log'; const mk = (sid, st, id, usd) => fs.writeFileSync(d + '/' + sid + '.jsonl', [JSON.stringify({ type: 'assistant', uuid: 'u' + id, timestamp: '2026-11-15T00:30:00.000Z', message: { id, model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [], usage: { input_tokens: 1000000 } } }), JSON.stringify({ type: 'cost-state', sessionId: sid, startTime: st, totalCostUSD: usd, totalAPIDuration: 100, totalDuration: 1, modelUsage: {} })].join('\\n') + '\\n'); const idx = () => m.index({ root: process.env.ICD + '/projects', log });"
ICD="$IC" js "$ICJ mk('i-1', 1794700000000, 'a1', 4); mk('i-2', 1794700100000, 'b1', 5); mk('i-3', 1794700100000, 'b2', 5); idx()"
touch -t 202611150100 "$IC/projects/-p/i-2.jsonl"
check_eq "index: unchanged file of another run is not re-read" '[["i-2.jsonl","i-3.jsonl"],2]' "$(ICD="$IC" js "$ICJ const F = (await import('node:fs')).default, real = F.readFileSync; const seen = []; F.readFileSync = (p, ...a) => { seen.push(String(p).split('/').pop()); return real(p, ...a); }; (await import('node:module')).syncBuiltinESMExports(); idx(); out([seen.filter(x => x.startsWith('i-')).sort(), m.readLog(log).sessions.size])")"

# --- gate ---
gate() { local d; d=$(mktemp -d -p "$TMP"); cp -r "$FX/projects" "$d/projects"; [ -n "${1:-}" ] && printf '%s' "$1" > "$d/claudzilla.json"; GOUT=$(CLAUDE_CONFIG_DIR="$d" node "$SCRIPT" </dev/null); GRC=$?; GLOG="$d/claudzilla-cost.jsonl"; GDIR="$d"; }
gate '{"experimental":{"steward":false}}'; check "gate off: no output, no log" [ "$GOUT|$GRC|$(ls "$GLOG" 2>/dev/null)" = "|0|" ]
gate; check "gate on by default: indexes" [ "$GOUT|$(ls "$GLOG" 2>/dev/null)" = "|$GLOG" ]
gate '{"experimental":{"steward":true}}'; check "gate on: indexes" [ "$GOUT|$(ls "$GLOG" 2>/dev/null)" = "|$GLOG" ]
gate '{"experimental":{"steward":"false"}}'; check "gate off needs exact false: string" [ -e "$GLOG" ]
gate '{"experimental":{"steward":0}}'; check "gate off needs exact false: number" [ -e "$GLOG" ]
gate '{"experimental":{"steward":false}}'; CLAUDE_CONFIG_DIR="$GDIR" node "$SCRIPT" report all >/dev/null; check "report ignores the gate" [ -e "$GLOG" ]
check_eq "settings: own entry at index 1, async" '[ undefined, true, true ]' "$(node -p 'const e=require(process.argv[1]).hooks.SessionStart;[e[1].matcher, e[1].hooks[0].command.includes("cost-trace.mjs"), e[1].hooks[0].async]' "$REPO/settings.base.json")"
check_eq "settings: trace entry unchanged" true "$(node -p 'require(process.argv[1]).hooks.SessionStart[0].hooks[0].command.includes("--session-start")' "$REPO/settings.base.json")"

summary cost-trace
