import { test } from "node:test";
import assert from "node:assert/strict";
import { userHandle } from "../src/users.mjs";
import { postUrl } from "../src/posts.mjs";
import { tagKey } from "../src/tags.mjs";

test("userHandle", () => assert.equal(userHandle("Zoë Smith"), "zoe-smith"));
test("postUrl", () => assert.equal(postUrl("Hello, World!", 7), "/posts/7-hello-world"));
test("tagKey", () => assert.equal(tagKey("  Rust Lang "), "rust-lang"));
