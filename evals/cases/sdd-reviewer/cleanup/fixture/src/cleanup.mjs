#!/usr/bin/env node
// Deletes files older than --days N (default 30) directly under a directory.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86400000;

export function stale(dir, days, now = Date.now()) {
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile() && now - statSync(p).mtimeMs > days * DAY);
}

export function main(argv, log = console.log) {
  let days = 30;
  let dir = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") days = Number(argv[++i]);
    else dir = argv[i];
  }
  for (const p of stale(dir, days)) rmSync(p);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
