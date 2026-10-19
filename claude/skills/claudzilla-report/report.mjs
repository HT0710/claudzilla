#!/usr/bin/env node
// Helper for the claudzilla-report skill: trace excerpt, marks, enterprise gate, issue search/filing, body fit.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, release, type } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACE_DIR, mask, safe, traceOn, write } from "../../hooks/trace.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const PERSONAL = new Set("gmail.com googlemail.com outlook.com hotmail.com live.com yahoo.com icloud.com me.com proton.me protonmail.com users.noreply.github.com".split(" "));
const FRESH_MS = 10 * 60 * 1000, LIMIT = 65000, HEADING = "#### Trace excerpt";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const USAGE = "usage: report.mjs --excerpt | --snapshot | --drafts | --mark start|end | --gate | --search <terms-file> | --file <body-file> | --comment <number> <body-file> | --fit <body-file>";
const usage = () => { process.stdout.write(`${USAGE}\n`); process.exit(2); };
// The n values after a flag; fewer present → usage, exit 2.
const vals = (f, n) => { const v = args.slice(args.indexOf(f) + 1, args.indexOf(f) + 1 + n); if (v.length < n || v.some((x) => x.startsWith("--"))) usage(); return v; };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { process.stdout.write(`cannot read ${p}\n`); process.exit(2); } };
const out = (s) => process.stdout.write(`${s}\n`);
const run = (cmd, a, opts = {}) => {
  try { return execFileSync(cmd, a, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], ...opts }).trim(); } catch { return undefined; }
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } };

// ---- gate: GitHub is for personal accounts only; enforced here, before any gh or link ----
const domain = (e) => e.slice(e.lastIndexOf("@") + 1).trim().toLowerCase();
const oneAt = (e) => e.split("@").length === 2;
function gate() {
  // No account email means API key, Bedrock or Vertex: counts as enterprise.
  const e = process.env;
  if (e.CLAUDE_CODE_USE_BEDROCK || e.CLAUDE_CODE_USE_VERTEX || e.CLAUDE_CODE_USE_FOUNDRY || e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN || readJson(join(CONFIG_DIR, "settings.json"))?.apiKeyHelper) return "api-key/bedrock/vertex auth";
  const cfg = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
  const account = readJson(cfg)?.oauthAccount?.emailAddress;
  if (typeof account !== "string" || !oneAt(account)) return "no Claude account email";
  if (!PERSONAL.has(domain(account))) return `account email domain @${domain(account)} is not personal mail`;
  const git = run("git", ["config", "user.email"]) ?? "";
  if (git && !oneAt(git)) return "git email is malformed";
  if (git && !PERSONAL.has(domain(git))) return `git email domain @${domain(git)} is not personal mail`;
  return undefined;
}
function needOpen() {
  const why = gate();
  if (why) { out(`blocked: ${why}. Share the report through your company's channel.`); process.exit(3); }
}

// ---- trace reading ----
const parse = (l) => { try { return JSON.parse(l); } catch { return undefined; } };
function entries(pred) {
  let names = [];
  try { names = readdirSync(TRACE_DIR).filter((n) => n.endsWith(".jsonl")); } catch { /* no dir */ }
  const all = [];
  for (const n of names.filter(pred)) {
    try { for (const l of readFileSync(join(TRACE_DIR, n), "utf8").split("\n")) { const e = l && parse(l); if (e && e.ts) all.push(e); } } catch { /* skip */ }
  }
  return { names, all: all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)) };
}
// This session only: the Bash tool env carries its id; another session's trace must never reach a report.
const SID = safe(process.env.CLAUDE_CODE_SESSION_ID, "");
const noTrace = () => (!SID ? "no session id" : !traceOn() ? "tracing off" : undefined);
const newestSnapshot = () => entries((n) => n === `${SID}.guide.jsonl` || n === `${SID}.guide.1.jsonl`).all.filter((e) => e.event === "report.snapshot").pop();

// ---- live snapshot: same fields the guide mod records, built here when tracing is off ----
const keyNames = (v, p = "") => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => keyNames(x, `${p}${k}.`)) : p ? [p.slice(0, -1)] : []);
function liveSnapshot() {
  const git = (...a) => run("git", ["-C", REPO, ...a]);
  const last = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
  let next;
  if (last) {
    const log = git("log", "--format=%s%n%b", `${last}..HEAD`);
    next = run("sh", [join(REPO, ".github/next-version.sh"), last], { input: log ?? "", stdio: ["pipe", "pipe", "ignore"] });
  }
  const status = git("status", "--porcelain");
  const settings = readJson(join(CONFIG_DIR, "settings.json"));
  const overrides = readJson(join(CONFIG_DIR, "settings.overrides.json"));
  const config = readJson(join(CONFIG_DIR, "claudzilla.json"));
  return {
    version: next || last || undefined,
    commit: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    dirty: status === undefined ? undefined : status !== "",
    claudeCode: run("claude", ["--version"]),
    os: `${type()} ${release()}`,
    node: process.version,
    mods: Object.entries(settings?.enabledPlugins ?? {}).filter(([k, v]) => v && k.endsWith("@claudzilla")).map(([k]) => k),
    overrideKeys: overrides && keyNames(overrides),
    configKeys: config && keyNames(config),
  };
}

