import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootPath = process.cwd();
const demoPath = path.join(rootPath, "examples", "demo-js");
const demoTestPath = path.join(demoPath, "test", "calculator.test.js");
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-smoke-"));
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const originalDemoTest = await fs.readFile(demoTestPath, "utf8");
const server = spawn(process.execPath, ["apps/web/server.js"], {
  cwd: rootPath,
  env: {
    ...process.env,
    CODECLAW_PORT: String(port),
    CODECLAW_STATE_DIR: stateDir,
    CODECLAW_PROJECT_LOCK_DIR: path.join(stateDir, "project-locks")
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let serverOutput = "";

server.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
server.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});

try {
  await waitForHealth();
  const scan = await request("/api/repo/scan", { path: demoPath });
  const task = await request("/api/tasks/create", { goal: "add divide by zero test and verify the project", rootPath: scan.profile.rootPath });
  await request("/api/agent/plan", { goal: task.task.goal, repoProfile: scan.profile, taskId: task.task.id });
  await request("/api/tools/call", { tool: "read_file", args: { path: "test/calculator.test.js" }, rootPath: scan.profile.rootPath, taskId: task.task.id });
  const patch = await request("/api/model/patch-proposal", { goal: task.task.goal, repoProfile: scan.profile, rootPath: scan.profile.rootPath, taskId: task.task.id });
  if (patch.proposal.path !== "test/calculator.test.js") throw new Error(`Unexpected patch path: ${patch.proposal.path}`);
  const applied = await request("/api/tasks/apply-patch", { taskId: task.task.id, proposalId: patch.proposal.proposalId, proposalDigest: patch.proposal.proposalDigest, approved: true });
  const verify = await request("/api/tools/call", { tool: "run_command", args: { command: "npm run test" }, rootPath: scan.profile.rootPath, taskId: task.task.id, approved: true });
  if (verify.result.exitCode !== 0) throw new Error(`Verification failed with exit ${verify.result.exitCode}`);
  const completed = await request("/api/tasks/complete", { taskId: task.task.id });
  if (!completed.task.reviewDraft?.includes("Exit code 0")) throw new Error("Review draft did not include verification result.");
  await request("/api/tasks/revert-patch", { taskId: task.task.id, patchIndex: 0, patchIdentity: applied.task.appliedPatches[0].patchIdentity, workspaceIdentity: applied.task.rootIdentity, approved: true });
  const finalDemoTest = await fs.readFile(demoTestPath, "utf8");
  if (finalDemoTest !== originalDemoTest) throw new Error("Smoke test did not restore the demo test file.");

  console.log(JSON.stringify({
    ok: true,
    port,
    files: scan.profile.fileCount,
    patchPath: patch.proposal.path,
    verificationExitCode: verify.result.exitCode,
    reviewDraft: completed.task.reviewDraft.split("\n")[0],
    demoRestored: true
  }, null, 2));
} finally {
  server.kill();
  await fs.rm(stateDir, { recursive: true, force: true });
}

async function request(url, body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.ok === false && !payload.blocked)) {
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`);
  }
  return payload;
}

async function waitForHealth() {
  for (let index = 0; index < 50; index += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early.\n${serverOutput}`);
    try {
      const health = await request("/api/health");
      if (health.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become ready.\n${serverOutput}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = address.port;
      probe.close(() => resolve(selected));
    });
  });
}
