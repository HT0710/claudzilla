#!/usr/bin/env node
// claudzilla doctor: does every part run the clone's version, and how to fix each problem.
//   node doctor.mjs                every check, human lines
//   node doctor.mjs --quick        state checks only; prints nothing when all pass
//   node doctor.mjs --json         every check as JSON; with --quick, state checks only
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const real = (p) => { try { return realpathSync(p); } catch { return undefined; } };
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "ignore"] });
  return { status: r.status, out: (r.stdout ?? "").trim() };
};
const onPath = (name) => (process.env.PATH ?? "").split(":").some((d) => { try { accessSync(join(d || ".", name), constants.X_OK); return true; } catch { return false; } });

function readJson(file, results) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  try { return JSON.parse(text); } catch { results.push({ check: "read", label: "read", ok: false, text: `could not read ${file}`, why: "fix or remove the file by hand" }); return undefined; }
}

function pickedParts(ctx, parts, results) {
  const all = Object.keys(parts).filter((p) => p !== "primer");
  const ins = readJson(join(ctx.config, "claudzilla.json"), results)?.install;
  const known = (v) => (Array.isArray(v) ? v.filter((p) => all.includes(p)) : []);
  let pick = all;
  if (ins && typeof ins === "object") {
    if (ins.only?.length && !known(ins.only).length) results.push({ check: "read", label: "read", ok: false, text: `could not read ${join(ctx.config, "claudzilla.json")}: install names no known part`, why: "fix \"install\" in claudzilla.json" });
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

function commitState(ctx, name, sha) {
  if (!existsSync(join(ctx.clone, "plugins", name))) return "missing";
  if (!sha || run("git", ["-C", ctx.clone, "cat-file", "-e", `${sha}^{commit}`]).status !== 0) return "unknown";
  return run("git", ["-C", ctx.clone, "diff", "--quiet", sha, "HEAD", "--", `plugins/${name}`]).status === 0 ? "ok" : "stale";
}

export function checks(ctx) {
  const results = [];
  const parts = JSON.parse(readFileSync(join(ctx.clone, "parts.json"), "utf8"));
  const base = JSON.parse(readFileSync(join(ctx.clone, "settings.base.json"), "utf8"));
  const renames = JSON.parse(readFileSync(join(ctx.clone, ".claude-plugin/marketplace.json"), "utf8")).renames ?? {};
  const installed = readJson(join(ctx.config, "plugins/installed_plugins.json"), results)?.plugins ?? {};
  const settings = readJson(join(ctx.config, "settings.json"), results) ?? {};
  const markets = readJson(join(ctx.config, "plugins/known_marketplaces.json"), results) ?? {};
  const on = pickedParts(ctx, parts, results);
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
        const prof = readJson(join(path, ".claude/settings.json"), []);
        results.push(prof?.enabledPlugins ? { check: "project", label: name, ok: false, text: `project install at ${short} for ${path}, whose .claude is also a profile`, why: "removing it edits that profile's settings" }
          : { check: "project", label: name, ok: false, text: `project install at ${short} for ${path}, clone at ${head}`, fix: { kind: "uninstall-project", id, scope: "project", cwd: path } });
      }
    }
  }

  const root = real(join(ctx.clone, "claude"));
  const links = [...on].flatMap((p) => parts[p]?.links ?? []);
  const badLinks = links.filter((l) => { try { lstatSync(join(ctx.config, l)); } catch { return true; } const r = real(join(ctx.config, l)); return !r || !(r === join(root, l) || r.startsWith(root + "/")); });
  results.push(badLinks.length ? { check: "links", label: "links", ok: false, text: `missing or outside the clone: ${badLinks.join(", ")}`, fix: install } : { check: "links", label: "links", ok: true, text: `${links.length}/${links.length}` });

  const want = [...on].flatMap((p) => parts[p]?.plugins ?? []);
  const off = want.filter((id) => !(installed[id] ?? []).some((e) => e?.scope === "user") || settings.enabledPlugins?.[id] !== true);
  results.push(off.length ? { check: "plugins", label: "plugins", ok: false, text: `not installed or not enabled: ${off.join(", ")}`, fix: install } : { check: "plugins", label: "plugins", ok: true, text: `${want.length}/${want.length} installed and enabled` });

  results.push(markets.claudzilla ? { check: "marketplace", label: "marketplace", ok: true, text: "claudzilla registered" } : { check: "marketplace", label: "marketplace", ok: false, text: "claudzilla marketplace is not registered", fix: install });

  const b = baseFor(base, parts, on);
  const missing = [];
  for (const [ev, entries] of Object.entries(b.hooks)) {
    const have = new Set((settings.hooks?.[ev] ?? []).flatMap((e) => (e?.hooks ?? []).map((h) => h?.command)));
    for (const e of entries) for (const h of e.hooks) if (!have.has(h.command)) missing.push(`${ev} hook`);
  }
  if (b.statusLine && settings.statusLine?.command !== b.statusLine.command) missing.push("statusLine");
  results.push(missing.length ? { check: "settings", label: "settings", ok: false, text: `missing from settings.json: ${[...new Set(missing)].join(", ")}`, fix: install } : { check: "settings", label: "settings", ok: true, text: "base hooks and status line present" });

  const tools = ["node", "perl", "git", ...(on.has("rtk") ? ["rtk"] : [])];
  const gone = tools.filter((t) => !onPath(t));
  results.push(gone.length ? { check: "tools", label: "tools", ok: false, text: `not on PATH: ${gone.join(", ")}`, why: `install ${gone.join(", ")}` } : { check: "tools", label: "tools", ok: true, text: tools.join(", ") });

  return results;
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
  for (const [check, rows] of seen) lines.push(`✓ ${check.padEnd(12)}${rows.length > 1 ? `${rows.length}/${rows.length} match the clone` : tilde(rows[0].text)}`);
  if (results.some((x) => !x.ok && x.fix)) lines.push("Fix all: /claudzilla doctor fix");
  return lines.join("\n");
}

if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  try {
    const flags = new Set(process.argv.slice(2));
    const ctx = {
      config: process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
      clone: join(dirname(fileURLToPath(import.meta.url)), "../.."),
      home: homedir(),
      cwd: process.cwd(),
      quick: flags.has("--quick"),
      json: flags.has("--json"),
    };
    const results = checks(ctx);
    if (ctx.json) console.log(JSON.stringify(results));
    else if (!ctx.quick || results.some((r) => !r.ok)) console.log(render(results, ctx));
  } catch (e) {
    console.error(`claudzilla doctor: ${e.message}`);
    process.exit(1);
  }
}