// Report-time only: prompt-like text becomes its length; URL credentials and key=value secrets are masked.
const HIDE = new Set(["prompt", "judged", "text", "title", "reason"]);
const scrub = (v, k) => {
  if (HIDE.has(k)) return `[${(typeof v === "string" ? v : JSON.stringify(v) ?? "").length} chars]`;
  if (typeof v === "string") return v.replace(/:\/\/[^\s:@/]+:[^\s@]+@/g, "://[masked]@").replace(/\b(pass(?:word)?|pwd|secret|token)\s*[=:]\s*\S+/gi, "$1=[masked]");
  if (Array.isArray(v)) return v.map((x) => scrub(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([j, x]) => [j, scrub(x, j)]));
  return v;
};

function excerpt() {
  const why = noTrace();
  if (why) { out(why); return out(JSON.stringify(liveSnapshot())); }
  const { names } = entries(() => true);
  if (!names.length) return out("tracing off or no trace for this session");
  const snap = newestSnapshot();
  if (!snap || Date.now() - Date.parse(snap.ts) > FRESH_MS) {
    out("no fresh snapshot");
    return out(JSON.stringify(liveSnapshot()));
  }
  const s = SID;
  const { all } = entries((n) => n.startsWith(`${s}.`) || n.startsWith("nosession."));
  const mine = all.filter((e) => e.session === s || !e.session || e.session === "nosession");
  const marks = mine.filter((e) => e.event === "report.mark" && e.session === s);
  const start = marks.filter((e) => e.data?.phase === "start").pop();
  const end = start && marks.find((e) => e.data?.phase === "end" && e.ts >= start.ts);
  const from = start?.ts ?? new Date(Date.parse(snap.ts) - FRESH_MS).toISOString();
  // Marked: up to the end mark (or now, if it is missing); else nothing after the snapshot.
  const to = start ? end?.ts ?? new Date().toISOString() : snap.ts;
  out(JSON.stringify(scrub(snap.data ?? {})));
  for (const e of mine) if (e.event !== "report.snapshot" && e.ts >= from && e.ts <= to) out(JSON.stringify(scrub(e)));
}

function mark() {
  const phase = flag("--mark");
  if (phase !== "start" && phase !== "end") usage();
  const why = noTrace();
  if (why) return out(why);
  const snap = newestSnapshot();
  if (!snap || Date.now() - Date.parse(snap.ts) > FRESH_MS) return out("no fresh snapshot");
  write({ session: SID, part: "report", event: "report.mark", data: { phase } });
}

// ---- GitHub ----
function repoSlug() {
  const url = run("git", ["-C", REPO, "remote", "get-url", "origin"]) ?? "";
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) { out(`origin is not a GitHub repo: ${url || "none"}`); process.exit(1); }
  return m[1];
}

const TIMEOUT = Number.isInteger(+process.env.CLAUDZILLA_GH_TIMEOUT_MS) && +process.env.CLAUDZILLA_GH_TIMEOUT_MS > 0 ? +process.env.CLAUDZILLA_GH_TIMEOUT_MS : 30000;
// gh with stderr kept: {ok, out, err, timedOut}
function gh(a) {
  const r = spawnSync("gh", a, { encoding: "utf8", timeout: TIMEOUT, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: r.status === 0 && !r.error, out: (r.stdout ?? "").trim(), err: mask((r.stderr ?? "").trim() || (r.error && r.error.code !== "ETIMEDOUT" ? String(r.error.message) : "")), timedOut: r.error?.code === "ETIMEDOUT" };
}

function search() {
  needOpen();
  const [f] = vals("--search", 1);
  const terms = mask(readText(f)).trim();
  if (!terms) { out("search terms file is empty"); process.exit(2); }
  const r = gh(["issue", "list", "--repo", repoSlug(), "--state", "all", "--search", terms, "--limit", "10"]);
  out(r.ok ? r.out || "no matching issues" : `gh unavailable or failed; no search done${r.err ? `: ${r.err}` : ""}`);
}

function comment() {
  needOpen();
  const [n, f] = vals("--comment", 2);
  if (!/^\d+$/.test(n)) usage();
  const path = writeBody(mask(readText(f)));
  let r;
  try { r = gh(["issue", "comment", n, "--repo", repoSlug(), "--body-file", path]); } finally { unlinkSync(path); }
  out(r.ok ? r.out : `gh failed${r.timedOut ? " (timed out): check the issue before commenting again" : ""}${r.err ? `: ${r.err}` : ""}`);
  if (!r.ok) process.exit(1);
}

// Where the skill writes its terms and draft files: fixed and 0700. Not under the config dir:
// dontAsk denies every write to that protected path.
function drafts() {
  const dir = join(homedir(), ".cache", "claudzilla", "report-drafts");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dirname(dir), 0o700);
  chmodSync(dir, 0o700);
  out(dir);
}

