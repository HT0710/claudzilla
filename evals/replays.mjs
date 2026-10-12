#!/usr/bin/env node
// Recorded Agent calls → local replay cases in <out>/<role>/<base7>-<head7>/; prints their "<case> opus max" reference cells.
//   node evals/replays.mjs [--repo DIR] [--out DIR] [--per-role N]
// Output stays gitignored: prompts carry local paths and private context.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS = dirname(fileURLToPath(import.meta.url));
// general-purpose calls replay only when they are reviews: that is the role the synthetic sdd-reviewer case scores.
const ROLES = { "caveman:cavecrew-reviewer": "cavecrew-reviewer", "general-purpose": "sdd-reviewer", Explore: "investigator", Plan: "plan" };
const TOOLS = ["Read", "Grep", "Glob", "Bash(git:*)", "Bash(node:*)", "Bash(bash tests/:*)"];

const a = { repo: null, out: join(EVALS, "replays"), perRole: 5 };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i], v = () => process.argv[++i];
  if (k === "--repo") a.repo = resolve(v());
  else if (k === "--out") a.out = resolve(v());
  else if (k === "--per-role") a.perRole = Number(v());
  else throw new Error(`unknown argument: ${k}`);
}
const git = (...args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
// Default: the main checkout, so calls recorded in it and in its sibling worktrees all count.
const repo = a.repo ?? dirname(execFileSync("git", ["-C", EVALS, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
const commit = (s) => (git("rev-parse", "-q", "--verify", `${s}^{commit}`).stdout.trim() || null);
const isAnc = (x, y) => x === y || git("merge-base", "--is-ancestor", x, y).status === 0;

function calls() {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  const prefix = repo.replace(/[^A-Za-z0-9]/g, "-");
  const out = [];
  for (const d of existsSync(root) ? readdirSync(root).filter((d) => d.startsWith(prefix)) : [])
    for (const f of readdirSync(join(root, d)).filter((f) => f.endsWith(".jsonl")))
      for (const line of readFileSync(join(root, d, f), "utf8").split("\n")) {
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
        for (const b of o.message.content)
          if (b.type === "tool_use" && b.name === "Agent") out.push({ ts: o.timestamp ?? "", agent: b.input?.subagent_type ?? "general-purpose", prompt: String(b.input?.prompt ?? "") });
      }
  return out;
}

function toCase(c) {
  const role = ROLES[c.agent];
  if (!role || (c.agent === "general-purpose" && !/\breview/i.test(c.prompt))) return null;
  // The checkout and its sibling worktrees (<repo>-<slug>) all become the replay workdir.
  const prompt = c.prompt.replace(new RegExp(`${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-[\\w.-]+)?`, "g"), "{{WORKDIR}}");
  const range = prompt.match(/\b([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})\b/);
  let base = range && commit(range[1]), head = range && commit(range[2]);
  if (!base || !head) {
    // Head descends from every named commit. Several named commits are base and tip (BASE_SHA/HEAD_SHA),
    // unless they sit beside `main..HEAD`: then, like a lone commit, they are the branch's own and base is the oldest's parent.
    const shas = [...new Set((prompt.match(/\b[0-9a-f]{7,40}\b/g) ?? []).map(commit).filter(Boolean))];
    head = shas.find((h) => shas.every((s) => isAnc(s, h)));
    const oldest = shas.find((o) => shas.every((s) => isAnc(o, s)));
    base = oldest && (shas.length > 1 && !/main\.\.\.?HEAD/.test(prompt) ? oldest : commit(`${oldest}^`));
  }
  if (!base || !head) return null;
  const extra = [];
  for (const raw of new Set(prompt.match(/(?:\{\{WORKDIR\}\}|\/(?:home|tmp|Users)\/)[^\s`'"(),;]*/g) ?? [])) {
    const p = raw.replace(/[.:]+$/, "");
    if (/[<>[\]*]/.test(p)) continue; // template placeholder, e.g. /tmp/review-<sha>
    if (!p.startsWith("{{WORKDIR}}")) { if (existsSync(p)) continue; return null; }
    const rel = p.slice("{{WORKDIR}}".length).replace(/^\//, "");
    if (!rel || git("cat-file", "-e", `${head}:${rel}`).status === 0) continue;
    // Not in the commit: a local-only file (e.g. an excluded plan) travels with the case; anything gone drops the call.
    if (!existsSync(join(repo, rel))) return null;
    extra.push(rel);
  }
  return { role, agent: c.agent, ts: c.ts, base, head, prompt, extra };
}

function write(id, k) {
  const dir = join(a.out, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "case.json"), `${JSON.stringify({ agent: k.agent, source: "replay", judge: true, allowed_tools: TOOLS, timeout_seconds: 1800 }, null, 2)}\n`);
  writeFileSync(join(dir, "prompt.md"), `${k.prompt}\n`);
  for (const rel of k.extra) cpSync(join(repo, rel), join(dir, "extra", rel), { recursive: true });
  writeFileSync(join(dir, "setup.sh"), [
    "#!/usr/bin/env bash",
    "# The checkout the recorded call saw: main at the base, HEAD at the reviewed tip, no origin to push to.",
    "set -e",
    `git clone -q --shared --no-checkout '${repo}' .`,
    "git remote remove origin",
    `git checkout -q -B main ${k.base}`,
    `git checkout -q -b replay ${k.head}`,
    '[ ! -d "$CASE_DIR/extra" ] || cp -R "$CASE_DIR/extra/." .',
    "",
  ].join("\n"));
}

rmSync(a.out, { recursive: true, force: true });
const seen = new Set(), per = new Map();
for (const k of calls().map(toCase).filter(Boolean).sort((x, y) => y.ts.localeCompare(x.ts))) {
  const id = `${k.role}/${k.base.slice(0, 7)}-${k.head.slice(0, 7)}`;
  if (seen.has(id) || (per.get(k.role) ?? 0) >= a.perRole) continue;
  seen.add(id);
  per.set(k.role, (per.get(k.role) ?? 0) + 1);
  write(id, k);
  console.log(`${id} opus max`);
}
