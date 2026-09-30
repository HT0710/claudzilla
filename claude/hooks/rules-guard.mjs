#!/usr/bin/env node
// Enforces claudzilla rules (claude/rules/*.md) at the moment they apply.
// Fails open: a guardrail, not security.
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaudeConfigDir } from "../hud/lib/config-dir.mjs";

const VERIFY = "verification-before-completion";
const MSG = {
  debug: "Auto: invoke superpowers:systematic-debugging; stop after Phase 3, fix on go.",
  review: "Auto: invoke superpowers:receiving-code-review.",
  debugGate: "Debug turn: systematic-debugging stops at Phase 3 — propose the fix and wait for go unless the user asked for a direct edit.",
  doneClaim: "Claimed done without verification-before-completion. Invoke superpowers:verification-before-completion now and report its evidence.",
};
// Hook texts → rule ids, so rule-review can count fires from transcripts.
const MSG_RULE = { debug: "debugTrigger", review: "reviewTrigger", debugGate: "debugGate", doneClaim: "doneClaim" };
const FLAG = {
  doneClaim: "claimed done without verification-before-completion",
  tldr: "missing TL;DR",
  emoji: "decorative emoji",
  brInTable: "<br> in table cell",
  boxAlign: "diagram box edge misaligned",
};
// Task notifications and peer-session messages arrive as prompts; their words are not the user's.
const MACHINE_PROMPT = /^(?:<task-notification>|Another Claude session sent a message:|\[Cross-session)/;

// Config: built-in defaults ← ~/.claude/claudzilla.json ← <repo>/.claude/claudzilla.json ← <repo>/.claude/claudzilla.local.json
const GATE = ["deny", "remind", "off"];
const LEVELS = {
  pushVerify: GATE, prSkill: GATE, forcePush: GATE, discard: GATE, mainCommit: GATE,
  commitSubject: GATE, sessionLink: GATE, envStaged: GATE, worktreePath: GATE,
  debugTrigger: ["remind", "off"], reviewTrigger: ["remind", "off"], debugGate: ["remind", "off"],
  specExclude: ["on", "off"],
  doneClaim: ["now", "flag", "off"], tldr: ["flag", "off"], emoji: ["flag", "off"], brInTable: ["flag", "off"], boxAlign: ["flag", "off"],
};
const DEFAULTS = {
  rules: Object.fromEntries(Object.entries(LEVELS).map(([id, l]) => [id, l[0]])),
  keywords: {
    debug: ["bug", "error", "fail", "broken", "crash", "exception", "traceback", "not working", "doesn't work", "doesnt work"],
    review: ["code review", "review comment", "review feedback", "reviewer said", "reviewer says", "PR comment"],
  },
  commitTypes: ["feat", "fix", "refactor", "chore", "docs", "test"],
  subjectMax: 50,
  tldrMinLines: 15,
  allowMain: false,
  reviewNudge: true,
  compactNudge: 150000,
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v >= 1;
const PARAMS = {
  commitTypes: [(v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && /^[a-z]+$/.test(x)), "expected non-empty array of lowercase words"],
  subjectMax: [posInt, "expected integer >= 1"],
  tldrMinLines: [posInt, "expected integer >= 1"],
  allowMain: [(v) => typeof v === "boolean", "expected true or false"],
  reviewNudge: [(v) => typeof v === "boolean", "expected true or false"],
  compactNudge: [(v) => Number.isInteger(v) && v >= 0, "expected integer >= 0 (0 = off)"],
};
const words = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "");

function applyLayer(cfg, rg, file, warnings) {
  const bad = (key, why) => warnings.push(`${file}: rulesGuard.${key} ignored: ${why}`);
  for (const [k, v] of Object.entries(rg)) {
    if (k === "rules" || k === "keywords") {
      if (!isObj(v)) { bad(k, "expected an object"); continue; }
      for (const [id, x] of Object.entries(v)) {
        if (!Object.hasOwn(cfg[k], id)) continue;
        if (k === "rules" ? LEVELS[id].includes(x) : words(x)) cfg[k][id] = x;
        else bad(`${k}.${id}`, k === "rules" ? `expected ${LEVELS[id].join(" or ")}` : "expected non-empty array of strings");
      }
    } else if (Object.hasOwn(PARAMS, k)) {
      if (PARAMS[k][0](v)) cfg[k] = v; else bad(k, PARAMS[k][1]);
    }
  }
}

function loadConfig(dir) {
  const cfg = structuredClone(DEFAULTS), warnings = [];
  const files = [join(getClaudeConfigDir(), "claudzilla.json")];
  const top = dir ? git(dir, "rev-parse", "--show-toplevel") : "";
  if (top) files.push(join(top, ".claude", "claudzilla.json"), join(top, ".claude", "claudzilla.local.json"));
  for (const f of files) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    let j;
    try { j = JSON.parse(text); } catch { warnings.push(`${f} ignored: invalid JSON`); continue; }
    if (!isObj(j)) { warnings.push(`${f} ignored: not a JSON object`); continue; }
    if (j.rulesGuard === undefined) continue;
    if (!isObj(j.rulesGuard)) { warnings.push(`${f} ignored: rulesGuard is not an object`); continue; }
    applyLayer(cfg, j.rulesGuard, f, warnings);
  }
  return { cfg, warnings };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Plurals and tenses only, so "fail" doesn't catch "failover".
// A keyword starting with a symbol (".env") has no \\b before it; require no word char instead.
// "without broken", "never crashes", "not a bug": negated mentions aren't reports. Same line only;
// "no" left out: "no it crashes", "no error shown" are reports.
const NEGATED = String.raw`(?<!\b(?:without|not|never)[ \t]+(?:(?:a|an|any|the|more)[ \t]+)?)`;
const keywordRe = (list) =>
  new RegExp(`${NEGATED}(?:${list.map((k) => (/^\w/.test(k) ? "\\b" : "(?<!\\w)") + escRe(k)).join("|")})(?:s|es|ed|ing|ure)?(?!\\w)`, "i");
// Records {why, level} for each rule that fires and isn't "off".
const hitter = (cfg, hits) => (id, why) => { if (why && cfg.rules[id] !== "off") hits.push({ why, level: cfg.rules[id] }); };

// Mentions inside `code` or quotes are not claims or triggers.
const unquote = (text) => text.replace(/`[^`\n]*`|"[^"\n]*"|“[^”\n]*”/g, "");
const fresh = () => ({ skills: [], debug: false, debugNudged: false, edited: false, flags: [] });
const statePath = (sid) => join(tmpdir(), "claudzilla-rules", `${String(sid).replace(/[^\w-]/g, "")}.json`);
function load(sid) {
  try { return { ...fresh(), ...JSON.parse(readFileSync(statePath(sid), "utf8")) }; } catch { return fresh(); }
}
function save(sid, s) {
  mkdirSync(dirname(statePath(sid)), { recursive: true });
  writeFileSync(statePath(sid), JSON.stringify(s));
}
const hasSkill = (s, name) => s.skills.some((k) => k === name || k.endsWith(`:${name}`));
const out = (event, fields) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } })}\n`);
const deny = (reason) => out("PreToolUse", { permissionDecision: "deny", permissionDecisionReason: reason });
function git(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}
function gitOk(cwd, ...args) {
  try { execFileSync("git", ["-C", cwd, ...args], { timeout: 2000, stdio: "ignore" }); return true; } catch { return false; }
}

