#!/usr/bin/env node
// Sweep eval cases across model × effort cells; appends one row per run to <out>/rows.jsonl.
//   node evals/run.mjs [--cases 'role/*'] [--runs N] [--out DIR] [--only FILE] [--root DIR] [--smoke]
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS = dirname(fileURLToPath(import.meta.url));
const EFFORTS = ["low", "medium", "high", "xhigh"];
// Inline skills cannot switch model (measured), so skill roles only ever run on the main model.
const SKILL_CELLS = [...EFFORTS, "max"].map((effort) => ({ model: "opus", effort }));
const AGENT_CELLS = ["haiku", "sonnet", "opus"]
  .flatMap((model) => EFFORTS.map((effort) => ({ model, effort })))
  .concat({ model: "opus", effort: "max" });
const READ_ONLY = ["Read", "Grep", "Glob"];

function parseArgs(argv) {
  const a = { cases: "*/*", runs: 1, out: join(EVALS, "results", "latest"), only: null, root: join(EVALS, "cases"), smoke: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => argv[++i];
    if (k === "--cases") a.cases = v();
    else if (k === "--runs") a.runs = Number(v());
    else if (k === "--out") a.out = resolve(v());
    else if (k === "--only") a.only = resolve(v());
    else if (k === "--root") a.root = resolve(v());
    else if (k === "--smoke") a.smoke = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

const globRe = (g) => new RegExp(`^${g.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);

function loadCases(root, pattern) {
  const re = globRe(pattern), out = [];
  const dirs = (d) => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const role of dirs(root)) for (const name of dirs(join(root, role))) {
    const dir = join(root, role, name), id = `${role}/${name}`;
    if (!re.test(id) || !existsSync(join(dir, "case.json"))) continue;
    const c = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
    out.push({
      id, dir, role: c.role ?? role, agent: c.agent ?? null, skill: c.skill ?? null,
      tools: (c.allowed_tools ?? READ_ONLY).join(","), matrix: c.matrix ?? (c.agent ? AGENT_CELLS : SKILL_CELLS),
      followups: c.followups ?? [], timeout: (c.timeout_seconds ?? 900) * 1000,
      prompt: readFileSync(join(dir, "prompt.md"), "utf8").trim(),
    });
  }
  return out;
}

function* entries(file) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try { yield JSON.parse(line); } catch {}
  }
}

const configDir = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
function findTranscript(sid) {
  const root = join(configDir(), "projects");
  if (!sid || !existsSync(root)) return null;
  for (const d of readdirSync(root)) {
    const f = join(root, d, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

function skillFired(file, skill) {
  if (!file) return false;
  for (const o of entries(file)) {
    const content = o.type === "assistant" ? o.message?.content : null;
    if (Array.isArray(content) && content.some((b) => b.type === "tool_use" && b.name === "Skill" && b.input?.skill === skill)) return true;
  }
  return false;
}

// Every turn re-passes model, effort and agent: --resume alone falls back to the saved defaults (measured).
function claudeArgs(c, cell) {
  return ["--model", cell.model, "--effort", cell.effort, "--permission-mode", "dontAsk", "--allowedTools", c.tools,
    ...(c.agent ? ["--agent", c.agent] : [])];
}

function runP(c, cell, wd) {
  const t = { cost: 0, outTokens: 0, turns: 0, ms: 0, models: new Set() };
  let sid = null;
  for (const prompt of [c.prompt, ...c.followups]) {
    const args = ["-p", prompt, ...claudeArgs(c, cell), "--output-format", "json", ...(sid ? ["--resume", sid] : [])];
    const r = spawnSync("claude", args, { cwd: wd, encoding: "utf8", timeout: c.timeout, stdio: ["ignore", "pipe", "pipe"] });
    let j;
    try { j = JSON.parse(r.stdout); } catch { return { status: "errored", error: String(r.error || r.stderr || "no output").slice(0, 300) }; }
    if (j.is_error && j.subtype !== "error_max_turns") return { status: "errored", error: String(j.result ?? j.subtype).slice(0, 300) };
    sid = j.session_id;
    t.cost += j.total_cost_usd ?? 0; t.turns += j.num_turns ?? 0; t.ms += j.duration_ms ?? 0;
    for (const [m, u] of Object.entries(j.modelUsage ?? {})) { t.models.add(m); t.outTokens += u.outputTokens ?? 0; }
  }
  return { status: "ran", session: sid, transcript: findTranscript(sid), ...t, models: [...t.models] };
}

function grade(c, wd, res) {
  if (c.skill && !skillFired(res.transcript, c.skill)) return "invalid";
  const r = spawnSync("bash", [join(c.dir, "grade.sh")], {
    cwd: wd, timeout: 120000, stdio: "ignore", env: { ...process.env, WORKDIR: wd, TRANSCRIPT: res.transcript ?? "" },
  });
  return r.status === 0 ? "pass" : "fail";
}

const key = (r) => [r.case, r.model, r.effort, r.run].join("|");
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

function main(argv) {
  const a = parseArgs(argv);
  const cases = loadCases(a.root, a.smoke ? "pilot/*" : a.cases);
  const only = a.only ? new Set(readFileSync(a.only, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)) : null;
  const rowsFile = join(a.out, "rows.jsonl");
  mkdirSync(a.out, { recursive: true });
  const done = new Set((existsSync(rowsFile) ? [...entries(rowsFile)] : []).filter((r) => r.status !== "errored").map(key));
  const claude = sh("claude", ["--version"]).stdout?.trim() || null;
  let streak = 0;
  for (const c of cases) {
    for (const cell of a.smoke ? [{ model: "haiku", effort: "low" }] : c.matrix) {
      if (only && !only.has(`${c.id} ${cell.model} ${cell.effort}`)) continue;
      for (let run = 1; run <= a.runs; run++) {
        const row = { case: c.id, role: c.role, agent: c.agent, model: cell.model, effort: cell.effort, run, claude };
        if (done.has(key(row))) continue;
        const wd = mkdtempSync(join(tmpdir(), "eval-"));
        try {
          cpSync(join(c.dir, "fixture"), wd, { recursive: true });
          const res = runP(c, cell, wd);
          Object.assign(row, res, { status: res.status === "ran" ? grade(c, wd, res) : res.status });
        } finally {
          rmSync(wd, { recursive: true, force: true });
        }
        appendFileSync(rowsFile, `${JSON.stringify(row)}\n`);
        console.log(`${row.status.padEnd(7)} ${c.id} ${cell.model} ${cell.effort} #${run}`);
        streak = row.status === "errored" ? streak + 1 : 0;
        if (streak >= 2) { console.error("two errored runs in a row; stopping (re-run to resume)"); return 3; }
      }
    }
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
