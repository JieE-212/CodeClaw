import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PatchTransactionStore, recoverPatchTransactions } from "../packages/patch-transaction/src/index.js";
import { capturePathIdentity, patchWriteTemporaryPath } from "../packages/shared/src/atomic-file.js";
import {
  captureWorkspaceIdentity,
  captureWorkspaceParentIdentity
} from "../packages/shared/src/workspace-identity.js";
import { TaskStore } from "../packages/task-store/src/index.js";
import { ToolRegistry, hashContent } from "../packages/tool-registry/src/index.js";

async function makeFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-transaction-"));
  const root = path.join(base, "project");
  const state = path.join(base, "state");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "a.txt"), "a-before\n", "utf8");
  await fs.writeFile(path.join(root, "src", "b.txt"), "b-before\n", "utf8");
  const taskStore = new TaskStore({ storagePath: path.join(state, "tasks.json") });
  const transactionStore = new PatchTransactionStore({ storagePath: path.join(state, "patch-transactions") });
  const task = await taskStore.create({ goal: "transaction test", rootPath: root });
  const registryFactory = (selectedRoot) => new ToolRegistry({ rootPath: selectedRoot });
  const registry = registryFactory(root);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root, state, store: transactionStore, taskStore, transactionStore, task, registry, registryFactory };
}

function applyItems() {
  return [
    { path: "src/a.txt", beforeExists: true, beforeContent: "a-before\n", afterExists: true, afterContent: "a-after\n" },
    { path: "src/b.txt", beforeExists: true, beforeContent: "b-before\n", afterExists: true, afterContent: "b-after\n" }
  ];
}

async function beginApply(fixture) {
  return beginTransaction(fixture, {
    operation: "apply",
    taskId: fixture.task.id,
    items: applyItems()
  });
}

async function beginTransaction(fixture, input) {
  const identity = await bindTransactionItems(fixture.root, input.items);
  return fixture.transactionStore.begin({
    ...input,
    rootPath: fixture.root,
    ...identity
  });
}

async function bindTransactionItems(rootPath, items) {
  const rootIdentity = (await captureWorkspaceIdentity(rootPath)).digest;
  const boundItems = await Promise.all(items.map(async (item) => ({
    ...item,
    parentIdentity: (await captureWorkspaceParentIdentity(rootPath, item.path)).digest
  })));
  return { rootIdentity, items: boundItems };
}

async function write(fixture, transaction, filePath, content, beforeContent) {
  const item = transaction.items.find((entry) => entry.path === filePath);
  assert.ok(item, `Missing transaction item for ${filePath}.`);
  return fixture.registry.call("write_patch", {
    path: filePath,
    content,
    transactionId: transaction.id,
    rootIdentity: transaction.rootIdentity,
    parentIdentity: item.parentIdentity,
    onTemporaryReady: (identity) => fixture.transactionStore.recordTemporaryIdentity(transaction.id, filePath, identity),
    expectedBaseline: { exists: true, sha256: hashContent(beforeContent) }
  }, { approved: true });
}

async function read(root, filePath) {
  return fs.readFile(path.join(root, filePath), "utf8");
}

test("patch recovery restores a two-file apply interrupted after its first write", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await write(fixture, transaction, "src/a.txt", "a-after\n", "a-before\n");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, true);
  assert.equal(recovery.recovered, 1);
  assert.equal(await read(fixture.root, "src/a.txt"), "a-before\n");
  assert.equal(await read(fixture.root, "src/b.txt"), "b-before\n");
  assert.deepEqual(await fixture.transactionStore.listPending(), []);
});

test("patch recovery removes a transaction-owned temporary write left by a crash", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  const temporaryPath = patchWriteTemporaryPath(path.join(fixture.root, "src", "a.txt"), transaction.id);
  await fs.writeFile(temporaryPath, "a-after\n", "utf8");
  const temporaryIdentity = await capturePathIdentity(temporaryPath, { requireFile: true });
  await fixture.transactionStore.recordTemporaryIdentity(transaction.id, "src/a.txt", {
    dev: String(temporaryIdentity.dev),
    ino: String(temporaryIdentity.ino),
    birthtimeNs: String(temporaryIdentity.birthtimeNs),
    nlink: Number(temporaryIdentity.nlink)
  });

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.recovered, 1);
  await assert.rejects(fs.access(temporaryPath), { code: "ENOENT" });
  assert.equal(await read(fixture.root, "src/a.txt"), "a-before\n");
});

test("patch recovery refuses to clean a temporary file through a replaced junction", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  const outside = path.join(fixture.base, "outside");
  await fs.mkdir(outside, { recursive: true });
  await fs.rm(path.join(fixture.root, "src"), { recursive: true, force: true });
  try {
    await fs.symlink(outside, path.join(fixture.root, "src"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EACCES", "ENOSYS", "EPERM"].includes(error.code)) {
      t.skip(`This environment cannot create a test junction (${error.code}).`);
      return;
    }
    throw error;
  }
  const temporaryPath = patchWriteTemporaryPath(path.join(fixture.root, "src", "a.txt"), transaction.id);
  await fs.writeFile(temporaryPath, "outside-sentinel\n", "utf8");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_PARENT_CHANGED");
  assert.equal(await fs.readFile(path.join(outside, path.basename(temporaryPath)), "utf8"), "outside-sentinel\n");
});

