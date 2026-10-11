### Task 2: `parseCsvLine`

**Files:**
- Modify: `src/csv.mjs`
- Test: `test/csv.test.mjs`

**Interfaces:**
- Consumes: `formatCsvLine(fields: string[]): string` (Task 1, `src/csv.mjs`)
- Produces: `parseCsvLine(line: string): string[]`, the inverse of `formatCsvLine` for one line; throws `SyntaxError` on malformed quoting.

**Rules:**
- Fields are separated by `,`. Nothing is trimmed: `" a , b "` → `[" a ", " b "]`.
- An empty line is one empty field (`[""]`); a trailing comma adds a trailing empty field (`"a,"` → `["a", ""]`).
- A field that starts with `"` is quoted: it runs to the next `"` that is not doubled. Inside it, `""` stands for one `"`, and `,` is literal.
- After a closing quote only `,` or the end of the line may follow.
- Throw `SyntaxError` for a quoted field with no closing quote, for any other character after a closing quote, and for a `"` inside an unquoted field.
- `parseCsvLine(formatCsvLine(fields))` returns `fields` for any list of strings without newlines.

**Steps:** write failing tests for these rules in `test/csv.test.mjs`, run `node --test` (fails), implement in `src/csv.mjs`, run `node --test` (passes), commit as `feat(csv): add parseCsvLine`.
