import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCsvLine, parseCsvLine } from "../src/csv.mjs";

test("plain and empty fields", () => {
  assert.deepEqual(parseCsvLine("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
  assert.deepEqual(parseCsvLine(""), [""]);
  assert.deepEqual(parseCsvLine("a,"), ["a", ""]);
  assert.deepEqual(parseCsvLine(" a , b "), [" a ", " b "]);
});

test("quoted fields", () => {
  assert.deepEqual(parseCsvLine('"a,b",c'), ["a,b", "c"]);
  assert.deepEqual(parseCsvLine('"say ""hi""",x'), ['say "hi"', "x"]);
  assert.deepEqual(parseCsvLine('"",""'), ["", ""]);
  assert.deepEqual(parseCsvLine('x,"y"'), ["x", "y"]);
});

test("malformed lines throw SyntaxError", () => {
  for (const s of ['"unterminated', 'a,"b"c', 'a"b', '"a""']) assert.throws(() => parseCsvLine(s), SyntaxError, s);
});

test("round-trips formatCsvLine", () => {
  for (const f of [["a", "b,c", 'd"e', ""], [""], ['""', ",", "x y"]]) assert.deepEqual(parseCsvLine(formatCsvLine(f)), f);
});
