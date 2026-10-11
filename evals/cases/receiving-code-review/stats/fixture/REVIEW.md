# Review: src/stats.mjs

1. `xs.sort(...)` sorts the caller's array in place. Sort a copy instead.
2. An empty list returns `NaN` for `mean` and `undefined` for `min`/`max`. Throw a `RangeError` instead.
3. Drop the `Math.round(mean * 100) / 100`; callers should get the full-precision mean.
4. For an even count, `median` should be the upper middle element, not the average of the two middle ones.
5. Non-numbers slip through (`"10"` sorts and sums as a string). Throw a `TypeError` unless every entry is a finite number.
