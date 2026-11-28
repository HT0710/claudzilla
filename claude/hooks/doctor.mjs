#!/usr/bin/env node
// claudzilla doctor: does every part run the clone's version, and how to fix each problem.
//   node doctor.mjs                every check, human lines
//   node doctor.mjs --quick        state checks only; prints nothing when all pass
//   node doctor.mjs --json         every check as JSON; with --quick, state checks only
//   node doctor.mjs --hook         SessionStart hook: quick checks, one JSON line on a problem; notes the session's plugin commits
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const real = (p) => { try { return realpathSync(p); } catch { return undefined; } };
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "ignore"] });
  return { status: r.status, out: (r.stdout ?? "").trim() };
};
const onPath = (name) => (process.env.PATH ?? "").split(":").some((d) => { try { accessSync(join(d || ".", name), constants.X_OK); return true; } catch { return false; } });

function readJson(file, results, showPath = String) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  try { return JSON.parse(text); } catch { results.push({ check: "read", label: "read", ok: false, text: `could not read ${showPath(file)}`, why: "fix or remove the file by hand" }); return undefined; }
}

function pickedParts(ctx, parts, results, showPath) {
  const all = Object.keys(parts).filter((p) => p !== "primer");
  const file = join(ctx.config, "claudzilla.json");
  const ins = readJson(file, results, showPath)?.install;
  const known = (v) => (Array.isArray(v) ? v.filter((p) => all.includes(p)) : []);
  let pick = all;
  if (ins && typeof ins === "object") {
    if (ins.only?.length && !known(ins.only).length) results.push({ check: "read", label: "read", ok: false, text: `could not read ${showPath(file)}: install names no known part`, why: "fix \"install\" in claudzilla.json" });
    else if (ins.only) pick = known(ins.only);
    else if (ins.skip) pick = all.filter((p) => !known(ins.skip).includes(p));
  }
  return new Set([...pick, "primer"]);
}

// The base settings install.sh applies for the picked parts (install.sh base_for), hooks and statusLine only.
function baseFor(base, parts, on) {
  const hooks = {};
  for (const [ev, entries] of Object.entries(base.hooks ?? {})) {
    hooks[ev] = entries.filter((e) => !Object.keys(parts).some((p) => !on.has(p) && e.hooks.some((h) => (parts[p].hooks ?? []).some((s) => h.command.includes(s)))));
  }
  return { hooks, statusLine: on.has("hud") ? base.statusLine : undefined };
}

// The temp state dir hud.pl uses (hud.pl:142-148): only when it is ours and private.
export function stateDir(env, uid) {
  const dir = join(env.TMPDIR || "/tmp", `claudzilla-rules-${uid}`);
  try { mkdirSync(dir, { mode: 0o700 }); } catch { /* exists */ }
  try { const st = lstatSync(dir); return st.isDirectory() && st.uid === uid && (st.mode & 0o077) === 0 ? dir : undefined; } catch { return undefined; }
}

export function readHookInput(stdin) {
  return new Promise((resolve) => {
    let buf = "";
    const done = () => { clearTimeout(t); stdin.destroy(); let j; try { j = JSON.parse(buf); } catch { j = {}; } resolve({ sid: typeof j?.session_id === "string" ? j.session_id : undefined, cwd: typeof j?.cwd === "string" ? j.cwd : undefined, source: typeof j?.source === "string" ? j.source : undefined }); };
    const t = setTimeout(done, 1000);
    stdin.setEncoding("utf8");
    stdin.on("data", (d) => { buf += d; });
    stdin.on("end", done);
    stdin.on("error", done);
  });
}

export function records(config) {
  const installed = readJson(join(config, "plugins/installed_plugins.json"), [])?.plugins ?? {};
  return Object.entries(installed).filter(([id, e]) => id.endsWith("@claudzilla") && Array.isArray(e))
    .flatMap(([id, e]) => e.filter((x) => x?.gitCommitSha).map((x) => ({ id, scope: x.scope, ...(x.projectPath ? { projectPath: x.projectPath } : {}), sha: x.gitCommitSha })));
}

