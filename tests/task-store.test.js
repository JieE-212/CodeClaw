import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore, activePatchSetDigest, buildTaskReviewDraft, summarizeTask, summarizeVerificationFailure } from "../packages/task-store/src/index.js";

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
  assert.equal(first.revision, 1);
  assert.equal((await store.latest({ rootPath: "C:/repo-a" })).id, second.id);
});

test("TaskStore creates prepared preflight evidence in one revision", async () => {
  const store = await makeStore();
  const task = await store.create({
    goal: "review safely",
    rootPath: "C:/repo-a",
    plan: { title: "Review", steps: [{ id: "read" }] },
    toolCalls: [{ tool: "read_file", summary: "read source", blocked: false }],
    contextFiles: [{ path: "src/index.js", summary: "UTF-8 text metadata", size: 12, source: "preflight" }],
    status: "running"
  });

  assert.equal(task.revision, 1);
  assert.equal(task.status, "running");
  assert.equal(task.plan.title, "Review");
  assert.equal(task.toolCalls.length, 1);
  assert.equal(task.contextFiles.length, 1);
  assert.ok(task.toolCalls[0].time);
  const persisted = JSON.parse(await fs.readFile(store.storagePath, "utf8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].revision, 1);
  assert.equal(persisted[0].contextFiles[0].path, "src/index.js");
});

test("TaskStore stores plan, tool calls, verification, and completion", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "fix tests", rootPath: "C:/repo-a" });

  await store.setPlan(task.id, { title: "Plan", steps: [{ id: "one" }] });
  await store.appendToolCall(task.id, { tool: "read_file", summary: "ok" });
  await store.appendContextFile(task.id, { path: "src/index.js", summary: "export" });
  await store.recordModelEvent(task.id, {
    operation: "suggestion",
    provider: "mock",
    model: "mock-codeclaw",
    requestSha256: digest("request"),
    responseSha256: digest("response"),
    status: "ok"
  });
  await store.setVerification(task.id, { exitCode: 0, timedOut: false });
  const completed = await store.complete(task.id, "done");

  assert.equal(completed.status, "completed");
  assert.equal(completed.toolCalls.length, 1);
  assert.equal(completed.contextFiles.length, 1);
  assert.equal(completed.modelEvents.length, 1);
  assert.equal(completed.verification.exitCode, 0);
  assert.equal(completed.summary, "done");
  assert.equal(completed.revision, 7);
  assert.match(completed.reviewDraft, /Title: fix tests/);
  assert.match(completed.reviewDraft, /Verification:/);
  assert.match(summarizeTask(completed), /completed/);
});

test("TaskStore updates duplicate context files", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "read context", rootPath: "C:/repo-a" });
  await store.appendContextFile(task.id, {
    path: "src/index.js",
    summary: "UTF-8 text metadata: 1 line(s), 5 byte(s).",
    size: 5
  });
  const updated = await store.appendContextFile(task.id, {
    path: "src/index.js",
    summary: "UTF-8 text metadata: 2 line(s), 6 byte(s).",
    size: 6
  });
  assert.equal(updated.contextFiles.length, 1);
  assert.equal(updated.contextFiles[0].summary, "UTF-8 text metadata: 2 line(s), 6 byte(s).");
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

test("TaskStore normalization preserves applicable patch proposal payloads", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "preserve patch", rootPath: "C:/repo-a" });
  await store.setPatchProposal(task.id, {
    applicable: true,
    path: "src/index.js",
    content: "export const value = 2;\n",
    diff: "--- a/src/index.js\n+++ b/src/index.js\n@@\n-old\n+new",
    summary: "Update the value."
  });
  const before = JSON.parse(await fs.readFile(store.storagePath, "utf8"))[0].patchProposal;

  await store.create({ goal: "force defensive write normalization", rootPath: "C:/repo-b" });
  const after = JSON.parse(await fs.readFile(store.storagePath, "utf8"))[0].patchProposal;
  assert.deepEqual(after, before);
  assert.equal(after.content, "export const value = 2;\n");
  assert.deepEqual(await store.initialize(), { migrated: 0, taskCount: 2 });
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

