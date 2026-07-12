import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { previewAndApproveModelOperation } from "../scripts/model-operation-client.js";

test("server-authoritative capabilities block originals and allow only an activated disposable copy", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-workspace-api-"));
  const stateDir = path.join(base, "state");
  const lockDir = path.join(base, "project-locks");
  const copyRoot = path.join(base, "copies");
  const original = path.join(base, "original");
  await fs.mkdir(path.join(original, "src"), { recursive: true });
  await fs.writeFile(path.join(original, "src", "value.js"), "export const value = 1;\n", "utf8");
  await fs.writeFile(path.join(original, "package.json"), '{"scripts":{"test":"node --test"}}\n', "utf8");
  t.after(() => fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  let server = await startServer({ stateDir, lockDir, copyRoot });
  t.after(() => stopServer(server));
  let baseUrl = server.baseUrl;
  const system = (await request(baseUrl, "/api/system/check")).payload;

  await t.test("copy preview rejects a linked source root before canonicalization", async (t) => {
    const linkedSource = path.join(base, "linked-original");
    try {
      await fs.symlink(original, linkedSource, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
      throw error;
    }
    t.after(() => unlinkDirectoryLink(linkedSource));

    const linkedPreview = await request(baseUrl, "/api/workspaces/copy/preview", { sourcePath: linkedSource });
    assert.equal(linkedPreview.response.status, 409);
    assert.equal(linkedPreview.payload.code, "PATH_LINKED_DIRECTORY");
  });

  const originalPreflight = await request(baseUrl, "/api/preflight/run", {
    path: original,
    goal: "understand this original project"
  });
  assert.equal(originalPreflight.payload.workspace.kind, "original-readonly");
  assert.equal(originalPreflight.payload.workspace.canWrite, false);

  const forgedApply = await request(baseUrl, "/api/tasks/apply-patch", {
    taskId: originalPreflight.payload.task.id,
    approved: true,
    mode: "disposable-copy",
    kind: "built-in-demo"
  });
  assert.equal(forgedApply.response.status, 409);
  assert.equal(forgedApply.payload.code, "WORKSPACE_ORIGINAL_READ_ONLY");
  assert.equal(await fs.readFile(path.join(original, "src", "value.js"), "utf8"), "export const value = 1;\n");

  const forgedCommand = await request(baseUrl, "/api/tools/call", {
    tool: "run_command",
    args: { command: "npm run test" },
    rootPath: original,
    taskId: originalPreflight.payload.task.id,
    approved: true,
    mode: "disposable-copy"
  });
  assert.equal(forgedCommand.response.status, 409);
  assert.equal(forgedCommand.payload.code, "WORKSPACE_ORIGINAL_READ_ONLY");

  const previewResult = await request(baseUrl, "/api/workspaces/copy/preview", { sourcePath: system.demoPath });
  const preview = previewResult.payload.preview;
  assert.equal(preview.eligible, true);
  assert.equal(preview.disclosure.containsSourceCode, true);
  assert.equal(preview.disclosure.safeToShare, false);
  const createdResult = await request(baseUrl, "/api/workspaces/copy/create", {
    previewId: preview.previewId,
    previewDigest: preview.previewDigest,
    targetPath: original,
    mode: "built-in-demo"
  });
  const copy = createdResult.payload.workspace;
  assert.equal(copy.kind, "disposable-copy");
  assert.equal(copy.active, false);
  assert.equal(copy.canWrite, false);
  assert.ok(copy.rootPath.startsWith(copyRoot));

  const inactiveScan = await request(baseUrl, "/api/repo/scan", { path: copy.rootPath });
  assert.equal(inactiveScan.payload.workspace.kind, "disposable-copy");
  assert.equal(inactiveScan.payload.workspace.canWrite, false);
  const inactiveCommand = await request(baseUrl, "/api/tools/call", {
    tool: "run_command",
    args: { command: "npm run test" },
    rootPath: copy.rootPath,
    approved: true
  });
  assert.equal(inactiveCommand.response.status, 409);
  assert.equal(inactiveCommand.payload.code, "WORKSPACE_ACTIVATION_REQUIRED");

  const activatedResult = await request(baseUrl, "/api/workspaces/activate", {
    workspaceId: copy.id,
    workspaceDigest: copy.workspaceDigest,
    rootPath: original,
    mode: "built-in-demo"
  });
  assert.equal(activatedResult.payload.workspace.canWrite, true);
  assert.equal(activatedResult.payload.profile.rootPath, copy.rootPath);

  await stopServer(server);
  server = await startServer({ stateDir, lockDir, copyRoot });
  baseUrl = server.baseUrl;
  const afterRestart = (await request(baseUrl, "/api/workspaces")).payload;
  const recoveredCopy = afterRestart.workspaces.find((item) => item.id === copy.id);
  assert.equal(recoveredCopy.active, true);
  assert.equal(recoveredCopy.canWrite, true);

  const copyPackagePath = path.join(copy.rootPath, "package.json");
  const copyPackage = JSON.parse((await fs.readFile(copyPackagePath, "utf8")).replace(/^\uFEFF/, ""));
  copyPackage.scripts.test = "node -e \"console.log('workspace command ok')\"";
  await fs.writeFile(copyPackagePath, `${JSON.stringify(copyPackage, null, 2)}\n`, "utf8");
  const goal = "Add a divide-by-zero test and verify the project";
  const preflight = await request(baseUrl, "/api/preflight/run", { path: copy.rootPath, goal });
  assert.equal(preflight.payload.workspace.id, copy.id);
  const proposal = await previewAndApproveModelOperation(
    (pathname, body) => request(baseUrl, pathname, body),
    { operation: "patch-proposal", taskId: preflight.payload.task.id }
  );
  assert.equal(proposal.result.applicable, true);

  const applied = await request(baseUrl, "/api/tasks/apply-patch", {
    taskId: preflight.payload.task.id,
    proposalId: proposal.result.proposalId,
    proposalDigest: proposal.result.proposalDigest,
    approved: true,
    mode: "original-readonly"
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.payload.ok, true);

  const verified = await request(baseUrl, "/api/tools/call", {
    tool: "run_command",
    args: { command: "npm run test" },
    rootPath: copy.rootPath,
    taskId: preflight.payload.task.id,
    approved: true
  });
  assert.equal(verified.payload.result.exitCode, 0);

  const patch = applied.payload.task.appliedPatches[0];
  const reverted = await request(baseUrl, "/api/tasks/revert-patch", {
    taskId: preflight.payload.task.id,
    patchIndex: 0,
    patchIdentity: patch.patchIdentity,
    workspaceIdentity: applied.payload.task.rootIdentity,
    approved: true
  });
  assert.equal(reverted.response.status, 200);

  const beforeCleanup = (await request(baseUrl, "/api/workspaces")).payload;
  const demo = beforeCleanup.workspaces.find((item) => item.kind === "built-in-demo");
  await request(baseUrl, "/api/workspaces/activate", { workspaceId: demo.id, workspaceDigest: demo.workspaceDigest });
  const cleanupList = (await request(baseUrl, "/api/workspaces")).payload;
  const cleanupCopy = cleanupList.workspaces.find((item) => item.id === copy.id);
  const cleanup = await request(baseUrl, "/api/workspaces/cleanup", {
    workspaceId: cleanupCopy.id,
    workspaceDigest: cleanupCopy.workspaceDigest,
    path: original,
    approved: true
  });
  assert.equal(cleanup.response.status, 200);
  await assert.rejects(() => fs.stat(copy.rootPath), (error) => error.code === "ENOENT");
  assert.equal((await fs.stat(original)).isDirectory(), true);

  const crossSite = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: "{}"
  });
  assert.equal(crossSite.status, 403);
});

