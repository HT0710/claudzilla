### Task 2: `parseCsvLine`

**Files:**
- Modify: `src/csv.mjs`
- Test: `test/csv.test.mjs`

**Interfaces:**
- Consumes: `formatCsvLine(fields: string[]): string` (Task 1, `src/csv.mjs`)
- Produces: `parseCsvLine(line: string): string[]`, the inverse of `formatCsvLine` for one line; throws `SyntaxError` on malformed quoting.

- [ ] **Step 1: Write the failing tests**

Change the import in `test/csv.test.mjs` to `import { formatCsvLine, parseCsvLine } from "../src/csv.mjs";`, then append:

```js
test("parseCsvLine splits plain and quoted fields", () => {
  assert.deepEqual(parseCsvLine("a,,c"), ["a", "", "c"]);
  assert.deepEqual(parseCsvLine('"a,b","say ""hi"""'), ["a,b", 'say "hi"']);
  assert.deepEqual(parseCsvLine("a,"), ["a", ""]);
});

test("parseCsvLine rejects malformed quoting", () => {
  for (const s of ['"open', 'a,"b"c', 'a"b']) assert.throws(() => parseCsvLine(s), SyntaxError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test`
Expected: FAIL with `SyntaxError: The requested module '../src/csv.mjs' does not provide an export named 'parseCsvLine'`

- [ ] **Step 3: Implement**

Append to `src/csv.mjs`:

```js
// Splits one CSV line into fields: `"`-quoted fields may hold `,` and `""` (one `"`); nothing is trimmed.
export function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let field = "";
      i++;
      for (;;) {
        if (i >= line.length) throw new SyntaxError("unterminated quoted field");
        if (line[i] === '"') {
          if (line[i + 1] !== '"') break;
          field += '"';
          i += 2;
        } else field += line[i++];
      }
      i++;
      if (i < line.length && line[i] !== ",") throw new SyntaxError(`unexpected character after closing quote at ${i}`);
      fields.push(field);
    } else {
      const comma = line.indexOf(",", i);
      const end = comma === -1 ? line.length : comma;
      const field = line.slice(i, end);
      if (field.includes('"')) throw new SyntaxError(`quote inside unquoted field at ${i}`);
      fields.push(field);
      i = end;
    }
    if (i >= line.length) return fields;
    i++;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/csv.mjs test/csv.test.mjs
git commit -m "feat(csv): add parseCsvLine"
```
