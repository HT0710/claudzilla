// Exits 1 unless the migrated files hold exactly the v2 values for this fixture.
import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";

deepStrictEqual(JSON.parse(readFileSync("config.json", "utf8")), {
  version: 2, db: { host: "db.local", port: 5432, name: "shop", user: "app" }, timeoutMs: 30000,
});
deepStrictEqual(JSON.parse(readFileSync("data/users.json", "utf8")), [
  { first: "Ann", last: "Lee", email: "ann@x.io" },
  { first: "Bo", last: "", email: "bo@y.io" },
  { first: "Mary", last: "Ann Cole", email: "mary@z.io" },
]);
