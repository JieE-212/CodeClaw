import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PatchTransactionStore } from "../packages/patch-transaction/src/index.js";
import { PatchTransactionClaimStore, loadPatchStateOwnerId } from "../packages/patch-transaction/src/claim-store.js";
import {
  captureWorkspaceIdentity,
  captureWorkspaceParentIdentity
} from "../packages/shared/src/workspace-identity.js";
import { TaskStore } from "../packages/task-store/src/index.js";
import { ToolRegistry, hashContent } from "../packages/tool-registry/src/index.js";

test("server startup recovers journals, preserves committed work, and fail-closes conflicts", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-startup-recovery-"));
  const stateDir = path.join(base, "state");
  const coordinationDir = path.join(base, "coordination");
  const rollbackRoot = path.join(base, "rollback-project");
  const committedRoot = path.join(base, "committed-project");
  const conflictRoot = path.join(base, "conflict-project");
  for (const root of [rollbackRoot, committedRoot, conflictRoot]) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "file.txt"), "before\n", "utf8");
  }

  const taskStore = new TaskStore({ storagePath: path.join(stateDir, "tasks.json") });
  const transactionStore = new PatchTransactionStore({ storagePath: path.join(stateDir, "patch-transactions") });
  const claimStore = new PatchTransactionClaimStore({
    storagePath: path.join(coordinationDir, "claims"),
    ownerId: await loadPatchStateOwnerId(stateDir)
  });

  const rollbackTask = await taskStore.create({ goal: "rollback after crash", rootPath: rollbackRoot });
  const rollbackTransaction = await beginApply(transactionStore, claimStore, rollbackTask.id, rollbackRoot);
  await applyAfter(rollbackRoot, rollbackTransaction, transactionStore);

  const committedTask = await taskStore.create({ goal: "keep committed apply", rootPath: committedRoot });
  const committedTransaction = await beginApply(transactionStore, claimStore, committedTask.id, committedRoot);
  await applyAfter(committedRoot, committedTransaction, transactionStore);
  await taskStore.recordAppliedPatch(committedTask.id, {
    transactionId: committedTransaction.id,
    batchId: committedTransaction.id,
    path: "file.txt",
    previousExists: true,
    previousContent: "before\n",
    nextContent: "after\n"
  });

  const conflictTask = await taskStore.create({ goal: "hold human edit", rootPath: conflictRoot });
  await taskStore.appendContextFile(conflictTask.id, { path: "file.txt", content: "before\n", contentComplete: true });
  const conflictProposal = await taskStore.setPatchProposal(conflictTask.id, { applicable: true, path: "file.txt", content: "after\n", summary: "change" });
  await beginApply(transactionStore, claimStore, conflictTask.id, conflictRoot);
  await fs.writeFile(path.join(conflictRoot, "file.txt"), "human-edit\n", "utf8");

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: coordinationDir
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  t.after(async () => {
    server.kill();
    await waitForExit(server);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
  });

  await waitForHealth(baseUrl, server, () => output);

  assert.equal(await fs.readFile(path.join(rollbackRoot, "file.txt"), "utf8"), "before\n");
  assert.equal(await fs.readFile(path.join(committedRoot, "file.txt"), "utf8"), "after\n");
  assert.equal(await fs.readFile(path.join(conflictRoot, "file.txt"), "utf8"), "human-edit\n");

  const status = await request(baseUrl, "/api/patch-recovery/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.recovery.recovered, 1);
  assert.equal(status.payload.recovery.committedCleanup, 1);
  assert.equal(status.payload.recovery.blocked, 1);
  const publicStatus = JSON.stringify(status.payload);
  assert.equal(publicStatus.includes(base), false);
  assert.equal(publicStatus.includes("file.txt"), false);
  assert.equal(publicStatus.includes("human-edit"), false);

  const directWrite = await request(baseUrl, "/api/tools/call", {
    tool: "write_patch",
    rootPath: rollbackRoot,
    args: { path: "file.txt", content: "bypass\n" },
    approved: true
  });
  assert.equal(directWrite.response.status, 409);
  assert.equal(directWrite.payload.code, "PATCH_TRANSACTION_REQUIRED");
  assert.equal(await fs.readFile(path.join(rollbackRoot, "file.txt"), "utf8"), "before\n");

  await taskStore.appendContextFile(rollbackTask.id, { path: "file.txt", content: "before\n", contentComplete: true });
  const healthyProposal = await taskStore.setPatchProposal(rollbackTask.id, { applicable: true, path: "file.txt", content: "healthy-after\n", summary: "healthy root" });
  const healthyApply = await request(baseUrl, "/api/tasks/apply-patch", {
    taskId: rollbackTask.id,
    proposalId: healthyProposal.patchProposal.proposalId,
    proposalDigest: healthyProposal.patchProposal.proposalDigest,
    approved: true
  });
  assert.equal(healthyApply.response.status, 200);
  const statusAfterHealthyRoot = await request(baseUrl, "/api/patch-recovery/status");
  assert.equal(statusAfterHealthyRoot.payload.recovery.ok, false);
  assert.equal(statusAfterHealthyRoot.payload.recovery.pending, 1);

  const blockedApply = await request(baseUrl, "/api/tasks/apply-patch", { taskId: conflictTask.id, proposalId: conflictProposal.patchProposal.proposalId, proposalDigest: conflictProposal.patchProposal.proposalDigest, approved: true });
  assert.equal(blockedApply.response.status, 409);
  assert.equal(blockedApply.payload.code, "PATCH_RECOVERY_REQUIRED");
  assert.equal(await fs.readFile(path.join(conflictRoot, "file.txt"), "utf8"), "human-edit\n");
});

async function beginApply(store, claimStore, taskId, rootPath) {
  const item = { path: "file.txt", beforeExists: true, beforeContent: "before\n", afterExists: true, afterContent: "after\n" };
  const transactionId = `apply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const rootIdentity = (await captureWorkspaceIdentity(rootPath)).digest;
  const parentIdentity = (await captureWorkspaceParentIdentity(rootPath, item.path)).digest;
  await claimStore.begin({ rootPath, rootIdentity, transactionId, operation: "apply" });
  const transaction = await store.begin({
    id: transactionId,
    operation: "apply",
    taskId,
    rootPath,
    rootIdentity,
    items: [{ ...item, parentIdentity }]
  });
  await claimStore.markJournaled({ rootPath, rootIdentity, transactionId });
  return transaction;
}

async function applyAfter(rootPath, transaction, transactionStore) {
  const registry = new ToolRegistry({ rootPath });
  const item = transaction.items[0];
  await registry.call("write_patch", {
    path: "file.txt",
    content: "after\n",
    transactionId: transaction.id,
    rootIdentity: transaction.rootIdentity,
    parentIdentity: item.parentIdentity,
    onTemporaryReady: (identity) => transactionStore.recordTemporaryIdentity(transaction.id, item.path, identity),
    expectedBaseline: { exists: true, sha256: hashContent("before\n") }
  }, { approved: true });
}

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth(baseUrl, server, serverOutput) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early.\n${serverOutput()}`);
    try {
      const result = await request(baseUrl, "/api/health");
      if (result.response.ok && result.payload.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${serverOutput()}`);
}

async function waitForExit(server) {
  if (server.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}
