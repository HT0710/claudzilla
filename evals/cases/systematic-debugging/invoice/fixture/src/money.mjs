// Parses a decimal amount like "12.5" into integer cents.
export function toCents(amount) {
  return Math.floor(parseFloat(amount) * 100);
}
