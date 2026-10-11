import { test } from "node:test";
import assert from "node:assert/strict";
import { summary } from "../src/stats.mjs";

test("1: input array is not mutated", () => {
  const xs = [3, 1, 2];
  summary(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});

test("2: empty list throws RangeError", () => {
  assert.throws(() => summary([]), RangeError);
});

test("5: non-finite entries throw TypeError", () => {
  for (const xs of [[1, "2"], [1, NaN], [Infinity], [1, null]]) assert.throws(() => summary(xs), TypeError);
});

test("3 and 4 not applied", () => {
  assert.equal(summary([1, 2, 2]).mean, 1.67);
  assert.equal(summary([4, 1, 3, 2]).median, 2.5);
});
