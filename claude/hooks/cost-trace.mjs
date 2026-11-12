#!/usr/bin/env node
// Cost trace: parse and price Claude Code transcripts.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enabled } from "./experimental.mjs";

// USD per million tokens, read 2026-11-12 from the claude-api skill model table (cached 2026-11-03).
// Keys are exact model ids; update when prices change. Unlisted ids stay unpriced.
const std = (input, output, cacheRead = input / 10) => ({ input, output, cacheRead });
export const PRICES = {
  "claude-fable-5-2": std(8, 40, 0.2),
  "claude-opus-5-5": std(4, 20, 0.2),
  "claude-sonnet-5-5": std(2, 10, 0.1),
  "claude-haiku-5-5": { ...std(0.1, 0.5, 0.01), long: { input: 0.5, output: 2.5 } },
  "claude-opus-4-8": std(5, 25),
  "claude-opus-5": std(5, 25),
  "claude-opus-4-7": std(5, 25),
  "claude-opus-4-6": std(5, 25),
  "claude-sonnet-5": std(2, 10),
  "claude-sonnet-4-6": std(3, 15),
  "claude-fable-5-1": std(10, 50, 0.25),
  "claude-fable-5": std(10, 50),
  "claude-haiku-4-5": std(1, 5),
};

export function costOf(model, usage) {
  const p = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!p || !usage) return undefined;
  if (usage.speed && usage.speed !== "standard") return undefined;
  const inp = usage.input_tokens || 0, out = usage.output_tokens || 0;
  const read = usage.cache_read_input_tokens || 0, write = usage.cache_creation_input_tokens || 0;
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  const w5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? write - w1h;
  const long = p.long && inp + write + read > 100_000;
  const rin = long ? p.long.input : p.input;
  // shortcut: cache rates above 100K assumed 5x like input; check the pricing page when it is reachable
  const rread = long ? p.cacheRead * 5 : p.cacheRead;
  return (inp * rin + out * (long ? p.long.output : p.output) + read * rread + w5m * rin * 1.25 + w1h * rin * 2) / 1e6;
}

const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join("") : "";

// Routing comes only from the SessionStart hook output, never from chat, tool results or queued prompts.
function routingOf(o) {
  const a = o.attachment;
  if (o.type !== "attachment" || a?.hookEvent !== "SessionStart" || typeof a.stdout !== "string") return null;
  let ctx;
  try { ctx = JSON.parse(a.stdout)?.hookSpecificOutput?.additionalContext; } catch { return null; }
  const at = typeof ctx === "string" ? ctx.indexOf("# Agent routing") : -1;
  if (at < 0) return null;
  const lines = ctx.slice(at).split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l.startsWith("# "));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n").trimEnd();
}

export function parseLines(text) {
  const reqs = new Map(), prompts = [], seenPrompt = new Set(), costStates = [], lines = [];
  let routing = null, lastType = null;
  for (const raw of text.split("\n")) {
    if (!raw) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    lastType = o.type ?? null;
    const ts = Date.parse(o.timestamp);
    if (o.uuid && !Number.isNaN(ts)) lines.push({ uuid: o.uuid, ts });
    if (routing === null && o.type === "attachment") routing = routingOf(o);
    if (o.type === "cost-state") {
      const { sessionId, startTime, totalCostUSD, totalAPIDuration, totalDuration, modelUsage } = o;
      costStates.push({ run: startTime, sessionId, startTime, totalCostUSD, totalAPIDuration, totalDuration, modelUsage });
    } else if (o.type === "assistant") {
      const m = o.message;
      if (!m?.id || m.model === "<synthetic>" || Number.isNaN(ts)) continue;
      // An unfinished request (stop_reason null) is never billed in cost-state.
      if (m.stop_reason === null) { reqs.delete(m.id); continue; }
      reqs.set(m.id, { id: m.id, model: m.model, effort: o.effort ?? null, ts, usage: m.usage ?? {} });
    } else if (o.type === "user" && o.turnOrigin === "human" && o.uuid && !seenPrompt.has(o.uuid) && !Number.isNaN(ts)) {
      const t = textOf(o.message?.content);
      if (t.startsWith("<command-name>") || (t.includes("usage limit") && t.includes("reset"))) continue;
      seenPrompt.add(o.uuid);
      prompts.push({ uuid: o.uuid, ts });
    }
  }
  return { requests: [...reqs.values()], prompts, costStates, lines, routing, lastType };
}

