import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore, buildTaskReviewDraft, summarizeTask, summarizeVerificationFailure } from "../packages/task-store/src/index.js";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-tasks-"));
  return new TaskStore({ storagePath: path.join(root, "tasks.json") });
}

test("TaskStore creates and returns latest tasks", async () => {
  const store = await makeStore();
  const first = await store.create({ goal: "first", rootPath: "C:/repo-a" });
  const second = await store.create({ goal: "second", rootPath: "C:/repo-a" });

  assert.equal(first.status, "planned");
  assert.equal((await store.latest({ rootPath: "C:/repo-a" })).id, second.id);
});

test("TaskStore stores plan, tool calls, verification, and completion", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "fix tests", rootPath: "C:/repo-a" });

  await store.setPlan(task.id, { title: "Plan", steps: [{ id: "one" }] });
  await store.appendToolCall(task.id, { tool: "read_file", summary: "ok" });
  await store.appendContextFile(task.id, { path: "src/index.js", summary: "export" });
  await store.appendSuggestion(task.id, { provider: "mock", content: "try this" });
  await store.setVerification(task.id, { exitCode: 0, timedOut: false });
  const completed = await store.complete(task.id, "done");

  assert.equal(completed.status, "completed");
  assert.equal(completed.toolCalls.length, 1);
  assert.equal(completed.contextFiles.length, 1);
  assert.equal(completed.suggestions.length, 1);
  assert.equal(completed.verification.exitCode, 0);
  assert.equal(completed.summary, "done");
  assert.match(completed.reviewDraft, /Title: fix tests/);
  assert.match(completed.reviewDraft, /Verification:/);
  assert.match(summarizeTask(completed), /completed/);
});

test("TaskStore updates duplicate context files", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "read context", rootPath: "C:/repo-a" });
  await store.appendContextFile(task.id, { path: "src/index.js", summary: "first" });
  const updated = await store.appendContextFile(task.id, { path: "src/index.js", summary: "second" });
  assert.equal(updated.contextFiles.length, 1);
  assert.equal(updated.contextFiles[0].summary, "second");
});

test("TaskStore stores patch proposals and tracks revert state", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "patch", rootPath: "C:/repo-a" });
  const proposed = await store.setPatchProposal(task.id, { path: "src/index.js", content: "next", diff: "+next" });
  assert.equal(proposed.status, "patch_ready");
  assert.equal(proposed.patchProposal.path, "src/index.js");

  const applied = await store.recordAppliedPatch(task.id, { path: "src/index.js", previousContent: "old", nextContent: "next" });
  assert.equal(applied.status, "patched");
  assert.equal(applied.appliedPatches.length, 1);

  const reverted = await store.markLastPatchReverted(task.id);
  assert.ok(reverted.appliedPatches[0].revertedAt);
});

test("TaskStore can revert a specific applied patch", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "patch", rootPath: "C:/repo-a" });
  await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  await store.recordAppliedPatch(task.id, { path: "src/b.js", previousContent: "b1", nextContent: "b2" });
  const reverted = await store.markPatchReverted(task.id, 0);
  assert.ok(reverted.appliedPatches[0].revertedAt);
  assert.equal(reverted.appliedPatches[1].revertedAt, null);
});

test("TaskStore keeps completed status when reverting after completion", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "patch", rootPath: "C:/repo-a" });
  await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  await store.complete(task.id, "done");
  const reverted = await store.markPatchReverted(task.id, 0);
  assert.equal(reverted.status, "completed");
  assert.ok(reverted.appliedPatches[0].revertedAt);
});

test("TaskStore marks failed verification", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "fix tests", rootPath: "C:/repo-a" });
  const updated = await store.setVerification(task.id, { exitCode: 1, timedOut: false, stderr: "AssertionError" });
  assert.equal(updated.status, "failed");
  assert.equal(updated.verificationHistory.length, 1);
  assert.match(updated.failureSummary, /AssertionError/);
});

test("summarizeVerificationFailure handles timeout and nonzero output", () => {
  assert.match(summarizeVerificationFailure({ timedOut: true, durationMs: 50 }), /timed out/);
  assert.match(summarizeVerificationFailure({ exitCode: 2, stderr: "boom" }), /boom/);
});

test("summarizeVerificationFailure keeps assertion details before stack tail", () => {
  const summary = summarizeVerificationFailure({
    exitCode: 1,
    timedOut: false,
    stdout: [
      "✖ failing tests:",
      "test at test/calculator.test.js:9:1",
      "✖ divide returns the quotient",
      "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
      "  4 !== 5",
      "      at TestContext.<anonymous> (test/calculator.test.js:10:10)",
      "    actual: 4,",
      "    expected: 5,",
      "    operator: 'strictEqual'",
      "      at Test.run (node:internal/test_runner/test:1201:25)"
    ].join("\n")
  });

  assert.match(summary, /divide returns the quotient/);
  assert.match(summary, /4 !== 5/);
  assert.match(summary, /actual: 4/);
  assert.match(summary, /expected: 5/);
});

test("buildTaskReviewDraft summarizes changed files and verification", () => {
  const draft = buildTaskReviewDraft({
    goal: "add coverage",
    toolCalls: [],
    suggestions: [],
    contextFiles: [],
    appliedPatches: [{ path: "test/example.test.js", revertedAt: null }],
    verification: { exitCode: 0, timedOut: false }
  }, "Added test coverage.");

  assert.match(draft, /Title: add coverage/);
  assert.match(draft, /- test\/example\.test\.js/);
  assert.match(draft, /Exit code 0/);
  assert.match(draft, /Verification passed/);
});
