#!/usr/bin/env node
// Statusline payload on stdin -> "key\tvalue" lines for hud-filter.pl.
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TAIL = 4 * 1024 * 1024;
const HEAD = 64 * 1024;
const THINKING_MS = 30_000;

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
let d = {};
try { d = JSON.parse(raw) ?? {}; } catch { /* no payload: print what we can */ }

const out = {};
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : undefined);

const sid = String(d.session_id ?? "");
out.id = sid.slice(0, 8);
out.sid = sid;
out.cwd = d.workspace?.current_dir || d.cwd;
out.effort = d.effort?.level;
out.model = d.model?.display_name;

// null until the first API reply; keep the row so the statusline height stays put
out.ctx = pct(d.context_window?.used_percentage) ?? 0;
// tokens in the prompt right now: what the context meter measures
const u = d.context_window?.current_usage;
const count = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const used = u ? count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens) : 0;
if (used > 0) out.ctx_note = used >= 999_500 ? `${+(used / 1e6).toFixed(1)}M` : `${Math.round(used / 1e3)}k`;
else if (out.ctx === 0) out.ctx_note = "0";

function resetIn(v) {
  const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const ms = Number.isFinite(n) ? (Math.abs(n) < 1e12 ? n * 1000 : n) : Date.parse(v);
  const left = Math.floor((ms - Date.now()) / 60_000);
  if (!(left > 0)) return undefined;
  const h = Math.floor(left / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${h}h${left % 60}m`;
}
for (const [key, src] of [["5h", "five_hour"], ["wk", "seven_day"]]) {
  const lim = d.rate_limits?.[src];
  const v = pct(lim?.used_percentage);
  // Claude Code drops a window after resets_at; dropped = fresh window, 0% used
  out[key] = v ?? (d.rate_limits?.five_hour || d.rate_limits?.seven_day ? 0 : undefined);
  if (v !== undefined) out[`${key}_note`] = resetIn(lim.resets_at);
}

try {
  const cfg = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
  // first + last char of the local part only: tells accounts apart without showing the address on screen
  out.profile = JSON.parse(readFileSync(cfg, "utf8"))?.oauthAccount?.emailAddress
    ?.replace(/^(.).+(.)@/, "$1…$2@").replace(/^(.).?@/, "$1…@");
} catch { /* not logged in, or no config */ }

function readSlice(fd, start, len) {
  const buf = Buffer.alloc(len);
  return buf.toString("utf8", 0, readSync(fd, buf, 0, len, start));
}
const lines = (text) => text.split("\n").filter(Boolean);
const parse = (line) => { try { return JSON.parse(line); } catch { return undefined; } };

// no reply yet: nothing of this chat to lose, show fresh
out.cch = 0;
out.cch_note = "hot";
if (d.transcript_path) {
  let fd;
  try {
    fd = openSync(d.transcript_path, "r");
    const { size: bytes } = fstatSync(fd);
    // first timestamped entry = session start; the head read may cut its last line, so skip bad JSON
    for (const line of lines(readSlice(fd, 0, Math.min(HEAD, bytes)))) {
      const ts = Date.parse(parse(line)?.timestamp);
      if (ts) { out.up = `${Math.max(0, Math.floor((Date.now() - ts) / 60_000))}m`; break; }
    }
    // ponytail: last-4MB tail only; an older skill is not shown, scan further back if that bites
    const start = Math.max(0, bytes - TAIL);
    let tail = lines(readSlice(fd, start, bytes - start));
    if (start > 0) tail = tail.slice(1);
    const blocks = (e) => (Array.isArray(e?.message?.content) ? e.message.content : []);
    for (let i = tail.length - 1; i >= 0 && out.skill === undefined; i--) {
      if (!tail[i].includes('"Skill"')) continue;
      const hit = blocks(parse(tail[i])).findLast((b) => b.type === "tool_use" && b.name === "Skill" && b.input?.skill);
      if (hit) out.skill = hit.input.skill;
    }
    for (let i = tail.length - 1; i >= 0; i--) {
      if (!/"type":"(thinking|reasoning)"/.test(tail[i])) continue;
      const e = parse(tail[i]);
      if (!blocks(e).some((b) => b.type === "thinking" || b.type === "reasoning")) continue;
      if (Date.now() - Date.parse(e.timestamp) <= THINKING_MS) out.thinking = 1;
      break;
    }
    // Prompt cache: each main-chat request restarts its TTL; a pure cache read keeps the TTL the last write chose.
    // Subagents cache apart, and a synthetic reply (API error) sent nothing.
    // shortcut: the reply's timestamp is its end, so a long reply overstates the time left by its length; read the request time if the transcript gains one.
    let last, ttl;
    for (let i = tail.length - 1; i >= 0 && ttl === undefined; i--) {
      if (!tail[i].includes('"assistant"')) continue;
      const e = parse(tail[i]);
      const u = e?.message?.usage;
      if (e?.type !== "assistant" || e.isSidechain || !u) continue;
      if (last === undefined && count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens) > 0) last = Date.parse(e.timestamp);
      if (last === undefined) continue;
      if (count(u.cache_creation?.ephemeral_1h_input_tokens) > 0) ttl = 3_600_000;
      else if (count(u.cache_creation?.ephemeral_5m_input_tokens) > 0) ttl = 300_000;
    }
    if (last && ttl) {
      // clamped: a clock stepped back puts the reply in the future
      const left = Math.min(ttl, Math.max(0, last + ttl - Date.now()));
      // floor: 100% only once cold
      out.cch = Math.floor((1 - left / ttl) * 100);
      out.cch_note = left > 0 ? `${Math.ceil(left / 60_000)}m` : "cold";
    } else if (last) {
      // replies but no cache write (caching off): the next message pays for it all
      out.cch = 100;
      out.cch_note = "cold";
    }
  } catch { /* transcript gone or unreadable */ } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

process.stdout.write(
  Object.entries(out)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    // C0/C1 control chars (tabs, newlines, terminal escapes in a skill or model name) never reach the terminal.
    .map(([k, v]) => `${k}\t${String(v).replace(/[\x00-\x1f\x7f-\x9f]/g, " ")}\n`)
    .join(""),
);