const SID = /^[A-Za-z0-9_-]{1,128}$/;
// Keyed by the Claude process, found through <config>/sessions/<pid>.json, because /clear gives the same process a new session id.
function noteKey(ctx) {
  try {
    for (const f of readdirSync(join(ctx.config, "sessions"))) {
      const j = readJson(join(ctx.config, "sessions", f), []);
      if (j?.sessionId === ctx.sid && Number.isInteger(j?.pid)) return `p${j.pid}`;
    }
  } catch { /* no sessions dir */ }
  return ctx.sid;
}
const notePath = (ctx) => (ctx.state && ctx.sid && SID.test(ctx.sid) ? join(ctx.state, `doctor-${noteKey(ctx)}.json`) : undefined);
const known = (ctx, sha) => run("git", ["-C", ctx.clone, "cat-file", "-e", `${sha}^{commit}`]).status === 0;

function commitState(ctx, name, sha) {
  if (!existsSync(join(ctx.clone, "plugins", name))) return "missing";
  if (!sha || run("git", ["-C", ctx.clone, "cat-file", "-e", `${sha}^{commit}`]).status !== 0) return "unknown";
  return run("git", ["-C", ctx.clone, "diff", "--quiet", sha, "HEAD", "--", `plugins/${name}`]).status === 0 ? "ok" : "stale";
}

