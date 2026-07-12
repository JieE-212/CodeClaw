import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

test("a foreign state cannot take over a journaled patch and the owning state recovers it", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-claim-integration-"));
  const rootPath = path.join(base, "project");
  const stateA = path.join(base, "state-a");
  const stateB = path.join(base, "state-b");
  const lockDir = path.join(base, "project-locks");
  const filePath = path.join(rootPath, "file.txt");
  let serverA = null;
  let serverB = null;

  try {
    await fs.mkdir(rootPath, { recursive: true });
    await fs.writeFile(filePath, "before\n", "utf8");

    const taskStoreA = new TaskStore({ storagePath: path.join(stateA, "tasks.json") });
    const transactionStoreA = new PatchTransactionStore({ storagePath: path.join(stateA, "patch-transactions") });
    const ownerA = await loadPatchStateOwnerId(stateA);
    const claimStoreA = new PatchTransactionClaimStore({
      storagePath: path.join(lockDir, "claims"),
      ownerId: ownerA
    });
    const taskA = await taskStoreA.create({ goal: "simulate a crashed apply", rootPath });
    const rootIdentity = (await captureWorkspaceIdentity(rootPath)).digest;
    const parentIdentity = (await captureWorkspaceParentIdentity(rootPath, "file.txt")).digest;
    const transactionId = `apply-${randomUUID()}`;

    const reservedClaim = await claimStoreA.begin({
      rootPath,
      rootIdentity,
      transactionId,
      operation: "apply"
    });
    assert.equal(reservedClaim.phase, "reserved");

    const transaction = await transactionStoreA.begin({
      id: transactionId,
      operation: "apply",
      taskId: taskA.id,
      rootPath,
      rootIdentity,
      items: [{
        path: "file.txt",
        parentIdentity,
        beforeExists: true,
        beforeContent: "before\n",
        afterExists: true,
        afterContent: "after-from-a\n"
      }]
    });
    const journaledClaim = await claimStoreA.markJournaled({ rootPath, rootIdentity, transactionId });
    assert.equal(journaledClaim.phase, "journaled");

    const registry = new ToolRegistry({ rootPath });
    await registry.call("write_patch", {
      path: "file.txt",
      content: "after-from-a\n",
      expectedBaseline: { exists: true, sha256: hashContent("before\n") },
      transactionId,
      rootIdentity,
      parentIdentity,
      onTemporaryReady: (identity) => transactionStoreA.recordTemporaryIdentity(transactionId, "file.txt", identity)
    }, { approved: true });
    assert.equal(await fs.readFile(filePath, "utf8"), "after-from-a\n");
    assert.equal((await taskStoreA.get(taskA.id)).appliedPatches.length, 0);

    const portB = await findFreePort();
    serverB = startServer({ port: portB, stateDir: stateB, lockDir });
    const baseUrlB = `http://127.0.0.1:${portB}`;
    await waitForHealth(baseUrlB, serverB);

    const ownerB = await loadPatchStateOwnerId(stateB);
    assert.notEqual(ownerB, ownerA);
    const taskStoreB = new TaskStore({ storagePath: path.join(stateB, "tasks.json") });
    const taskB = await taskStoreB.create({ goal: "attempt an apply from another state", rootPath });
    await taskStoreB.appendContextFile(taskB.id, {
      path: "file.txt",
      content: "after-from-a\n",
      contentComplete: true
    });
    const proposedTaskB = await taskStoreB.setPatchProposal(taskB.id, {
      applicable: true,
      path: "file.txt",
      content: "after-from-b\n",
      summary: "must remain blocked while state A owns recovery"
    });
    const blockedApply = await request(baseUrlB, "/api/tasks/apply-patch", {
      taskId: taskB.id,
      proposalId: proposedTaskB.patchProposal.proposalId,
      proposalDigest: proposedTaskB.patchProposal.proposalDigest,
      approved: true
    });
    assert.equal(blockedApply.response.status, 409);
    assert.equal(blockedApply.payload.code, "PATCH_RECOVERY_OWNED_ELSEWHERE");
    assert.equal(await fs.readFile(filePath, "utf8"), "after-from-a\n");
    assert.equal((await taskStoreB.get(taskB.id)).appliedPatches.length, 0);
    assert.equal((await transactionStoreA.listPending()).length, 1);
    assert.equal((await claimStoreA.read(rootPath)).record.phase, "journaled");

    await stopServer(serverB);
    serverB = null;

    let portA = await findFreePort();
    while (portA === portB) portA = await findFreePort();
    serverA = startServer({ port: portA, stateDir: stateA, lockDir });
    const baseUrlA = `http://127.0.0.1:${portA}`;
    await waitForHealth(baseUrlA, serverA);

    assert.equal(await fs.readFile(filePath, "utf8"), "before\n");
    const recoveryStatus = await request(baseUrlA, "/api/patch-recovery/status");
    assert.equal(recoveryStatus.response.status, 200);
    assert.equal(recoveryStatus.payload.recovery.ok, true);
    assert.equal(recoveryStatus.payload.recovery.recovered, 1);
    assert.equal(recoveryStatus.payload.recovery.blocked, 0);
    assert.deepEqual(await transactionStoreA.listPending(), []);
    assert.equal((await claimStoreA.read(rootPath)).exists, false);
  } finally {
    await Promise.all([stopServer(serverA), stopServer(serverB)]);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function startServer({ port, stateDir, lockDir }) {
  const child = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: lockDir
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  return { child, output: () => output };
}

async function stopServer(server) {
  if (!server || childExited(server.child)) return;
  server.child.kill();
  await waitForExit(server.child);
  if (!childExited(server.child)) {
    server.child.kill("SIGKILL");
    await waitForExit(server.child);
  }
}

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth(baseUrl, server) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (childExited(server.child)) throw new Error(`Server exited early.\n${server.output()}`);
    try {
      const result = await request(baseUrl, "/api/health");
      if (result.response.ok && result.payload.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${server.output()}`);
}

async function waitForExit(child) {
  if (childExited(child)) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
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
