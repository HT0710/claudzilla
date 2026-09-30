#!/usr/bin/env node
// Per-rule counts from Claude Code transcripts. Output never holds transcript text.
//   node scan.mjs [--days N] [--dir PATH] [--save [--background] | --issue [--brief] | --share | --nudge]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaudeConfigDir } from "../../hud/lib/config-dir.mjs";
import {
  CLAIM_RE, DEFAULTS, MACHINE_PROMPT, SESSION_RE, VERIFY,
  commitSubject, expand, firedRules, forceFlag, formatFlags, ghPr, gitParse, keywordRe, loadConfig, mcpPr, proseOf, subjectProblem, unquote,
} from "../../hooks/rules-guard.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// Bump when counting changes, so the nudge refreshes instead of showing old counts.
const SCHEMA = 2;
const RULES = Object.keys(DEFAULTS.rules);
const FORMAT = ["tldr", "emoji", "brInTable", "boxAlign"];
const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
// Local-command echoes, interrupts and compaction resumes are not the user asking for something.
const NOT_ASKED = /^(?:<(?:local-command-|bash-)|\[Request interrupted|This session is being continued)/;

const fail = (msg) => { process.stderr.write(`rule-review: ${msg}\n`); process.exit(1); };
const has = (skills, name) => skills.some((k) => k === name || k.endsWith(`:${name}`));
// Content blocks that are objects; transcripts can hold null or odd entries.
const blocks = (c) => (Array.isArray(c) ? c.filter((x) => x && typeof x === "object") : []);
const textOf = (c) => (typeof c === "string" ? c : blocks(c).filter((x) => x.type === "text").map((x) => x.text).join("\n"));

// kind: "real" opens a turn; "machine" is a prompt the hook sees but the user didn't type;
// "skip" (skill bodies, command echoes) leaves the last prompt's kind alone. Null = not a prompt.
function promptOf(o) {
  let text, meta = o.isMeta;
  if (o.type === "attachment" && o.attachment?.type === "queued_command") {
    // Typed while Claude was busy: stored only as an attachment.
    if (o.attachment.commandMode === "task-notification") return { kind: "machine" };
    if (o.attachment.commandMode !== "prompt") return null;
    text = String(o.attachment.prompt ?? "").trimStart();
  } else if (o.type === "user") {
    const c = o.message?.content;
    if (blocks(c).some((x) => x.type === "tool_result")) return null;
    text = textOf(c).trimStart();
  } else return null;
  const typed = text.match(/<command-name>\/([\w:-]+)<\/command-name>/);
  if (typed) return { kind: "real", text: "", typed: typed[1] };
  if (MACHINE_PROMPT.test(text)) return { kind: "machine" };
  if (meta || NOT_ASKED.test(text)) return { kind: "skip" };
  return { kind: "real", text };
}

function scan(root, days) {
  if (!existsSync(root)) fail(`no transcripts at ${root}`);
  if (!statSync(root).isDirectory()) fail(`not a directory: ${root}`);
  const since = Date.now() - days * 864e5;
  const cfg = loadConfig("").cfg;
  const all = { ...cfg, rules: DEFAULTS.rules };
  const rules = Object.fromEntries(RULES.map((id) => [id, { applies: 0, slips: 0, hookFires: 0, falseFires: 0 }]));
  // When each rule reached this machine (install.sh); a turn before that can't slip it.
  let arrived = {};
  try { arrived = JSON.parse(readFileSync(join(getClaudeConfigDir(), ".claudzilla-rules.json"), "utf8")) ?? {}; } catch { /* not stamped: count nothing */ }
  let at = "";
  const add = (id, key) => {
    if ((key === "applies" || key === "slips") && !(typeof arrived[id] === "string" && at >= arrived[id])) return;
    rules[id][key]++;
  };
  let sessions = 0, turns = 0, unparsed = 0;
  // Repo allows commits on main (its claudzilla config): such a commit is no slip.
  const allow = new Map();
  const allowsMain = (cwd) => {
    if (!cwd) return false;
    if (!allow.has(cwd)) {
      let v = false;
      try { v = loadConfig(cwd).cfg.allowMain === true; } catch { /* unreadable: default */ }
      allow.set(cwd, v);
    }
    return allow.get(cwd);
  };

  // Same PR matching as the hook (ghPr / mcpPr); only the exact `pr` skill counts.
  const countPr = ({ op, describes }, c) => {
    const ran = !c.denied;
    add("sessionLink", "applies");
    if (ran && SESSION_RE.test(c.cmd)) add("sessionLink", "slips");
    if (op === "create") {
      add("pushVerify", "applies");
      if (ran && !has(c.skills, VERIFY)) add("pushVerify", "slips");
    }
    if (describes) {
      add("prSkill", "applies");
      if (ran && !c.skills.includes("pr")) add("prSkill", "slips");
    }
  };

  const finish = (t) => {
    // A built-in command (/clear, /login) gets no reply: not a request.
    if (t.typed && !t.answered) return;
    if (!t.sess.counted) { sessions++; t.sess.counted = true; }
    turns++;
    at = t.ts;
    for (const c of t.cmds) {
      const ran = !c.denied;
      if (c.pr) { countPr(c.pr, c); continue; }
      // After cd, -C or a switch/checkout in the same command the branch may differ from the
      // transcript's; unknown, so not counted (an in-repo `cd sub` under-counts, the safe side).
      let moved = false;
      for (const seg of expand(c.cmd)) {
        if (seg[0] === "cd" || (seg[0] === "git" && ["switch", "checkout"].includes(gitParse(seg, ".").sub))) moved = true;
        if (seg[0] === "git") {
          const { dir, sub, a } = gitParse(seg, ".");
          if (sub === "push") {
            add("pushVerify", "applies"); add("forcePush", "applies");
            if (ran && !has(c.skills, VERIFY)) add("pushVerify", "slips");
            if (ran && forceFlag(a)) add("forcePush", "slips");
          } else if (sub === "commit") {
            add("sessionLink", "applies");
            if (!moved && dir === "." && !allowsMain(c.cwd)) {
              add("mainCommit", "applies");
              if (ran && ["main", "master"].includes(c.branch)) add("mainCommit", "slips");
            }
            if (ran && SESSION_RE.test(c.cmd)) add("sessionLink", "slips");
            if (commitSubject(c.cmd) != null) {
              add("commitSubject", "applies");
              if (ran && subjectProblem(c.cmd, cfg)) add("commitSubject", "slips");
            }
          }
        } else if (seg[0] === "gh") {
          const pr = ghPr(seg);
          if (pr) countPr(pr, c);
        }
      }
    }
    if (t.reply) {
      for (const id of FORMAT) add(id, "applies");
      for (const [id] of formatFlags(t.reply, all)) add(id, "slips");
      if (t.edited) {
        add("doneClaim", "applies");
        if (CLAIM_RE.test(proseOf(t.reply)) && !has(t.skills, VERIFY)) add("doneClaim", "slips");
      }
    }
    if (!t.typed) {
      const bare = unquote(t.text);
      for (const [id, words, skill] of [["debugTrigger", cfg.keywords.debug, "systematic-debugging"], ["reviewTrigger", cfg.keywords.review, "receiving-code-review"]]) {
        if (!keywordRe(words).test(bare)) continue;
        add(id, "applies");
        if (!has(t.skills, skill)) add(id, "slips");
      }
    }
  };

  const scanFile = (file) => {
    let turn = null, machine = false;
    const sess = { counted: false };
    const cmds = new Map();
    const fired = (text, fromPrompt) => {
      for (const id of firedRules(text)) {
        add(id, "hookFires");
        if (fromPrompt && machine && (id === "debugTrigger" || id === "reviewTrigger")) add(id, "falseFires");
      }
    };
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { unparsed++; continue; }
      if (!o || typeof o !== "object") { unparsed++; continue; }
      const p = promptOf(o);
      if (p) {
        if (p.kind === "skip") continue;
        machine = p.kind === "machine";
        if (machine) continue;
        if (turn) finish(turn);
        turn = null;
        if (!(Date.parse(o.timestamp) >= since)) continue;
        turn = { ts: String(o.timestamp ?? ""), text: p.text, typed: p.typed, skills: p.typed ? [p.typed] : [], cmds: [], edited: false, reply: "", branch: o.gitBranch, answered: false, sess };
        continue;
      }
      if (!turn) continue;
      if (o.type === "assistant") {
        turn.answered = true;
        for (const x of blocks(o.message?.content)) {
          if (x.type === "text" && typeof x.text === "string" && x.text.trim()) turn.reply = x.text;
          if (x.type !== "tool_use") continue;
          if (x.name === "Skill") turn.skills.push(String(x.input?.skill ?? ""));
          if (EDITS.has(x.name)) turn.edited = true;
          const pr = mcpPr(x.name, x.input);
          if (x.name === "Bash" || pr) {
            const cmd = pr ? JSON.stringify(x.input ?? {}) : String(x.input?.command ?? "");
            const c = { cmd, pr, skills: [...turn.skills], branch: o.gitBranch ?? turn.branch, cwd: o.cwd, denied: false };
            cmds.set(x.id, c);
            turn.cmds.push(c);
          }
        }
      } else if (o.type === "user") {
        for (const x of blocks(o.message?.content)) {
          const text = textOf(x.content);
          if (x.type !== "tool_result" || !x.is_error || !/^PreToolUse:\S+ hook error:/.test(text)) continue;
          const c = cmds.get(x.tool_use_id);
          if (c) c.denied = true;
          fired(text, false);
        }
      } else if (o.type === "attachment" && o.attachment?.type === "hook_additional_context") {
        for (const text of Array.isArray(o.attachment.content) ? o.attachment.content : []) fired(String(text), o.attachment.hookEvent === "UserPromptSubmit");
      } else if (o.type === "system" && o.subtype === "stop_hook_summary") {
        for (const text of Array.isArray(o.hookAdditionalContext) ? o.hookAdditionalContext : []) fired(String(text), false);
      }
    }
    if (turn) finish(turn);
  };

  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(root, d.name), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".jsonl")) scanFile(join(root, d.name, f.name));
    }
  }
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  let claudzilla = "unknown";
  try { claudzilla = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a checkout */ }
  return { schema: SCHEMA, claudzilla, window: { from: day(since), to: day(Date.now()) }, sessions, turns, unparsed, rules };
}

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const days = Number(opt("--days", "14"));
if (!Number.isInteger(days) || days < 1) fail("--days needs a positive integer");
const root = opt("--dir", join(getClaudeConfigDir(), "projects"));
const REPORTS = join(getClaudeConfigDir(), "claudzilla-reports");
const saved = () => (existsSync(REPORTS) ? readdirSync(REPORTS).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).sort() : []);
const readReport = (f) => JSON.parse(readFileSync(join(REPORTS, f), "utf8"));
// Last report the user has seen (via /rule-review or a nudge).
const SEEN = join(REPORTS, ".nudged");
const markSeen = (f) => writeFileSync(SEEN, `${f}\n`);
function latest() {
  const f = saved().at(-1);
  if (!f) fail("no saved report; run with --save first");
  try { return readReport(f); } catch { return fail(`unreadable report ${join(REPORTS, f)}`); }
}
const span = (r) => Date.parse(r?.window?.to) - Date.parse(r?.window?.from);
function issue(r) {
  const used = Object.entries(r.rules).filter(([, v]) => v.applies || v.slips || v.hookFires || v.falseFires);
  const head = `claudzilla \`${r.claudzilla}\` · ${r.window.from}..${r.window.to} · ${r.sessions} sessions · ${r.turns} turns`;
  // One line, zero rules dropped (a missing rule = all counts 0).
  const json = JSON.stringify({ ...r, rules: Object.fromEntries(used) });
  const table = [
    "| rule | applies | slips | hook fires | false fires |",
    "|---|---|---|---|---|",
    ...used.map(([id, v]) => `| ${id} | ${v.applies} | ${v.slips} | ${v.hookFires} | ${v.falseFires} |`),
  ];
  const body = [
    "Counts only: no prompts, replies, commands or paths. Sent from `/rule-review`.",
    "", head, "", ...table, "",
    "<details><summary>JSON</summary>", "", json, "", "</details>",
  ].join("\n");
  return { title: `rule-report ${r.claudzilla} ${r.window.to}`, body, brief: head };
}
// SessionStart: show an unseen report's summary once; refresh a missing or week-old report
// in the background so startup never waits on a scan. Never fails the hook.
async function nudge() {
  let cwd;
  try {
    let raw = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) raw += chunk;
    cwd = JSON.parse(raw).cwd;
  } catch { /* no payload: machine config only */ }
  try {
    if (loadConfig(cwd).cfg.reviewNudge === false) return;
  } catch { return; }
  let name, r = null;
  try { name = saved().at(-1); } catch { return; }
  try { r = name ? readReport(name) : null; } catch { /* unreadable: say nothing */ }
  // Unreadable, week-old or counted by older rules: refresh quietly, show the new one next session.
  const stale = !name || !r || Date.now() - Date.parse(name.slice(0, 10)) > 7 * 864e5 || (r && r.schema !== SCHEMA);
  try {
    let seen = "";
    try { seen = readFileSync(SEEN, "utf8").trim(); } catch { /* never shown */ }
    const rules = r && !stale && name !== seen ? Object.entries(r.rules) : [];
    const slips = rules.reduce((n, [, v]) => n + v.slips, 0);
    if (slips > 0) {
      const [top, v] = rules.reduce((a, b) => (b[1].slips > a[1].slips ? b : a));
      const days = Math.round((Date.parse(r.window.to) - Date.parse(r.window.from)) / 864e5);
      const line = `claudzilla: ${slips} rule slips in ${r.sessions} sessions (${days} days) · most: ${top} ${v.slips}× · /rule-review to see and share`;
      process.stdout.write(`${JSON.stringify({ systemMessage: line })}\n`);
      markSeen(name);
    }
  } catch { /* unreadable report: say nothing */ }
  // ponytail: no lock; sessions starting together may each scan, same dated file, add a lock if that costs
  if (stale) {
    try {
      spawn(process.execPath, [fileURLToPath(import.meta.url), "--save", "--background"], { detached: true, stdio: "ignore" })
        .on("error", () => { /* can't start: try next session */ })
        .unref();
    } catch { /* can't spawn: try next session */ }
  }
}
function repoSlug() {
  let url = "";
  try { url = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* no origin */ }
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) fail(`origin is not a GitHub repo: ${url || "none"}`);
  return m[1];
}

