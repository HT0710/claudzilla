import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stale } from "../src/cleanup.mjs";

test("stale lists files older than the cutoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-"));
  writeFileSync(join(dir, "old"), "");
  writeFileSync(join(dir, "new"), "");
  utimesSync(join(dir, "old"), new Date(0), new Date(0));
  assert.deepEqual(stale(dir, 30), [join(dir, "old")]);
});
