import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, average, formatAmount, applyDiscount } from "../src/money.mjs";

test("parseAmount handles currency, commas and accounting negatives", () => {
  assert.equal(parseAmount("$1,234.50"), 1234.5);
  assert.equal(parseAmount("(1,234.50)"), -1234.5);
});

test("parseAmount rejects invalid input", () => {
  assert.throws(() => parseAmount("abc"), /invalid amount/i);
});

test("average handles empty input and rounds to cents", () => {
  assert.equal(average([]), 0);
  assert.equal(average([1, 2, 3]), 2);
  assert.equal(average([0.1, 0.2]), 0.15);
  assert.equal(average([1.005, 1.005]), 1.01);
});

test("formatAmount groups thousands and keeps the sign", () => {
  assert.equal(formatAmount(1234.5), "$1,234.50");
  assert.equal(formatAmount(-1234.5), "-$1,234.50");
});

test("applyDiscount rounds half up", () => {
  assert.equal(applyDiscount(100, 15), 85);
  assert.equal(applyDiscount(10.005, 0), 10.01);
});
