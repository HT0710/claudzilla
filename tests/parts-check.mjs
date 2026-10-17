// Exit 1 listing any base key, env/marketplace/plugin key or hook entry claimed by 0 or 2+ parts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const repo = process.argv[2];
const parts = JSON.parse(readFileSync(join(repo, "parts.json"), "utf8"));
const base = JSON.parse(readFileSync(join(repo, "settings.base.json"), "utf8"));
const names = Object.keys(parts);
const bad = [];
const owners = (hit) => names.filter(hit);
const once = (what, hit) => { const o = owners(hit); if (o.length !== 1) bad.push(`${what}: ${o.length ? o.join("+") : "unclaimed"}`); };
const containers = ["env", "extraKnownMarketplaces", "enabledPlugins", "hooks"];
for (const k of Object.keys(base).filter((k) => !containers.includes(k)))
  once(`key ${k}`, (n) => parts[n].keys?.includes(k) || (parts[n].rest && !names.some((m) => parts[m].keys?.includes(k))));
for (const c of ["env", "extraKnownMarketplaces"])
  for (const k of Object.keys(base[c] ?? {})) once(`${c}.${k}`, (n) => parts[n].keys?.includes(`${c}.${k}`));
for (const k of Object.keys(base.enabledPlugins ?? {})) once(`plugin ${k}`, (n) => parts[n].plugins?.includes(k));
for (const [ev, list] of Object.entries(base.hooks ?? {}))
  list.forEach((e, i) => {
    const cmds = e.hooks.map((h) => h.command);
    once(`hook ${ev}[${i}]`, (n) => cmds.some((c) => parts[n].hooks?.some((s) => c.includes(s))));
  });
for (const l of "CLAUDE.md RTK.md rules themes hud hooks/claudzilla-update.sh hooks/rules-guard.mjs hooks/md-display.pl skills/pr skills/rule-review".split(" "))
  once(`link ${l}`, (n) => parts[n].links?.includes(l));
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
