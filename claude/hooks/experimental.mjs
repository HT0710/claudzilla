#!/usr/bin/env node
// Experimental features: claude/experimental/<id>.md, off until claudzilla.json sets experimental.<id> to true.
//   node experimental.mjs          SessionStart hook: print enabled feature text
//   node experimental.mjs --list   print [{id, description, on}] as JSON
//   node experimental.mjs --set <id> on|off   write experimental.<id> to claudzilla.json
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)));
const DIR = join(HERE, "..", "experimental");
const ID = /^[a-z][A-Za-z0-9]*$/;

function enabled() {
  try {
    const cfg = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "claudzilla.json");
    const e = JSON.parse(readFileSync(cfg, "utf8")).experimental;
    return e && typeof e === "object" && !Array.isArray(e) ? e : {};
  } catch { return {}; }
}

export function features() {
  let names;
  try { names = readdirSync(DIR); } catch { return []; }
  const state = enabled();
  return names
    .filter((n) => n.endsWith(".md") && ID.test(n.slice(0, -3)))
    .map((n) => n.slice(0, -3))
    .sort()
    .flatMap((id) => {
      let text;
      try { text = readFileSync(join(DIR, `${id}.md`), "utf8").trimEnd(); } catch { return []; }
      const description = text.split("\n").slice(1).find((l) => l.trim()) ?? "";
      return [{ id, description, text, on: Object.hasOwn(state, id) && state[id] === true }];
    });
}

function fail(code, msg) { console.error(msg); process.exit(code); }

function setFeature(id, state) {
  const known = features().map((f) => f.id);
  if (!known.includes(id)) fail(3, `No experimental feature "${id}". Known: ${known.join(", ")}`);
  let file = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "claudzilla.json");
  let cfg = {};
  let raw;
  try {
    if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() && !existsSync(file)) file = resolve(dirname(file), readlinkSync(file));
    else if (existsSync(file)) file = realpathSync(file);
    if (existsSync(file)) raw = readFileSync(file, "utf8");
  } catch (err) { fail(1, `Could not write ${file}: ${err.message}`); }
  if (raw !== undefined) {
    try { cfg = JSON.parse(raw); } catch { cfg = null; }
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) fail(2, `${file} is not valid JSON. Fix it, then retry.`);
  }
  const e = cfg.experimental;
  cfg.experimental = { ...(e && typeof e === "object" && !Array.isArray(e) ? e : {}), [id]: state === "on" };
  const tmp = join(dirname(file), ".claudzilla.json.claudzilla");
  try {
    writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    fail(1, `Could not write ${file}: ${err.message}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--list") {
    console.log(JSON.stringify(features().map(({ id, description, on }) => ({ id, description, on }))));
  } else if (process.argv[2] === "--set") {
    const [, , , id, state, extra] = process.argv;
    if (!id || !["on", "off"].includes(state) || extra !== undefined) fail(4, "Use: --set <id> on|off");
    setFeature(id, state);
  } else {
    try {
      const text = features().filter((f) => f.on && f.text).map((f) => f.text).join("\n\n");
      if (text) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
    } catch { /* never fail a session */ }
  }
}