test("TaskStore reopens a completed task when a patch is reverted", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "patch", rootPath: "C:/repo-a" });
  await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  await store.complete(task.id, "done");
  const reverted = await store.markPatchReverted(task.id, 0);
  assert.equal(reverted.status, "running");
  assert.equal(reverted.verification, null);
  assert.equal(reverted.summary, "");
  assert.equal(reverted.reviewDraft, "");
  assert.ok(reverted.appliedPatches[0].revertedAt);
});

test("TaskStore invalidates stale verification and completion when a patch is applied", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "patch after verification", rootPath: "C:/repo-a" });
  const verified = await store.setVerification(task.id, { exitCode: 0, timedOut: false });
  assert.match(verified.verification.time, /^\d{4}-\d{2}-\d{2}T/);
  await store.update(task.id, { summary: "old summary", reviewDraft: "old review" });

  const applied = await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  assert.equal(applied.status, "patched");
  assert.equal(applied.verification, null);
  assert.equal(applied.failureSummary, "");
  assert.equal(applied.summary, "");
  assert.equal(applied.reviewDraft, "");
  assert.equal(applied.verificationHistory.length, 1);
});

test("TaskStore rejects a verification result captured for an older patch set", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "bind verification", rootPath: "C:/repo-a" });
  const first = await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  const firstDigest = activePatchSetDigest(first);
  assert.match(firstDigest, /^[a-f0-9]{64}$/);
  const second = await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a2", nextContent: "a3" });
  assert.notEqual(activePatchSetDigest(second), firstDigest);

  await assert.rejects(
    store.setVerification(task.id, { exitCode: 0, timedOut: false }, { expectedPatchSetDigest: firstDigest }),
    (error) => error.code === "TASK_VERIFY_PATCH_CHANGED" && error.status === 409
  );
  assert.equal((await store.get(task.id)).verification, null);
});

test("TaskStore completion guard and concurrent Revert cannot leave a completed stale task", async () => {
  const root = await makeTemporaryRoot("codeclaw-task-complete-race-");
  const storagePath = path.join(root, "tasks.json");
  const completingStore = new TaskStore({ storagePath });
  const revertingStore = new TaskStore({ storagePath });
  const task = await completingStore.create({ goal: "complete or revert", rootPath: "C:/repo-a" });
  await completingStore.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  await completingStore.setVerification(task.id, { exitCode: 0, timedOut: false });

  const readyAtCommit = ({ currentTask }) => {
    const digest = activePatchSetDigest(currentTask);
    if (!digest || currentTask.verification?.patchSetDigest !== digest) throw new Error("task is no longer ready");
  };
  await Promise.allSettled([
    completingStore.complete(task.id, "done", "review", { beforeCommit: readyAtCommit }),
    revertingStore.markPatchReverted(task.id, 0)
  ]);

  const finalTask = await completingStore.get(task.id);
  assert.equal(finalTask.status, "running");
  assert.equal(finalTask.verification, null);
  assert.equal(finalTask.summary, "");
  assert.ok(finalTask.appliedPatches[0].revertedAt);
});

test("TaskStore keeps completed tasks terminal except for explicit Revert", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "terminal task", rootPath: "C:/repo-a" });
  await store.recordAppliedPatch(task.id, { path: "src/a.js", previousContent: "a1", nextContent: "a2" });
  await store.setVerification(task.id, { exitCode: 0, timedOut: false });
  await store.complete(task.id, "done", "review");

  const inspected = await store.appendToolCall(task.id, { tool: "read_file", blocked: false });
  assert.equal(inspected.status, "completed");
  assert.equal(inspected.summary, "done");
  for (const operation of [
    () => store.setPlan(task.id, { title: "replacement" }),
    () => store.setVerification(task.id, { exitCode: 0, timedOut: false }),
    () => store.setPatchProposal(task.id, { applicable: false }),
    () => store.recordAppliedPatch(task.id, { path: "src/b.js", previousContent: "b1", nextContent: "b2" })
  ]) {
    await assert.rejects(operation, (error) => error.code === "TASK_ALREADY_COMPLETED" && error.status === 409);
  }

  const finalTask = await store.get(task.id);
  assert.equal(finalTask.status, "completed");
  assert.equal(finalTask.summary, "done");
});