test("patch recovery restores writes made before any task state was committed", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await write(fixture, transaction, "src/a.txt", "a-after\n", "a-before\n");
  await write(fixture, transaction, "src/b.txt", "b-after\n", "b-before\n");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.recovered, 1);
  assert.equal(await read(fixture.root, "src/a.txt"), "a-before\n");
  assert.equal(await read(fixture.root, "src/b.txt"), "b-before\n");
});

test("patch recovery holds without overwriting any file when a human edit conflicts", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await write(fixture, transaction, "src/a.txt", "a-after\n", "a-before\n");
  await fs.writeFile(path.join(fixture.root, "src", "b.txt"), "human-edit\n", "utf8");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.blocked, 1);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_RECOVERY_CONFLICT");
  assert.equal(await read(fixture.root, "src/a.txt"), "a-after\n");
  assert.equal(await read(fixture.root, "src/b.txt"), "human-edit\n");
  assert.equal((await fixture.transactionStore.listPending()).length, 1);
  assert.equal(JSON.stringify(recovery).includes(fixture.root), false);
  assert.equal(JSON.stringify(recovery).includes("src/a.txt"), false);
});

test("patch recovery only cleans a journal after an apply task record committed", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await write(fixture, transaction, "src/a.txt", "a-after\n", "a-before\n");
  await write(fixture, transaction, "src/b.txt", "b-after\n", "b-before\n");
  await fixture.taskStore.recordAppliedPatches(fixture.task.id, applyItems().map((item) => ({
    transactionId: transaction.id,
    batchId: transaction.id,
    path: item.path,
    previousExists: item.beforeExists,
    previousContent: item.beforeContent,
    nextContent: item.afterContent
  })));

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.committedCleanup, 1);
  assert.equal(await read(fixture.root, "src/a.txt"), "a-after\n");
  assert.equal(await read(fixture.root, "src/b.txt"), "b-after\n");
  assert.deepEqual(await fixture.transactionStore.listPending(), []);
});

test("patch recovery only cleans a journal after a revert task record committed", async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.root, "src", "a.txt"), "a-after\n", "utf8");
  const applied = await fixture.taskStore.recordAppliedPatch(fixture.task.id, {
    transactionId: "apply-recorded-12345678",
    path: "src/a.txt",
    previousExists: true,
    previousContent: "a-before\n",
    nextContent: "a-after\n"
  });
  const transaction = await beginTransaction(fixture, {
    operation: "revert",
    taskId: fixture.task.id,
    patchIndex: 0,
    items: [{ path: "src/a.txt", beforeExists: true, beforeContent: "a-after\n", afterExists: true, afterContent: "a-before\n" }]
  });
  await write(fixture, transaction, "src/a.txt", "a-before\n", "a-after\n");
  await fixture.taskStore.markPatchReverted(applied.id, 0, { revertTransactionId: transaction.id });

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.committedCleanup, 1);
  assert.equal(await read(fixture.root, "src/a.txt"), "a-before\n");
  assert.deepEqual(await fixture.transactionStore.listPending(), []);
});

test("patch recovery restores applied content when an existing-file Revert crashes before task commit", async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.root, "src", "a.txt"), "a-after\n", "utf8");
  await fixture.taskStore.recordAppliedPatch(fixture.task.id, {
    transactionId: "apply-existing-12345678",
    path: "src/a.txt",
    previousExists: true,
    previousContent: "a-before\n",
    nextContent: "a-after\n"
  });
  const transaction = await beginTransaction(fixture, {
    operation: "revert",
    taskId: fixture.task.id,
    patchIndex: 0,
    items: [{ path: "src/a.txt", beforeExists: true, beforeContent: "a-after\n", afterExists: true, afterContent: "a-before\n" }]
  });
  await write(fixture, transaction, "src/a.txt", "a-before\n", "a-after\n");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.recovered, 1);
  assert.equal(await read(fixture.root, "src/a.txt"), "a-after\n");
  assert.equal((await fixture.taskStore.get(fixture.task.id)).appliedPatches[0].revertedAt, null);
});