const TAIL = 1024 * 1024;
// Tokens in the prompt as of the last main-thread reply (what the statusline's ctx shows); 0 after a compact or if unknown.
function contextTokens(path) {
  if (!path) return 0;
  let fd;
  try {
    fd = openSync(String(path), "r");
    const { size } = fstatSync(fd), start = Math.max(0, size - TAIL), buf = Buffer.alloc(size - start);
    const lines = buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, start)).split("\n");
    const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"') && !lines[i].includes("compact_boundary")) continue;
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (o?.subtype === "compact_boundary") return 0;
      const u = o?.message?.usage;
      if (o?.type !== "assistant" || o.isSidechain || !u) continue;
      // synthetic replies (API errors, limits) carry all-zero usage
      const sum = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
      if (sum) return sum;
    }
  } catch { /* no transcript */ } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return 0;
}

// Past the threshold, the main model judges whether to suggest /compact; wording strengthens at 2x and 4x.
function compactMsg(tokens, t) {
  if (!t || tokens < t) return;
  const k = `~${Math.round(tokens / 1e3)}k`;
  const head = `Context ${k} tokens, re-sent every turn.`;
  const tail = "Fill each <...>: facts only about finished work, the next step as a condition. Reply doesn't complete a piece of work → don't mention compacting.";
  if (tokens >= 4 * t) {
    return `${head} If this reply completes a piece of work or the older context is clearly stale: turn **Next:** into bullets (add **Next:** if missing) and put this as the FIRST bullet: - **recommend:** \`/compact\` now; <what finished>; unless <that context is needed>, ${k} tokens per turn is mostly waste. ${tail}`;
  }
  const line = tokens >= 2 * t
    ? `- **suggest:** \`/compact\` first; <what finished>; if the next task doesn't need it, each turn re-sends ${k} tokens of mostly unused context`
    : `- *optional: \`/compact\` first; <what finished>; if the next task is unrelated, this skips re-sending ${k} tokens every turn*`;
  return `${head} If this reply completes a piece of work: turn **Next:** into bullets (add **Next:** if missing) and put this as the last bullet: ${line}. ${tail}`;
}

