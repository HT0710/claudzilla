import { test } from "node:test";
import assert from "node:assert/strict";
import { toCents } from "../src/money.mjs";

test("toCents is exact for two-decimal amounts", () => {
  for (const [s, c] of [["0.29", 29], ["1.15", 115], ["19.99", 1999], ["4.35", 435], ["7", 700], ["0.5", 50], ["1005.07", 100507]]) {
    assert.equal(toCents(s), c, s);
  }
});
