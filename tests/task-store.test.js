import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore, buildTaskReviewDraft, summarizeTask, summarizeVerificationFailure } from "../packages/task-store/src/index.js";

const temporaryRoots = [];

async function makeStore() {
  const root = await makeTemporaryRoot("codeclaw-tasks-");
  return new TaskStore({ storagePath: path.join(root, "tasks.json") });
}

async function makeTemporaryRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

test.after(async () => {
  for (const root of temporaryRoots) await fs.rm(root, { recursive: true, force: true });
});

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

test("TaskStore serializes concurrent read-modify-write updates", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "concurrent updates", rootPath: "C:/repo-a" });
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.appendSuggestion(task.id, { provider: "mock", content: `suggestion-${index}` })));
  const updated = await store.get(task.id);
  assert.equal(updated.suggestions.length, 20);
  assert.equal(new Set(updated.suggestions.map((item) => item.content)).size, 20);
});

test("TaskStore coordinates concurrent mutations across instances and Windows path casing", async (t) => {
  const root = await makeTemporaryRoot("codeclaw-task-cross-process-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storagePath = path.join(root, "tasks.json");
  const first = new TaskStore({ storagePath });
  const second = new TaskStore({ storagePath: process.platform === "win32" ? storagePath.toUpperCase() : storagePath });

  await Promise.all([
    first.create({ goal: "first instance", rootPath: "C:/repo-a" }),
    second.create({ goal: "second instance", rootPath: "C:/repo-a" })
  ]);

  const tasks = await first.readAll();
  assert.equal(tasks.length, 2);
  assert.deepEqual(new Set(tasks.map((task) => task.goal)), new Set(["first instance", "second instance"]));
});

test("TaskStore records apply and revert transaction ids idempotently", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "idempotent transaction", rootPath: "C:/repo-a" });
  const patch = {
    transactionId: "apply-idempotent-12345678",
    path: "src/a.js",
    previousContent: "a1",
    nextContent: "a2"
  };
  await store.recordAppliedPatch(task.id, patch);
  const replayed = await store.recordAppliedPatch(task.id, patch);
  assert.equal(replayed.appliedPatches.length, 1);

  await store.markPatchReverted(task.id, 0, { revertTransactionId: "revert-idempotent-12345678" });
  const revertReplay = await store.markPatchReverted(task.id, 0, { revertTransactionId: "revert-idempotent-12345678" });
  assert.equal(revertReplay.appliedPatches[0].revertTransactionId, "revert-idempotent-12345678");
});

test("TaskStore derives a stable identity for legacy applied patches", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "legacy patch", rootPath: "C:/repo-a" });
  const applied = await store.recordAppliedPatch(task.id, {
    path: "src/a.js",
    previousExists: true,
    previousContent: "a1",
    nextContent: "a2"
  });
  const raw = JSON.parse(await fs.readFile(store.storagePath, "utf8"));
  delete raw[0].appliedPatches[0].patchIdentity;
  await fs.writeFile(store.storagePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const restored = await new TaskStore({ storagePath: store.storagePath }).get(applied.id);
  assert.match(restored.appliedPatches[0].patchIdentity, /^[0-9a-f]{64}$/);
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