test("server refuses a missing copy root below a linked ancestor before writing an owner claim", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-workspace-api-root-link-"));
  const linkedTarget = path.join(base, "linked-target");
  const linkedParent = path.join(base, "linked-parent");
  const copyRoot = path.join(linkedParent, "nested", "copies");
  await fs.mkdir(linkedTarget);
  try {
    await fs.symlink(linkedTarget, linkedParent, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("Directory links are unavailable in this environment.");
    throw error;
  }
  t.after(async () => {
    await unlinkDirectoryLink(linkedParent);
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const result = await startServer({
    stateDir: path.join(base, "state"),
    lockDir: path.join(base, "project-locks"),
    copyRoot
  }).then((server) => ({ server, error: null }), (error) => ({ server: null, error }));
  if (result.server) {
    await stopServer(result.server);
    assert.fail("The server started with a linked disposable-copy root ancestor.");
  }
  assert.match(result.error.message, /Every existing disposable-copy root ancestor must be a normal directory/);
  await assert.rejects(() => fs.stat(path.join(linkedTarget, "nested")), (error) => error.code === "ENOENT");
  await assert.rejects(
    () => fs.stat(path.join(linkedTarget, "nested", "copies", ".codeclaw-copy-root-owner.json")),
    (error) => error.code === "ENOENT"
  );
});

async function startServer({ stateDir, lockDir, copyRoot }) {
  const port = await findFreePort();
  const child = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: lockDir,
      CODECLAW_DISPOSABLE_ROOT: copyRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const server = { child, baseUrl: `http://127.0.0.1:${port}`, output: () => output };
  await waitForHealth(server);
  return server;
}

async function stopServer(server) {
  if (!server || exited(server.child)) return;
  server.child.kill();
  await Promise.race([
    new Promise((resolve) => server.child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2500))
  ]);
  if (!exited(server.child)) server.child.kill("SIGKILL");
}

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth(server) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (exited(server.child)) throw new Error(`Server exited early.\n${server.output()}`);
    try {
      const health = await request(server.baseUrl, "/api/health");
      if (health.response.ok && health.payload.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start.\n${server.output()}`);
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function unlinkDirectoryLink(linkPath) {
  try {
    await fs.unlink(linkPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    if (process.platform === "win32" && ["EPERM", "EACCES", "EISDIR"].includes(error.code)) {
      await fs.rmdir(linkPath);
      return;
    }
    throw error;
  }
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