export function checks(ctx, showPath = String) {
  const results = [];
  const parts = JSON.parse(readFileSync(join(ctx.clone, "parts.json"), "utf8"));
  const base = JSON.parse(readFileSync(join(ctx.clone, "settings.base.json"), "utf8"));
  const renames = JSON.parse(readFileSync(join(ctx.clone, ".claude-plugin/marketplace.json"), "utf8")).renames ?? {};
  const installed = readJson(join(ctx.config, "plugins/installed_plugins.json"), results, showPath)?.plugins ?? {};
  const settings = readJson(join(ctx.config, "settings.json"), results, showPath) ?? {};
  const markets = readJson(join(ctx.config, "plugins/known_marketplaces.json"), results, showPath) ?? {};
  const on = pickedParts(ctx, parts, results, showPath);
  const ids = new Set(Object.values(parts).flatMap((p) => p.plugins ?? []));
  const head = run("git", ["-C", ctx.clone, "rev-parse", "--short=7", "HEAD"]).out;
  const install = { kind: "install", cwd: ctx.clone };
  const here = new Set([real(ctx.cwd), real(run("git", ["-C", ctx.cwd, "rev-parse", "--show-toplevel"]).out || "/nonexistent")].filter(Boolean));

  for (const [id, entries] of Object.entries(installed)) {
    const [name, market] = id.split("@");
    if (market !== "claudzilla" || !Array.isArray(entries)) continue;
    if (name in renames) { results.push({ check: "oldid", label: name, ok: false, text: `${id} is an old name of ${renames[name]}@claudzilla`, fix: install }); continue; }
    if (!ids.has(id)) continue;
    for (const e of entries) {
      const sha = e?.gitCommitSha, short = String(sha ?? "?").slice(0, 7);
      if (e?.scope === "user") {
        const s = commitState(ctx, name, sha);
        results.push(s === "ok" ? { check: "plugin", label: name, ok: true, text: `${name} matches the clone` }
          : { check: "plugin", label: name, ok: false, text: s === "stale" ? `cache at ${short}, clone at ${head}` : s === "missing" ? `plugins/${name} is missing in the clone` : `cache at ${short}, a commit the clone does not have`, fix: s === "stale" ? { kind: "update-plugin", id } : install });
      } else if (e?.scope === "project" && typeof e.projectPath === "string" && here.has(real(e.projectPath))) {
        if (commitState(ctx, name, sha) === "ok") continue;
        const path = e.projectPath.replace(/\/+$/, "");
        results.push(existsSync(join(path, ".claude/plugins/installed_plugins.json")) ? { check: "project", label: name, ok: false, text: `project install at ${short} for ${showPath(path)}, whose .claude is also a profile`, why: "removing it edits that profile's settings" }
          : { check: "project", label: name, ok: false, text: `project install at ${short} for ${showPath(path)}, clone at ${head}`, fix: { kind: "uninstall-project", id, scope: "project", cwd: path } });
      }
    }
  }

  const note = notePath(ctx) && readJson(notePath(ctx), []);
  if (Array.isArray(note)) {
    const now = records(ctx.config);
    const changed = note.filter((n) => {
      const cur = now.find((c) => c.id === n.id && c.scope === n.scope && c.projectPath === n.projectPath);
      return cur && cur.sha !== n.sha && known(ctx, n.sha) && known(ctx, cur.sha)
        && run("git", ["-C", ctx.clone, "diff", "--quiet", n.sha, cur.sha, "--", `plugins/${n.id.split("@")[0]}`]).status === 1;
    });
    for (const n of changed) { const label = n.id.split("@")[0]; results.push({ check: "restart", label, ok: false, text: `${label} changed since this session started`, fix: { kind: "restart" } }); }
    if (!changed.length) results.push({ check: "restart", label: "restart", ok: true, text: "no plugin changed since this session started" });
  }

  const root = real(join(ctx.clone, "claude"));
  const links = [...on].flatMap((p) => parts[p]?.links ?? []);
  const badLinks = links.filter((l) => { try { lstatSync(join(ctx.config, l)); } catch { return true; } const r = real(join(ctx.config, l)); return !r || !(r === join(root, l) || r.startsWith(root + "/")); });
  results.push(badLinks.length ? { check: "links", label: "links", ok: false, text: `missing or outside the clone: ${badLinks.join(", ")}`, fix: install } : { check: "links", label: "links", ok: true, text: `${links.length}/${links.length}` });

  const want = [...on].flatMap((p) => parts[p]?.plugins ?? []);
  const off = want.filter((id) => !(Array.isArray(installed[id]) && installed[id].some((e) => e?.scope === "user")) || settings.enabledPlugins?.[id] !== true);
  results.push(off.length ? { check: "plugins", label: "plugins", ok: false, text: `not installed or not enabled: ${off.join(", ")}`, fix: install } : { check: "plugins", label: "plugins", ok: true, text: `${want.length}/${want.length} installed and enabled` });

  results.push(markets.claudzilla ? { check: "marketplace", label: "marketplace", ok: true, text: "claudzilla registered" } : { check: "marketplace", label: "marketplace", ok: false, text: "claudzilla marketplace is not registered", fix: install });

  const b = baseFor(base, parts, on);
  const missing = [];
  for (const [ev, entries] of Object.entries(b.hooks)) {
    const list = settings.hooks?.[ev];
    const have = new Set((Array.isArray(list) ? list : []).flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : []).map((h) => h?.command)));
    for (const e of entries) for (const h of e.hooks) if (!have.has(h.command)) missing.push(`${ev} hook`);
  }
  if (b.statusLine && settings.statusLine?.command !== b.statusLine.command) missing.push("statusLine");
  results.push(missing.length ? { check: "settings", label: "settings", ok: false, text: `missing from settings.json: ${[...new Set(missing)].join(", ")}`, fix: install } : { check: "settings", label: "settings", ok: true, text: "base hooks and status line present" });

  const tools = ["node", "perl", "git", ...(on.has("rtk") ? ["rtk"] : [])];
  const gone = tools.filter((t) => !onPath(t));
  results.push(gone.length ? { check: "tools", label: "tools", ok: false, text: `not on PATH: ${gone.join(", ")}`, why: `install ${gone.join(", ")}` } : { check: "tools", label: "tools", ok: true, text: tools.join(", ") });

  if (!ctx.quick) results.push(...fullChecks(ctx, links, on));
  // install.sh run from a worktree relinks ~/.claude to it; a quote would break out of the skill's quoting.
  const gd = run("git", ["-C", ctx.clone, "rev-parse", "--absolute-git-dir"]).out;
  const common = resolve(ctx.clone, run("git", ["-C", ctx.clone, "rev-parse", "--git-common-dir"]).out || ".");
  const worktree = gd && real(gd) !== real(common);
  for (const r of results) {
    if ((r.fix?.kind === "install" || r.fix?.kind === "basic-glyphs") && worktree) { delete r.fix; r.why = "this is a git worktree; run install.sh in the main clone"; }
    else if (r.fix?.cwd?.includes("'")) { delete r.fix; r.why = "the path has a quote; fix it by hand"; }
    else if (r.fix?.cwd) r.fix = { ...r.fix, cwd: showPath(r.fix.cwd) };
  }
  return results;
}