test("patch recovery recreates a new file when its Revert deletion crashes before task commit", async (t) => {
  const fixture = await makeFixture(t);
  await fs.writeFile(path.join(fixture.root, "generated.txt"), "generated\n", "utf8");
  await fixture.taskStore.recordAppliedPatch(fixture.task.id, {
    transactionId: "apply-created-12345678",
    path: "generated.txt",
    previousExists: false,
    previousContent: "",
    nextContent: "generated\n"
  });
  const transaction = await beginTransaction(fixture, {
    operation: "revert",
    taskId: fixture.task.id,
    patchIndex: 0,
    items: [{ path: "generated.txt", beforeExists: true, beforeContent: "generated\n", afterExists: false, afterContent: "" }]
  });
  const journalItem = transaction.items[0];
  await fixture.registry.call("write_patch", {
    path: "generated.txt",
    remove: true,
    transactionId: transaction.id,
    rootIdentity: transaction.rootIdentity,
    parentIdentity: journalItem.parentIdentity,
    onTemporaryReady: (identity) => fixture.transactionStore.recordTemporaryIdentity(transaction.id, "generated.txt", identity),
    expectedBaseline: { exists: true, sha256: hashContent("generated\n") }
  }, { approved: true });

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.recovered, 1);
  assert.equal(await read(fixture.root, "generated.txt"), "generated\n");
  assert.equal((await fixture.taskStore.get(fixture.task.id)).appliedPatches[0].revertedAt, null);
});

test("patch recovery blocks a task commit whose workspace never reached after state", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await fixture.taskStore.recordAppliedPatches(fixture.task.id, applyItems().map((item) => ({
    transactionId: transaction.id,
    batchId: transaction.id,
    path: item.path,
    previousExists: item.beforeExists,
    previousContent: item.beforeContent,
    nextContent: item.afterContent
  })));

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_COMMITTED_DRIFT");
  assert.equal(await read(fixture.root, "src/a.txt"), "a-before\n");
  assert.equal((await fixture.transactionStore.listPending()).length, 1);
});

test("patch recovery validates every needed backup before changing any file", async (t) => {
  const fixture = await makeFixture(t);
  const transaction = await beginApply(fixture);
  await write(fixture, transaction, "src/a.txt", "a-after\n", "a-before\n");
  await write(fixture, transaction, "src/b.txt", "b-after\n", "b-before\n");
  await fs.writeFile(path.join(fixture.state, "patch-transactions", transaction.id, "0001.before"), "corrupt\n", "utf8");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_BACKUP_INVALID");
  assert.equal(await read(fixture.root, "src/a.txt"), "a-after\n");
  assert.equal(await read(fixture.root, "src/b.txt"), "b-after\n");
  assert.equal((await fixture.transactionStore.listPending()).length, 1);
});

test("patch recovery retains its journal and never touches a replacement workspace root", async (t) => {
  const fixture = await makeFixture(t);
  await beginApply(fixture);
  const originalRoot = path.join(fixture.base, "project-original");
  await fs.rename(fixture.root, originalRoot);
  await fs.mkdir(path.join(fixture.root, "src"), { recursive: true });
  await fs.writeFile(path.join(fixture.root, "src", "a.txt"), "replacement-a\n", "utf8");
  await fs.writeFile(path.join(fixture.root, "src", "b.txt"), "replacement-b\n", "utf8");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_ROOT_CHANGED");
  assert.equal(await fs.readFile(path.join(fixture.root, "src", "a.txt"), "utf8"), "replacement-a\n");
  assert.equal(await fs.readFile(path.join(originalRoot, "src", "a.txt"), "utf8"), "a-before\n");
  assert.equal((await fixture.transactionStore.listPending()).length, 1);
});

test("patch recovery retains its journal and never touches a replacement parent directory", async (t) => {
  const fixture = await makeFixture(t);
  await beginApply(fixture);
  const originalParent = path.join(fixture.root, "src-original");
  await fs.rename(path.join(fixture.root, "src"), originalParent);
  await fs.mkdir(path.join(fixture.root, "src"), { recursive: true });
  await fs.writeFile(path.join(fixture.root, "src", "a.txt"), "replacement-a\n", "utf8");
  await fs.writeFile(path.join(fixture.root, "src", "b.txt"), "replacement-b\n", "utf8");

  const recovery = await recoverPatchTransactions(fixture);

  assert.equal(recovery.ok, false);
  assert.equal(recovery.transactions[0].code, "PATCH_TRANSACTION_PARENT_CHANGED");
  assert.equal(await fs.readFile(path.join(fixture.root, "src", "a.txt"), "utf8"), "replacement-a\n");
  assert.equal(await fs.readFile(path.join(originalParent, "a.txt"), "utf8"), "a-before\n");
  assert.equal((await fixture.transactionStore.listPending()).length, 1);
});

test("patch transactions reject portable Windows path collisions", async (t) => {
  const fixture = await makeFixture(t);
  if (process.platform !== "win32") t.skip("Windows path collision semantics only apply on Windows.");
  await assert.rejects(
    () => beginTransaction(fixture, {
      operation: "apply",
      taskId: fixture.task.id,
      items: [
        { path: "src/A.txt", beforeExists: false, afterExists: true, afterContent: "a" },
        { path: "src/a.txt", beforeExists: false, afterExists: true, afterContent: "b" }
      ]
    }),
    /Duplicate patch transaction path/
  );
});
