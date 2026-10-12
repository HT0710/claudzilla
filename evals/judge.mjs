#!/usr/bin/env node
// Score judged rows (replays, case.json "judge": true) against the same case's reference run; appends to scores.jsonl beside the rows.
//   node evals/judge.mjs <rows.jsonl> <reference rows.jsonl>
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS = dirname(fileURLToPath(import.meta.url));
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["score", "matched", "missed"],
  properties: { score: { type: "number", minimum: 0, maximum: 1 }, matched: { type: "array", items: { type: "string" } }, missed: { type: "array", items: { type: "string" } } },
};
const RUBRIC = `You grade an AI agent's output against a reference output for the same task. Use only the two texts below.
List the reference's substantive points: for a review, each real finding (bug, risk, missing requirement), not praise or style; for a plan or an answer, each key decision or fact.
A point is matched when the candidate makes the same point (same problem, same place) in any wording. Points only the candidate makes do not count.
score = matched / total. matched and missed name the reference points.
If the reference has no substantive points, score 1 when the candidate raises no real problem either, else 0.`;

const [file, refFile] = process.argv.slice(2);
const read = (f) => (f && existsSync(f) ? readFileSync(f, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const key = (r) => [r.case, r.model, r.effort, r.run].join("|");
const text = (t) => spawnSync("node", [join(EVALS, "tx.mjs"), "text", t], { encoding: "utf8" }).stdout.trim();
const out = join(dirname(file), "scores.jsonl");
const done = new Set(read(out).map(key));
const refs = new Map();
for (const r of read(refFile)) if (!refs.has(r.case) && r.transcript && ["pass", "fail", "replayed"].includes(r.status)) refs.set(r.case, r);

let streak = 0, n = 0;
for (const r of read(file)) {
  if (!r.judge || done.has(key(r)) || !["pass", "fail", "replayed"].includes(r.status)) continue;
  const ref = refs.get(r.case), refText = ref && existsSync(ref.transcript) ? text(ref.transcript) : "";
  // A missing transcript or reference is not a model miss: skip so a later run can score it.
  if (!refText || !existsSync(r.transcript ?? "")) { console.error(`skipped ${key(r)}: no reference or transcript`); continue; }
  const cand = text(r.transcript);
  let s = { score: 0, matched: [], missed: ["(no output)"], cost: 0 };
  if (cand) {
    // Fixed judge cell (spec), never swept; no tools, so the score rests on the two texts alone.
    const p = spawnSync("claude", ["-p", `${RUBRIC}\n\n<reference>\n${refText}\n</reference>\n\n<candidate>\n${cand}\n</candidate>`,
      "--model", "opus", "--effort", "high", "--tools", "", "--json-schema", JSON.stringify(SCHEMA), "--output-format", "json", "--no-session-persistence"],
      { cwd: tmpdir(), encoding: "utf8", timeout: 600000 });
    let j; try { j = JSON.parse(p.stdout); } catch {}
    if (!j?.structured_output || j.is_error) {
      console.error(`judge errored on ${key(r)}`);
      if (++streak >= 2) { console.error("two judge errors in a row; stopping (re-run to resume)"); process.exit(3); }
      continue;
    }
    streak = 0;
    s = { ...j.structured_output, cost: j.total_cost_usd ?? 0 };
  }
  appendFileSync(out, `${JSON.stringify({ case: r.case, role: r.role, model: r.model, effort: r.effort, run: r.run, ...s })}\n`);
  n++;
}
console.log(`scored ${n} rows → ${out}`);
