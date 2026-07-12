import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { previewAndApproveModelOperation } from "../scripts/model-operation-client.js";

test("POST transport and private workspace state fail closed", async (t) => {
  const fixture = await createFixture("transport");
  const server = await startServer(fixture);
  t.after(async () => {
    await stopServer(server);
    await fs.rm(fixture.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await fs.mkdir(fixture.copyRoot, { recursive: true });

  for (const contentType of [undefined, "text/plain", "application/jsonp", "application/x-www-form-urlencoded"]) {
    const result = await rawPost(server.baseUrl, "/api/repo/scan", JSON.stringify({ path: fixture.original }), {
      contentType
    });
    assert.equal(result.response.status, 415, `content-type ${contentType || "<missing>"}`);
    assert.equal(result.payload.code, "JSON_CONTENT_TYPE_REQUIRED");
  }

  const malformed = await rawPost(server.baseUrl, "/api/repo/scan", "{", { contentType: "application/json" });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.payload.code, "JSON_BODY_INVALID");

  for (const origin of ["https://example.com", "null", "http://127.0.0.1:1", "https://localhost:4173"]) {
    const result = await rawPost(server.baseUrl, "/api/repo/scan", JSON.stringify({ path: fixture.original }), {
      contentType: "application/json",
      origin
    });
    assert.equal(result.response.status, 403, `origin ${origin}`);
    assert.equal(result.payload.code, "LOCAL_ORIGIN_REQUIRED");
  }
  const rejectedAudit = await request(server.baseUrl, "/api/audit/events");
  assert.deepEqual(rejectedAudit.payload.events, [], "untrusted transport rejections must not write audit state");

  const sameOrigin = await rawPost(server.baseUrl, "/api/repo/scan", JSON.stringify({ path: fixture.original }), {
    contentType: "Application/JSON; Charset=UTF-8",
    origin: server.baseUrl
  });
  assert.equal(sameOrigin.response.status, 200);
  assert.equal(sameOrigin.payload.workspace.kind, "original-readonly");

  for (const pathname of [
    "/api/model/suggest",
    "/api/model/context-files",
    "/api/model/patch-proposal",
    "/api/model/fix-from-failure",
    "/api/tasks/context-file"
  ]) {
    const removed = await request(server.baseUrl, pathname, {});
    assert.equal(removed.response.status, 404, pathname);
    assert.equal(removed.payload.code, "API_NOT_FOUND", pathname);
  }

  for (const pathname of ["/api/repo/scan", "/api/preflight/run"]) {
    const result = await request(server.baseUrl, pathname, { path: fixture.stateDir, goal: "read private state" });
    assert.equal(result.response.status, 403, pathname);
    assert.equal(result.payload.code, "PATH_PROTECTED_STATE");
  }
  for (const protectedPath of [fixture.copyRoot, fixture.lockDir, fixture.base]) {
    const result = await request(server.baseUrl, "/api/repo/scan", { path: protectedPath });
    assert.equal(result.response.status, 403, protectedPath);
    assert.equal(result.payload.code, "PATH_PROTECTED_STATE");
  }
  const statePreview = await request(server.baseUrl, "/api/workspaces/copy/preview", { sourcePath: fixture.stateDir });
  assert.equal(statePreview.response.status, 403);
  assert.equal(statePreview.payload.code, "PATH_PROTECTED_STATE");

  const protectedRoot = await request(server.baseUrl, "/api/repo/scan", { path: path.join(fixture.original, ".codeclaw") });
  assert.equal(protectedRoot.response.status, 403);
  assert.equal(protectedRoot.payload.code, "PATH_PROTECTED_ROOT");

  for (const protectedPath of [".codeclaw/private.json", ".git/config"]) {
    const read = await request(server.baseUrl, "/api/tools/call", {
      tool: "read_file",
      args: { path: protectedPath },
      rootPath: fixture.original
    });
    assert.equal(read.response.status, 409, protectedPath);
    assert.equal(read.payload.code, "READ_PROTECTED_PATH_REFUSED");
  }

  const workspaces = await request(server.baseUrl, "/api/workspaces");
  const publicPayload = JSON.stringify(workspaces.payload);
  assert.doesNotMatch(publicPayload, /ownerId|workspace-owner\.json|workspace-capabilities\.json|"secret"/i);
  assert.equal(await fs.readFile(path.join(fixture.stateDir, "workspace-owner.json"), "utf8").then(Boolean), true);
});

test("task-bound and active-workspace reads reject a same-path junction replacement", async (t) => {
  const fixture = await createFixture("root-replacement-read");
  const server = await startServer(fixture);
  t.after(async () => {
    await stopServer(server);
    await fs.rm(fixture.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.original,
    goal: "review the original before any change"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  const owner = JSON.parse(await fs.readFile(path.join(fixture.stateDir, "workspace-owner.json"), "utf8"));
  assert.match(owner.secret, /^[A-Za-z0-9_-]{43}$/);

  const reviewedOriginal = `${fixture.original}-reviewed`;
  try {
    await fs.rename(fixture.original, reviewedOriginal);
    await fs.symlink(fixture.stateDir, fixture.original, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EACCES", "EPERM", "ENOSYS"].includes(error.code)) {
      t.skip(`This environment cannot create the directory link needed for the regression (${error.code}).`);
      return;
    }
    throw error;
  }

  const attempts = [
    await request(server.baseUrl, "/api/tools/call", {
      tool: "read_file",
      args: { path: "workspace-owner.json" },
      rootPath: fixture.original,
      taskId
    }),
    await request(server.baseUrl, "/api/tools/call", {
      tool: "list_files",
      args: {},
      rootPath: fixture.original,
      taskId
    }),
    await request(server.baseUrl, "/api/tools/call", {
      tool: "search_code",
      args: { query: owner.secret },
      rootPath: fixture.original,
      taskId
    }),
    await request(server.baseUrl, "/api/model/preview", {
      operation: "patch-proposal",
      taskId
    }),
    await request(server.baseUrl, "/api/tools/call", {
      tool: "read_file",
      args: { path: "workspace-owner.json" },
      rootPath: fixture.original
    })
  ];

  for (const [index, attempt] of attempts.entries()) {
    assert.equal(attempt.response.status, 409, `attempt ${index + 1}`);
    assert.equal(attempt.payload.code, "WORKSPACE_IDENTITY_CHANGED", `attempt ${index + 1}`);
    assert.doesNotMatch(JSON.stringify(attempt.payload), new RegExp(escapeRegExp(owner.secret)), `attempt ${index + 1}`);
  }
  const audit = await request(server.baseUrl, "/api/audit/events");
  assert.doesNotMatch(JSON.stringify(audit.payload), new RegExp(escapeRegExp(owner.secret)));
});

test("strict approvals and server capabilities reject every client-side elevation", async (t) => {
  const fixture = await createFixture("permissions");
  const server = await startServer(fixture);
  t.after(async () => {
    await stopServer(server);
    await fs.rm(fixture.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const originalPreflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.original,
    goal: "understand the original"
  });
  const originalTaskId = originalPreflight.payload.task.id;
  const forgedCapability = {
    approved: true,
    mode: "disposable-copy",
    kind: "built-in-demo",
    canWrite: true,
    canRunCommands: true,
    active: true,
    workspaceId: "built-in-demo",
    workspaceDigest: "forged"
  };

  const forgedApply = await request(server.baseUrl, "/api/tasks/apply-patch", {
    taskId: originalTaskId,
    ...forgedCapability
  });
  assertWorkspaceReadOnly(forgedApply, "forged Apply");

  const forgedRevert = await request(server.baseUrl, "/api/tasks/revert-patch", {
    taskId: originalTaskId,
    patchIndex: 0,
    patchIdentity: "forged",
    workspaceIdentity: "forged",
    ...forgedCapability
  });
  assertWorkspaceReadOnly(forgedRevert, "forged Revert");

  for (const tool of ["run_command", "git_status", "git_diff"]) {
    const blocked = await request(server.baseUrl, "/api/tools/call", {
      tool,
      args: tool === "run_command" ? { command: "npm run test" } : {},
      rootPath: fixture.original,
      taskId: originalTaskId,
      ...forgedCapability
    });
    assertWorkspaceReadOnly(blocked, `original ${tool}`);
  }
  for (const tool of ["git_commit", "git_push"]) {
    const blocked = await request(server.baseUrl, "/api/tools/call", {
      tool,
      args: {},
      rootPath: fixture.original,
      taskId: originalTaskId,
      ...forgedCapability
    });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.payload.code, "WORKSPACE_TOOL_NOT_ALLOWED");
  }
  assert.equal(await fs.readFile(path.join(fixture.original, "src", "value.js"), "utf8"), "export const value = 1;\n");

  const system = await request(server.baseUrl, "/api/system/check");
  const previewResult = await request(server.baseUrl, "/api/workspaces/copy/preview", { sourcePath: system.payload.demoPath });
  const preview = previewResult.payload.preview;
  const createdResult = await request(server.baseUrl, "/api/workspaces/copy/create", {
    previewId: preview.previewId,
    previewDigest: preview.previewDigest,
    targetPath: fixture.original,
    mode: "built-in-demo",
    canWrite: true,
    active: true
  });
  const copy = createdResult.payload.workspace;
  assert.equal(copy.active, false);
  assert.equal(copy.canWrite, false);
  assert.ok(copy.rootPath.startsWith(fixture.copyRoot));
  const activated = await request(server.baseUrl, "/api/workspaces/activate", {
    workspaceId: copy.id,
    workspaceDigest: copy.workspaceDigest,
    rootPath: fixture.original,
    mode: "built-in-demo",
    canWrite: true
  });
  assert.equal(activated.payload.workspace.kind, "disposable-copy");
  assert.equal(activated.payload.workspace.active, true);
  assert.equal(activated.payload.workspace.canWrite, true);
  assert.equal(activated.payload.profile.rootPath, copy.rootPath);

  const goal = "Add a divide-by-zero test and verify the project";
  const preflight = await request(server.baseUrl, "/api/preflight/run", { path: copy.rootPath, goal });
  const proposal = await previewAndApproveModelOperation(
    (pathname, body) => request(server.baseUrl, pathname, body),
    { operation: "patch-proposal", taskId: preflight.payload.task.id }
  );
  assert.equal(proposal.result.applicable, true);
  const targetPath = path.join(copy.rootPath, "test", "calculator.test.js");
  const beforeApply = await fs.readFile(targetPath, "utf8");
  const applyBody = {
    taskId: preflight.payload.task.id,
    proposalId: proposal.result.proposalId,
    proposalDigest: proposal.result.proposalDigest
  };

  for (const approved of [false, "true", "TRUE", 1, {}, []]) {
    const blocked = await request(server.baseUrl, "/api/tasks/apply-patch", { ...applyBody, approved });
    assert.equal(blocked.response.status, 200, `Apply approval ${JSON.stringify(approved)}`);
    assert.equal(blocked.payload.blocked, true);
  }
  assert.equal(await fs.readFile(targetPath, "utf8"), beforeApply);

  const applied = await request(server.baseUrl, "/api/tasks/apply-patch", { ...applyBody, approved: true });
  assert.equal(applied.response.status, 200);
  const afterApply = await fs.readFile(targetPath, "utf8");
  assert.notEqual(afterApply, beforeApply);

  for (const approved of ["true", 1, {}, []]) {
    const blocked = await request(server.baseUrl, "/api/tools/call", {
      tool: "run_command",
      args: { command: "npm run test" },
      rootPath: copy.rootPath,
      taskId: preflight.payload.task.id,
      approved
    });
    assert.equal(blocked.response.status, 200, `command approval ${JSON.stringify(approved)}`);
    assert.equal(blocked.payload.blocked, true);
  }

  const markerRead = await request(server.baseUrl, "/api/tools/call", {
    tool: "read_file",
    args: { path: ".codeclaw-disposable-copy.json" },
    rootPath: copy.rootPath,
    taskId: preflight.payload.task.id
  });
  assert.equal(markerRead.response.status, 409);
  assert.equal(markerRead.payload.code, "READ_PROTECTED_PATH_REFUSED");

  const patch = applied.payload.task.appliedPatches[0];
  const revertBody = {
    taskId: preflight.payload.task.id,
    patchIndex: 0,
    patchIdentity: patch.patchIdentity,
    workspaceIdentity: applied.payload.task.rootIdentity
  };
  for (const approved of [false, "true", 1, {}, []]) {
    const blocked = await request(server.baseUrl, "/api/tasks/revert-patch", { ...revertBody, approved });
    assert.equal(blocked.response.status, 200, `Revert approval ${JSON.stringify(approved)}`);
    assert.equal(blocked.payload.blocked, true);
  }
  assert.equal(await fs.readFile(targetPath, "utf8"), afterApply);
  const reverted = await request(server.baseUrl, "/api/tasks/revert-patch", { ...revertBody, approved: true });
  assert.equal(reverted.response.status, 200);
  assert.equal(await fs.readFile(targetPath, "utf8"), beforeApply);

  const workspaceList = await request(server.baseUrl, "/api/workspaces");
  const demo = workspaceList.payload.workspaces.find((item) => item.kind === "built-in-demo");
  await request(server.baseUrl, "/api/workspaces/activate", { workspaceId: demo.id, workspaceDigest: demo.workspaceDigest });
  const refreshed = await request(server.baseUrl, "/api/workspaces");
  const inactiveCopy = refreshed.payload.workspaces.find((item) => item.id === copy.id);
  for (const approved of [false, "true", 1, {}, []]) {
    const blocked = await request(server.baseUrl, "/api/workspaces/cleanup", {
      workspaceId: inactiveCopy.id,
      workspaceDigest: inactiveCopy.workspaceDigest,
      approved
    });
    assert.equal(blocked.response.status, 409, `cleanup approval ${JSON.stringify(approved)}`);
    assert.equal(blocked.payload.code, "WORKSPACE_CLEANUP_APPROVAL_REQUIRED");
  }
  assert.equal((await fs.stat(copy.rootPath)).isDirectory(), true);
});

function assertWorkspaceReadOnly(result, label) {
  assert.equal(result.response.status, 409, label);
  assert.equal(result.payload.code, "WORKSPACE_ORIGINAL_READ_ONLY", label);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createFixture(name) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), `codeclaw-server-security-${name}-`));
  const stateDir = path.join(base, "state");
  const lockDir = path.join(base, "locks");
  const copyRoot = path.join(base, "copies");
  const original = path.join(base, "original");
  await fs.mkdir(lockDir, { recursive: true });
  await fs.mkdir(path.join(original, "src"), { recursive: true });
  await fs.mkdir(path.join(original, ".codeclaw"), { recursive: true });
  await fs.mkdir(path.join(original, ".git"), { recursive: true });
  await fs.writeFile(path.join(original, "src", "value.js"), "export const value = 1;\n", "utf8");
  await fs.writeFile(path.join(original, "package.json"), '{"scripts":{"test":"node --test"}}\n', "utf8");
  await fs.writeFile(path.join(original, ".codeclaw", "private.json"), '{"private":true}\n', "utf8");
  await fs.writeFile(path.join(original, ".git", "config"), "[core]\n", "utf8");
  return { base, stateDir, lockDir, copyRoot, original };
}

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
  const server = { child, port, baseUrl: `http://127.0.0.1:${port}`, output: () => output };
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
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function rawPost(baseUrl, pathname, body, { contentType, origin } = {}) {
  const headers = {};
  if (contentType) headers["content-type"] = contentType;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers, body });
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
