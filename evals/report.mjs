#!/usr/bin/env node
// rows.jsonl → report.md + picks.json beside it; winner = cheapest cell within TOL of the best pass rate.
//   node evals/report.mjs <rows.jsonl> [--stage-b]   (--stage-b prints "<case> <model> <effort>" cells to confirm)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOL = 0.1, EPS = 1e-9;
const ORDER = ["low", "medium", "high", "xhigh", "max"];
const ESTIMATES = join(dirname(fileURLToPath(import.meta.url)), "estimates.json");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const stageB = process.argv.includes("--stage-b");

const all = readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const graded = (r) => r.status === "pass" || r.status === "fail";
const rows = all.filter(graded);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const group = (xs, f) => xs.reduce((m, x) => m.set(f(x), [...(m.get(f(x)) ?? []), x]), new Map());

function cells(rs) {
  return [...group(rs, (r) => `${r.model} ${r.effort}`)].map(([cell, xs]) => ({
    cell, model: xs[0].model, effort: xs[0].effort, runs: xs.length, maxRun: Math.max(...xs.map((r) => r.run ?? 1)),
    pass: mean(xs.map((r) => (r.status === "pass" ? 1 : 0))),
    cost: mean(xs.map((r) => r.cost ?? 0)),
    out: mean(xs.map((r) => r.outTokens ?? 0)), turns: mean(xs.map((r) => r.turns ?? 0)), ms: mean(xs.map((r) => r.ms ?? 0)),
    neverPasses: [...group(xs, (r) => r.case)].filter(([, v]) => !v.some((r) => r.status === "pass")).map(([k]) => k),
  }));
}

function pick(all) {
  // Stage-B cells (most runs) outrank single-run stage-A screens: best is a stage-B pass rate (spec).
  const top = Math.max(...all.map((c) => c.maxRun));
  const cs = all.filter((c) => c.maxRun === top);
  const best = cs.reduce((a, b) => (b.pass > a.pass ? b : a));
  const near = cs.filter((c) => c.pass >= best.pass - TOL - EPS);
  const ok = near.filter((c) => c.neverPasses.every((k) => best.neverPasses.includes(k)));
  ok.sort((a, b) => a.cost - b.cost || a.turns - b.turns || a.ms - b.ms);
  return { best, near, winner: ok[0] };
}

const roles = [...group(all, (r) => r.role)].map(([role, rs]) => {
  const cs = cells(rs.filter(graded));
  // invalid/errored runs never score but stay visible: a high invalid rate means the case prompt needs rework.
  const skipped = group(rs.filter((r) => !graded(r)), (r) => `${r.model} ${r.effort}`);
  const sel = cs.length ? pick(cs) : { best: null, near: [], winner: null };
  return { role, agent: rs[0].agent ?? null, cases: [...new Set(rs.filter(graded).map((r) => r.case))], cells: cs, skipped, ...sel };
});

if (stageB) {
  for (const r of roles) for (const c of r.near) for (const k of r.cases) console.log(`${k} ${c.model} ${c.effort}`);
  process.exit(0);
}

// The main session runs every skill role, so its effort is the level most skill roles settle on; ties go higher.
const votes = [...group(roles.filter((r) => !r.agent && r.winner), (r) => r.winner.effort)];
votes.sort((a, b) => b[1].length - a[1].length || ORDER.indexOf(b[0]) - ORDER.indexOf(a[0]));
const mainEffort = votes[0]?.[0] ?? null;

const picks = {
  generated: new Date().toISOString(), claude: rows[0]?.claude ?? null,
  models: [...new Set(rows.flatMap((r) => r.models ?? []))].sort(), main: { effort: mainEffort },
  roles: Object.fromEntries(roles.filter((r) => r.winner).map((r) => [r.role, {
    model: r.winner.model, effort: r.winner.effort, pass: r.winner.pass, cost: r.winner.cost, best: r.best.cell,
  }])),
};

const est = existsSync(ESTIMATES) ? JSON.parse(readFileSync(ESTIMATES, "utf8")) : {};
const pct = (x) => `${Math.round(x * 100)}%`;
const md = ["# Effort eval report", "", `Generated ${picks.generated} · Claude Code ${picks.claude ?? "?"} · main-session effort: **${mainEffort ?? "?"}**`, "",
  "## Summary", "", "| role | winner | best | estimate | changed |", "|---|---|---|---|---|"];
for (const r of roles) {
  const e = est[r.role] ?? "-";
  const w = r.winner?.cell ?? "-";
  md.push(`| ${r.role} | ${w} | ${r.best?.cell ?? "-"} | ${e} | ${e === "-" || w === "-" ? "-" : e === w ? "no" : "yes"} |`);
}
for (const r of roles) {
  md.push("", `## ${r.role}`, "", "| cell | runs | pass | cost $ | out tok | turns | s | invalid | errored |", "|---|---|---|---|---|---|---|---|---|");
  for (const k of new Set([...r.cells.map((c) => c.cell), ...r.skipped.keys()])) {
    const c = r.cells.find((x) => x.cell === k), n = (s) => (r.skipped.get(k) ?? []).filter((x) => x.status === s).length;
    const tag = c && c === r.winner ? " **winner**" : c && c === r.best ? " (best)" : "";
    const stats = c ? `${c.runs} | ${pct(c.pass)} | ${c.cost.toFixed(3)} | ${Math.round(c.out)} | ${c.turns.toFixed(1)} | ${(c.ms / 1000).toFixed(0)}` : "0 | - | - | - | - | -";
    md.push(`| ${k}${tag} | ${stats} | ${n("invalid")} | ${n("errored")} |`);
  }
}
const dir = dirname(file);
writeFileSync(join(dir, "picks.json"), `${JSON.stringify(picks, null, 2)}\n`);
writeFileSync(join(dir, "report.md"), `${md.join("\n")}\n`);
console.log(`wrote ${join(dir, "report.md")} and picks.json`);
