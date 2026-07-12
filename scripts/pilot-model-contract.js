import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { findAvailablePort, listenOnLoopback, withAutomationResources } from "./automation-resource-scope.js";
import { previewAndApproveModelOperation } from "./model-operation-client.js";

const rootPath = process.cwd();
const demoPath = path.join(rootPath, "examples", "demo-js");
const demoTestPath = path.join(demoPath, "test", "calculator.test.js");
const demoSourcePath = path.join(demoPath, "src", "calculator.js");
let originalTest = "";
let originalSource = "";
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
let previewNoSendChecks = 0;
let exactBodyChecks = 0;

await withAutomationResources(async (scope) => {
  stateDir = await scope.temporaryDirectory("codeclaw-model-contract-");
  copyRoot = await scope.temporaryDirectory("codeclaw-model-contract-copies-");
  originalTest = await fs.readFile(demoTestPath, "utf8");
  originalSource = await fs.readFile(demoSourcePath, "utf8");
  scope.defer("restore model-contract source fixture", () => restoreFileIfChanged(demoSourcePath, originalSource));
  scope.defer("restore model-contract test fixture", () => restoreFileIfChanged(demoTestPath, originalTest));
  appPort = await findAvailablePort();
  modelPort = await findAvailablePort();
  appBaseUrl = `http://127.0.0.1:${appPort}`;
  modelBaseUrl = `http://127.0.0.1:${modelPort}/v1`;
  fakeModelServer = scope.server(createFakeModelServer(), "model-contract fake model server");
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
  }), "CodeClaw model-contract pilot server");
  appServer.stdout.on("data", (chunk) => {
    appOutput += String(chunk);
  });
  appServer.stderr.on("data", (chunk) => {
    appOutput += String(chunk);
  });

  await waitForAppHealth();
  await appRequest("/api/model/config", {
    type: "openai-compatible",
    name: "contract-fake",
    baseUrl: modelBaseUrl,
    apiKey: "fake-key",
    model: "contract-model"
  });
  const disposableWorkspace = await createActivatedDisposableCopy(demoPath);
  const scan = await appRequest("/api/repo/scan", { path: disposableWorkspace.rootPath });

  modelResponses.push("Contract suggestion: read the calculator source and test before proposing a small change.");
  const workflowTask = await createTask(scan.profile, "add divide by zero test and verify the project", []);
  const taskSuggestion = await runModelOperation("task-suggest", workflowTask.task.id);
  assertIncludes(taskSuggestion.content, "Contract suggestion", "suggestion content");

  modelResponses.push("Contract context note: read test/calculator.test.js first, then src/calculator.js if behavior is unclear.");
  const contextSuggestion = await runModelOperation("context-files", workflowTask.task.id);
  assertIncludes(contextSuggestion.note, "Contract context note", "context note");
  if (!contextSuggestion.files.some((file) => file.path === "test/calculator.test.js")) {
    throw new Error("context suggestion did not include test/calculator.test.js");
  }

  const results = [];
  const missingContextBefore = modelRequests.length;
  const missingContextTask = await createTask(scan.profile, "missing context should not call model", []);
  const missingContext = await runModelOperation("patch-proposal", missingContextTask.task.id);
  assertEqual(missingContext.reason, "missing_context", "missing context reason");
  assertEqual(modelRequests.length, missingContextBefore, "missing context should not call fake model");
  results.push(resultFor("missing_context", missingContext));

  const changedTest = appendOnce(originalTest, [
    "",
    "test(\"divide throws on zero denominator\", () => {",
    "  assert.throws(() => divide(1, 0), /Cannot divide by zero/);",
    "});",
    ""
  ].join("\n"));
  modelResponses.push(JSON.stringify({
    path: "test/calculator.test.js",
    content: changedTest,
    summary: "Add divide by zero test."
  }));
  const goodTask = await createTask(scan.profile, "good single file json", ["test/calculator.test.js"]);
  const good = await runModelOperation("patch-proposal", goodTask.task.id);
  assertEqual(good.applicable, true, "good proposal should be applicable");
  assertEqual(good.path, "test/calculator.test.js", "good proposal path");
  results.push(resultFor("good_single_file_json", good));

  modelResponses.push("I would edit the test file, but this is not JSON.");
  const invalidJsonTask = await createTask(scan.profile, "bad json model output", ["test/calculator.test.js"]);
  const invalidJson = await runModelOperation("patch-proposal", invalidJsonTask.task.id);
  assertEqual(invalidJson.reason, "invalid_json", "invalid JSON reason");
  results.push(resultFor("bad_json", invalidJson));

  modelResponses.push(JSON.stringify({
    path: "test/calculator.test.js",
    content: "--- a/test/calculator.test.js\n+++ b/test/calculator.test.js\n@@\n-old\n+new\n",
    summary: "Returns diff instead of full content."
  }));
  const diffTask = await createTask(scan.profile, "diff instead of full file", ["test/calculator.test.js"]);
  const diff = await runModelOperation("patch-proposal", diffTask.task.id);
  assertEqual(diff.reason, "diff_instead_of_full_content", "diff content reason");
  results.push(resultFor("diff_instead_of_full_content", diff));

  modelResponses.push(JSON.stringify({ path: "test/calculator.test.js" }));
  const missingFieldsTask = await createTask(scan.profile, "missing fields", ["test/calculator.test.js"]);
  const missingFields = await runModelOperation("patch-proposal", missingFieldsTask.task.id);
  assertEqual(missingFields.reason, "missing_fields", "missing fields reason");
  results.push(resultFor("missing_fields", missingFields));

  const changedSource = appendOnce(originalSource, "\n// Contract pilot source change candidate.\n");
  modelResponses.push(JSON.stringify({
    summary: "Change source and tests.",
    files: [
      { path: "src/calculator.js", content: changedSource, summary: "Add source comment candidate." },
      { path: "test/calculator.test.js", content: changedTest, summary: "Add divide by zero test candidate." }
    ]
  }));
  const multiTask = await createTask(scan.profile, "multi file json", ["src/calculator.js", "test/calculator.test.js"]);
  const multi = await runModelOperation("patch-proposal", multiTask.task.id);
  assertEqual(multi.applicable, true, "multi-file proposal should be applicable");
  assertEqual(multi.files.length, 2, "multi-file proposal length");
  results.push(resultFor("multi_file_json", multi));

  const failingTest = originalTest.replace("assert.equal(divide(8, 2), 4);", "assert.equal(divide(8, 2), 5);");
  modelResponses.push(JSON.stringify({
    path: "test/calculator.test.js",
    content: failingTest,
    summary: "Create a controlled failing verification for the contract pilot."
  }));
  const failureTask = await createTask(scan.profile, "create controlled failure and ask for repair advice", ["test/calculator.test.js"]);
  const failingPatch = await runModelOperation("patch-proposal", failureTask.task.id);
  assertEqual(failingPatch.applicable, true, "failing patch should be applicable");
  const appliedFailure = await appRequest("/api/tasks/apply-patch", { taskId: failureTask.task.id, proposalId: failingPatch.proposalId, proposalDigest: failingPatch.proposalDigest, approved: true });
  const failedVerification = await appRequest("/api/tools/call", { tool: "run_command", args: { command: "npm run test" }, rootPath: scan.profile.rootPath, taskId: failureTask.task.id, approved: true });
  if (failedVerification.result.exitCode === 0) throw new Error("controlled verification unexpectedly passed");
  await appRequest("/api/tools/call", {
    tool: "read_file",
    args: { path: "test/calculator.test.js" },
    rootPath: scan.profile.rootPath,
    taskId: failureTask.task.id
  });
  modelResponses.push("Contract failure fix: inspect the changed assertion and restore the expected quotient to 4.");
  const failureFix = await runModelOperation("failure-fix", failureTask.task.id);
  assertIncludes(failureFix.content, "restore the expected quotient", "failure fix content");
  await appRequest("/api/tasks/revert-patch", { taskId: failureTask.task.id, patchIndex: 0, patchIdentity: appliedFailure.task.appliedPatches[0].patchIdentity, workspaceIdentity: appliedFailure.task.rootIdentity, approved: true });

  assertEqual(modelResponses.length, 0, "all fake model responses consumed");
  assertEqual(modelRequests.length, 9, "fake model request count");
  assertEqual(exactBodyChecks, 9, "exact preview-to-wire body checks");
  const mockResults = await verifyAllMockOperations(scan.profile);
  assertEqual(modelRequests.length, 9, "Mock operations must not call fake model server");

  const finalCopyTest = await fs.readFile(path.join(disposableWorkspace.rootPath, "test", "calculator.test.js"), "utf8");
  const finalCopySource = await fs.readFile(path.join(disposableWorkspace.rootPath, "src", "calculator.js"), "utf8");
  if (finalCopyTest !== originalTest || finalCopySource !== originalSource) {
    throw new Error("Model contract pilot did not restore disposable-copy files after revert.");
  }
  const finalSourceTest = await fs.readFile(demoTestPath, "utf8");
  const finalSourceCode = await fs.readFile(demoSourcePath, "utf8");
  if (finalSourceTest !== originalTest || finalSourceCode !== originalSource) {
    throw new Error("Model contract pilot changed its source fixture instead of the disposable copy.");
  }

  console.log(JSON.stringify({
    ok: true,
    appPort,
    modelPort,
    fakeModelRequests: modelRequests.length,
    previewNoSendChecks,
    exactBodyChecks,
    mockOperations: mockResults,
    workflow: {
      suggestion: taskSuggestion.content.split("\n")[0],
      contextFiles: contextSuggestion.files.map((file) => file.path).slice(0, 3),
      failureFix: failureFix.content.split("\n")[0],
      controlledFailureExitCode: failedVerification.result.exitCode
    },
    cases: results,
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
    const rawBody = await readRequestBody(request);
    modelRequests.push(rawBody);
    const content = modelResponses.shift();
    if (typeof content !== "string") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "no queued fake model response" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content } }]
    }));
  });
}

