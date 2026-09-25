#!/usr/bin/env node
// Enforces claudzilla rules (claude/rules/*.md) at the moment they apply.
// Fails open: a guardrail, not security.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const VERIFY = "verification-before-completion";
const MSG = {
  debug: "Auto: invoke superpowers:systematic-debugging; stop after Phase 3, fix on go.",
  review: "Auto: invoke superpowers:receiving-code-review.",
  debugGate: "Debug turn: systematic-debugging stops at Phase 3 — propose the fix and wait for go unless the user asked for a direct edit.",
};
const DEBUG_RE = /\b(bug|error|fail(s|ed|ing|ure)?|broken|crash(es|ed)?|exception|traceback|not working|doesn'?t work)\b/i;
const REVIEW_RE = /\b(code review|review (comments?|feedback)|reviewer (said|says)|PR comments?)\b/i;

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
  const lines = [];
  if (prev.flags.length) lines.push(`Previous reply broke: ${prev.flags.join("; ")}. Apply from this reply on.`);
  const p = String(d.prompt ?? "").trimStart();
  const typed = p.match(/^\/([\w:-]+)/);
  if (typed) s.skills.push(typed[1]);
  else {
    if (DEBUG_RE.test(unquote(p))) { s.debug = true; lines.push(MSG.debug); }
    if (REVIEW_RE.test(unquote(p))) lines.push(MSG.review);
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
const SUBJECT_RE = /^(feat|fix|refactor|chore|docs|test)(\([^)]+\))?: \S/;
const HEREDOC_RE = /<<-?\s*['"]?(\w+)['"]?([^\n]*)\n([\s\S]*?)\n\s*\1\b/;
const WHY = {
  verify: "Run superpowers:verification-before-completion this turn before push/PR (superpowers.md:47).",
  force: "Force push not allowed; use --force-with-lease only if the user asked (git.md:7).",
  discard: "Discards work. Ask the user; if approved they run `! <cmd>` (git.md:8).",
  main: "Branch first: git switch -c <type>/<slug>. Solo repo that commits to main: user runs `git config claudzilla.allowMain true` (git.md:6).",
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

function checkCommit(dir, cmd) {
  if (SESSION_RE.test(cmd)) return WHY.session;
  const branch = git(dir, "symbolic-ref", "--short", "HEAD");
  if (["main", "master"].includes(branch) && git(dir, "config", "--type=bool", "claudzilla.allowMain") !== "true") return WHY.main;
  const staged = git(dir, "diff", "--cached", "--name-only").split("\n").map((f) => f.split("/").pop());
  if (staged.some((f) => /^\.env(\..+)?$/.test(f) && !/^\.env\.(example|sample|template)$/.test(f))) return WHY.env;
  const subj = commitSubject(cmd);
  if (subj == null) return null;
  if (!SUBJECT_RE.test(subj)) return `Commit subject must be Conventional Commits: feat|fix|refactor|chore|docs|test[(scope)]: … (git.md:18). Got: ${subj}`;
  const len = [...subj].length;
  return len > 50 ? `Commit subject is ${len} chars; max 50 (git.md:19).` : null;
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

function checkGit(t, cwd, cmd, s) {
  let i = 1, dir = cwd;
  while (t[i]?.startsWith("-")) {
    if (t[i] === "-C") { dir = resolve(cwd, t[i + 1] ?? "."); i += 2; } else i += t[i] === "-c" ? 2 : 1;
  }
  const [sub, ...a] = t.slice(i);
  switch (sub) {
    case "push":
      if (a.some((x) => x === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(x) || /^\+./.test(x))) return WHY.force;
      return hasSkill(s, VERIFY) ? null : WHY.verify;
    case "reset": return a.includes("--hard") ? WHY.discard : null;
    case "clean": return a.some((x) => x === "--force" || /^-[a-zA-Z]*f/.test(x)) ? WHY.discard : null;
    case "checkout": return a.some((x) => ["--", ".", "-f", "--force"].includes(x)) ? WHY.discard : null;
    case "switch": return a.some((x) => ["--discard-changes", "-f", "--force"].includes(x)) ? WHY.discard : null;
    case "restore":
      return a.some((x) => x === "--staged" || x === "-S") && !a.some((x) => x === "--worktree" || x === "-W") ? null : WHY.discard;
    case "stash": return ["drop", "clear"].includes(a[0]) ? WHY.discard : null;
    case "worktree": return a[0] === "add" && insideRepo(dir, worktreePath(a.slice(1))) ? WHY.worktree : null;
    case "commit": return checkCommit(dir, cmd);
    default: return null;
  }
}

function checkGh(t, cmd, s) {
  if (t[1] !== "pr" || !["create", "edit"].includes(t[2])) return null;
  if (SESSION_RE.test(cmd)) return WHY.session;
  return t[2] === "create" && !hasSkill(s, VERIFY) ? WHY.verify : null;
}

function checkBash(cmd, cwd, s) {
  for (const t of segments(cmd)) {
    while (t.length && /^\w+=/.test(t[0])) t.shift();
    if (t[0] === "cd" && t[1]) { cwd = resolve(cwd, t[1]); continue; }
    const why = t[0] === "git" ? checkGit(t, cwd, cmd, s) : t[0] === "gh" ? checkGh(t, cmd, s) : null;
    if (why) return deny(why);
  }
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
  const file = String(d.tool_input?.file_path ?? d.tool_input?.notebook_path ?? "");
  if (d.tool_name === "Write" && file.includes("/docs/superpowers/")) excludeSpecs(file);
  let ctx;
  if (s.debug && !s.debugNudged) { s.debugNudged = true; ctx = MSG.debugGate; }
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
  const msg = String(d.last_assistant_message ?? "");
  const prose = unquote(msg.replace(/```[\s\S]*?```/g, ""));
  const flags = [];
  if (s.edited && /\b(done|fixed|passing|all tests pass|works now|verified)\b/i.test(prose) && !hasSkill(s, VERIFY))
    flags.push("claimed done without verification-before-completion");
  if (msg.split("\n").length > 15 && /^## /m.test(prose) && !/^\*\*TL;DR\*\*/m.test(prose)) flags.push("missing TL;DR");
  if (/\p{Emoji_Presentation}/u.test(prose)) flags.push("decorative emoji");
  if (/^\|.*<br\s*\/?>/im.test(prose)) flags.push("<br> in table cell");
  const line = boxError(msg);
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
