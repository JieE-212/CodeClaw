import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { findAvailablePort, listenOnLoopback, withAutomationResources } from "./automation-resource-scope.js";
import { previewAndApproveModelOperation } from "./model-operation-client.js";

const rootPath = process.cwd();
const fixturePath = path.join(rootPath, "examples", "support-inbox-js");
const apiPath = path.join(fixturePath, "src", "api.js");
const inboxPath = path.join(fixturePath, "src", "inbox.js");
const inboxTestPath = path.join(fixturePath, "test", "inbox.test.js");
let originalApi = "";
let originalInbox = "";
let originalInboxTest = "";
let stateDir = "";
let copyRoot = "";
let appPort = 0;
let modelPort = 0;
let appBaseUrl = "";
let modelBaseUrl = "";
let fakeModelServer = null;
let appServer = null;
let appOutput = "";
const modelResponses = [];
const modelRequests = [];

await withAutomationResources(async (scope) => {
  stateDir = await scope.temporaryDirectory("codeclaw-inbox-fixture-");
  copyRoot = await scope.temporaryDirectory("codeclaw-inbox-copies-");
  originalApi = await fs.readFile(apiPath, "utf8");
  originalInbox = await fs.readFile(inboxPath, "utf8");
  originalInboxTest = await fs.readFile(inboxTestPath, "utf8");
  scope.defer("restore support-inbox test fixture", () => restoreFileIfChanged(inboxTestPath, originalInboxTest));
  scope.defer("restore support-inbox state fixture", () => restoreFileIfChanged(inboxPath, originalInbox));
  scope.defer("restore support-inbox API fixture", () => restoreFileIfChanged(apiPath, originalApi));
  appPort = await findAvailablePort();
  modelPort = await findAvailablePort();
  appBaseUrl = `http://127.0.0.1:${appPort}`;
  modelBaseUrl = `http://127.0.0.1:${modelPort}/v1`;
  fakeModelServer = scope.server(createFakeModelServer(), "support-inbox fake model server");
  await listenOnLoopback(fakeModelServer, modelPort);
  appServer = scope.child(spawn(process.execPath, ["apps/web/server.js"], {
    cwd: rootPath,
    env: {
      ...process.env,
      CODECLAW_PORT: String(appPort),
      CODECLAW_STATE_DIR: stateDir,
      CODECLAW_PROJECT_LOCK_DIR: path.join(stateDir, "project-locks"),
      CODECLAW_DISPOSABLE_ROOT: copyRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }), "CodeClaw support-inbox pilot server");
  appServer.stdout.on("data", (chunk) => {
    appOutput += String(chunk);
  });
  appServer.stderr.on("data", (chunk) => {
    appOutput += String(chunk);
  });

  await waitForAppHealth();
  await appRequest("/api/model/config", {
    type: "openai-compatible",
    name: "inbox-fixture-fake",
    baseUrl: modelBaseUrl,
    apiKey: "fake-key",
    model: "inbox-fixture-model"
  });

  const disposableWorkspace = await createActivatedDisposableCopy(fixturePath);
  const scan = await appRequest("/api/repo/scan", { path: disposableWorkspace.rootPath });
  const task = await appRequest("/api/tasks/create", {
    rootPath: scan.profile.rootPath,
    goal: "add channel filtering to the support inbox API and view state"
  });
  const plan = await appRequest("/api/agent/plan", {
    goal: task.task.goal,
    repoProfile: scan.profile,
    taskId: task.task.id
  });

  modelResponses.push("Read src/api.js, src/inbox.js, test/inbox.test.js, and src/tickets.js before adding channel filtering.");
  const context = (await previewAndApproveModelOperation(appRequest, {
    operation: "context-files",
    taskId: task.task.id
  })).result;
  const selectedPaths = ensureContextPaths(context.files);
  for (const filePath of selectedPaths) {
    await appRequest("/api/tools/call", {
      tool: "read_file",
      args: { path: filePath },
      rootPath: scan.profile.rootPath,
      taskId: task.task.id
    });
  }

  modelResponses.push(JSON.stringify({
    summary: "Add channel filtering across API and inbox state.",
    files: [
      {
        path: "src/api.js",
        content: addApiChannelFilter(originalApi),
        summary: "Respect filters.channel in listTickets."
      },
      {
        path: "src/inbox.js",
        content: addInboxChannelFilter(originalInbox),
        summary: "Respect filters.channel in selectInboxTickets."
      },
      {
        path: "test/inbox.test.js",
        content: addInboxChannelTests(originalInboxTest),
        summary: "Cover channel filtering in selection and state rows."
      }
    ]
  }));

  const proposal = (await previewAndApproveModelOperation(appRequest, {
    operation: "patch-proposal",
    taskId: task.task.id
  })).result;
  if (!proposal.applicable) throw new Error(`Inbox fixture proposal was not applicable: ${proposal.reason}`);
  if (proposal.files.length !== 3) throw new Error("Inbox fixture proposal should update three files.");

  const applied = await appRequest("/api/tasks/apply-patch", { taskId: task.task.id, proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, approved: true });
  const verification = await appRequest("/api/tools/call", {
    tool: "run_command",
    args: { command: "npm run test" },
    rootPath: scan.profile.rootPath,
    taskId: task.task.id,
    approved: true
  });
  if (verification.result.exitCode !== 0) throw new Error("Inbox fixture verification failed.");

  const completed = await appRequest("/api/tasks/complete", { taskId: task.task.id });

  for (let index = proposal.files.length - 1; index >= 0; index -= 1) {
    await appRequest("/api/tasks/revert-patch", { taskId: task.task.id, patchIndex: index, patchIdentity: applied.task.appliedPatches[index].patchIdentity, workspaceIdentity: applied.task.rootIdentity, approved: true });
  }

  const finalCopyApi = await fs.readFile(path.join(disposableWorkspace.rootPath, "src", "api.js"), "utf8");
  const finalCopyInbox = await fs.readFile(path.join(disposableWorkspace.rootPath, "src", "inbox.js"), "utf8");
  const finalCopyInboxTest = await fs.readFile(path.join(disposableWorkspace.rootPath, "test", "inbox.test.js"), "utf8");
  if (finalCopyApi !== originalApi || finalCopyInbox !== originalInbox || finalCopyInboxTest !== originalInboxTest) {
    throw new Error("Inbox fixture pilot did not restore disposable-copy files after revert.");
  }
  const finalSourceApi = await fs.readFile(apiPath, "utf8");
  const finalSourceInbox = await fs.readFile(inboxPath, "utf8");
  const finalSourceInboxTest = await fs.readFile(inboxTestPath, "utf8");
  if (finalSourceApi !== originalApi || finalSourceInbox !== originalInbox || finalSourceInboxTest !== originalInboxTest) {
    throw new Error("Inbox fixture pilot changed its source fixture instead of the disposable copy.");
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
    patchFiles: proposal.files.map((file) => file.path),
    verificationExitCode: verification.result.exitCode,
    reviewDraft: completed.task.reviewDraft.split("\n")[0],
    workspaceKind: disposableWorkspace.kind,
    disposableCopyRestored: true,
    sourceFixtureUnchanged: true
  }, null, 2));
});

