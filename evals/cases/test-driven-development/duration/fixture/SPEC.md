# parseDuration(text) → seconds

- Parts are a non-negative integer followed by a unit: `h`, `m` or `s`.
- Each unit appears at most once, in the order `h`, `m`, `s`: `1h30m`, `45s`, `2h5s`.
- Spaces may separate parts (`1h 30m 15s`); leading and trailing spaces are ignored.
- No space between a number and its unit; no sign, no decimals.
- `0s` is valid and returns `0`.
- Anything else throws a `RangeError`: empty or blank text, an unknown unit, a repeated unit,
  units out of order (`30m1h`), a bare number (`90`), a decimal (`1.5h`), a sign (`-1h`).
