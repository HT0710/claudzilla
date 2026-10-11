import { test } from "node:test";
import assert from "node:assert/strict";
import { shout } from "../src/shout.mjs";

test("shout", () => assert.equal(shout("hi"), "HI!"));
