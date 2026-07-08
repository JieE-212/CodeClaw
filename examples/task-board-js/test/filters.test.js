import test from "node:test";
import assert from "node:assert/strict";
import { filterTasks, sortTasksByTitle } from "../src/filters.js";
import { cloneTasks } from "../src/tasks.js";

test("filterTasks filters by status", () => {
  const result = filterTasks(cloneTasks(), { status: "doing" });
  assert.deepEqual(result.map((task) => task.id), ["T-102", "T-104"]);
});

test("filterTasks filters by assignee", () => {
  const result = filterTasks(cloneTasks(), { assignee: "Mina" });
  assert.deepEqual(result.map((task) => task.id), ["T-101", "T-103"]);
});

test("sortTasksByTitle sorts without mutating input", () => {
  const input = cloneTasks();
  const result = sortTasksByTitle(input);
  assert.deepEqual(result.map((task) => task.id), ["T-104", "T-101", "T-103", "T-102"]);
  assert.equal(input[0].id, "T-101");
});