export function activeMs(ts) {
  const s = [...ts].sort((a, b) => a - b);
  let t = 0;
  for (let i = 1; i < s.length; i++) t += Math.min(s[i] - s[i - 1], 300_000);
  return t;
}

export function parseMeta(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  return { agentType: o.agentType, description: o.description, spawnDepth: o.spawnDepth };
}

export function runOf(startTimes, ts) {
  let best = null;
  for (const s of startTimes) if (s <= ts && (best === null || s > best)) best = s;
  return best;
}

const minOf = (a) => { let m = Infinity; for (const x of a) if (x < m) m = x; return m; };
const maxOf = (a) => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };

const startsOf = (parsed) => parsed.costStates.map((c) => c.startTime).filter(Number.isFinite);
// A process whose cost-state never rose above 0 billed nothing, so it owns no request.
const liveStarts = (parsed) => [...new Set(parsed.costStates.filter((c) => +c.totalCostUSD > 0).map((c) => c.startTime).filter(Number.isFinite))];
const isFileKey = (run) => typeof run === "string" && run.startsWith("file:");
const runKey = (f, st) => f.parsed.costStates.find((c) => c.startTime === st)?.run ?? st;
const startOfKey = (run) => Number(String(run).split(":")[0]);

// Concurrent processes can share a startTime. Files holding one identical nonzero cost-state snapshot
// are one process; each such set becomes its own run, keyed "<startTime>:<earliest file id>" when a group splits.
export function splitRuns(files) {
  const first = (f) => minOf(f.parsed.lines.map((l) => l.ts));
  const groups = new Map();
  for (const f of files) for (const st of new Set(startsOf(f.parsed))) (groups.get(st) ?? groups.set(st, []).get(st)).push(f);
  for (const [st, gf] of groups) {
    const parent = new Map(gf.map((f) => [f, f]));
    const find = (f) => { while (parent.get(f) !== f) f = parent.get(f); return f; };
    const sig = new Map(), bare = [];
    for (const f of gf) {
      const sigs = f.parsed.costStates.filter((c) => c.startTime === st && +c.totalCostUSD > 0).map((c) => c.totalCostUSD + "|" + c.totalAPIDuration);
      if (!sigs.length) bare.push(f);
      for (const g of sigs) { if (sig.has(g)) parent.set(find(f), find(sig.get(g))); else sig.set(g, f); }
    }
    const sets = new Map();
    for (const f of gf) if (!bare.includes(f)) (sets.get(find(f)) ?? sets.set(find(f), []).get(find(f))).push(f);
    const list = [...sets.values()];
    if (bare.length) { if (!list.length) list.push([...bare]); else if (list.length === 1) list[0].push(...bare); else for (const f of bare) list.push([f]); }
    if (list.length < 2) continue;
    for (const set of list) {
      const e = [...set].sort((a, b) => first(a) - first(b) || (a.sessionId < b.sessionId ? -1 : 1))[0];
      for (const f of set) for (const c of f.parsed.costStates) if (c.startTime === st) c.run = `${st}:${e.sessionId}`;
    }
  }
}

const tokensOf = (u = {}) => {
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens || 0;
  const write = u.cache_creation_input_tokens || 0;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite5m: u.cache_creation?.ephemeral_5m_input_tokens ?? write - w1h,
    cacheWrite1h: w1h,
  };
};

const addTokens = (into, t) => { for (const k in t) into[k] = (into[k] || 0) + t[k]; return into; };

