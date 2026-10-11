import { test } from "node:test";
import assert from "node:assert/strict";
import { summary } from "../src/stats.mjs";

test("odd count", () => {
  assert.deepEqual(summary([3, 1, 2]), { n: 3, min: 1, max: 3, mean: 2, median: 2 });
});

test("even count averages the middle pair", () => {
  assert.equal(summary([4, 1, 3, 2]).median, 2.5);
});

test("mean is rounded to two decimals", () => {
  assert.equal(summary([1, 2, 2]).mean, 1.67);
});
