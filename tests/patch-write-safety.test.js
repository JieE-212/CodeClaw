import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { TaskStore } from "../packages/task-store/src/index.js";
import { hashContent } from "../packages/tool-registry/src/index.js";

test("patch APIs reject stale baselines, roll back partial batches, and protect post-apply edits", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-patch-safety-workspace-"));
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-patch-safety-state-"));
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const store = new TaskStore({ storagePath: path.join(stateDir, "tasks.json") });
  const server = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, CODECLAW_PORT: String(port), CODECLAW_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });

  const calculatorPath = path.join(workspace, "test", "calculator.test.js");
  const firstPath = path.join(workspace, "first.txt");
  const ignoredPath = path.join(workspace, "blocked.txt");
  const calculatorOriginal = [
    "import test from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { divide } from \"../src/calculator.js\";",
    "test(\"divide\", () => assert.equal(divide(8, 2), 4));",
    ""
  ].join("\n");

  try {
    await fs.mkdir(path.dirname(calculatorPath), { recursive: true });
    await fs.writeFile(path.join(workspace, ".gitignore"), "blocked.txt\n", "utf8");
    await fs.writeFile(calculatorPath, calculatorOriginal, "utf8");
    await fs.writeFile(firstPath, "first-old\n", "utf8");
    await fs.writeFile(ignoredPath, "blocked-old\n", "utf8");
    await waitForHealth({ baseUrl, server, serverOutput: () => serverOutput });

    const staleTask = await store.create({ goal: "add divide by zero test", rootPath: workspace });
    await store.appendContextFile(staleTask.id, {
      path: "test/calculator.test.js",
      content: calculatorOriginal,
      contentComplete: true
    });
    const proposed = await request(baseUrl, "/api/model/patch-proposal", {
      taskId: staleTask.id,
      goal: staleTask.goal,
      rootPath: workspace,
      repoProfile: { rootPath: workspace, files: [] }
    });
    assert.equal(proposed.response.status, 200);
    assert.deepEqual(proposed.payload.proposal.files[0].expectedBaseline, {
      exists: true,
      sha256: hashContent(calculatorOriginal)
    });

    const privateManualEdit = "PRIVATE-MANUAL-EDIT-MUST-NOT-LEAK\n";
    await fs.writeFile(calculatorPath, privateManualEdit, "utf8");
    const staleApply = await request(baseUrl, "/api/tasks/apply-patch", { taskId: staleTask.id, approved: true });
    assert.equal(staleApply.response.status, 409);
    assert.equal(staleApply.payload.code, "PATCH_BASELINE_CONFLICT");
    assert.doesNotMatch(staleApply.payload.error, /PRIVATE-MANUAL-EDIT/);
    assert.equal(await fs.readFile(calculatorPath, "utf8"), privateManualEdit);
    assert.equal((await store.get(staleTask.id)).appliedPatches.length, 0);

    const batchTask = await store.create({ goal: "apply two files", rootPath: workspace });
    await store.appendContextFile(batchTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    await store.appendContextFile(batchTask.id, { path: "blocked.txt", content: "blocked-old\n", contentComplete: true });
    await store.setPatchProposal(batchTask.id, {
      applicable: true,
      summary: "Update two files.",
      files: [
        { path: "first.txt", content: "first-next\n" },
        { path: "blocked.txt", content: "blocked-next\n" }
      ]
    });
    const failedBatch = await request(baseUrl, "/api/tasks/apply-patch", { taskId: batchTask.id, approved: true });
    assert.equal(failedBatch.response.status, 409);
    assert.equal(failedBatch.payload.code, "PATCH_APPLY_FAILED");
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
    assert.equal(await fs.readFile(ignoredPath, "utf8"), "blocked-old\n");
    const batchAfterFailure = await store.get(batchTask.id);
    assert.equal(batchAfterFailure.status, "patch_ready");
    assert.equal(batchAfterFailure.appliedPatches.length, 0);

    const revertTask = await store.create({ goal: "protect later edits", rootPath: workspace });
    await store.appendContextFile(revertTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    await store.setPatchProposal(revertTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-applied\n",
      summary: "Update first.txt."
    });
    const applied = await request(baseUrl, "/api/tasks/apply-patch", { taskId: revertTask.id, approved: true });
    assert.equal(applied.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-applied\n");

    const laterManualEdit = "PRIVATE-LATER-EDIT-MUST-NOT-LEAK\n";
    await fs.writeFile(firstPath, laterManualEdit, "utf8");
    const conflictedRevert = await request(baseUrl, "/api/tasks/revert-patch", { taskId: revertTask.id, patchIndex: 0, approved: true });
    assert.equal(conflictedRevert.response.status, 409);
    assert.equal(conflictedRevert.payload.code, "PATCH_REVERT_CONFLICT");
    assert.doesNotMatch(conflictedRevert.payload.error, /PRIVATE-LATER-EDIT/);
    assert.equal(await fs.readFile(firstPath, "utf8"), laterManualEdit);
    assert.equal((await store.get(revertTask.id)).appliedPatches[0].revertedAt, null);

    await fs.writeFile(firstPath, "first-applied\n", "utf8");
    const reverted = await request(baseUrl, "/api/tasks/revert-patch", { taskId: revertTask.id, patchIndex: 0, approved: true });
    assert.equal(reverted.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");
    assert.ok((await store.get(revertTask.id)).appliedPatches[0].revertedAt);

    const stackedTask = await store.create({ goal: "revert the newest change first", rootPath: workspace });
    await store.appendContextFile(stackedTask.id, { path: "first.txt", content: "first-old\n", contentComplete: true });
    await store.setPatchProposal(stackedTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-middle\n",
      summary: "First update."
    });
    assert.equal((await request(baseUrl, "/api/tasks/apply-patch", { taskId: stackedTask.id, approved: true })).response.status, 200);
    await store.setPatchProposal(stackedTask.id, {
      applicable: true,
      path: "first.txt",
      content: "first-newest\n",
      expectedBaseline: { exists: true, sha256: hashContent("first-middle\n") },
      summary: "Second update."
    });
    assert.equal((await request(baseUrl, "/api/tasks/apply-patch", { taskId: stackedTask.id, approved: true })).response.status, 200);

    const revertedNewest = await request(baseUrl, "/api/tasks/revert-patch", { taskId: stackedTask.id, path: "first.txt", approved: true });
    assert.equal(revertedNewest.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-middle\n");
    const afterNewestRevert = await store.get(stackedTask.id);
    assert.equal(afterNewestRevert.appliedPatches[0].revertedAt, null);
    assert.ok(afterNewestRevert.appliedPatches[1].revertedAt);

    const revertedOlder = await request(baseUrl, "/api/tasks/revert-patch", { taskId: stackedTask.id, path: "first.txt", approved: true });
    assert.equal(revertedOlder.response.status, 200);
    assert.equal(await fs.readFile(firstPath, "utf8"), "first-old\n");

    const createdPath = path.join(workspace, "generated.txt");
    const createTask = await store.create({ goal: "create and safely revert a file", rootPath: workspace });
    await store.setPatchProposal(createTask.id, {
      applicable: true,
      path: "generated.txt",
      content: "generated\n",
      expectedBaseline: { exists: false, sha256: null },
      summary: "Create generated.txt."
    });
    const created = await request(baseUrl, "/api/tasks/apply-patch", { taskId: createTask.id, approved: true });
    assert.equal(created.response.status, 200);
    assert.equal(await fs.readFile(createdPath, "utf8"), "generated\n");
    assert.equal((await store.get(createTask.id)).appliedPatches[0].previousExists, false);

    const removedAgain = await request(baseUrl, "/api/tasks/revert-patch", { taskId: createTask.id, patchIndex: 0, approved: true });
    assert.equal(removedAgain.response.status, 200);
    await assert.rejects(fs.access(createdPath), { code: "ENOENT" });
  } finally {
    server.kill();
    await waitForExit(server);
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3 });
    await fs.rm(stateDir, { recursive: true, force: true, maxRetries: 3 });
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