function createFakeModelServer() {
  return http.createServer(async (request, response) => {
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
}

async function createActivatedDisposableCopy(sourcePath) {
  const previewResult = await appRequest("/api/workspaces/copy/preview", { sourcePath });
  const preview = previewResult.preview;
  if (!preview?.eligible || preview.blockers?.length) {
    throw new Error(`Inbox disposable-copy preview was blocked (${preview?.blockers?.length || 0} blocker(s)).`);
  }
  const created = await appRequest("/api/workspaces/copy/create", {
    previewId: preview.previewId,
    previewDigest: preview.previewDigest
  });
  if (created.workspace?.active) throw new Error("Creating a disposable copy must not activate it automatically.");
  const activated = await appRequest("/api/workspaces/activate", {
    workspaceId: created.workspace.id,
    workspaceDigest: created.workspace.workspaceDigest
  });
  if (activated.workspace?.kind !== "disposable-copy"
    || activated.workspace.active !== true
    || activated.workspace.canWrite !== true
    || activated.workspace.canRunCommands !== true) {
    throw new Error("Inbox disposable copy did not receive an activated server capability.");
  }
  return activated.workspace;
}

function ensureContextPaths(files) {
  const paths = files.map((file) => file.path);
  const required = ["src/api.js", "src/inbox.js", "test/inbox.test.js", "src/tickets.js"];
  const selected = [...required];
  for (const filePath of paths) {
    if (!selected.includes(filePath)) selected.push(filePath);
  }
  return selected.slice(0, 6);
}

function addApiChannelFilter(content) {
  return content.replace(
    "    if (filters.assignee && ticket.assignee !== filters.assignee) return false;\n    return true;",
    "    if (filters.assignee && ticket.assignee !== filters.assignee) return false;\n    if (filters.channel && ticket.channel !== filters.channel) return false;\n    return true;"
  );
}

function addInboxChannelFilter(content) {
  return content.replace(
    "    if (filters.assignee && ticket.assignee !== filters.assignee) return false;\n    if (filters.unreadOnly && !ticket.unread) return false;",
    "    if (filters.assignee && ticket.assignee !== filters.assignee) return false;\n    if (filters.channel && ticket.channel !== filters.channel) return false;\n    if (filters.unreadOnly && !ticket.unread) return false;"
  );
}

function addInboxChannelTests(content) {
  const extra = [
    "",
    "test(\"selectInboxTickets filters by channel\", () => {",
    "  const result = selectInboxTickets(cloneTickets(), { channel: \"chat\" });",
    "  assert.deepEqual(result.map((ticket) => ticket.id), [\"S-1002\", \"S-1003\"]);",
    "});",
    "",
    "test(\"createInboxState keeps channel-filtered rows and counters\", () => {",
    "  const state = createInboxState(cloneTickets(), { channel: \"email\", unreadOnly: true });",
    "  assert.equal(state.total, 1);",
    "  assert.equal(state.unread, 1);",
    "  assert.deepEqual(state.rows.map((row) => row.id), [\"S-1001\"]);",
    "});",
    ""
  ].join("\n");
  return content.includes("filters by channel") ? content : `${content.endsWith("\n") ? content : `${content}\n`}${extra}`;
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

async function restoreFileIfChanged(filePath, expected) {
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current !== expected) await fs.writeFile(filePath, expected, "utf8");
}
