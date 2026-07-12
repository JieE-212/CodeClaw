import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootPath = process.cwd();
const fixturePath = path.join(rootPath, "examples", "task-board-js");
const filterPath = path.join(fixturePath, "src", "filters.js");
const filterTestPath = path.join(fixturePath, "test", "filters.test.js");
const originalFilter = await fs.readFile(filterPath, "utf8");
const originalFilterTest = await fs.readFile(filterTestPath, "utf8");
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-fixture-pilot-"));
const appPort = await findFreePort();
const modelPort = await findFreePort();
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const modelBaseUrl = `http://127.0.0.1:${modelPort}/v1`;
const modelResponses = [];
const modelRequests = [];

const fakeModelServer = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  const body = await readRequestJson(request);
  modelRequests.push(body);
  const content = modelResponses.shift();
  if (typeof content !== "string") {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "no queued fake model response" } }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
});

await listen(fakeModelServer, modelPort);

const appServer = spawn(process.execPath, ["apps/web/server.js"], {
  cwd: rootPath,
  env: {
    ...process.env,
    CODECLAW_PORT: String(appPort),
    CODECLAW_STATE_DIR: stateDir,
    CODECLAW_PROJECT_LOCK_DIR: path.join(stateDir, "project-locks")
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let appOutput = "";
appServer.stdout.on("data", (chunk) => {
  appOutput += String(chunk);
});
appServer.stderr.on("data", (chunk) => {
  appOutput += String(chunk);
});

try {
  await waitForAppHealth();
  await appRequest("/api/model/config", {
    type: "openai-compatible",
    name: "fixture-fake",
    baseUrl: modelBaseUrl,
    apiKey: "fake-key",
    model: "fixture-model"
  });

  const scan = await appRequest("/api/repo/scan", { path: fixturePath });
  const task = await appRequest("/api/tasks/create", {
    rootPath: scan.profile.rootPath,
    goal: "add priority filtering to the task board list"
  });
  const plan = await appRequest("/api/agent/plan", {
    goal: task.task.goal,
    repoProfile: scan.profile,
    taskId: task.task.id
  });

  modelResponses.push("Read src/filters.js, test/filters.test.js, and src/tasks.js before changing priority filtering.");
  const context = await appRequest("/api/model/context-files", {
    goal: task.task.goal,
    repoProfile: scan.profile,
    rootPath: scan.profile.rootPath,
    taskId: task.task.id
  });
  const selectedPaths = ensureContextPaths(context.suggestion.files);
  for (const filePath of selectedPaths) {
    await appRequest("/api/tools/call", {
      tool: "read_file",
      args: { path: filePath },
      rootPath: scan.profile.rootPath,
      taskId: task.task.id
    });
  }

  modelResponses.push(JSON.stringify({
    summary: "Add priority filtering support and test coverage.",
    files: [
      {
        path: "src/filters.js",
        content: addPriorityFilter(originalFilter),
        summary: "Respect filters.priority in filterTasks."
      },
      {
        path: "test/filters.test.js",
        content: addPriorityFilterTest(originalFilterTest),
        summary: "Cover high-priority filtering with the fixture task list."
      }
    ]
  }));
  const proposal = await appRequest("/api/model/patch-proposal", {
    goal: task.task.goal,
    repoProfile: scan.profile,
    rootPath: scan.profile.rootPath,
    taskId: task.task.id
  });
  if (!proposal.proposal.applicable) throw new Error(`Fixture proposal was not applicable: ${proposal.proposal.reason}`);
  if (proposal.proposal.files.length !== 2) throw new Error("Fixture proposal should update two files.");

  const applied = await appRequest("/api/tasks/apply-patch", { taskId: task.task.id, proposalId: proposal.proposal.proposalId, proposalDigest: proposal.proposal.proposalDigest, approved: true });
  const verification = await appRequest("/api/tools/call", {
    tool: "run_command",
    args: { command: "npm run test" },
    rootPath: scan.profile.rootPath,
    taskId: task.task.id,
    approved: true
  });
  if (verification.result.exitCode !== 0) throw new Error("Fixture verification failed.");

  const completed = await appRequest("/api/tasks/complete", {
    taskId: task.task.id,
    summary: "Priority filtering was added to the task-board fixture and verified."
  });

  await appRequest("/api/tasks/revert-patch", { taskId: task.task.id, patchIndex: 1, patchIdentity: applied.task.appliedPatches[1].patchIdentity, workspaceIdentity: applied.task.rootIdentity, approved: true });
  await appRequest("/api/tasks/revert-patch", { taskId: task.task.id, patchIndex: 0, patchIdentity: applied.task.appliedPatches[0].patchIdentity, workspaceIdentity: applied.task.rootIdentity, approved: true });

  const finalFilter = await fs.readFile(filterPath, "utf8");
  const finalFilterTest = await fs.readFile(filterTestPath, "utf8");
  if (finalFilter !== originalFilter || finalFilterTest !== originalFilterTest) {
    throw new Error("Fixture pilot did not restore files after revert.");
  }

  console.log(JSON.stringify({
    ok: true,
    appPort,
    modelPort,
    project: scan.profile.name,
    files: scan.profile.fileCount,
    commands: scan.profile.commands.map((item) => item.command),
    planSteps: plan.plan.steps.length,
    contextFiles: selectedPaths,
    modelRequests: modelRequests.length,
    patchFiles: proposal.proposal.files.map((file) => file.path),
    verificationExitCode: verification.result.exitCode,
    reviewDraft: completed.task.reviewDraft.split("\n")[0],
    fixtureRestored: true
  }, null, 2));
} finally {
  appServer.kill();
  fakeModelServer.close();
  await fs.writeFile(filterPath, originalFilter, "utf8").catch(() => null);
  await fs.writeFile(filterTestPath, originalFilterTest, "utf8").catch(() => null);
  await fs.rm(stateDir, { recursive: true, force: true });
}

function ensureContextPaths(files) {
  const paths = files.map((file) => file.path);
  const required = ["src/filters.js", "test/filters.test.js", "src/tasks.js"];
  const selected = [...required];
  for (const filePath of paths) {
    if (!selected.includes(filePath)) selected.push(filePath);
  }
  return selected.slice(0, 5);
}

function addPriorityFilter(content) {
  return content.replace(
    "    if (filters.assignee && task.assignee !== filters.assignee) return false;\n    return true;",
    "    if (filters.assignee && task.assignee !== filters.assignee) return false;\n    if (filters.priority && task.priority !== filters.priority) return false;\n    return true;"
  );
}

function addPriorityFilterTest(content) {
  const extra = [
    "",
    "test(\"filterTasks filters by priority\", () => {",
    "  const result = filterTasks(cloneTasks(), { priority: \"high\" });",
    "  assert.deepEqual(result.map((task) => task.id), [\"T-101\", \"T-104\"]);",
    "});",
    ""
  ].join("\n");
  return content.includes("filters by priority") ? content : `${content.endsWith("\n") ? content : `${content}\n`}${extra}`;
}

async function appRequest(url, body) {
  const response = await fetch(`${appBaseUrl}${url}`, {
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

async function waitForAppHealth() {
  for (let index = 0; index < 50; index += 1) {
    if (appServer.exitCode !== null) throw new Error(`CodeClaw server exited early.\n${appOutput}`);
    try {
      const health = await appRequest("/api/health");
      if (health.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`CodeClaw server did not become ready.\n${appOutput}`);
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
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
