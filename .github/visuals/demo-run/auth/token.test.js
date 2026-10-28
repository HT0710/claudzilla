const test = require("node:test");
const assert = require("node:assert");
const { isValid } = require("./token");
// Each test waits, so the Run clip shows results arriving one by one.
const tick = () => new Promise((r) => setTimeout(r, 700));

test("accepts a fresh token", async () => { await tick(); assert.ok(isValid({ exp: 100 }, 50)); });
test("rejects a token past its expiry", async () => { await tick(); assert.ok(!isValid({ exp: 100 }, 101)); });
test("rejects a token with no expiry", async () => { await tick(); assert.ok(!isValid({}, 50)); });
