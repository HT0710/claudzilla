// Formats integer cents as "-$1,234.05".
export function money(cents) {
  const abs = Math.abs(cents);
  const frac = String(abs % 100).padStart(2, "0");
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${whole}.${frac}`;
}
