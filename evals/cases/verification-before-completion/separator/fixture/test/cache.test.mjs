import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey } from "../src/cache.mjs";

test("cacheKey joins user and id", () => {
  assert.equal(cacheKey("ann", 42), "ann-42");
});