// Masked copy of the body in the 0700 reports dir; gh reads it, nothing rides on argv.
function writeBody(body) {
  const dir = join(CONFIG_DIR, "claudzilla-reports");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `report-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-${process.pid}.txt`);
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

// The first line `# <title>` is the title; the rest is the body.
function file() {
  needOpen();
  const [f] = vals("--file", 1);
  const raw = mask(readText(f));
  const m = raw.match(/^# (.*)\n+/);
  if (!m || !m[1].trim()) { out("body file must start with a non-empty `# <title>` line"); process.exit(2); }
  const [title, body] = [m[1].trim(), raw.slice(m[0].length)];
  const slug = repoSlug();
  const path = writeBody(body);
  let keep = false;
  try {
    const r = gh(["issue", "create", "--repo", slug, "--label", "report", "--title", title, "--body-file", path]);
    if (r.ok) return out(r.out);
    keep = true;
    fallback(r, slug, title, body, path);
  } finally { if (!keep) unlinkSync(path); }
}

// Code-point cut: never splits a surrogate pair.
const cut = (t, n) => Array.from(t).slice(0, n).join("");
function fallback(r, slug, title0, body, path) {
  const title = cut(title0, 200);
  // Top part only, whole URL capped: links break around 8 KB.
  const det = body.search(/<details[\s>]/i);
  let top = (det >= 0 ? body.slice(0, det) : body.split(/\n\s*\n/)[0]).trim();
  const link = () => `https://github.com/${slug}/issues/new?${new URLSearchParams({ labels: "report", title, body: top })}`;
  while (link().length > 8000 && top.length > 1) top = `${cut(top, Math.floor(Array.from(top).length * 0.8))}…`;
  out(r.timedOut ? `gh timed out: check https://github.com/${slug}/issues before filing again; the issue may already exist` : `gh unavailable or failed${r.err ? `: ${r.err}` : ""}`);
  out(`Open this link to file the report (top part only):\n${link()}\nFull report saved: ${path}\nDrag that file into the issue.`);
}

// Cut the excerpt from its oldest line until the body fits; snapshot and steps stay whole.
function fit() {
  const [p] = vals("--fit", 1);
  const masked = mask(readText(p));
  writeFileSync(p, masked);
  const lines = masked.split("\n");
  const h = lines.indexOf(HEADING);
  const open = h < 0 ? -1 : lines.findIndex((l, j) => j > h && l.startsWith("```"));
  const close = open < 0 ? -1 : lines.findIndex((l, j) => j > open && l === "```");
  const total = () => lines.join("\n").length;
  if (total() <= LIMIT) return out("fits");
  if (close < 0) { out(`over ${LIMIT} chars and no "${HEADING}" fenced block to cut`); process.exit(1); }
  let cut = 0;
  const first = open + 1;
  lines.splice(first, 0, "[older trace lines cut to fit]");
  while (total() > LIMIT && lines[first + 1] !== "```") { lines.splice(first + 1, 1); cut++; }
  writeFileSync(p, lines.join("\n"));
  out(total() <= LIMIT ? `cut ${cut} oldest trace lines` : `still over ${LIMIT} chars after cutting the whole excerpt`);
  if (total() > LIMIT) process.exit(1);
}

if (args.includes("--gate")) { const why = gate(); out(why ? `blocked: ${why}` : "github"); }
else if (args.includes("--search")) search();
else if (args.includes("--file")) file();
else if (args.includes("--fit")) fit();
else if (args.includes("--mark")) mark();
else if (args.includes("--snapshot")) out(JSON.stringify(liveSnapshot()));
else if (args.includes("--drafts")) drafts();
else if (args.includes("--excerpt")) excerpt();
else if (args.includes("--comment")) comment();
else usage();