// Owner of each message id and prompt uuid (D3): a file whose process had started by then, then the one whose
// earliest unique line is oldest, then the lower sessionId.
export function owners(files, logged) {
  const held = new Map();
  for (const f of files) for (const u of new Set(f.parsed.lines.map((l) => l.uuid))) held.set(u, (held.get(u) || 0) + 1);
  const rank = new Map(files.map((f) => [f.sessionId, minOf(f.parsed.lines.filter((l) => held.get(l.uuid) === 1).map((l) => l.ts))]));
  const byRank = (a, b) => rank.get(a.sessionId) - rank.get(b.sessionId) || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
  const fromFile = (f, key, type) => {
    const starts = liveStarts(f.parsed), pending = f.parsed.costStates.length === 0;
    if (type === "prompt") {
      const p = f.parsed.prompts.find((x) => x.uuid === key);
      return p && { type, sessionId: f.sessionId, run: runKey(f, runOf(starts, p.ts)), pending, tokens: {}, usd: 0 };
    }
    const r = f.parsed.requests.find((x) => x.id === key);
    return r && { type, sessionId: f.sessionId, run: runKey(f, runOf(starts, r.ts)), pending, model: r.model, tokens: tokensOf(r.usage), usd: costOf(r.model, r.usage) ?? null };
  };
  const cands = new Map();
  for (const f of files) {
    for (const r of f.parsed.requests) (cands.get(r.id) ?? cands.set(r.id, { type: "request", fs: [] }).get(r.id)).fs.push(f);
    for (const p of f.parsed.prompts) (cands.get(p.uuid) ?? cands.set(p.uuid, { type: "prompt", fs: [] }).get(p.uuid)).fs.push(f);
  }
  const out = new Map();
  for (const [key, { type, fs }] of cands) {
    const pin = logged.get(key)?.sessionId;
    const ts = type === "prompt" ? fs[0].parsed.prompts.find((x) => x.uuid === key)?.ts : fs[0].parsed.requests.find((x) => x.id === key)?.ts;
    // A fork copies lines with their old timestamps; only a process started by then can have sent the request.
    const late = (x) => (runOf(liveStarts(x.parsed), ts) === null ? 1 : 0);
    const f = fs.find((x) => x.sessionId === pin) ?? (pin === undefined ? [...fs].sort((a, b) => late(a) - late(b) || byRank(a, b))[0] : null);
    if (f) out.set(key, fromFile(f, key, type));
  }
  for (const [key, row] of logged) {
    if (out.has(key)) continue;
    out.set(key, { type: row.type, sessionId: row.sessionId, run: row.run, pending: false, ...(row.type === "request" ? { model: row.model } : {}), tokens: row.tokens ?? {}, usd: row.usd ?? (row.type === "prompt" ? 0 : null) });
  }
  return out;
}

