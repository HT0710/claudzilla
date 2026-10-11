// Summary statistics for a list of numbers.
export function summary(xs) {
  const sorted = xs.sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, min: sorted[0], max: sorted[n - 1], mean: Math.round(mean * 100) / 100, median };
}
