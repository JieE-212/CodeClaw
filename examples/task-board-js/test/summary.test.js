import test from "node:test";
import assert from "node:assert/strict";
import { formatSummary, summarizeTasks } from "../src/summary.js";
import { cloneTasks } from "../src/tasks.js";

test("summarizeTasks groups tasks by status and assignee", () => {
  const summary = summarizeTasks(cloneTasks());
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.byStatus, { todo: 1, doing: 2, done: 1 });
  assert.deepEqual(summary.byAssignee, { Mina: 2, Kai: 1, Jo: 1 });
});

test("formatSummary returns compact display text", () => {
  assert.equal(formatSummary(summarizeTasks(cloneTasks())), "4 task(s), 3 status bucket(s)");
});
