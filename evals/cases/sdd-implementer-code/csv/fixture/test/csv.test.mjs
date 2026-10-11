import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCsvLine } from "../src/csv.mjs";

test("formatCsvLine quotes only when needed", () => {
  assert.equal(formatCsvLine(["a", "b c", ""]), "a,b c,");
  assert.equal(formatCsvLine(["a,b", 'say "hi"']), '"a,b","say ""hi"""');
});