function onPrompt(d) {
  const prev = load(d.session_id);
  const s = fresh();
  const { cfg, warnings } = loadConfig(d.cwd ?? process.cwd());
  const lines = warnings.map((w) => `claudzilla config: ${w}`);
  if (prev.flags.length) lines.push(`Previous reply broke: ${prev.flags.join("; ")}. Apply from this reply on.`);
  const p = String(d.prompt ?? "").trimStart();
  const compact = !MACHINE_PROMPT.test(p) && compactMsg(contextTokens(d.transcript_path), cfg.compactNudge);
  if (compact) lines.push(compact);
  const typed = p.match(/^\/([\w:-]+)/);
  if (typed) s.skills.push(typed[1]);
  else if (!MACHINE_PROMPT.test(p)) {
    const bare = unquote(p);
    if (cfg.rules.debugTrigger === "remind" && keywordRe(cfg.keywords.debug).test(bare)) { s.debug = true; lines.push(MSG.debug); }
    if (cfg.rules.reviewTrigger === "remind" && keywordRe(cfg.keywords.review).test(bare)) lines.push(MSG.review);
  }
  if (lines.length) out("UserPromptSubmit", { additionalContext: lines.join("\n") });
  save(d.session_id, s);
}

function onPostTool(d) {
  if (d.tool_name !== "Skill") return;
  const s = load(d.session_id);
  s.skills.push(String(d.tool_input?.skill ?? ""));
  save(d.session_id, s);
}

const SESSION_RE = /claude\.ai\/code\/session|Claude-Session:/;
const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?([^\n]*)\n([\s\S]*?)\n\s*\1\b/;
const WHY = {
  verify: "Run superpowers:verification-before-completion this turn before push/PR (superpowers.md Order).",
  pr: "Opening or editing a PR: invoke the pr skill first (git.md:59).",
  force: "Force push not allowed; use --force-with-lease only if the user asked (git.md:7).",
  discard: "Discards work. Ask the user; if approved they run `! <cmd>` (git.md:8).",
  main: "Branch first: git switch -c <type>/<slug>. Solo repo that commits to main: set \"allowMain\": true in .claude/claudzilla.local.json (git.md:6).",
  session: "No Claude session link (git.md:55).",
  env: "`.env` staged; unstage it (git.md:21).",
  worktree: "Worktree goes at ../<repo>-<slug> (git.md:27).",
};
const WHY_RULE = { verify: "pushVerify", pr: "prSkill", force: "forcePush", discard: "discard", main: "mainCommit", session: "sessionLink", env: "envStaged", worktree: "worktreePath" };
function firedRules(text) {
  const ids = [];
  // match without the trailing "(file:line)" citation, so fires survive citation edits
  for (const [k, id] of Object.entries(WHY_RULE)) if (text.includes(WHY[k].replace(/ \([^()]*\)\.$/, ""))) ids.push(id);
  for (const [k, id] of Object.entries(MSG_RULE)) if (text.includes(MSG[k])) ids.push(id);
  if (/Commit subject (?:must be|is \d+ chars)/.test(text)) ids.push("commitSubject");
  const prev = text.match(/Previous reply broke: (.*)\. Apply from this reply on\./);
  for (const f of prev ? prev[1].split("; ") : []) {
    const id = Object.keys(FLAG).find((k) => f.startsWith(FLAG[k]));
    if (id) ids.push(id);
  }
  return ids;
}