export function fullChecks(ctx, links, on = new Set()) {
  const results = [];
  const glyphs = glyphRow(ctx, on);
  if (glyphs) results.push(glyphs);
  const ver = version(ctx.clone);
  if (ver) {
    const tmp = mkdtempSync(join(tmpdir(), "claudzilla-doctor-"));
    const input = JSON.stringify({ session_id: "doctor", workspace: { current_dir: ctx.clone }, model: { display_name: "Opus" }, context_window: { used_percentage: 10, context_window_size: 200000 } });
    const r = spawnSync("perl", [join(ctx.clone, "claude/hud/hud.pl")], { encoding: "utf8", input, env: { ...process.env, TMPDIR: tmp, CLAUDE_CONFIG_DIR: tmp }, stdio: ["pipe", "pipe", "ignore"] });
    rmSync(tmp, { recursive: true, force: true });
    results.push(r.status === 0 && (r.stdout ?? "").includes(ver) ? { check: "statusline", label: "statusline", ok: true, text: `shows ${ver}` }
      : { check: "statusline", label: "statusline", ok: false, text: `hud.pl ${r.status === 0 ? `does not show ${ver}` : "failed"}`, why: "run /claudzilla report to file it" });
  }

  const files = links.filter((l) => l.startsWith("hooks/")).concat(links.includes("skills/rule-review") ? ["skills/rule-review/scan.mjs"] : []);
  const CHECK = { ".mjs": ["node", "--check"], ".pl": ["perl", "-c"], ".sh": ["sh", "-n"] };
  const missing = [], broken = [];
  for (const f of files) {
    const path = join(ctx.clone, "claude", f), how = CHECK[f.slice(f.lastIndexOf("."))];
    if (!existsSync(path)) missing.push(f);
    else if (how && run(how[0], [...how.slice(1), path]).status !== 0) broken.push(f);
  }
  if (missing.length) results.push({ check: "hooks", label: "hooks", ok: false, text: `missing: ${missing.join(", ")}`, fix: { kind: "install", cwd: ctx.clone } });
  if (broken.length) results.push({ check: "hooks", label: "hooks", ok: false, text: `does not parse: ${broken.join(", ")}`, why: "the clone has a broken file; run /claudzilla report" });
  if (!missing.length && !broken.length) results.push({ check: "hooks", label: "hooks", ok: true, text: `${files.length}/${files.length} parse` });

  const gd = run("git", ["-C", ctx.clone, "rev-parse", "--absolute-git-dir"]).out;
  let lines = [];
  try { lines = readFileSync(join(gd, "claudzilla-update.events"), "utf8").split("\n").map((l) => l.split("\t")); } catch { /* no update yet */ }
  const fail = lines.findLastIndex((l) => l[1] === "fail");
  const fixed = fail >= 0 && lines.slice(fail + 1).some((l) => l[1] === "live" && (l[2] ?? "").startsWith("claudzilla: updated to "));
  results.push(fail >= 0 && !fixed ? { check: "update", label: "update", ok: false, text: `last auto-update failed, log: ${join(gd, "claudzilla-update.log")}`, why: "ask Claude to debug the claudzilla update" }
    : { check: "update", label: "update", ok: true, text: "no failed auto-update" });
  return results;
}

// No shell call reads the terminal's font, so the row shows the glyphs and the person judges (ask).
function glyphRow(ctx, on) {
  if (!on.has("hud") && !on.has("margin")) return undefined;
  if (existsSync(join(ctx.config, ".claudzilla-basic-glyphs"))) return { check: "glyphs", label: "glyphs", ok: true, text: "basic symbols" };
  const read = (f) => { try { return readFileSync(join(ctx.clone, f), "utf8"); } catch { return ""; } };
  const codes = (text, re) => [...text.matchAll(re)].map((m) => JSON.parse(`"\\u${m[1].padStart(4, "0")}"`)).join(" ");
  const rail = on.has("margin") ? codes(read("plugins/margin/hooks/kit.tsx").match(/export const ICON = \{.*\}/)?.[0] ?? "", /\\u([0-9A-Fa-f]{4})/g) : "";
  const hud = on.has("hud") ? codes(read("claude/hud/hud.pl").match(/^\s*: \(.*\);$/m)?.[0] ?? "", /\\x\{([0-9A-Fa-f]+)\}/g) : "";
  const text = [rail, hud].filter(Boolean).join("   ");
  if (!text) return undefined;
  return { check: "glyphs", label: "glyphs", ok: true, text, ask: "boxes? set MesloLGS NF as your terminal font, or", fix: { kind: "basic-glyphs", cwd: ctx.clone } };
}

