#!/usr/bin/env node
// Prints "name · abcd1234" from the statusline payload on stdin.
// ponytail: prefix line only; the OMC HUD dist is generated, so don't patch it.
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
let d = {};
try { d = JSON.parse(raw); } catch { /* no payload, print nothing */ }
// hud-filter.pl relocates this first line onto the cwd line.
const id = String(d.session_id ?? "").slice(0, 8);
if (id) process.stdout.write(`\x1b[2m${id}\x1b[0m\n`);
