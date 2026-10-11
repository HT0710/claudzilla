import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "../src/duration.mjs";

test("valid durations", () => {
  for (const [s, n] of [["1h30m", 5400], ["45s", 45], ["2h5s", 7205], ["1h 30m 15s", 5415], ["  10m ", 600], ["0s", 0], ["100h", 360000], ["0h0m1s", 1]]) {
    assert.equal(parseDuration(s), n, s);
  }
});

test("invalid durations throw RangeError", () => {
  for (const s of ["", "   ", "5d", "1h1h", "30m1h", "90", "1.5h", "-1h", "+1h", "1 h", "h", "1h30"]) {
    assert.throws(() => parseDuration(s), RangeError, JSON.stringify(s));
  }
});
