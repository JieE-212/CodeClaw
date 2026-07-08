import test from "node:test";
import assert from "node:assert/strict";
import { add, divide } from "../src/calculator.js";

test("add returns the sum", () => {
  assert.equal(add(2, 3), 5);
});

test("divide returns the quotient", () => {
  assert.equal(divide(8, 2), 4);
});