const topBy = (arr) => {
  const n = new Map();
  for (const v of arr) if (v != null) n.set(v, (n.get(v) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
};

export function assembleRun({ run, project, files, agents, owners: all }) {
  if (!files.length) return { session: null, agents: [], keys: [] };
  const byFile = isFileKey(run);
  const fid = byFile ? run.slice(5) : null;
  const firstTs = (f) => minOf(f.parsed.lines.map((l) => l.ts));
  const sorted = [...files].sort((a, b) => firstTs(a) - firstTs(b) || (a.sessionId < b.sessionId ? -1 : 1));
  const mine = (o) => (byFile ? o.pending && o.sessionId === fid : o.run === run);
  // Unassigned items (D8) are returned once: by the run that is their file's smallest startTime,
  // or, when the file is absent (deleted owner, missing parent), by the smallest run among `files`.
  const present = new Set(sorted.map((f) => f.sessionId));
  const homeIds = new Set(byFile ? [fid] : sorted.filter((f) => runKey(f, minOf(startsOf(f.parsed))) === run).map((f) => f.sessionId));
  const smin = minOf(sorted.flatMap((f) => startsOf(f.parsed)));
  const hf = sorted.find((f) => startsOf(f.parsed).includes(smin));
  const homeAll = !byFile && !!hf && runKey(hf, smin) === run;
  const keys = [], tokens = {};
  let mainUsd = 0, prompts = 0, unpriced = 0;
  for (const [key, o] of all) {
    if (!(mine(o) || (o.run === null && !o.pending && (homeIds.has(o.sessionId) || (!present.has(o.sessionId) && homeAll))))) continue;
    keys.push({ key, sessionId: o.sessionId, type: o.type, run: o.run, model: o.model ?? null, tokens: o.tokens, usd: o.usd, pending: o.pending });
    if (!mine(o)) continue;
    if (o.type === "prompt") { prompts++; continue; }
    if (o.usd === null) unpriced++; else mainUsd += o.usd;
    addTokens(tokens[o.model] ??= {}, o.tokens);
  }

  const rows = [];
  let agentUsd = 0;
  for (const a of agents) {
    const parent = sorted.find((f) => f.sessionId === a.parentSession);
    const reqs = a.parsed.requests;
    const first = reqs.length ? minOf(reqs.map((r) => r.ts)) : null;
    const starts = parent ? liveStarts(parent.parsed) : [];
    const arun = !parent || first === null ? null : starts.length ? runKey(parent, runOf(starts, first)) : "file:" + parent.sessionId;
    if (arun !== run && !(arun === null && (parent ? homeIds.has(parent.sessionId) : homeAll))) continue;
    const t = {};
    let usd = 0;
    for (const r of reqs) {
      addTokens(t, tokensOf(r.usage));
      const c = costOf(r.model, r.usage);
      if (c === undefined) usd = null; else if (usd !== null) usd += c;
    }
    if (arun === run) {
      for (const r of reqs) if (costOf(r.model, r.usage) === undefined) unpriced++;
      if (usd !== null) agentUsd += usd;
    }
    rows.push({
      kind: "agent", id: a.agentId.replace(/^agent-/, ""), session: a.parentSession, run: arun, project, mtime: a.mtime, start: first,
      activeMs: activeMs(reqs.map((r) => r.ts)),
      prompt: first === null || !parent ? 0 : parent.parsed.prompts.filter((p) => p.ts <= first).length,
      type: a.meta?.agentType ?? "unknown", description: a.meta?.description ?? "",
      model: topBy(reqs.map((r) => r.model)), effort: topBy(reqs.map((r) => r.effort)),
      depth: a.meta?.spawnDepth ?? null, tokens: t, usd,
    });
  }

  const states = sorted.flatMap((f) => f.parsed.costStates).filter((c) => c.run === run);
  const big = (k) => (states.length ? maxOf(states.map((c) => +c[k] || 0)) : null);
  const costUsd = byFile ? null : big("totalCostUSD");
  const routing = sorted.find((f) => f.parsed.routing)?.parsed.routing ?? null;
  const newest = sorted.reduce((b, f) => (f.mtime > b.mtime ? f : b));
  return {
    session: {
      kind: "session", run, id: sorted[0].sessionId, files: sorted.map((f) => ({ name: f.name, mtime: f.mtime })),
      mtime: newest.mtime, project, start: byFile ? firstTs(sorted[0]) : startOfKey(run),
      running: byFile || newest.parsed.lastType !== "cost-state",
      routing: routing !== null, routingHash: routing === null ? null : createHash("sha256").update(routing).digest("hex").slice(0, 8),
      prompts, costUsd,
      apiMs: byFile ? null : big("totalAPIDuration"), durationMs: byFile ? null : big("totalDuration"),
      mainUsd, agentUsd, untrackedUsd: costUsd === null ? null : costUsd - mainUsd - agentUsd, unpriced, tokens,
    },
    agents: rows, keys,
  };
}

export const logPath = (env) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "claudzilla-cost.jsonl");

const lsDir = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const mtimeOf = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

export function walk(root) {
  const out = [];
  for (const pd of lsDir(root).filter((d) => d.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = join(root, pd.name);
    for (const e of lsDir(dir).filter((x) => x.isFile() && x.name.endsWith(".jsonl")).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const sessionId = e.name.slice(0, -6), sub = join(dir, sessionId, "subagents");
      const agents = lsDir(sub).filter((x) => x.isFile() && /^agent-.+\.jsonl$/.test(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1)).map((x) => {
        const agentId = x.name.slice(6, -6), mt = readText(join(sub, `agent-${agentId}.meta.json`));
        return { agentId, name: x.name, path: join(sub, x.name), mtime: mtimeOf(join(sub, x.name)), meta: mt === null ? null : parseMeta(mt) };
      });
      out.push({ project: pd.name, sessionId, name: e.name, path: join(dir, e.name), mtime: mtimeOf(join(dir, e.name)), agents });
    }
  }
  return out;
}

const sessionKey = (project, run) => project + "/" + run;

export function readLog(file) {
  const sessions = new Map(), agents = new Map(), ids = new Map();
  const text = readText(file);
  if (text === null) return { sessions, agents, ids };
  for (const raw of text.split("\n")) {
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (o.kind === "session") sessions.set(sessionKey(o.project, o.run), o);
    else if (o.kind === "agent") agents.set(o.id, o);
    else if (o.kind === "ids" && Array.isArray(o.keys)) for (const k of o.keys) if (k && k.key !== undefined) ids.set(k.key, k);
  }
  for (const s of sessions.values()) {
    if (isFileKey(s.run)) continue;
    if (typeof s.run === "string") sessions.delete(sessionKey(s.project, startOfKey(s.run)));
    for (const f of s.files || []) sessions.delete(sessionKey(s.project, "file:" + String(f.name).replace(/\.jsonl$/, "")));
  }
  return { sessions, agents, ids };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameKey = (a, b) => !!a && ["sessionId", "run", "model", "tokens", "usd"].every((f) => same(a[f] ?? null, b[f] ?? null));

export function index({ root, log }) {
  let changed = 0, rows = 0;
  try {
    const tree = walk(root);
    if (!tree.length) return { changed, rows };
    const L = readLog(log);
    const seen = new Map();
    for (const s of L.sessions.values()) for (const f of s.files || []) seen.set(s.project + "/" + f.name, f.mtime);
    const isChanged = (m) => m.mtime !== seen.get(m.project + "/" + m.name) || m.agents.some((a) => a.mtime !== L.agents.get(a.agentId)?.mtime);
    const append = (row) => {
      mkdirSync(dirname(log), { recursive: true });
      appendFileSync(log, JSON.stringify(row) + "\n", { mode: 0o600 });
      rows++;
    };
    const projects = new Map();
    for (const m of tree) (projects.get(m.project) ?? projects.set(m.project, []).get(m.project)).push(m);
    for (const [project, mains] of projects) {
      const dirty = new Set(mains.filter(isChanged).map((m) => m.sessionId));
      if (!dirty.size) continue;
      changed += dirty.size;
      // Parse the changed files and any file that shares a run with them (per the logged session rows).
      // Other files keep their owners from the logged ids rows.
      const byName = new Map(mains.map((m) => [m.name, m]));
      const rows = [...L.sessions.values()].filter((s) => s.project === project);
      const loaded = new Map();
      const load = (m) => {
        if (!loaded.has(m.sessionId)) {
          const t = readText(m.path);
          loaded.set(m.sessionId, t === null ? null : { sessionId: m.sessionId, name: m.name, mtime: m.mtime, parsed: parseLines(t) });
        }
        return loaded.get(m.sessionId);
      };
      const todo = mains.filter((m) => dirty.has(m.sessionId)), queued = new Set(todo.map((m) => m.sessionId));
      while (todo.length) {
        const m = todo.pop(), f = load(m);
        if (!f) continue;
        const starts = new Set(startsOf(f.parsed));
        for (const s of rows) {
          if (!(s.files || []).some((x) => x.name === m.name) && !starts.has(startOfKey(s.run))) continue;
          for (const x of s.files || []) {
            const sib = byName.get(x.name);
            if (sib && !queued.has(sib.sessionId)) { queued.add(sib.sessionId); todo.push(sib); }
          }
        }
      }
      const files = [], agents = [];
      for (const m of mains) {
        const f = loaded.get(m.sessionId);
        if (!f) continue;
        files.push(f);
        for (const a of m.agents) {
          const at = readText(a.path);
          if (at !== null) agents.push({ agentId: a.agentId, parentSession: m.sessionId, name: a.name, mtime: a.mtime, parsed: parseLines(at), meta: a.meta });
        }
      }
      const logged = new Map([...L.ids].filter(([, r]) => r.project === undefined || r.project === project));
      splitRuns(files);
      const own = owners(files, logged);
      const allRuns = new Set(files.flatMap((f) => f.parsed.costStates.map((c) => c.run)));
      const runs = new Set();
      for (const f of files) {
        if (!dirty.has(f.sessionId)) continue;
        if (f.parsed.costStates.length === 0) runs.add("file:" + f.sessionId);
        for (const c of f.parsed.costStates) runs.add(c.run);
      }
      for (const [key, o] of own) {
        if (o.pending) continue;
        if (sameKey(logged.get(key), { sessionId: o.sessionId, run: o.run, model: o.model ?? null, tokens: o.tokens, usd: o.usd })) continue;
        if (o.run === null) for (const r of allRuns) runs.add(r); else runs.add(o.run);
      }
      const order = [...runs].sort((a, b) => (typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === "number" ? -1 : 1));
      for (const run of order) {
        const rf = isFileKey(run)
          ? files.filter((f) => "file:" + f.sessionId === run && f.parsed.costStates.length === 0)
          : files.filter((f) => f.parsed.costStates.some((c) => c.run === run));
        const ids = new Set(rf.map((f) => f.sessionId));
        const r = assembleRun({ run, project, files: rf, agents: agents.filter((a) => ids.has(a.parentSession)), owners: own });
        if (!r.session) continue;
        const keyRows = r.keys.filter((k) => !k.pending && !sameKey(L.ids.get(k.key), k));
        for (let i = 0; i < keyRows.length; i += 200) {
          const ks = keyRows.slice(i, i + 200).map((k) => ({ ...k, project }));
          append({ kind: "ids", keys: ks });
          for (const k of ks) L.ids.set(k.key, k);
        }
        for (const a of r.agents) if (!same(a, L.agents.get(a.id))) { append(a); L.agents.set(a.id, a); }
        if (!same(r.session, L.sessions.get(sessionKey(project, run)))) { append(r.session); L.sessions.set(sessionKey(project, run), r.session); }
      }
    }
  } catch {}
  return { changed, rows };
}

// Percentile on an ascending sort, same helper as spawn-cost.mjs.
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const usd = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(n === 0 || Math.abs(n) >= 0.1 ? 2 : 4);
const listUsd = (label, n) => `${label} list ${n === null || n === undefined ? "n/a" : usd(n)}`;
const dur = (ms) => {
  if (ms === null || ms === undefined) return "n/a";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
};
const when = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "n/a");
const fit = (lines) => lines.map((l) => (l.length > 80 ? l.slice(0, 77) + "..." : l));
const tokenSum = (t = {}) => Object.values(t).reduce((a, b) => a + (b || 0), 0);
const perPrompt = (n, p) => (p > 0 ? usd(n / p) : "n/a");

const unpricedLine = (n, pad = "") => `${pad}unpriced rows: ${n} (unknown model ids)`;

export function formatSession(s, agents) {
  const sum = s.mainUsd + s.agentUsd;
  const out = [
    `session ${s.id}`,
    `run ${isFileKey(s.run) ? "file" : s.run} | routing ${s.routing ? "on" : "off"} | prompts ${s.prompts} | start ${when(s.start)} UTC | API ${dur(s.apiMs)}`,
    `computed list ${usd(sum)} (main list ${usd(s.mainUsd)}, agents list ${usd(s.agentUsd)})`,
    s.running && s.costUsd !== null
      ? `cost-state list ${usd(s.costUsd)} as of last write, computed list ${usd(sum)}`
      : listUsd("cost-state", s.costUsd),
    listUsd("untracked", s.untrackedUsd),
    `per prompt list ${perPrompt(sum, s.prompts)}`,
  ];
  if (s.unpriced > 0) out.splice(3, 0, unpricedLine(s.unpriced));
  for (const a of agents) {
    const head = `prompt ${a.prompt} d${a.depth ?? "-"} ${a.type} ${a.model ?? "-"} ${a.effort ?? "-"} ${tokenSum(a.tokens)}tok ${listUsd("", a.usd).trim()} ${dur(a.activeMs)}`;
    const room = 79 - head.length;
    out.push(room >= 4 && a.description ? `${head} ${a.description.length > room ? a.description.slice(0, room - 3) + "..." : a.description}` : head);
  }
  return fit(out);
}

export function formatAll(sessions, agents, unassignedUsd, range = {}) {
  const closed = sessions.filter((s) => !s.running);
  const out = [
    `all sessions | project ${range.project ?? "all"} | ${range.since ?? "start"} to ${range.until ?? "now"}`,
    `running left out: ${sessions.length - closed.length}`,
    `unassigned list ${usd(unassignedUsd)}`,
  ];
  for (const on of [true, false]) {
    const ss = closed.filter((s) => s.routing === on);
    const sum = (k) => ss.reduce((a, s) => a + (s[k] || 0), 0);
    const prompts = sum("prompts"), cost = sum("costUsd");
    const share = (n) => (cost ? `${Math.round((100 * n) / cost)}%` : "n/a");
    out.push("", `routing ${on ? "on" : "off"}`,
      `  sessions ${ss.length}, prompts ${prompts}`,
      `  cost-state list per prompt ${perPrompt(cost, prompts)}`,
      `  main chat list per prompt ${perPrompt(sum("mainUsd"), prompts)}`,
      `  agent share ${share(sum("agentUsd"))}, untracked share ${share(sum("untrackedUsd"))} of cost-state list`);
    if (sum("unpriced") > 0) out.push(unpricedLine(sum("unpriced"), "  "));
    const runs = new Set(ss.map((s) => s.project + "/" + s.run));
    const groups = new Map();
    for (const a of agents) {
      if (!runs.has(a.project + "/" + a.run)) continue;
      const k = [a.model ?? "-", a.type, a.effort ?? "-"].join(" / ");
      (groups.get(k) ?? groups.set(k, []).get(k)).push(a);
    }
    if (!groups.size) out.push("  no agents");
    const total = (g) => g.reduce((a, x) => a + (x.usd || 0), 0);
    for (const [k, g] of [...groups].sort((a, b) => total(b[1]) - total(a[1]) || (a[0] < b[0] ? -1 : 1))) {
      const stat = (vals, f) => (vals.length ? `median ${f(q(vals, 0.5))} p10 ${f(q(vals, 0.1))} p90 ${f(q(vals, 0.9))}` : "n/a");
      const asc = (v) => v.sort((a, b) => a - b);
      out.push(`  ${k}  count ${g.length}  total list ${usd(total(g))}`);
      out.push(`    list: ${stat(asc(g.filter((x) => x.usd !== null).map((x) => x.usd)), usd)}`);
      out.push(`    time: ${stat(asc(g.filter((x) => x.activeMs != null).map((x) => x.activeMs)), dur)}`);
    }
  }
  return fit(out);
}

export function report(args, { log, root, cwd }) {
  index({ root, log });
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
  }
  const L = readLog(log);
  const sessions = [...L.sessions.values()];
  if ("session" in opt) {
    if (!opt.session || opt.session.startsWith("--")) return "Usage: report --session <id>";
    const hit = sessions.filter((s) => s.id === opt.session || (s.files || []).some((f) => String(f.name).replace(/\.jsonl$/, "") === opt.session));
    if (!hit.length) return `No session matches "${String(opt.session).slice(0, 40)}".`;
    return hit.map((s) => formatSession(s, [...L.agents.values()].filter((a) => a.project === s.project && a.run === s.run)).join("\n")).join("\n\n");
  }
  const day = /^\d{4}-\d\d-\d\d$/;
  for (const k of ["since", "until"]) if (opt[k] !== undefined && !day.test(opt[k])) return `Bad --${k} date, use YYYY-MM-DD.`;
  const lo = opt.since ? Date.parse(opt.since + "T00:00:00Z") : -Infinity;
  const hi = opt.until ? Date.parse(opt.until + "T00:00:00Z") + 86399999 : Infinity;
  const proj = opt.project ?? "";
  const base = proj === "all" ? null : (proj || cwd || "").startsWith("/") ? (proj || cwd).replace(/[^A-Za-z0-9]/g, "-") : proj || (cwd ?? "");
  const inProject = (p) => base === null || base === "" || p === base || String(p).startsWith(base + "-");
  const sel = sessions.filter((s) => inProject(s.project) && s.start >= lo && s.start <= hi);
  if (!sel.length) return "No sessions in this range.";
  const ag = [...L.agents.values()].filter((a) => a.run !== null);
  const loose = [...L.agents.values()].filter((a) => a.run === null && inProject(a.project)).reduce((n, a) => n + (a.usd || 0), 0);
  const unassigned = [...L.ids.values()].filter((k) => k.run === null && inProject(k.project)).reduce((n, k) => n + (k.usd || 0), 0) + loose;
  return formatAll(sel, ag, unassigned, { since: opt.since, until: opt.until, project: base ?? "all" }).join("\n");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  try {
    if (process.argv[2] === "report") {
      let a = process.argv.slice(3);
      if (a[0] === "all") a = a.slice(1);
      const ci = a.indexOf("--cwd");
      console.log(report(a, { log: logPath(process.env), root: join(dir, "projects"), cwd: ci >= 0 ? a[ci + 1] : process.cwd() }));
    } else if (enabled().agentRouting === true) {
      index({ root: join(dir, "projects"), log: logPath(process.env) });
    }
  } catch (e) {
    if (process.argv[2] === "report") console.log(`cost report failed: ${e?.message ?? e}`);
  }
}
