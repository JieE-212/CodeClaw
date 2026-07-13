import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { TaskStore } from "../packages/task-store/src/index.js";
import { createActivatedWorkspace } from "./helpers/activated-workspace.js";

test("two server processes sharing one authoritative disposable workspace serialize the same patch", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-cross-instance-"));
  const source = path.join(base, "source");
  const lockDir = path.join(base, "project-locks");
  const stateDir = path.join(base, "state");
  const copyRoot = path.join(base, "copies");
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, "file.txt"), "before\n", "utf8");
  const activated = await createActivatedWorkspace({ sourcePath: source, stateDir, copyRoot });
  const workspace = activated.rootPath;

  const ports = [await findFreePort(), await findFreePort()];
  // Separate capability states intentionally cannot both own the same managed copy. Two
  // processes share the signed state here so this test continues to exercise the project lock.
  const servers = ports.map((port) => spawn(process.execPath, ["apps/web/server.js"], {
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
  }));
  const output = ["", ""];
  servers.forEach((server, index) => {
    server.stdout.on("data", (chunk) => { output[index] += String(chunk); });
    server.stderr.on("data", (chunk) => { output[index] += String(chunk); });
  });
  t.after(async () => {
    for (const server of servers) server.kill();
    await Promise.all(servers.map(waitForExit));
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
  });

  await Promise.all(ports.map((port, index) => waitForHealth(`http://127.0.0.1:${port}`, servers[index], () => output[index])));

  const approvals = [];
  const stores = [];
  for (let index = 0; index < ports.length; index += 1) {
    const store = new TaskStore({ storagePath: path.join(stateDir, "tasks.json") });
    stores.push(store);
    const task = await store.create({ goal: "same patch from two instances", rootPath: workspace, workspaceId: activated.workspace.id });
    await store.appendContextFile(task.id, { path: "file.txt", content: "before\n", contentComplete: true });
    const updated = await store.setPatchProposal(task.id, { applicable: true, path: "file.txt", content: "after\n", summary: "same change" });
    approvals.push({ taskId: task.id, proposalId: updated.patchProposal.proposalId, proposalDigest: updated.patchProposal.proposalDigest, approved: true });
  }

  const results = await Promise.all(ports.map((port, index) => request(`http://127.0.0.1:${port}`, "/api/tasks/apply-patch", approvals[index])));
  assert.deepEqual(
    results.map((result) => result.response.status).sort(),
    [200, 409],
    JSON.stringify(results.map((result) => ({ status: result.response.status, code: result.payload.code, error: result.payload.error })))
  );
  assert.equal(results.find((result) => result.response.status === 409).payload.code, "PATCH_BASELINE_CONFLICT");
  assert.equal(await fs.readFile(path.join(workspace, "file.txt"), "utf8"), "after\n");

  const tasks = await Promise.all(stores.map((store, index) => store.get(approvals[index].taskId)));
  assert.deepEqual(tasks.map((task) => task.appliedPatches.length).sort(), [0, 1]);
  const transactionDir = path.join(stateDir, "patch-transactions");
  const entries = await fs.readdir(transactionDir).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
  assert.deepEqual(entries, []);
});

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth(baseUrl, server, serverOutput) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
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