if (args.includes("--issue")) {
  const { title, body, brief } = issue(latest());
  process.stdout.write(`${title}\n\n${args.includes("--brief") ? brief : body}\n`);
} else if (args.includes("--share")) {
  const { title, body } = issue(latest());
  const slug = repoSlug();
  try {
    process.stdout.write(execFileSync("gh", ["issue", "create", "--repo", slug, "--label", "rule-report", "--title", title, "--body", body], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    const q = new URLSearchParams({ labels: "rule-report", title, body });
    process.stdout.write(`gh unavailable or failed; open this link to file the report:\nhttps://github.com/${slug}/issues/new?${q}\n`);
  }
} else if (args.includes("--nudge")) {
  await nudge();
} else {
  const report = scan(root, days);
  if (args.includes("--save")) {
    const name = `${report.window.to}.json`;
    // Compare like with like: the latest earlier report, same schema, same number of days.
    let previous = null;
    for (const f of saved().filter((x) => x < name).reverse()) {
      try { const r = readReport(f); if (r.schema === report.schema && span(r) === span(report)) { previous = r; break; } } catch { /* unreadable: skip */ }
    }
    // tmp + rename: a reader or a parallel scan never sees half a report; saved() skips .tmp
    const tmp = join(REPORTS, `${name}.${process.pid}.tmp`);
    try {
      mkdirSync(REPORTS, { recursive: true });
      writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
      renameSync(tmp, join(REPORTS, name));
    } catch {
      try { unlinkSync(tmp); } catch { /* never written */ }
      fail(`can't save report to ${REPORTS}`);
    }
    if (!args.includes("--background")) {
      markSeen(name);
      process.stdout.write(`${JSON.stringify({ report, previous }, null, 2)}\n`);
    }
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
