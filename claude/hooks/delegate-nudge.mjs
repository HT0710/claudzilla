#!/usr/bin/env node
// Blocks the third search of a turn with no Agent call; hook half of the Agent routing experimental feature.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A search command at the start of a part, after shell keywords, VAR= settings, xargs or a path.
const SEARCH_START = /^(\s*(do|then|else|!|\{|xargs(\s+-\S+)*|\w+=\S*)\s)*\s*(\S*\/)?(git\s+)?(grep|rg|find|fd|ag|ack)(\s|$)/;
const RECURSIVE = /\s-\w*[rR]|\s--(dereference-)?recursive/;
// Delegating a 1-2 search lookup cost the same and took twice as long (routing eval, 2026-11-10).
const FREE = 2;
const MSG = "Third search this turn with no Agent call. Delegate the lookup: Agent(subagent_type: caveman:cavecrew-investigator, model: haiku, effort: low) with the question and file:line quotes asked. Read of a known path, and grep inside one known file, stay allowed. When it answers, check hits by reading the cited file:line; never re-run its search. Empty or weak result: retry the agent on sonnet. When caveman:cavecrew-investigator is not in the agent list, use Explore instead.";

// Same-length blanking keeps every index in `bare` pointing at the same character in `cmd`.
const blank = (m) => m.replace(/[^\n]/g, "_");
const blankAll = (m) => "_".repeat(m.length);

try {
  // Drain stdin first so a large event never meets a closed pipe on the early exits.
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  // The effort eval's routing-off runs disallow Agent, so this guard would block every search there.
  if (process.env.EVAL_ROUTING === "off") process.exit(0);
  const { enabled } = await import("./experimental.mjs");
  if (enabled().agentRouting !== true) process.exit(0);
  const d = JSON.parse(raw);
  if (!d.session_id) process.exit(0);
  const dir = join(tmpdir(), "delegate-nudge");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, String(d.session_id).replace(/[^\w-]/g, ""));
  // Relative paths resolve from the last plain `cd` in the command, not only the session cwd.
  let base = d.cwd ?? ".";
  const abs = (p) => resolve(base, p.replace(/^["']|["']$/g, "").replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir()));
  const isFile = (p) => { try { return statSync(abs(p)).isFile(); } catch { return false; } };
  const cmd = d.tool_input?.command ?? "";
  // Heredoc bodies, escapes, quoted text and fd redirects are data, not commands.
  const bare = cmd
    .replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*\n)([\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$))/g, (_, head, _q, _w, body) => head + blankAll(body))
    .replace(/\\./g, blankAll)
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, blank)
    .replace(/\d*>&\d+|&>/g, blankAll);
  const segs = [];
  let at = 0, sep = "";
  for (const m of bare.matchAll(/&&|\|\||[;|&\n()`]/g)) { segs.push([at, m.index, sep]); at = m.index + m[0].length; sep = m[0]; }
  segs.push([at, cmd.length, sep]);
  // Every search part is a non-recursive grep whose last word is one existing file: lookups in known files.
  let anySearch = false;
  const knownFiles = segs.every(([a, b, before]) => {
    const s = bare.slice(a, b);
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(cmd.slice(a, b));
    if (cd) base = abs(cd[1]);
    if (!SEARCH_START.test(s)) return true;
    const plainGrep = /^\s*grep\s/.test(s) && !RECURSIVE.test(s);
    // A grep fed by a pipe filters that output; it searches no files.
    if (plainGrep && before === "|") return true;
    anySearch = true;
    const words = cmd.slice(a, b).replace(/\s\d*>>?\s*\S+/g, "").trim().split(/\s+/);
    return plainGrep && isFile(words.pop());
  });
  const search = (d.tool_name === "Grep" && !isFile(d.tool_input?.path ?? "")) || d.tool_name === "Glob" || (d.tool_name === "Bash" && anySearch && !knownFiles);
  if (d.hook_event_name === "UserPromptSubmit") writeFileSync(file, "");
  else if (!d.agent_id && d.tool_name === "Agent") appendFileSync(file, "A");
  else if (!d.agent_id && search) {
    // Append, not read-then-write: parallel calls would race on a counter.
    appendFileSync(file, ".");
    const seen = readFileSync(file, "utf8");
    if (!seen.includes("A") && seen.length > FREE) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: MSG } }));
    }
  }
} catch { /* a guard bug must never break a tool call */ }
