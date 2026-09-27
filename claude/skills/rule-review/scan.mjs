#!/usr/bin/env node
// Per-rule counts from Claude Code transcripts. Output never holds transcript text.
//   node scan.mjs [--days N] [--dir PATH] [--save | --issue | --share]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getClaudeConfigDir } from "../../hud/lib/config-dir.mjs";
import {
  CLAIM_RE, DEFAULTS, MACHINE_PROMPT, SESSION_RE, VERIFY,
  commitSubject, expand, firedRules, forceFlag, formatFlags, gitParse, keywordRe, loadConfig, prDescribes, proseOf, subjectProblem, unquote,
} from "../../hooks/rules-guard.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RULES = Object.keys(DEFAULTS.rules);
const FORMAT = ["tldr", "emoji", "brInTable", "boxAlign"];
const EDITS = new Set(["Edit", "Write", "NotebookEdit"]);
// Local-command echoes, interrupts and compaction resumes are not the user asking for something.
const NOT_ASKED = /^(?:<(?:local-command-|bash-)|\[Request interrupted|This session is being continued)/;

const fail = (msg) => { process.stderr.write(`rule-review: ${msg}\n`); process.exit(1); };
const has = (skills, name) => skills.some((k) => k === name || k.endsWith(`:${name}`));
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "");

// Returns null for non-prompts (tool results, assistant, attachments).
function promptOf(o) {
  if (o.type !== "user") return null;
  const c = o.message?.content;
  if (Array.isArray(c) && c.some((x) => x.type === "tool_result")) return null;
  const text = textOf(c).trimStart();
  const typed = text.match(/<command-name>\/([\w:-]+)<\/command-name>/);
  if (typed) return { real: true, text: "", typed: typed[1] };
  return { real: !o.isMeta && !MACHINE_PROMPT.test(text) && !NOT_ASKED.test(text), text };
}

function scan(root, days) {
  if (!existsSync(root)) fail(`no transcripts at ${root}`);
  const since = Date.now() - days * 864e5;
  const cfg = loadConfig("").cfg;
  const all = { ...cfg, rules: DEFAULTS.rules };
  const rules = Object.fromEntries(RULES.map((id) => [id, { applies: 0, slips: 0, hookFires: 0, falseFires: 0 }]));
  const add = (id, key) => { rules[id][key]++; };
  let sessions = 0, turns = 0, unparsed = 0;

  const finish = (t) => {
    turns++;
    for (const c of t.cmds) {
      const ran = !c.denied;
      for (const seg of expand(c.cmd)) {
        if (seg[0] === "git") {
          const { sub, a } = gitParse(seg, ".");
          if (sub === "push") {
            add("pushVerify", "applies"); add("forcePush", "applies");
            if (ran && !has(c.skills, VERIFY)) add("pushVerify", "slips");
            if (ran && forceFlag(a)) add("forcePush", "slips");
          } else if (sub === "commit") {
            add("mainCommit", "applies"); add("sessionLink", "applies");
            if (ran && ["main", "master"].includes(c.branch)) add("mainCommit", "slips");
            if (ran && SESSION_RE.test(c.cmd)) add("sessionLink", "slips");
            if (commitSubject(c.cmd) != null) {
              add("commitSubject", "applies");
              if (ran && subjectProblem(c.cmd, cfg)) add("commitSubject", "slips");
            }
          }
        } else if (seg[0] === "gh" && seg[1] === "pr" && ["create", "edit"].includes(seg[2])) {
          add("sessionLink", "applies");
          if (ran && SESSION_RE.test(c.cmd)) add("sessionLink", "slips");
          if (seg[2] === "create") {
            add("pushVerify", "applies");
            if (ran && !has(c.skills, VERIFY)) add("pushVerify", "slips");
          }
          if (prDescribes(seg)) {
            add("prSkill", "applies");
            if (ran && !has(c.skills, "pr")) add("prSkill", "slips");
          }
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
    let turn = null, machine = false, counted = false;
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
      const p = promptOf(o);
      if (p) {
        machine = !p.real;
        if (machine) continue;
        if (turn) finish(turn);
        turn = null;
        if (!(Date.parse(o.timestamp) >= since)) continue;
        if (!counted) { sessions++; counted = true; }
        turn = { text: p.text, typed: p.typed, skills: p.typed ? [p.typed] : [], cmds: [], edited: false, reply: "", branch: o.gitBranch };
        continue;
      }
      if (!turn) continue;
      if (o.type === "assistant") {
        for (const x of Array.isArray(o.message?.content) ? o.message.content : []) {
          if (x.type === "text" && x.text.trim()) turn.reply = x.text;
          if (x.type !== "tool_use") continue;
          if (x.name === "Skill") turn.skills.push(String(x.input?.skill ?? ""));
          if (EDITS.has(x.name)) turn.edited = true;
          if (x.name === "Bash") {
            const c = { cmd: String(x.input?.command ?? ""), skills: [...turn.skills], branch: o.gitBranch ?? turn.branch, denied: false };
            cmds.set(x.id, c);
            turn.cmds.push(c);
          }
        }
      } else if (o.type === "user") {
        for (const x of o.message.content) {
          const text = textOf(x.content);
          if (x.type !== "tool_result" || !x.is_error || !/^PreToolUse:\S+ hook error:/.test(text)) continue;
          const c = cmds.get(x.tool_use_id);
          if (c) c.denied = true;
          fired(text, false);
        }
      } else if (o.type === "attachment" && o.attachment?.type === "hook_additional_context") {
        for (const text of o.attachment.content ?? []) fired(String(text), o.attachment.hookEvent === "UserPromptSubmit");
      } else if (o.type === "system" && o.subtype === "stop_hook_summary") {
        for (const text of o.hookAdditionalContext ?? []) fired(String(text), false);
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
  return { schema: 1, claudzilla, window: { from: day(since), to: day(Date.now()) }, sessions, turns, unparsed, rules };
}

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const days = Number(opt("--days", "14"));
if (!Number.isInteger(days) || days < 1) fail("--days needs a positive integer");
const root = opt("--dir", join(getClaudeConfigDir(), "projects"));
process.stdout.write(`${JSON.stringify(scan(root, days), null, 2)}\n`);
