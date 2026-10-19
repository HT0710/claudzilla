// Always-on local trace: one JSONL file per session and part, bounded, masked, never throws.
import { appendFileSync, chmodSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Correlation id, not a secret: Math.random avoids loading node:crypto on every hook run.
const newId = () => Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, "0");
const HOME = homedir();
export const TRACE_DIR = join(process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude"), "claudzilla-trace");
const OFF = join(TRACE_DIR, ".off");
const ROTATE = 5 * 1024 * 1024, KEEP_MS = 7 * 864e5, DIR_MAX = 50 * 1024 * 1024, CUT = 2000, EVERY = 100;
const SECRETS = [
  /sk-[A-Za-z0-9_-]{20,}/g, /gh[pousr]_[A-Za-z0-9]{36,}/g, /github_pat_[A-Za-z0-9_]{22,}/g, /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/g, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /[A-Fa-f0-9]{48,}/g, /[A-Za-z0-9+/]{48,}={0,2}/g,
];

// Home first: a long home path would otherwise trip the base64 pattern.
export function mask(s) {
  let r = HOME ? s.split(HOME).join("~") : s;
  for (const re of SECRETS) r = r.replace(re, "[masked]");
  return r;
}

const clean = (v) => {
  if (typeof v === "string") { const m = mask(v); return m.length > CUT ? m.slice(0, CUT) + "…[cut]" : m; }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
};

export function traceOn() {
  try { statSync(OFF); return false; } catch { return true; }
}

export const safe = (s, d) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "") || d;
let writes = 0;
const checked = new Set();

function rotate(file) {
  try {
    if (statSync(file).size > ROTATE) renameSync(file, file.replace(/\.jsonl$/, ".1.jsonl"));
  } catch { /* no file yet */ }
}

export function write(entry) {
  const id = entry.id ?? newId();
  try {
    if (!traceOn()) return id;
    const file = join(TRACE_DIR, `${safe(entry.session, "nosession")}.${safe(entry.part, "part")}.jsonl`);
    mkdirSync(TRACE_DIR, { recursive: true, mode: 0o700 });
    // Hook processes are short-lived: check on a process's first write too.
    if (!checked.has(file) || ++writes % EVERY === 0) { checked.add(file); rotate(file); }
    const e = { ts: new Date().toISOString(), ...entry, id, level: entry.level ?? "info" };
    if (e.data !== undefined) e.data = clean(e.data);
    appendFileSync(file, JSON.stringify(e) + "\n", { mode: 0o600, flag: "a" });
  } catch { /* tracing never breaks the caller */ }
  return id;
}

export function span(base, event, data) {
  const id = newId(), ts = new Date().toISOString();
  return {
    id,
    end(more, status) {
      write({ ...base, event, id, ts, end: new Date().toISOString(), data: { ...data, ...more }, ...(status && { status }) });
    },
  };
}

export function cleanup(now = Date.now()) {
  try {
    const files = readdirSync(TRACE_DIR).filter((n) => n.endsWith(".jsonl")).map((n) => {
      const p = join(TRACE_DIR, n), s = statSync(p);
      return { p, t: s.mtimeMs, size: s.size };
    }).sort((a, b) => a.t - b.t);
    let total = 0;
    const live = files.filter((f) => f.t < now - KEEP_MS ? (unlinkSync(f.p), false) : (total += f.size, true));
    for (const f of live) { if (total < DIR_MAX) break; unlinkSync(f.p); total -= f.size; }
  } catch { /* nothing to clean */ }
}

async function sessionStart() {
  try {
    mkdirSync(TRACE_DIR, { recursive: true, mode: 0o700 });
    chmodSync(TRACE_DIR, 0o700);
    // rules-guard runs its main only when it is the entry script, so the import is safe.
    const { loadConfig } = await import(new URL("./rules-guard.mjs", import.meta.url));
    if (loadConfig("").cfg.trace === false) writeFileSync(OFF, "", { mode: 0o600 });
    else rmSync(OFF, { force: true });
    cleanup();
  } catch { /* exit 0 regardless */ }
}

if (process.argv[2] === "--session-start" && process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await sessionStart();
  process.exit(0);
}
