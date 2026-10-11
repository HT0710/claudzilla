import { test } from "node:test";
import assert from "node:assert/strict";
import { userHandle } from "../src/users.mjs";
import { postUrl } from "../src/posts.mjs";
import { tagKey } from "../src/tags.mjs";

test("behavior preserved", () => {
  assert.equal(userHandle("Ünïcode -- Name!"), "unicode-name");
  assert.equal(userHandle("snake_case"), "snake-case");
  assert.equal(postUrl("  Ça va?  ", 3), "/posts/3-ca-va");
  assert.equal(tagKey("Snake_Case Tag"), "snake_case-tag");
  assert.equal(tagKey("--a--"), "a");
});