async function createActivatedDisposableCopy(sourcePath) {
  const previewResult = await appRequest("/api/workspaces/copy/preview", { sourcePath });
  const preview = previewResult.preview;
  if (!preview?.eligible || preview.blockers?.length) {
    throw new Error(`Model-contract disposable-copy preview was blocked (${preview?.blockers?.length || 0} blocker(s)).`);
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
    throw new Error("Model-contract disposable copy did not receive an activated server capability.");
  }
  return activated.workspace;
}

async function createTask(repoProfile, goal, contextPaths) {
  const task = await appRequest("/api/tasks/create", { goal, rootPath: repoProfile.rootPath });
  for (const filePath of contextPaths) {
    await appRequest("/api/tools/call", { tool: "read_file", args: { path: filePath }, rootPath: repoProfile.rootPath, taskId: task.task.id });
  }
  return task;
}

async function runModelOperation(operation, taskId) {
  const requestsBeforePreview = modelRequests.length;
  const approved = await previewAndApproveModelOperation(appRequest, {
    operation,
    taskId,
    inspectPreview(preview) {
      assertEqual(modelRequests.length, requestsBeforePreview, `${operation} preview must not call fake model`);
      assertEqual(Buffer.byteLength(preview.request.bodyUtf8, "utf8"), preview.request.byteLength, `${operation} preview byte length`);
      previewNoSendChecks += 1;
    }
  });

  const sendsRequest = approved.preview.request.channel !== "local";
  assertEqual(
    modelRequests.length,
    requestsBeforePreview + (sendsRequest ? 1 : 0),
    `${operation} approved send request count`
  );
  if (sendsRequest) {
    const capturedBody = modelRequests[requestsBeforePreview];
    const reviewedBody = Buffer.from(approved.preview.request.bodyUtf8, "utf8");
    if (!reviewedBody.equals(capturedBody)) {
      throw new Error(`${operation} approved request bytes differed from the reviewed preview.`);
    }
    exactBodyChecks += 1;
  }
  return approved.result;
}

