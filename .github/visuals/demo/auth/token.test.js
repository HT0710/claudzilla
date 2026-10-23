const assert = require("node:assert");
const { isValid } = require("./token");
// A token is valid up to and including its expiry second.
assert.strictEqual(isValid({ exp: 100 }, 100), true);
console.log("ok");
