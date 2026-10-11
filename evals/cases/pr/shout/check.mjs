// Exits 1 unless the last `gh pr create` carries a Conventional title and the template's bold labels,
// and the README's shout example, run as written, prints what the README promises.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const fail = (msg) => { console.error(msg); process.exit(1); };
const calls = existsSync(".gh.log") ? readFileSync(".gh.log", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const create = calls.filter((c) => c.args[0] === "pr" && c.args[1] === "create").pop() ?? fail("no gh pr create");
const a = create.args;
const opt = (long, short) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === long || a[i] === short) return a[i + 1];
    if (a[i].startsWith(`${long}=`)) return a[i].slice(long.length + 1);
  }
  return null;
};
const title = opt("--title", "-t") ?? "";
if (!/^(feat|fix|refactor|chore|docs|test)(\([^)]+\))?: \S/.test(title) || [...title].length > 50) fail(`bad title: ${title}`);
const body = create.bodyFile ?? opt("--body", "-b") ?? "";
for (const label of ["**Why:**", "**Changes:**", "**Test plan:**"]) if (!body.includes(label)) fail(`body lacks ${label}`);
const ex = readFileSync("README.md", "utf8").match(/`(node src\/cli\.mjs shout [^`]+)` → `([^`]+)`/) ?? fail("no shout example");
const out = execSync(ex[1], { encoding: "utf8" }).trim();
if (out !== ex[2]) fail(`README example prints ${out}, not ${ex[2]}`);
