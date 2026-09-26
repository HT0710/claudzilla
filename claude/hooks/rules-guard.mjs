#!/usr/bin/env node
// Enforces claudzilla rules (claude/rules/*.md) at the moment they apply.
// Fails open: a guardrail, not security.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { getClaudeConfigDir } from "../hud/lib/config-dir.mjs";

const VERIFY = "verification-before-completion";
const MSG = {
  debug: "Auto: invoke superpowers:systematic-debugging; stop after Phase 3, fix on go.",
  review: "Auto: invoke superpowers:receiving-code-review.",
  debugGate: "Debug turn: systematic-debugging stops at Phase 3 — propose the fix and wait for go unless the user asked for a direct edit.",
};

// Config: built-in defaults ← ~/.claude/claudzilla.json ← <repo>/.claude/claudzilla.json ← <repo>/.claude/claudzilla.local.json
const GATE = ["deny", "remind", "off"];
const LEVELS = {
  pushVerify: GATE, forcePush: GATE, discard: GATE, mainCommit: GATE,
  commitSubject: GATE, sessionLink: GATE, envStaged: GATE, worktreePath: GATE,
  debugTrigger: ["remind", "off"], reviewTrigger: ["remind", "off"], debugGate: ["remind", "off"],
  specExclude: ["on", "off"],
  doneClaim: ["flag", "off"], tldr: ["flag", "off"], emoji: ["flag", "off"], brInTable: ["flag", "off"], boxAlign: ["flag", "off"],
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
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v >= 1;
const PARAMS = {
  commitTypes: [(v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && /^[a-z]+$/.test(x)), "expected non-empty array of lowercase words"],
  subjectMax: [posInt, "expected integer >= 1"],
  tldrMinLines: [posInt, "expected integer >= 1"],
  allowMain: [(v) => typeof v === "boolean", "expected true or false"],
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
const keywordRe = (list) => new RegExp(`\\b(?:${list.map(escRe).join("|")})(?:s|es|ed|ing|ure)?(?!\\w)`, "i");
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

function onPrompt(d) {
  const prev = load(d.session_id);
  const s = fresh();
  const { cfg, warnings } = loadConfig(d.cwd ?? process.cwd());
  const lines = warnings.map((w) => `claudzilla config: ${w}`);
  if (prev.flags.length) lines.push(`Previous reply broke: ${prev.flags.join("; ")}. Apply from this reply on.`);
  const p = String(d.prompt ?? "").trimStart();
  const typed = p.match(/^\/([\w:-]+)/);
  if (typed) s.skills.push(typed[1]);
  else {
    const bare = unquote(p);
    if (cfg.rules.debugTrigger === "remind" && keywordRe(cfg.keywords.debug).test(bare)) { s.debug = true; lines.push(MSG.debug); }
    if (cfg.rules.reviewTrigger === "remind" && keywordRe(cfg.keywords.review).test(bare)) lines.push(MSG.review);
  }
  save(d.session_id, s);
  if (lines.length) out("UserPromptSubmit", { additionalContext: lines.join("\n") });
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
  verify: "Run superpowers:verification-before-completion this turn before push/PR (superpowers.md:47).",
  force: "Force push not allowed; use --force-with-lease only if the user asked (git.md:7).",
  discard: "Discards work. Ask the user; if approved they run `! <cmd>` (git.md:8).",
  main: "Branch first: git switch -c <type>/<slug>. Solo repo that commits to main: set \"allowMain\": true in .claude/claudzilla.local.json (git.md:6).",
  session: "No Claude session link (git.md:55).",
  env: "`.env` staged; unstage it (git.md:21).",
  worktree: "Worktree goes at ../<repo>-<slug> (git.md:27).",
};

// Heredoc bodies are message text, not commands.
function segments(cmd) {
  const flat = cmd.replace(new RegExp(HEREDOC_RE.source, "g"), "<<$1$2");
  return flat.split(/\n|;|&&|\|\|?/)
    .map((x) => x.trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, "")))
    .filter((t) => t[0]);
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

function checkCommit(dir, cmd, hit, cfg) {
  hit("sessionLink", SESSION_RE.test(cmd) && WHY.session);
  hit("mainCommit", !cfg.allowMain && ["main", "master"].includes(git(dir, "symbolic-ref", "--short", "HEAD")) && WHY.main);
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

function checkGit(t, cwd, cmd, s, hits) {
  let i = 1, dir = cwd;
  while (t[i]?.startsWith("-")) {
    if (t[i] === "-C") { dir = resolve(cwd, t[i + 1] ?? "."); i += 2; } else i += t[i] === "-c" ? 2 : 1;
  }
  const [sub, ...a] = t.slice(i);
  const { cfg } = loadConfig(dir);
  const hit = hitter(cfg, hits);
  const discard = (cond) => hit("discard", cond && WHY.discard);
  switch (sub) {
    case "push":
      hit("forcePush", a.some((x) => x === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x) || /^\+./.test(x)) && WHY.force);
      return hit("pushVerify", !hasSkill(s, VERIFY) && WHY.verify);
    case "reset": return discard(a.includes("--hard"));
    case "clean": return discard(a.some((x) => x === "--force" || /^-[a-zA-Z]*f/.test(x)));
    case "checkout": return discard(a.some((x) => ["--", ".", "-f", "--force"].includes(x)));
    case "switch": return discard(a.some((x) => ["--discard-changes", "-f", "--force"].includes(x)));
    case "restore":
      return discard(!(a.some((x) => x === "--staged" || x === "-S") && !a.some((x) => x === "--worktree" || x === "-W")));
    case "stash": return discard(["drop", "clear"].includes(a[0]));
    case "worktree": return hit("worktreePath", a[0] === "add" && insideRepo(dir, worktreePath(a.slice(1))) && WHY.worktree);
    case "commit": return checkCommit(dir, cmd, hit, cfg);
  }
}

function checkGh(t, cwd, cmd, s, hits) {
  if (t[1] !== "pr" || !["create", "edit"].includes(t[2])) return;
  const hit = hitter(loadConfig(cwd).cfg, hits);
  hit("sessionLink", SESSION_RE.test(cmd) && WHY.session);
  hit("pushVerify", t[2] === "create" && !hasSkill(s, VERIFY) && WHY.verify);
}

function checkBash(cmd, cwd, s) {
  const hits = [];
  for (const t of segments(cmd)) {
    while (t.length && /^\w+=/.test(t[0])) t.shift();
    if (t[0] === "cd" && t[1]) { cwd = resolve(cwd, t[1]); continue; }
    if (t[0] === "git") checkGit(t, cwd, cmd, s, hits);
    else if (t[0] === "gh") checkGh(t, cwd, cmd, s, hits);
  }
  // Any deny wins; a rule set to "remind" never weakens another rule.
  const blocked = hits.find((h) => h.level === "deny");
  if (blocked) return deny(blocked.why);
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
  if (!["Edit", "Write", "NotebookEdit"].includes(d.tool_name)) return;
  const { cfg } = loadConfig(d.cwd ?? process.cwd());
  const file = String(d.tool_input?.file_path ?? d.tool_input?.notebook_path ?? "");
  if (cfg.rules.specExclude === "on" && d.tool_name === "Write" && file.includes("/docs/superpowers/")) excludeSpecs(file);
  let ctx;
  if (cfg.rules.debugGate === "remind" && s.debug && !s.debugNudged) { s.debugNudged = true; ctx = MSG.debugGate; }
  s.edited = true;
  save(d.session_id, s);
  if (ctx) out("PreToolUse", { additionalContext: ctx });
}

const EDGE_L = "│├┤┼└", EDGE_R = "│├┤┼┘";

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
            if (c2 === -1) continue;
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

function onStop(d) {
  const s = load(d.session_id);
  const { cfg } = loadConfig(d.cwd ?? process.cwd());
  const on = (id) => cfg.rules[id] === "flag";
  const msg = String(d.last_assistant_message ?? "");
  const prose = unquote(msg.replace(/```[\s\S]*?```/g, ""));
  const flags = [];
  if (on("doneClaim") && s.edited && /\b(done|fixed|passing|all tests pass|works now|verified)\b/i.test(prose) && !hasSkill(s, VERIFY))
    flags.push("claimed done without verification-before-completion");
  if (on("tldr") && msg.split("\n").length > cfg.tldrMinLines && /^## /m.test(prose) && !/^\*\*TL;DR\*\*/m.test(prose)) flags.push("missing TL;DR");
  if (on("emoji") && /\p{Emoji_Presentation}/u.test(prose)) flags.push("decorative emoji");
  if (on("brInTable") && /^\|.*<br\s*\/?>/im.test(prose)) flags.push("<br> in table cell");
  const line = on("boxAlign") ? boxError(msg) : 0;
  if (line) flags.push(`diagram box edge misaligned at line ${line}`);
  if (!flags.length) return;
  s.flags = [...new Set([...s.flags, ...flags])];
  save(d.session_id, s);
}

const HANDLERS = { UserPromptSubmit: onPrompt, PreToolUse: onPreTool, PostToolUse: onPostTool, Stop: onStop };

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
try {
  const d = JSON.parse(raw);
  if (d.session_id) HANDLERS[d.hook_event_name]?.(d);
} catch { /* fail open */ }
