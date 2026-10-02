import test from "node:test";
import assert from "node:assert/strict";
import { reportLines, checkDigit } from "../src/reports.js";
const rules = {
  counted: "not_cancelled",
  bulk: 8,
  rounding: "nearest10",
  late: "grace1",
  top: "qty",
  tie: "alpha",
  sort: "revenue_desc",
  zero_lines: true,
};
const orders = [
  {
    customer: "Example",
    product: "widgets",
    qty: 10,
    price: 11,
    status: "delivered",
    promised: 3,
    delivered: 5,
  },
  {
    customer: "Example",
    product: "hinges",
    qty: 1,
    price: 5,
    status: "cancelled",
    promised: 3,
    delivered: null,
  },
];
test("integer cents discount, rounding, exclusion, grace and zero rows", () => {
  const rows = reportLines(rules, orders, ["Empty", "Example"]);
  assert.deepEqual(rows, [
    {
      customer: "Example",
      orders: 1,
      revenue_cents: 10000,
      late: 1,
      top: "widgets",
    },
    { customer: "Empty", orders: 0, revenue_cents: 0, late: 0, top: "-" },
  ]);
  assert.equal(checkDigit(rows), 2);
});
test("name sorting ignores alternative appearance tiebreak", () => {
  const rows = reportLines(
    { ...rules, sort: "name" },
    orders,
    ["Empty", "Example"],
    { sort_tie: "appearance" },
  );
  assert.deepEqual(
    rows.map((r) => r.customer),
    ["Empty", "Example"],
  );
});