test("TaskStore serializes concurrent read-modify-write updates", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "concurrent updates", rootPath: "C:/repo-a" });
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.recordModelEvent(task.id, {
    operation: "suggestion",
    provider: "mock",
    model: "mock-codeclaw",
    requestSha256: digest(`request-${index}`),
    responseSha256: digest(`response-${index}`),
    status: "ok"
  })));
  const updated = await store.get(task.id);
  assert.equal(updated.modelEvents.length, 20);
  assert.equal(new Set(updated.modelEvents.map((item) => item.responseSha256)).size, 20);
  assert.equal(updated.revision, 21);
});

test("TaskStore keeps only hashed context metadata on disk", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "minimize context", rootPath: "C:/repo-a" });
  const secret = "CONTEXT_BODY_MUST_NOT_PERSIST-中文-😀";
  const updated = await store.appendContextFile(task.id, {
    path: "src/private.js",
    summary: "CONTEXT_SUMMARY_MUST_NOT_PERSIST",
    content: secret,
    contentComplete: true,
    size: 1,
    source: "read_file",
    prompt: "PROMPT_MUST_NOT_PERSIST",
    key: "KEY_MUST_NOT_PERSIST"
  });

  assert.deepEqual(Object.keys(updated.contextFiles[0]).sort(), [
    "contentComplete",
    "path",
    "sha256",
    "size",
    "source",
    "summary",
    "time"
  ]);
  assert.equal(updated.contextFiles[0].sha256, digest(secret));
  assert.equal(updated.contextFiles[0].size, Buffer.byteLength(secret, "utf8"));
  assert.equal(updated.contextFiles[0].summary, "");
  assert.equal(updated.contextFiles[0].contentComplete, true);
  assert.equal(updated.revision, 2);
  const summaryOnly = await store.appendContextFile(task.id, {
    path: "src/summary-only.js",
    summary: "CONTEXT_SUMMARY_ONLY_MUST_NOT_PERSIST",
    size: 41,
    sha256: digest("summary-only"),
    contentComplete: true,
    source: "UNTRUSTED_CONTEXT_SOURCE_MUST_NOT_PERSIST"
  });
  assert.equal(summaryOnly.contextFiles[1].summary, "");
  assert.equal(summaryOnly.contextFiles[1].source, "");
  assert.equal(summaryOnly.revision, 3);
  const raw = await fs.readFile(store.storagePath, "utf8");
  assert.doesNotMatch(raw, /CONTEXT_(?:BODY|SUMMARY|SUMMARY_ONLY)_MUST_NOT_PERSIST|PROMPT_MUST_NOT_PERSIST|KEY_MUST_NOT_PERSIST|UNTRUSTED_CONTEXT_SOURCE_MUST_NOT_PERSIST/);
  assert.doesNotMatch(raw, /"content"\s*:/);
});

