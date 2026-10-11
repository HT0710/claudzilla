import { toCents } from "./money.mjs";

// Total of line items ({ qty, price } with price a decimal string) as "123.45".
export function invoiceTotal(items) {
  const cents = items.reduce((sum, it) => sum + it.qty * toCents(it.price), 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
