#!/usr/bin/env node
// Transcript facts for graders: `text` = the last assistant message's text; `tools` = one line per tool call, "<name>\t<path|command|skill>".
//   node evals/tx.mjs text|tools <transcript.jsonl>
import { existsSync, readFileSync } from "node:fs";

const [what, file] = process.argv.slice(2);
const lines = file && existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
const msgs = lines.flatMap((l) => {
  try {
    const o = JSON.parse(l);
    return o.type === "assistant" && Array.isArray(o.message?.content) ? [o.message] : [];
  } catch { return []; }
});
if (what === "text") {
  // One message spans several transcript lines (one per content block); join the last one's text blocks.
  let id, text = [];
  for (const m of msgs) {
    const t = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (!t) continue;
    if (m.id !== id) { id = m.id; text = []; }
    text.push(t);
  }
  console.log(text.join("\n"));
} else if (what === "tools") {
  for (const m of msgs) for (const b of m.content) {
    if (b.type !== "tool_use") continue;
    const arg = b.input?.file_path ?? b.input?.command ?? b.input?.skill ?? "";
    console.log(`${b.name}\t${String(arg).replace(/\s+/g, " ")}`);
  }
} else {
  console.error("usage: tx.mjs text|tools <transcript.jsonl>");
  process.exit(2);
}