test("TaskStore records only allowlisted model event metadata", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "minimize model state", rootPath: "C:/repo-a" });
  const updated = await store.recordModelEvent(task.id, {
    operation: "patch-proposal",
    provider: "openai-compatible",
    model: "gpt-test",
    requestSha256: digest("request"),
    responseSha256: digest("response"),
    status: "completed",
    content: "MODEL_CONTENT_MUST_NOT_PERSIST",
    messages: [{ content: "MODEL_MESSAGES_MUST_NOT_PERSIST" }],
    prompt: "MODEL_PROMPT_MUST_NOT_PERSIST",
    error: "MODEL_ERROR_MUST_NOT_PERSIST",
    key: "MODEL_KEY_MUST_NOT_PERSIST"
  });

  assert.deepEqual(Object.keys(updated.modelEvents[0]), [
    "operation",
    "provider",
    "model",
    "requestSha256",
    "responseSha256",
    "status",
    "time"
  ]);
  const raw = await fs.readFile(store.storagePath, "utf8");
  assert.doesNotMatch(raw, /MODEL_(?:CONTENT|MESSAGES|PROMPT|ERROR|KEY)_MUST_NOT_PERSIST/);
  for (const forbidden of ["content", "messages", "prompt", "error", "key"]) {
    assert.equal(Object.hasOwn(updated.modelEvents[0], forbidden), false);
  }
});

test("TaskStore does not persist raw notes for a new inapplicable patch proposal", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "reject raw invalid response", rootPath: "C:/repo-a" });
  const updated = await store.setPatchProposal(task.id, {
    applicable: false,
    provider: "mock",
    model: "mock-codeclaw",
    reason: "invalid_response",
    summary: "No applicable patch.",
    content: "INVALID_CONTENT_MUST_NOT_PERSIST",
    diff: "INVALID_DIFF_MUST_NOT_PERSIST",
    note: "INVALID_NOTE_MUST_NOT_PERSIST",
    raw: "INVALID_RAW_MUST_NOT_PERSIST",
    prompt: "INVALID_PROMPT_MUST_NOT_PERSIST"
  }, { expectedRevision: task.revision });

  assert.equal(updated.patchProposal.applicable, false);
  for (const forbidden of ["content", "diff", "note", "raw", "prompt"]) {
    assert.equal(Object.hasOwn(updated.patchProposal, forbidden), false);
  }
  assert.doesNotMatch(await fs.readFile(store.storagePath, "utf8"), /INVALID_(?:CONTENT|DIFF|NOTE|RAW|PROMPT)_MUST_NOT_PERSIST/);
});

test("TaskStore commits a patch proposal and minimized model event in one CAS revision", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "atomic model patch", rootPath: "C:/repo-a" });
  const updated = await store.setPatchProposal(task.id, {
    applicable: true,
    path: "src/index.js",
    content: "export const value = 2;\n",
    diff: "+value",
    summary: "Update the value."
  }, {
    expectedRevision: task.revision,
    modelEvent: {
      operation: "patch-proposal",
      provider: "mock",
      model: "mock-codeclaw",
      requestSha256: digest("atomic-request"),
      responseSha256: digest("atomic-response"),
      status: "ok",
      content: "ATOMIC_MODEL_BODY_MUST_NOT_PERSIST",
      error: "ATOMIC_MODEL_ERROR_MUST_NOT_PERSIST"
    }
  });

  assert.equal(updated.revision, task.revision + 1);
  assert.equal(updated.patchProposal.path, "src/index.js");
  assert.equal(updated.modelEvents.length, 1);
  assert.equal(updated.modelEvents[0].requestSha256, digest("atomic-request"));
  assert.equal(updated.modelEvents[0].responseSha256, digest("atomic-response"));
  const raw = await fs.readFile(store.storagePath, "utf8");
  assert.doesNotMatch(raw, /ATOMIC_MODEL_(?:BODY|ERROR)_MUST_NOT_PERSIST/);

  await assert.rejects(
    () => store.setPatchProposal(task.id, { applicable: false, summary: "stale" }, {
      expectedRevision: task.revision,
      modelEvent: { operation: "patch-proposal", status: "stale" }
    }),
    (error) => error.code === "TASK_REVISION_CONFLICT" && error.currentRevision === updated.revision
  );
  assert.equal((await store.get(task.id)).modelEvents.length, 1);
});

