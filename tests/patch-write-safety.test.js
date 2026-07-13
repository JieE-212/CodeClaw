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
import { createActivatedWorkspace } from "./helpers/activated-workspace.js";
import { previewAndApproveModelOperation } from "../scripts/model-operation-client.js";

test("patch APIs reject stale and ignored targets, while protecting post-apply edits", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-patch-safety-"));
  const source = path.join(base, "source");
  const stateDir = path.join(base, "state");
  const copyRoot = path.join(base, "copies");
  const calculatorOriginal = [
    "import test from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { divide } from \"../src/calculator.js\";",
    "test(\"divide\", () => assert.equal(divide(8, 2), 4));",
    ""
  ].join("\n");
  await fs.mkdir(path.join(source, "test"), { recursive: true });
  await fs.writeFile(path.join(source, ".gitignore"), "blocked.txt\n", "utf8");
  await fs.writeFile(path.join(source, "test", "calculator.test.js"), calculatorOriginal, "utf8");
  await fs.writeFile(path.join(source, "first.txt"), "first-old\n", "utf8");
  const activated = await createActivatedWorkspace({ sourcePath: source, stateDir, copyRoot });
  const workspace = activated.rootPath;
  // Ignored source payloads are intentionally absent from the disposable copy. This
  // local file proves that a later ignored target is rejected before any batch write.
  await fs.writeFile(path.join(workspace, "blocked.txt"), "blocked-old\n", "utf8");

  const port = await findFreePort();
  const projectLockDir = path.join(stateDir, "project-locks");
  const baseUrl = `http://127.0.0.1:${port}`;
  const store = new TaskStore({ storagePath: path.join(stateDir, "tasks.json") });
  const server = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: projectLockDir,
      CODECLAW_DISPOSABLE_ROOT: copyRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

  const calculatorPath = path.join(workspace, "test", "calculator.test.js");
  const firstPath = path.join(workspace, "first.txt");
  const ignoredPath = path.join(workspace, "blocked.txt");

  try {
    await waitForHealth({ baseUrl, server, serverOutput: () => serverOutput });

    const orderedTask = await store.create({ goal: "enforce Apply before Verify and Complete", rootPath: workspace, workspaceId: activated.workspace.id });
    const verifyBeforeApply = await request(baseUrl, "/api/tools/call", {
      tool: "run_command",
      args: { command: "npm test" },
      rootPath: workspace,
      taskId: orderedTask.id,
      approved: true
    });
    assert.equal(verifyBeforeApply.response.status, 409);
    assert.equal(verifyBeforeApply.payload.code, "TASK_VERIFY_PATCH_REQUIRED");
    const completeBeforeApply = await request(baseUrl, "/api/tasks/complete", { taskId: orderedTask.id });
    assert.equal(completeBeforeApply.response.status, 409);
    assert.equal(completeBeforeApply.payload.code, "TASK_COMPLETE_PATCH_REQUIRED");

    await store.recordAppliedPatch(orderedTask.id, { path: "first.txt", previousContent: "first-old\n", nextContent: "first-next\n" });
    await fs.writeFile(firstPath, "first-next\n", "utf8");
    await store.setVerification(orderedTask.id, { exitCode: 1, timedOut: false, stderr: "expected failure" });
    const completeAfterFailure = await request(baseUrl, "/api/tasks/complete", { taskId: orderedTask.id });
    assert.equal(completeAfterFailure.response.status, 409);
    assert.equal(completeAfterFailure.payload.code, "TASK_COMPLETE_VERIFICATION_REQUIRED");
    await store.setVerification(orderedTask.id, { exitCode: 0, timedOut: false });
    await fs.writeFile(firstPath, "manual-after-verify\n", "utf8");
    const completeAfterDrift = await request(baseUrl, "/api/tasks/complete", { taskId: orderedTask.id });
    assert.equal(completeAfterDrift.response.status, 409);
    assert.equal(completeAfterDrift.payload.code, "TASK_COMPLETE_PATCH_CHANGED");
    await fs.writeFile(firstPath, "first-next\n", "utf8");
    const completedInOrder = await request(baseUrl, "/api/tasks/complete", { taskId: orderedTask.id });
    assert.equal(completedInOrder.response.status, 200);
    assert.equal(completedInOrder.payload.task.status, "completed");
    const completedRead = await request(baseUrl, "/api/tools/call", { tool: "read_file", args: { path: "first.txt" }, rootPath: workspace, taskId: orderedTask.id });
    assert.equal(completedRead.response.status, 200);
    assert.equal(completedRead.payload.task.status, "completed");
    const verifyCompleted = await request(baseUrl, "/api/tools/call", { tool: "run_command", args: { command: "npm test" }, rootPath: workspace, taskId: orderedTask.id, approved: true });
    assert.equal(verifyCompleted.response.status, 409);
    assert.equal(verifyCompleted.payload.code, "TASK_ALREADY_COMPLETED");
    const applyCompleted = await request(baseUrl, "/api/tasks/apply-patch", { taskId: orderedTask.id, approved: true });
    assert.equal(applyCompleted.response.status, 409);
    assert.equal(applyCompleted.payload.code, "TASK_ALREADY_COMPLETED");
    const replanCompleted = await request(baseUrl, "/api/agent/plan", { taskId: orderedTask.id, goal: "change again" });
    assert.equal(replanCompleted.response.status, 409);
    assert.equal(replanCompleted.payload.code, "TASK_ALREADY_COMPLETED");
    await fs.writeFile(firstPath, "first-old\n", "utf8");

    const layeredTask = await store.create({ goal: "verify the top patch for a repeated path", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.recordAppliedPatch(layeredTask.id, { path: "first.txt", previousContent: "first-old\n", nextContent: "first-middle\n" });
    await fs.writeFile(firstPath, "first-middle\n", "utf8");
    await store.recordAppliedPatch(layeredTask.id, { path: "first.txt", previousContent: "first-middle\n", nextContent: "first-top\n" });
    await fs.writeFile(firstPath, "first-top\n", "utf8");
    await store.setVerification(layeredTask.id, { exitCode: 0, timedOut: false });
    const completedLayered = await request(baseUrl, "/api/tasks/complete", { taskId: layeredTask.id });
    assert.equal(completedLayered.response.status, 200);
    assert.equal(completedLayered.payload.task.status, "completed");
    await fs.writeFile(firstPath, "first-old\n", "utf8");

    const staleTask = await store.create({ goal: "add divide by zero test", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(staleTask.id, {
      path: "test/calculator.test.js",
      content: calculatorOriginal,
      contentComplete: true
    });
    const proposed = await previewAndApproveModelOperation(
      (pathname, body) => request(baseUrl, pathname, body),
      { operation: "patch-proposal", taskId: staleTask.id }
    );
    assert.equal(proposed.sendEnvelope.response.status, 200);
    assert.deepEqual(proposed.result.files[0].expectedBaseline, {
      exists: true,
      sha256: hashContent(calculatorOriginal)
    });

    const privateManualEdit = "PRIVATE-MANUAL-EDIT-MUST-NOT-LEAK\n";
    await fs.writeFile(calculatorPath, privateManualEdit, "utf8");
    const staleApply = await request(baseUrl, "/api/tasks/apply-patch", { taskId: staleTask.id, proposalId: proposed.result.proposalId, proposalDigest: proposed.result.proposalDigest, approved: true });
    assert.equal(staleApply.response.status, 409);
    assert.equal(staleApply.payload.code, "PATCH_BASELINE_CONFLICT");
    assert.doesNotMatch(staleApply.payload.error, /PRIVATE-MANUAL-EDIT/);
    assert.equal(await fs.readFile(calculatorPath, "utf8"), privateManualEdit);
    assert.equal((await store.get(staleTask.id)).appliedPatches.length, 0);

    const batchTask = await store.create({ goal: "reject an ignored target before starting a batch", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(batchTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    await store.appendContextFile(batchTask.id, { path: "blocked.txt", content: "blocked-old\n", contentComplete: true });
    const batchProposal = await store.setPatchProposal(batchTask.id, {
      applicable: true,
      summary: "Attempt a batch containing an ignored target.",
      files: [
        { path: "first.txt", content: "first-next\n" },
        { path: "blocked.txt", content: "blocked-next\n" }
      ]
    });
    const failedBatch = await request(baseUrl, "/api/tasks/apply-patch", { taskId: batchTask.id, proposalId: batchProposal.patchProposal.proposalId, proposalDigest: batchProposal.patchProposal.proposalDigest, approved: true });
    assert.equal(failedBatch.response.status, 409);
    assert.equal(failedBatch.payload.code, "READ_IGNORED_PATH_REFUSED");
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
    assert.equal(await fs.readFile(ignoredPath, "utf8"), "blocked-old\n");
    const batchAfterFailure = await store.get(batchTask.id);
    assert.equal(batchAfterFailure.status, "patch_ready");
    assert.equal(batchAfterFailure.appliedPatches.length, 0);

    const revertTask = await store.create({ goal: "protect later edits", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(revertTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    const revertProposal = await store.setPatchProposal(revertTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-applied\n",
      summary: "Update first.txt."
    });
    const applied = await request(baseUrl, "/api/tasks/apply-patch", { taskId: revertTask.id, proposalId: revertProposal.patchProposal.proposalId, proposalDigest: revertProposal.patchProposal.proposalDigest, approved: true });
    assert.equal(applied.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-applied\n");

    const laterManualEdit = "PRIVATE-LATER-EDIT-MUST-NOT-LEAK\n";
    await fs.writeFile(firstPath, laterManualEdit, "utf8");
    const conflictedRevert = await request(baseUrl, "/api/tasks/revert-patch", { taskId: revertTask.id, patchIndex: 0, patchIdentity: applied.payload.task.appliedPatches[0].patchIdentity, workspaceIdentity: applied.payload.task.rootIdentity, approved: true });
    assert.equal(conflictedRevert.response.status, 409);
    assert.equal(conflictedRevert.payload.code, "PATCH_REVERT_CONFLICT");
    assert.doesNotMatch(conflictedRevert.payload.error, /PRIVATE-LATER-EDIT/);
    assert.equal(await fs.readFile(firstPath, "utf8"), laterManualEdit);
    assert.equal((await store.get(revertTask.id)).appliedPatches[0].revertedAt, null);

    await fs.writeFile(firstPath, "first-applied\n", "utf8");
    const reverted = await request(baseUrl, "/api/tasks/revert-patch", { taskId: revertTask.id, patchIndex: 0, patchIdentity: applied.payload.task.appliedPatches[0].patchIdentity, workspaceIdentity: applied.payload.task.rootIdentity, approved: true });
    assert.equal(reverted.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
    assert.ok((await store.get(revertTask.id)).appliedPatches[0].revertedAt);

    const stackedTask = await store.create({ goal: "revert the newest change first", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(stackedTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    const firstStackedProposal = await store.setPatchProposal(stackedTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-middle\n",
      summary: "First update."
    });
    const firstStackedApply = await request(baseUrl, "/api/tasks/apply-patch", { taskId: stackedTask.id, proposalId: firstStackedProposal.patchProposal.proposalId, proposalDigest: firstStackedProposal.patchProposal.proposalDigest, approved: true });
    assert.equal(firstStackedApply.response.status, 200);
    const secondStackedProposal = await store.setPatchProposal(stackedTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-newest\n",
      expectedBaseline: { exists: true, sha256: hashContent("first-middle\n") },
      summary: "Second update."
    });
    const secondStackedApply = await request(baseUrl, "/api/tasks/apply-patch", { taskId: stackedTask.id, proposalId: secondStackedProposal.patchProposal.proposalId, proposalDigest: secondStackedProposal.patchProposal.proposalDigest, approved: true });
    assert.equal(secondStackedApply.response.status, 200);

    const revertedNewest = await request(baseUrl, "/api/tasks/revert-patch", { taskId: stackedTask.id, path: "first.txt", patchIdentity: secondStackedApply.payload.task.appliedPatches[1].patchIdentity, workspaceIdentity: secondStackedApply.payload.task.rootIdentity, approved: true });
    assert.equal(revertedNewest.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-middle\n");
    const afterNewestRevert = await store.get(stackedTask.id);
    assert.equal(afterNewestRevert.appliedPatches[0].revertedAt, null);
    assert.ok(afterNewestRevert.appliedPatches[1].revertedAt);

    const revertedOlder = await request(baseUrl, "/api/tasks/revert-patch", { taskId: stackedTask.id, path: "first.txt", patchIdentity: secondStackedApply.payload.task.appliedPatches[0].patchIdentity, workspaceIdentity: secondStackedApply.payload.task.rootIdentity, approved: true });
    assert.equal(revertedOlder.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");

    const createdPath = path.join(workspace, "generated.txt");
    const createTask = await store.create({ goal: "create and safely revert a file", rootPath: workspace, workspaceId: activated.workspace.id });
    const createProposal = await store.setPatchProposal(createTask.id, {
      applicable: true,
      path: "generated.txt",
      content: "generated\n",
      expectedBaseline: { exists: false, sha256: null },
      summary: "Create generated.txt."
    });
    const created = await request(baseUrl, "/api/tasks/apply-patch", { taskId: createTask.id, proposalId: createProposal.patchProposal.proposalId, proposalDigest: createProposal.patchProposal.proposalDigest, approved: true });
    assert.equal(created.response.status, 200);
    assert.equal(await fs.readFile(createdPath, "utf8"), "generated\n");
    assert.equal((await store.get(createTask.id)).appliedPatches[0].previousExists, false);

    const removedAgain = await request(baseUrl, "/api/tasks/revert-patch", { taskId: createTask.id, patchIndex: 0, patchIdentity: created.payload.task.appliedPatches[0].patchIdentity, workspaceIdentity: created.payload.task.rootIdentity, approved: true });
    assert.equal(removedAgain.response.status, 200);
    await assert.rejects(fs.access(createdPath), { code: "ENOENT" });

    const approvalTask = await store.create({ goal: "bind approval to reviewed proposal", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(approvalTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    const reviewed = await store.setPatchProposal(approvalTask.id, { applicable: true, path: "first.txt", content: "reviewed-change\n", summary: "reviewed A" });
    const lockManager = new CrossProcessLockManager({
      storagePath: projectLockDir,
      namespace: "project-write",
      lockedCode: "PROJECT_WRITE_LOCKED"
    });
    const heldLock = await lockManager.acquire(await canonicalPathLockKey(workspace));
    let queuedApply;
    try {
      queuedApply = request(baseUrl, "/api/tasks/apply-patch", {
        taskId: approvalTask.id,
        proposalId: reviewed.patchProposal.proposalId,
        proposalDigest: reviewed.patchProposal.proposalDigest,
        approved: true
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await store.setPatchProposal(approvalTask.id, { applicable: true, path: "surprise.txt", content: "surprise\n", expectedBaseline: { exists: false, sha256: null }, summary: "unreviewed B" });
    } finally {
      await lockManager.release(heldLock);
    }
    const staleApproval = await queuedApply;
    assert.equal(staleApproval.response.status, 409);
    assert.equal(staleApproval.payload.code, "PATCH_APPROVAL_STALE");
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
    await assert.rejects(fs.access(path.join(workspace, "surprise.txt")), { code: "ENOENT" });

    const legacyTask = await store.create({ goal: "revert legacy patch record", rootPath: workspace, workspaceId: activated.workspace.id });
    await fs.writeFile(firstPath, "legacy-after\n", "utf8");
    await store.recordAppliedPatch(legacyTask.id, {
      path: "first.txt",
      previousExists: true,
      previousContent: "first-old\n",
      nextContent: "legacy-after\n"
    });
    const rawTasks = JSON.parse(await fs.readFile(store.storagePath, "utf8"));
    const rawLegacy = rawTasks.find((task) => task.id === legacyTask.id);
    delete rawLegacy.appliedPatches[0].patchIdentity;
    await store.writeAll(rawTasks);
    const restoredLegacy = await request(baseUrl, `/api/tasks/latest?rootPath=${encodeURIComponent(workspace)}`);
    assert.match(restoredLegacy.payload.task.appliedPatches[0].patchIdentity, /^[0-9a-f]{64}$/);
    const legacyRevert = await request(baseUrl, "/api/tasks/revert-patch", {
      taskId: legacyTask.id,
      patchIndex: 0,
      patchIdentity: restoredLegacy.payload.task.appliedPatches[0].patchIdentity,
      workspaceIdentity: restoredLegacy.payload.task.rootIdentity,
      approved: true
    });
    assert.equal(legacyRevert.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
  } finally {
    server.kill();
    await waitForExit(server);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
  }
});

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