// Word lists per simple command. Heredoc bodies are message text; quotes group
// words; ; & | ( ) and newlines split only outside quotes.
function segments(cmd) {
  const flat = cmd.replace(new RegExp(HEREDOC_RE.source, "g"), "<<$1$2");
  const segs = [[]];
  let word = null, q = null;
  const end = () => { if (word !== null) segs.at(-1).push(word); word = null; };
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    if (c === "\\" && flat[i + 1] === "\n" && q !== "'") i++;
    else if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < flat.length) word += flat[++i];
      else word += c;
    } else if (c === "'" || c === '"') { q = c; word ??= ""; }
    else if (c === "\\" && i + 1 < flat.length) word = (word ?? "") + flat[++i];
    else if ("\n;&|()".includes(c)) { end(); segs.push([]); }
    else if (/\s/.test(c)) end();
    else word = (word ?? "") + c;
  }
  end();
  return segs.filter((t) => t[0]);
}

function commitSubject(full) {
  // Only flags after `git … commit`, so `python -m x && git commit` isn't read as a message.
  const at = full.search(/\bgit\b[^\n;&|]*?\bcommit\b/);
  const cmd = at === -1 ? full : full.slice(at);
  const doc = cmd.match(HEREDOC_RE);
  const m = cmd.match(/(?:^|\s)(?:-[a-zA-Z]*m|--message)(?:\s+|=)("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/);
  if (m) {
    const v = m[1].replace(/^(["'])([\s\S]*)\1$/, "$2");
    if (v.startsWith("$")) return v.startsWith("$(") && doc ? doc[3].split("\n")[0].trim() : null;
    return v.split("\n")[0].trim();
  }
  if (doc && /(?:^|\s)(?:-F|--file)(?:\s+|=)-(?:\s|$)/.test(cmd)) return doc[3].split("\n")[0].trim();
  return null;
}

function subjectProblem(cmd, cfg) {
  const subj = commitSubject(cmd);
  if (subj == null) return null;
  const types = cfg.commitTypes.join("|");
  if (!new RegExp(`^(${types})(\\([^)]+\\))?: \\S`).test(subj)) return `Commit subject must be Conventional Commits: ${types}[(scope)]: … (git.md:18). Got: ${subj}`;
  const len = [...subj].length;
  return len > cfg.subjectMax ? `Commit subject is ${len} chars; max ${cfg.subjectMax} (git.md:19).` : null;
}

function stagedEnv(dir) {
  const staged = git(dir, "diff", "--cached", "--name-only").split("\n").map((f) => f.split("/").pop());
  return staged.some((f) => /^\.env(\..+)?$/.test(f) && !/^\.env\.(example|sample|template)$/.test(f));
}

function checkCommit(dir, cmd, hit, cfg, branch) {
  hit("sessionLink", SESSION_RE.test(cmd) && WHY.session);
  hit("mainCommit", !cfg.allowMain && ["main", "master"].includes(branch ?? git(dir, "symbolic-ref", "--short", "HEAD")) && WHY.main);
  hit("envStaged", stagedEnv(dir) && WHY.env);
  hit("commitSubject", subjectProblem(cmd, cfg));
}

function worktreePath(a) {
  for (let i = 0; i < a.length; i++) {
    if (["-b", "-B", "--orphan", "--reason"].includes(a[i])) i++;
    else if (!a[i].startsWith("-")) return a[i];
  }
  return null;
}

function insideRepo(dir, p) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  if (!p || !top) return false;
  const abs = resolve(realpathSync(dir), p);
  return abs === top || abs.startsWith(top + sep);
}

const CHECKED = new Set(["push", "reset", "clean", "checkout", "switch", "restore", "stash", "worktree", "commit"]);
const operand = (a) => a.find((x) => !x.startsWith("-"));
const after = (a, flags) => { const i = a.findIndex((x) => flags.includes(x)); return i === -1 ? undefined : a[i + 1]; };

function gitParse(t, cwd) {
  let i = 1, dir = cwd;
  while (t[i]?.startsWith("-")) {
    if (t[i] === "-C") { dir = resolve(cwd, t[i + 1] ?? "."); i += 2; } else i += t[i] === "-c" ? 2 : 1;
  }
  const [sub, ...a] = t.slice(i);
  return { dir, sub, a };
}
const forceFlag = (a) => a.some((x) => x === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x) || /^\+./.test(x));
// Label/reviewer/base edits don't touch the description, so the template doesn't apply.
const prDescribes = (t) => t[2] === "create" || t.slice(3).some((x) => /^(?:--(?:title|body|body-file)(?:=|$)|-[tbF])/.test(x));

// branches: dir → branch a `switch`/`checkout` earlier in the same command moved to.
function checkGit(t, cwd, cmd, s, hits, branches) {
  const { dir, sub, a } = gitParse(t, cwd);
  if (!CHECKED.has(sub)) return;
  const { cfg } = loadConfig(dir);
  const hit = hitter(cfg, hits);
  const discard = (cond) => hit("discard", cond && WHY.discard);
  const isBranch = (x) => gitOk(dir, "rev-parse", "--verify", "-q", `refs/heads/${x}`);
  if (sub === "switch") {
    const to = after(a, ["-c", "-C", "--create", "--force-create"]);
    const x = operand(a);
    if (to) branches.set(dir, to);
    else if (x && isBranch(x)) branches.set(dir, x);
  }
  if (sub === "checkout" && !a.includes("--")) {
    const NEW = ["-b", "-B", "--orphan"];
    const to = after(a, NEW);
    const ops = a.filter((x, k) => !x.startsWith("-") && !NEW.includes(a[k - 1]));
    if (to) branches.set(dir, to);
    // `checkout <ref> <path>…` restores files from <ref>.
    else if (ops.length > 1) discard(true);
    else if (ops[0] && isBranch(ops[0])) branches.set(dir, ops[0]);
    // Not a ref but an existing path: `git checkout <file>` throws away its edits.
    else if (ops[0] && ops[0] !== "." && !gitOk(dir, "rev-parse", "--verify", "-q", ops[0]) && existsSync(resolve(dir, ops[0]))) discard(true);
  }
  switch (sub) {
    case "push":
      hit("forcePush", forceFlag(a) && WHY.force);
      return hit("pushVerify", !hasSkill(s, VERIFY) && WHY.verify);
    case "reset": return discard(a.includes("--hard"));
    case "clean": return discard(a.some((x) => x === "--force" || /^-[a-zA-Z]*f/.test(x)));
    case "checkout": return discard(a.some((x) => ["--", ".", "-f", "--force"].includes(x)));
    case "switch": return discard(a.some((x) => ["--discard-changes", "-f", "--force"].includes(x)));
    case "restore":
      return discard(!(a.some((x) => x === "--staged" || x === "-S") && !a.some((x) => x === "--worktree" || x === "-W")));
    case "stash": return discard(["drop", "clear"].includes(a[0]));
    case "worktree": return hit("worktreePath", a[0] === "add" && insideRepo(dir, worktreePath(a.slice(1))) && WHY.worktree);
    case "commit": return checkCommit(dir, cmd, hit, cfg, branches.get(dir));
  }
}

const REPO_FLAG = /^(?:-R|--repo(?=$|=))/;
const PULLS = /^(?:https?:\/\/[^?]*?)?\/?repos\/[^/]+\/[^/]+\/pulls(\/\d+)?\/?(?:\?.*)?$/;
// gh -R/--repo may sit anywhere, even before the subcommand; `gh api` writes to pulls create or edit a PR too.
function ghPr(t) {
  const a = [];
  for (let i = 1; i < t.length; i++) {
    if (!REPO_FLAG.test(t[i])) a.push(t[i]);
    else if (t[i] === "-R" || t[i] === "--repo") i++;
  }
  if (a[0] === "pr") return ["create", "edit"].includes(a[1]) && { op: a[1], describes: prDescribes(["gh", ...a]) };
  if (a[0] !== "api") return;
  if (a.includes("graphql")) {
    const q = a.join(" ");
    if (/\bcreatePullRequest\b/.test(q)) return { op: "create", describes: true };
    return /\bupdatePullRequest\b/.test(q) && { op: "edit", describes: true };
  }
  const pulls = a.map((x) => PULLS.exec(x)).find(Boolean);
  if (!pulls) return;
  let method;
  for (let i = 1; i < a.length; i++) {
    const m = a[i].match(/^(?:-X|--method)(?:=?(.+))?$/);
    if (m) method = (m[1] ?? a[++i] ?? "").toUpperCase();
  }
  method ??= a.some((x) => /^(?:-[fF]|--field|--raw-field|--input)/.test(x)) ? "POST" : "GET";
  if (!pulls[1]) return method === "POST" && { op: "create", describes: true };
  const describes = a.some((x) => x === "--input" || /(?:^|=|^-[fF])(?:title|body)=/.test(x));
  return method === "PATCH" && { op: "edit", describes };
}

// GitHub MCP create/update_pull_request tool call -> { op, describes }, else undefined.
function mcpPr(tool, input) {
  const m = /^mcp__.+__(create|update)_pull_request$/.exec(tool ?? "");
  if (!m) return;
  const i = input ?? {};
  return m[1] === "create" ? { op: "create", describes: true } : { op: "edit", describes: i.title !== undefined || i.body !== undefined };
}

function prGates({ op, describes }, cwd, text, s, hits) {
  const hit = hitter(loadConfig(cwd).cfg, hits);
  hit("sessionLink", SESSION_RE.test(text) && WHY.session);
  hit("pushVerify", op === "create" && !hasSkill(s, VERIFY) && WHY.verify);
  // exact: a plugin's own `x:pr` skill is not ours
  hit("prSkill", describes && !s.skills.includes("pr") && WHY.pr);
}

function checkGh(t, cwd, cmd, s, hits) {
  const pr = ghPr(t);
  if (pr) prGates(pr, cwd, cmd, s, hits);
}

const SHELLS = new Set(["bash", "sh", "zsh"]);
// Commands a shell -c string or eval will run are checked like the outer command.
function expand(cmd, depth = 0) {
  const all = [];
  for (const t of segments(cmd)) {
    while (t.length && /^\w+=/.test(t[0])) t.shift();
    const c = t.indexOf("-c");
    if (depth < 3 && SHELLS.has(t[0]) && c > 0 && t[c + 1] !== undefined) all.push(...expand(t[c + 1], depth + 1));
    else if (depth < 3 && t[0] === "eval") all.push(...expand(t.slice(1).join(" "), depth + 1));
    else if (t.length) all.push(t);
  }
  return all;
}

function checkBash(cmd, cwd, s) {
  const hits = [], branches = new Map();
  for (const t of expand(cmd)) {
    if (t[0] === "cd" && t[1]) { cwd = resolve(cwd, t[1]); continue; }
    if (t[0] === "git") checkGit(t, cwd, cmd, s, hits, branches);
    else if (t[0] === "gh") checkGh(t, cwd, cmd, s, hits);
  }
  report(hits);
}

function report(hits) {
  // Any deny wins; a rule set to "remind" never weakens another rule.
  const blocked = hits.filter((h) => h.level === "deny");
  if (blocked.length) return deny([...new Set(blocked.map((h) => h.why))].join(" "));
  if (hits.length) out("PreToolUse", { additionalContext: hits.map((h) => `Reminder: ${h.why}`).join("\n") });
}

function excludeSpecs(file) {
  let dir = dirname(file);
  while (!existsSync(dir) && dir !== dirname(dir)) dir = dirname(dir);
  const top = git(dir, "rev-parse", "--show-toplevel");
  if (!top || git(top, "ls-files", "docs/superpowers") || gitOk(top, "check-ignore", "-q", "--no-index", file)) return;
  const ex = resolve(top, git(top, "rev-parse", "--git-path", "info/exclude"));
  mkdirSync(dirname(ex), { recursive: true });
  const cur = existsSync(ex) ? readFileSync(ex, "utf8") : "";
  appendFileSync(ex, `${cur && !cur.endsWith("\n") ? "\n" : ""}docs/superpowers/\n`);
}

function onPreTool(d) {
  const s = load(d.session_id);
  if (d.tool_name === "Bash") return checkBash(String(d.tool_input?.command ?? ""), d.cwd ?? process.cwd(), s);
  const pr = mcpPr(d.tool_name, d.tool_input);
  if (pr) {
    const hits = [];
    prGates(pr, d.cwd ?? process.cwd(), JSON.stringify(d.tool_input ?? {}), s, hits);
    return report(hits);
  }
  if (!["Edit", "Write", "NotebookEdit"].includes(d.tool_name)) return;
  const { cfg } = loadConfig(d.cwd ?? process.cwd());
  const file = String(d.tool_input?.file_path ?? d.tool_input?.notebook_path ?? "");
  if (cfg.rules.specExclude === "on" && d.tool_name === "Write" && file.includes("/docs/superpowers/")) excludeSpecs(file);
  let ctx;
  if (cfg.rules.debugGate === "remind" && s.debug && !s.debugNudged) { s.debugNudged = true; ctx = MSG.debugGate; }
  s.edited = true;
  if (ctx) out("PreToolUse", { additionalContext: ctx });
  save(d.session_id, s);
}

const EDGE_L = "│├┤┼└", EDGE_R = "│├┤┼┘";
// "want it fixed", "once fixed", "not done" talk about a fix; they don't claim one.
const CLAIM_RE = /\b(?<!\b(?:want|get|once|if|until|when|not)\s+(?:it\s+|them\s+)?)(?:done|fixed|passing|all tests pass|works now|verified)\b/i;

// Returns the 1-based message line of the first misaligned box edge in ```text blocks, else 0.
function boxError(msg) {
  const rows = [];
  let inText = false;
  const lines = msg.split("\n");
  for (let n = 0; n <= lines.length; n++) {
    const l = lines[n] ?? "```";
    if (/^\s*```/.test(l)) {
      if (inText) {
        for (let r = 0; r < rows.length; r++) {
          const ch = rows[r][1];
          for (let c = ch.indexOf("┌"); c !== -1; c = ch.indexOf("┌", c + 1)) {
            const c2 = ch.indexOf("┐", c + 1);
            // An arrowhead below it: a connector (loop-back arrow), not a box.
            if (c2 === -1 || "▼▲".includes(rows[r + 1]?.[1][c] ?? " ")) continue;
            for (let k = r + 1; k < rows.length; k++) {
              const [line, row] = rows[k];
              if (row[c] === "└") { if (row[c2] !== "┘") return line; break; }
              if (!row[c] || !EDGE_L.includes(row[c]) || !row[c2] || !EDGE_R.includes(row[c2])) return line;
            }
          }
        }
        rows.length = 0;
      }
      inText = !inText && /^\s*```text\s*$/.test(l);
      continue;
    }
    if (inText) rows.push([n + 1, Array.from(l)]);
  }
  return 0;
}

const proseOf = (msg) => unquote(msg.replace(/```[\s\S]*?```/g, ""));
function formatFlags(msg, cfg) {
  const on = (id) => cfg.rules[id] !== "off";
  const prose = proseOf(msg);
  const f = [];
  if (on("tldr") && msg.split("\n").length > cfg.tldrMinLines && /^## /m.test(prose) && !/^\*\*TL;DR\*\*/m.test(prose)) f.push(["tldr", FLAG.tldr]);
  if (on("emoji") && /\p{Emoji_Presentation}/u.test(prose)) f.push(["emoji", FLAG.emoji]);
  if (on("brInTable") && /^\|.*<br\s*\/?>/im.test(prose)) f.push(["brInTable", FLAG.brInTable]);
  const line = on("boxAlign") ? boxError(msg) : 0;
  if (line) f.push(["boxAlign", `${FLAG.boxAlign} at line ${line}`]);
  return f;
}

function onStop(d) {
  const s = load(d.session_id);
  const { cfg } = loadConfig(d.cwd ?? process.cwd());
  const msg = String(d.last_assistant_message ?? "");
  const flags = formatFlags(msg, cfg).map(([, text]) => text);
  const claim = cfg.rules.doneClaim !== "off" && s.edited && CLAIM_RE.test(proseOf(msg)) && !hasSkill(s, VERIFY);
  // Continuing already → next-turn flag, so a claim the fix can't clear doesn't loop.
  if (claim && cfg.rules.doneClaim === "now" && !d.stop_hook_active) {
    out("Stop", { additionalContext: [MSG.doneClaim, ...(flags.length ? [`Also fix: ${flags.join("; ")}.`] : [])].join(" ") });
    return;
  }
  if (claim) flags.unshift(FLAG.doneClaim);
  if (!flags.length) return;
  s.flags = [...new Set([...s.flags, ...flags])];
  save(d.session_id, s);
}

const HANDLERS = { UserPromptSubmit: onPrompt, PreToolUse: onPreTool, PostToolUse: onPostTool, Stop: onStop };

// Runs as a hook only when executed; rule-review imports the checks.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const d = JSON.parse(raw);
    if (d.session_id) HANDLERS[d.hook_event_name]?.(d);
  } catch { /* fail open */ }
}

export {
  CLAIM_RE, DEFAULTS, FLAG, MACHINE_PROMPT, MSG, SESSION_RE, VERIFY, WHY,
  commitSubject, expand, firedRules, forceFlag, formatFlags, ghPr, gitParse, keywordRe, loadConfig, mcpPr, prDescribes, proseOf, subjectProblem, unquote,
};