test("TaskStore revision CAS rejects stale updates before running a mutation", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "compare and swap", rootPath: "C:/repo-a" });
  let staleCallbackRan = false;
  const updated = await store.update(task.id, { status: "running" }, { expectedRevision: task.revision });
  assert.equal(updated.revision, 2);

  await assert.rejects(
    () => store.update(task.id, () => {
      staleCallbackRan = true;
      return { status: "failed" };
    }, { expectedRevision: task.revision }),
    (error) => error.code === "TASK_REVISION_CONFLICT"
      && error.status === 409
      && error.currentRevision === 2
  );
  assert.equal(staleCallbackRan, false);

  const proposed = await store.setPatchProposal(task.id, {
    applicable: true,
    path: "src/index.js",
    content: "export const value = 2;\n",
    diff: "+value"
  }, { expectedRevision: updated.revision });
  assert.equal(proposed.revision, 3);
  await assert.rejects(
    () => store.setPatchProposal(task.id, { applicable: false, note: "stale raw note" }, { expectedRevision: updated.revision }),
    (error) => error.code === "TASK_REVISION_CONFLICT" && error.status === 409
  );
  assert.equal((await store.get(task.id)).revision, 3);
});

test("TaskStore runs a final async guard inside the mutation lock before writing", async () => {
  const store = await makeStore();
  const task = await store.create({ goal: "guard commit", rootPath: "C:/repo-a" });
  const order = [];
  await assert.rejects(
    () => store.update(task.id, async () => {
      order.push("mutation");
      await Promise.resolve();
      return { status: "running" };
    }, {
      expectedRevision: task.revision,
      beforeCommit: async ({ currentTask, nextPatch }) => {
        order.push("guard");
        assert.equal(currentTask.revision, task.revision);
        assert.equal(nextPatch.status, "running");
        throw Object.assign(new Error("changed before commit"), { code: "FINAL_GUARD_CHANGED" });
      }
    }),
    { code: "FINAL_GUARD_CHANGED" }
  );
  assert.deepEqual(order, ["mutation", "guard"]);
  assert.equal((await store.get(task.id)).revision, task.revision);
  assert.equal((await store.get(task.id)).status, task.status);
});

