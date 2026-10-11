// Exits 1 unless config.json and data/users.json have the v2 shape (see V2.md).
import { readFileSync } from "node:fs";

const fail = (msg) => { console.error(`invalid: ${msg}`); process.exit(1); };
const read = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { fail(`${f}: ${e.message}`); } };
const str = (v) => typeof v === "string" && v !== "";

const cfg = read("config.json");
if (cfg.version !== 2) fail("config.version must be 2");
const db = cfg.db ?? {};
if (!str(db.host) || !Number.isInteger(db.port) || !str(db.name) || !str(db.user)) fail("config.db needs host, port, name, user");
if (!Number.isInteger(cfg.timeoutMs)) fail("config.timeoutMs must be an integer");
if ("timeout" in cfg || "password" in db) fail("config has v1 or secret fields");

const users = read("data/users.json");
if (!Array.isArray(users)) fail("users must be an array");
for (const u of users) {
  if (!str(u.first) || typeof u.last !== "string" || !str(u.email)) fail(`bad user ${JSON.stringify(u)}`);
  if (u.email !== u.email.toLowerCase() || "name" in u) fail(`user not migrated ${JSON.stringify(u)}`);
}
console.log("ok");
