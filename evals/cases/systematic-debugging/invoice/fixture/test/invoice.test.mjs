import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal } from "../src/invoice.mjs";

test("sums whole prices", () => {
  assert.equal(invoiceTotal([{ qty: 3, price: "4" }]), "12.00");
});

test("sums cents", () => {
  assert.equal(invoiceTotal([{ qty: 3, price: "0.29" }, { qty: 1, price: "1.5" }]), "2.37");
});