test("TaskStore CAS allows only one concurrent writer across instances", async () => {
  const root = await makeTemporaryRoot("codeclaw-task-cas-");
  const storagePath = path.join(root, "tasks.json");
  const first = new TaskStore({ storagePath });
  const second = new TaskStore({ storagePath });
  const task = await first.create({ goal: "one winner", rootPath: "C:/repo-a" });

  const results = await Promise.allSettled([
    first.update(task.id, { status: "running" }, { expectedRevision: task.revision }),
    second.update(task.id, { status: "blocked" }, { expectedRevision: task.revision })
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "TASK_REVISION_CONFLICT");
  assert.equal((await first.get(task.id)).revision, 2);
});

test("TaskStore startup migration removes legacy model and context bodies atomically", async () => {
  const root = await makeTemporaryRoot("codeclaw-task-migration-");
  const storagePath = path.join(root, "tasks.json");
  const time = "2026-07-13T00:00:00.000Z";
  const legacy = [{
    id: "task-legacy",
    goal: "migrate private state",
    rootPath: null,
    rootIdentity: null,
    workspaceId: null,
    status: "patch_ready",
    plan: null,
    toolCalls: [],
    contextFiles: [{
      path: "src/private.js",
      summary: "LEGACY_CONTEXT_SUMMARY_SECRET",
      content: "LEGACY_CONTEXT_BODY_SECRET",
      contentComplete: true,
      source: "preflight",
      time
    }, {
      path: "src/summary-only.js",
      summary: "LEGACY_SUMMARY_ONLY_SOURCE_SECRET",
      size: 33,
      sha256: digest("legacy-summary-only"),
      contentComplete: true,
      source: "legacy",
      time
    }],
    suggestions: [{
      kind: "failure-fix",
      provider: "mock",
      model: "mock-codeclaw",
      content: "LEGACY_SUGGESTION_BODY_SECRET",
      prompt: "LEGACY_SUGGESTION_PROMPT_SECRET",
      time
    }],
    modelEvents: [{
      operation: "suggestion",
      provider: "mock",
      model: "mock-codeclaw",
      requestSha256: digest("legacy-request"),
      responseSha256: digest("legacy-response"),
      status: "completed",
      content: "LEGACY_EVENT_BODY_SECRET",
      error: "LEGACY_EVENT_ERROR_SECRET",
      time
    }],
    verification: null,
    verificationHistory: [],
    failureSummary: "",
    patchProposal: {
      applicable: false,
      provider: "mock",
      model: "mock-codeclaw",
      path: null,
      files: [],
      reason: "invalid_response",
      summary: "No applicable patch.",
      content: "LEGACY_INVALID_PATCH_CONTENT_SECRET",
      diff: "LEGACY_INVALID_PATCH_DIFF_SECRET",
      note: "LEGACY_INVALID_PATCH_NOTE_SECRET",
      raw: "LEGACY_INVALID_PATCH_RAW_SECRET",
      prompt: "LEGACY_INVALID_PATCH_PROMPT_SECRET",
      proposalId: "proposal-legacy",
      time
    },
    appliedPatches: [],
    summary: "",
    reviewDraft: "",
    createdAt: time,
    updatedAt: time
  }];
  await fs.writeFile(storagePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const store = new TaskStore({ storagePath });

  const compatible = await store.get("task-legacy");
  assert.equal(compatible.revision, 0);
  assert.equal(Object.hasOwn(compatible, "suggestions"), false);
  assert.equal(Object.hasOwn(compatible.contextFiles[0], "content"), false);
  assert.equal(compatible.contextFiles[0].summary, "");
  assert.equal(Object.hasOwn(compatible.patchProposal, "note"), false);

  const result = await store.initialize();
  assert.deepEqual(result, { migrated: 1, taskCount: 1 });
  const migrated = JSON.parse(await fs.readFile(storagePath, "utf8"))[0];
  assert.equal(migrated.revision, 1);
  assert.equal(Object.hasOwn(migrated, "suggestions"), false);
  assert.equal(migrated.modelEvents.length, 2);
  assert.equal(migrated.contextFiles[0].sha256, digest("LEGACY_CONTEXT_BODY_SECRET"));
  assert.equal(migrated.contextFiles[0].summary, "");
  assert.equal(migrated.contextFiles[0].source, "preflight");
  assert.equal(migrated.contextFiles[1].summary, "");
  assert.equal(migrated.contextFiles[1].source, "");
  assert.deepEqual(Object.keys(migrated.contextFiles[0]).sort(), [
    "contentComplete",
    "path",
    "sha256",
    "size",
    "source",
    "summary",
    "time"
  ]);
  for (const forbidden of ["content", "diff", "note", "raw", "prompt"]) {
    assert.equal(Object.hasOwn(migrated.patchProposal, forbidden), false);
  }
  const raw = await fs.readFile(storagePath, "utf8");
  assert.doesNotMatch(raw, /LEGACY_(?:CONTEXT|SUMMARY_ONLY|SUGGESTION|EVENT|INVALID_PATCH)_[A-Z_]*SECRET/);

  const beforeSecondMigration = raw;
  assert.deepEqual(await store.initialize(), { migrated: 0, taskCount: 1 });
  assert.equal(await fs.readFile(storagePath, "utf8"), beforeSecondMigration);
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
    modelEvents: [{ operation: "patch-proposal", status: "ok" }],
    contextFiles: [],
    appliedPatches: [{ path: "test/example.test.js", revertedAt: null }],
    verification: { exitCode: 0, timedOut: false }
  }, "Added test coverage.");

  assert.match(draft, /Title: add coverage/);
  assert.match(draft, /- test\/example\.test\.js/);
  assert.match(draft, /Exit code 0/);
  assert.match(draft, /1 minimized event/);
  assert.match(draft, /Verification passed/);
});

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}
