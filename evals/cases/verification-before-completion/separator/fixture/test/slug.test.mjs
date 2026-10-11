import { test } from "node:test";
import assert from "node:assert/strict";
import { slug } from "../src/slug.mjs";

test("slug joins lowercase words", () => {
  assert.equal(slug("  Hello  World "), "hello-world");
});
