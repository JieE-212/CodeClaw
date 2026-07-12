import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { TaskStore } from "../packages/task-store/src/index.js";
import { hashContent } from "../packages/tool-registry/src/index.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../packages/shared/src/cross-process-lock.js";
import { activateRegisteredWorkspace, createActivatedWorkspace } from "./helpers/activated-workspace.js";

test("patch APIs bind Apply and Revert to the reviewed workspace directories", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-workspace-identity-"));
  const stateDir = path.join(base, "state");
  const coordinationDir = path.join(base, "coordination");
  const copyRoot = path.join(base, "copies");
  const rootSource = path.join(base, "root-source");
  const parentSource = path.join(base, "parent-source");
  const revertSource = path.join(base, "revert-source");
  await fs.mkdir(rootSource);
  await fs.mkdir(path.join(parentSource, "sub"), { recursive: true });
  await fs.writeFile(path.join(parentSource, "sub", "file.txt"), "before\n", "utf8");
  await fs.mkdir(path.join(revertSource, "sub"), { recursive: true });
  await fs.writeFile(path.join(revertSource, "sub", "file.txt"), "revert-before\n", "utf8");

  const rootCopy = await createActivatedWorkspace({ sourcePath: rootSource, stateDir, copyRoot });
  const capabilityStore = rootCopy.store;
  const parentCopy = await createActivatedWorkspace({ sourcePath: parentSource, store: capabilityStore });
  const revertCopy = await createActivatedWorkspace({ sourcePath: revertSource, store: capabilityStore });
  await activateRegisteredWorkspace(capabilityStore, rootCopy.workspace.id);

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const store = new TaskStore({ storagePath: path.join(stateDir, "tasks.json") });
  const server = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: coordinationDir,
      CODECLAW_DISPOSABLE_ROOT: copyRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

  try {
    await waitForHealth({ baseUrl, server, serverOutput: () => serverOutput });

    const reviewedRoot = rootCopy.rootPath;
    const movedReviewedRoot = `${reviewedRoot}-original`;
    const rootTask = await store.create({ goal: "create a reviewed root-level file", rootPath: reviewedRoot, workspaceId: rootCopy.workspace.id });
    const rootProposal = await store.setPatchProposal(rootTask.id, {
      applicable: true,
      path: "new.txt",
      content: "reviewed-content\n",
      expectedBaseline: { exists: false, sha256: null },
      summary: "Create new.txt."
    });
    const lockManager = new CrossProcessLockManager({
      storagePath: coordinationDir,
      namespace: "project-write",
      lockedCode: "PROJECT_WRITE_LOCKED"
    });
    const heldRootLock = await lockManager.acquire(await canonicalPathLockKey(reviewedRoot));
    let replacedRootApplyPromise;
    try {
      replacedRootApplyPromise = applyProposal(baseUrl, rootTask.id, rootProposal.patchProposal);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await fs.rename(reviewedRoot, movedReviewedRoot);
      await fs.mkdir(reviewedRoot);
    } finally {
      await lockManager.release(heldRootLock);
    }
    const replacedRootApply = await replacedRootApplyPromise;
    assert.equal(replacedRootApply.response.status, 409);
    assert.equal(replacedRootApply.payload.code, "PATCH_WORKSPACE_CHANGED");
    await assertMissing(path.join(movedReviewedRoot, "new.txt"));
    await assertMissing(path.join(reviewedRoot, "new.txt"));

    await activateRegisteredWorkspace(capabilityStore, parentCopy.workspace.id);
    const parentRoot = parentCopy.rootPath;
    const reviewedParent = path.join(parentRoot, "sub");
    const movedReviewedParent = path.join(parentRoot, "sub-original");
    const parentTask = await store.create({ goal: "update a file under a reviewed parent", rootPath: parentRoot, workspaceId: parentCopy.workspace.id });
    const parentProposal = await store.setPatchProposal(parentTask.id, {
      applicable: true,
      path: "sub/file.txt",
      content: "after\n",
      expectedBaseline: { exists: true, sha256: hashContent("before\n") },
      summary: "Update sub/file.txt."
    });

    await fs.rename(reviewedParent, movedReviewedParent);
    await fs.mkdir(reviewedParent);
    await fs.writeFile(path.join(reviewedParent, "file.txt"), "before\n", "utf8");
    const replacedParentApply = await applyProposal(baseUrl, parentTask.id, parentProposal.patchProposal);
    assert.equal(replacedParentApply.response.status, 409);
    assert.equal(replacedParentApply.payload.code, "PATCH_PARENT_CHANGED");
    assert.equal(await fs.readFile(path.join(movedReviewedParent, "file.txt"), "utf8"), "before\n");
    assert.equal(await fs.readFile(path.join(reviewedParent, "file.txt"), "utf8"), "before\n");

    await activateRegisteredWorkspace(capabilityStore, revertCopy.workspace.id);
    const revertRoot = revertCopy.rootPath;
    const revertParent = path.join(revertRoot, "sub");
    const movedRevertParent = path.join(revertRoot, "sub-applied-original");
    const revertTask = await store.create({ goal: "apply then protect a parent-bound revert", rootPath: revertRoot, workspaceId: revertCopy.workspace.id });
    const revertProposal = await store.setPatchProposal(revertTask.id, {
      applicable: true,
      path: "sub/file.txt",
      content: "revert-after\n",
      expectedBaseline: { exists: true, sha256: hashContent("revert-before\n") },
      summary: "Update the revert fixture."
    });
    const applied = await applyProposal(baseUrl, revertTask.id, revertProposal.patchProposal);
    assert.equal(applied.response.status, 200, applied.payload.error || serverOutput);
    const appliedPatch = applied.payload.task.appliedPatches[0];
    assert.equal(await fs.readFile(path.join(revertParent, "file.txt"), "utf8"), "revert-after\n");

    await fs.rename(revertParent, movedRevertParent);
    await fs.mkdir(revertParent);
    await fs.writeFile(path.join(revertParent, "file.txt"), "revert-after\n", "utf8");
    const replacedParentRevert = await request(baseUrl, "/api/tasks/revert-patch", {
      taskId: revertTask.id,
      patchIndex: 0,
      patchIdentity: appliedPatch.patchIdentity,
      workspaceIdentity: applied.payload.task.rootIdentity,
      approved: true
    });
    assert.equal(replacedParentRevert.response.status, 409);
    assert.equal(replacedParentRevert.payload.code, "PATCH_PARENT_CHANGED");
    assert.equal(await fs.readFile(path.join(movedRevertParent, "file.txt"), "utf8"), "revert-after\n");
    assert.equal(await fs.readFile(path.join(revertParent, "file.txt"), "utf8"), "revert-after\n");
    assert.equal((await store.get(revertTask.id)).appliedPatches[0].revertedAt, null);
  } finally {
    server.kill();
    await waitForExit(server);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

async function applyProposal(baseUrl, taskId, proposal) {
  return request(baseUrl, "/api/tasks/apply-patch", {
    taskId,
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    approved: true
  });
}

async function assertMissing(filePath) {
  await assert.rejects(fs.access(filePath), { code: "ENOENT" });
}

async function request(baseUrl, url, body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth({ baseUrl, server, serverOutput }) {
  for (let index = 0; index < 50; index += 1) {
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
