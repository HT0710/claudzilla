#!/usr/bin/env node
// Fills a missing or taken Agent name so every subagent has one; names used this session live in a per-session dir.
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Each style: lists the name is built from, 24 characters at most in the longest combination.
export const STYLES = {
  animal: [
    ["brave", "sleepy", "sneaky", "jolly", "grumpy", "fuzzy", "clever", "dizzy", "mighty", "wobbly", "cosmic", "nimble"],
    ["otter", "lynx", "badger", "falcon", "walrus", "panda", "gecko", "moose", "heron", "ferret", "koala", "newt"],
  ],
  fantasy: [
    ["wandering", "grim", "merry", "arcane", "silent", "lucky", "wild", "ember"],
    ["wizard", "rogue", "paladin", "bard", "ranger", "druid", "monk", "cleric", "warlock", "knight"],
  ],
  codename: [["nova", "orbit", "quasar", "vector", "photon", "comet", "pulsar", "nebula", "zenith", "ion", "apollo", "helix"]],
  epithet: [
    ["waffle", "bruno", "mabel", "otto", "pixel", "gus", "luna", "milo", "ziggy", "pearl", "rudy", "tess", "ivy", "hugo", "nell", "fritz", "daisy", "ollie", "max", "bea"],
    ["bold", "baker", "brave", "wise", "swift", "sly", "tidy", "kind", "loud", "calm", "bright", "lazy", "odd", "fierce", "merry", "keen", "gentle", "mighty", "witty", "grand"],
  ],
};

export function nameFrom(style, pick) {
  const [a, b] = STYLES[style].map((l) => pick(l));
  if (style === "codename") return `${a}-${1 + Math.floor(Math.random() * 99)}`;
  return style === "epithet" ? `${a}-the-${b}` : `${a}-${b}`;
}

const rand = (l) => l[Math.floor(Math.random() * l.length)];
const KINDS = Object.keys(STYLES);
// codename's pick is called once, so its number comes from nameFrom itself.
const randomName = (style) => nameFrom(style, rand);

async function main() {
  try {
    // Drain stdin first so a large event never meets a closed pipe on the early exits.
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const d = JSON.parse(raw);
    const teams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    // With teams on, a named spawn becomes a teammate; touching the input could change that.
    if (d.hook_event_name !== "PreToolUse" || (teams && teams !== "0") || d.agent_id || !d.session_id) process.exit(0);
    // Per user and private, because tmpdir is shared on Linux: another user's planted dir or symlink would get our writes.
    const uid = process.getuid?.();
    const root = join(tmpdir(), `agent-name-${uid ?? "u"}`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const st = lstatSync(root);
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || st.mode & 0o077) process.exit(0);
    const dir = join(root, String(d.session_id).replace(/[^\w-]/g, ""));
    mkdirSync(dir, { mode: 0o700, recursive: true });
    // The exclusive flag makes the claim atomic, so parallel spawns never share a name.
    const claimFile = (f) => {
      try { writeFileSync(join(dir, f), "", { flag: "wx" }); return true; }
      catch (e) { if (e.code === "EEXIST") return false; throw e; }
    };
    const claim = (n) => claimFile(encodeURIComponent(n));
    const given = d.tool_input?.name;
    const had = typeof given === "string" && given !== "";
    if (had && (claim(given) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(given))) process.exit(0);
    // Slot files %s0, %s1, ... never collide with names (encodeURIComponent escapes %); a distinct slot per spawn rotates the style.
    let slot = -1;
    for (let i = 0; i < 100 && slot < 0; i++) if (claimFile(`%s${i}`)) slot = i;
    const offset = [...String(d.session_id)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const style = slot < 0 ? rand(KINDS) : KINDS[(slot + offset) % KINDS.length];
    let name;
    for (let i = 0; i < 100 && !name; i++) { const n = randomName(style); if (claim(n)) name = n; }
    if (!name) process.exit(0);
    const tail = "playful character name of your own, 1 to 3 words in kebab case, like `brave-otter`.";
    const additionalContext = had
      ? `The name \`${given}\` was already used this session, so the hook picked \`${name}\`. Next time, give each subagent a new ${tail}`
      : `This Agent call had no \`name\`, so the hook picked \`${name}\`. Next time, give each subagent a ${tail}`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...d.tool_input, name }, additionalContext } }));
  } catch { /* a naming bug must never block a spawn */ }
}

let entry = false;
try { entry = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* not a file entry */ }
if (entry) await main();
