import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, stale } from "../src/cleanup.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-"));
  writeFileSync(join(dir, "old"), "");
  writeFileSync(join(dir, "new"), "");
  utimesSync(join(dir, "old"), new Date(0), new Date(0));
  return dir;
}

test("stale lists files older than the cutoff", () => {
  const dir = fixture();
  assert.deepEqual(stale(dir, 30), [join(dir, "old")]);
});

test("deletes and prints stale files", () => {
  const dir = fixture();
  const out = [];
  assert.equal(main([dir], (l) => out.push(l)), 0);
  assert.deepEqual(out, [join(dir, "old")]);
  assert.equal(existsSync(join(dir, "old")), false);
});

test("--dry-run prints but keeps files", () => {
  const dir = fixture();
  const out = [];
  main(["--dry-run", dir], (l) => out.push(l));
  assert.deepEqual(out, [join(dir, "old")]);
  assert.equal(existsSync(join(dir, "old")), true);
});
