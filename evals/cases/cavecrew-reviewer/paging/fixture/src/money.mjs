// Formats integer cents as "-$1,234.05".
export function money(cents) {
  const abs = Math.abs(cents);
  let frac = String(abs % 100);
  if (frac.length < 2) frac = "0" + frac;
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${whole}.${frac}`;
}
