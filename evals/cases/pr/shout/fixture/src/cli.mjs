#!/usr/bin/env node
import { greet } from "./greet.mjs";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "greet") console.log(greet(rest[0]));
else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