function version(clone) {
  const last = run("git", ["-C", clone, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]).out;
  if (!last) return "";
  const log = run("git", ["-C", clone, "log", "--format=%s%n%b", `${last}..HEAD`]).out;
  return run("sh", [join(clone, ".github/next-version.sh"), last], log).out || last;
}

const FIX = {
  install: (f) => `cd ${f.cwd} && bash install.sh`,
  "update-plugin": (f) => `claude plugin update ${f.id}`,
  "uninstall-project": (f) => `cd ${f.cwd} && claude plugin uninstall ${f.id} --scope project`,
  "basic-glyphs": (f) => `cd ${f.cwd} && CLAUDZILLA_FONT=no bash install.sh`,
  restart: () => "restart, or ignore if you ran /reload-plugins",
};

export function render(results, ctx) {
  const esc = ctx.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tilde = (s) => (ctx.home ? s.replace(new RegExp(`(^|[\\s(])${esc}(?=/|$|[\\s,)])`, "g"), "$1~") : s);
  const head = run("git", ["-C", ctx.clone, "rev-parse", "--short=7", "HEAD"]).out;
  const ver = version(ctx.clone);
  const lines = [`claudzilla doctor  ${ver ? `${ver} ` : ""}@ ${head}`];
  for (const r of results.filter((x) => !x.ok)) {
    lines.push(`${r.fix ? "✗" : "!"} ${r.label.padEnd(12)}${tilde(r.text)}`);
    lines.push(r.fix ? `  fix: ${tilde(FIX[r.fix.kind](r.fix))}` : `  no automatic fix: ${r.why}`);
  }
  const seen = new Map();
  for (const r of results.filter((x) => x.ok)) seen.set(r.check, [...(seen.get(r.check) ?? []), r]);
  for (const [check, rows] of seen) {
    const r = rows[0];
    if (!r.ask) { lines.push(`✓ ${check.padEnd(12)}${rows.length > 1 ? `${rows.length}/${rows.length} match the clone` : tilde(r.text)}`); continue; }
    lines.push(`? ${r.label.padEnd(12)}${r.text}`, `  ${r.ask} ${r.fix ? `run ${tilde(FIX[r.fix.kind](r.fix))}, then restart Claude` : `use basic symbols (${r.why})`}`);
  }
  if (results.some((x) => !x.ok && x.fix)) lines.push("Fix all: /claudzilla doctor fix");
  return lines.join("\n");
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  try {
    const flags = new Set(process.argv.slice(2));
    const hook = flags.has("--hook");
    const input = hook ? await readHookInput(process.stdin) : { sid: process.env.CLAUDE_CODE_SESSION_ID };
    const ctx = {
      config: process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      clone: join(dirname(fileURLToPath(import.meta.url)), "../.."),
      home: homedir(),
      cwd: (hook && input.cwd) || process.cwd(),
      sid: input.sid,
      state: stateDir(process.env, process.getuid()),
      quick: hook || flags.has("--quick"),
      json: flags.has("--json"),
      hook,
    };
    const results = checks(ctx, !hook && ctx.quick && ctx.json ? () => "<path>" : String);
    if (hook) {
      const path = notePath(ctx);
      const fresh = input.source === "startup" || input.source === "resume";
      if (path) { try { writeFileSync(path, JSON.stringify(records(ctx.config)), { flag: fresh ? "w" : "wx", mode: 0o600 }); } catch { /* kept from session start */ } }
      const bad = results.filter((r) => !r.ok);
      if (bad.length) {
        const plugin = bad.find((r) => r.check === "plugin");
        const what = plugin ? `${plugin.label} out of date` : `${bad.length} problem${bad.length > 1 ? "s" : ""} found`;
        console.log(JSON.stringify({ systemMessage: `claudzilla: ${what}. Run /claudzilla-doctor, or ask Claude to fix claudzilla.`, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "claudzilla doctor found problems. If the user asks to fix claudzilla, run the claudzilla-doctor skill." } }));
      }
    } else if (ctx.json) console.log(JSON.stringify(results));
    else if (!ctx.quick || results.some((r) => !r.ok)) console.log(render(results, ctx));
  } catch (e) {
    console.error(`claudzilla doctor: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}