function resultFor(name, proposal) {
  return {
    name,
    applicable: Boolean(proposal.applicable),
    reason: proposal.reason || "",
    path: proposal.path || null,
    files: proposal.files?.length || 0
  };
}

async function verifyAllMockOperations(repoProfile) {
  const networkRequestsBeforeMock = modelRequests.length;
  await appRequest("/api/model/config", {
    type: "mock",
    name: "mock",
    baseUrl: "",
    apiKey: "",
    model: "mock-codeclaw"
  });

  const suggestionTask = await createTask(repoProfile, "explain a safe next step", []);
  const suggestion = await runModelOperation("task-suggest", suggestionTask.task.id);

  const contextTask = await createTask(repoProfile, "find calculator source and tests", []);
  const context = await runModelOperation("context-files", contextTask.task.id);

  const patchTask = await createTask(repoProfile, "add divide by zero test", ["test/calculator.test.js"]);
  const proposal = await runModelOperation("patch-proposal", patchTask.task.id);

  const failureTask = await createTask(repoProfile, "suggest how to fix a failed calculator test", []);
  const failureFix = await runModelOperation("failure-fix", failureTask.task.id);

  assertEqual(modelRequests.length, networkRequestsBeforeMock, "all Mock operations must remain local");
  assertIncludes(suggestion.content, "Mock suggestion", "Mock task suggestion");
  if (!Array.isArray(context.files) || !context.files.length) throw new Error("Mock context operation returned no candidates.");
  assertEqual(proposal.applicable, true, "Mock patch proposal should be applicable");
  assertIncludes(failureFix.content, "Mock failure fix suggestion", "Mock failure fix");
  return [
    { operation: "task-suggest", local: true },
    { operation: "context-files", local: true },
    { operation: "patch-proposal", local: true },
    { operation: "failure-fix", local: true }
  ];
}

function appendOnce(content, extra) {
  return content.includes(extra.trim().split("\n")[0]) ? content : `${content.endsWith("\n") ? content : `${content}\n`}${extra}`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(actual, expected, label) {
  if (!String(actual || "").includes(expected)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
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

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function restoreFileIfChanged(filePath, expected) {
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current !== expected) await fs.writeFile(filePath, expected, "utf8");
}
