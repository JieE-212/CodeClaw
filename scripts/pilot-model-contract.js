import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const rootPath = process.cwd();
const demoPath = path.join(rootPath, "examples", "demo-js");
const demoTestPath = path.join(demoPath, "test", "calculator.test.js");
const demoSourcePath = path.join(demoPath, "src", "calculator.js");
const originalTest = await fs.readFile(demoTestPath, "utf8");
const originalSource = await fs.readFile(demoSourcePath, "utf8");
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-model-contract-"));
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
  response.end(JSON.stringify({
    choices: [{ message: { role: "assistant", content } }]
  }));
});

await listen(fakeModelServer, modelPort);

const appServer = spawn(process.execPath, ["apps/web/server.js"], {
  cwd: rootPath,
  env: { ...process.env, CODECLAW_PORT: String(appPort), CODECLAW_STATE_DIR: stateDir },
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
    name: "contract-fake",
    baseUrl: modelBaseUrl,
    apiKey: "fake-key",
    model: "contract-model"
  });
  const scan = await appRequest("/api/repo/scan", { path: demoPath });

  modelResponses.push("Contract suggestion: read the calculator source and test before proposing a small change.");
  const workflowTask = await createTask(scan.profile, "add divide by zero test and verify the project", []);
  const taskSuggestion = await suggest(scan.profile, workflowTask.task.id, workflowTask.task.goal);
  assertIncludes(taskSuggestion.suggestion.content, "Contract suggestion", "suggestion content");

  modelResponses.push("Contract context note: read test/calculator.test.js first, then src/calculator.js if behavior is unclear.");
  const contextSuggestion = await suggestContext(scan.profile, workflowTask.task.id, workflowTask.task.goal);
  assertIncludes(contextSuggestion.suggestion.note, "Contract context note", "context note");
  if (!contextSuggestion.suggestion.files.some((file) => file.path === "test/calculator.test.js")) {
    throw new Error("context suggestion did not include test/calculator.test.js");
  }

  const results = [];
  const missingContextBefore = modelRequests.length;
  const missingContextTask = await createTask(scan.profile, "missing context should not call model", []);
  const missingContext = await propose(scan.profile, missingContextTask.task.id, missingContextTask.task.goal);
  assertEqual(missingContext.proposal.reason, "missing_context", "missing context reason");
  assertEqual(modelRequests.length, missingContextBefore, "missing context should not call fake model");
  results.push(resultFor("missing_context", missingContext.proposal));

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
  const good = await propose(scan.profile, goodTask.task.id, goodTask.task.goal);
  assertEqual(good.proposal.applicable, true, "good proposal should be applicable");
  assertEqual(good.proposal.path, "test/calculator.test.js", "good proposal path");
  results.push(resultFor("good_single_file_json", good.proposal));

  modelResponses.push("I would edit the test file, but this is not JSON.");
  const invalidJsonTask = await createTask(scan.profile, "bad json model output", ["test/calculator.test.js"]);
  const invalidJson = await propose(scan.profile, invalidJsonTask.task.id, invalidJsonTask.task.goal);
  assertEqual(invalidJson.proposal.reason, "invalid_json", "invalid JSON reason");
  results.push(resultFor("bad_json", invalidJson.proposal));

  modelResponses.push(JSON.stringify({
    path: "test/calculator.test.js",
    content: "--- a/test/calculator.test.js\n+++ b/test/calculator.test.js\n@@\n-old\n+new\n",
    summary: "Returns diff instead of full content."
  }));
  const diffTask = await createTask(scan.profile, "diff instead of full file", ["test/calculator.test.js"]);
  const diff = await propose(scan.profile, diffTask.task.id, diffTask.task.goal);
  assertEqual(diff.proposal.reason, "diff_instead_of_full_content", "diff content reason");
  results.push(resultFor("diff_instead_of_full_content", diff.proposal));

  modelResponses.push(JSON.stringify({ path: "test/calculator.test.js" }));
  const missingFieldsTask = await createTask(scan.profile, "missing fields", ["test/calculator.test.js"]);
  const missingFields = await propose(scan.profile, missingFieldsTask.task.id, missingFieldsTask.task.goal);
  assertEqual(missingFields.proposal.reason, "missing_fields", "missing fields reason");
  results.push(resultFor("missing_fields", missingFields.proposal));

  const changedSource = appendOnce(originalSource, "\n// Contract pilot source change candidate.\n");
  modelResponses.push(JSON.stringify({
    summary: "Change source and tests.",
    files: [
      { path: "src/calculator.js", content: changedSource, summary: "Add source comment candidate." },
      { path: "test/calculator.test.js", content: changedTest, summary: "Add divide by zero test candidate." }
    ]
  }));
  const multiTask = await createTask(scan.profile, "multi file json", ["src/calculator.js", "test/calculator.test.js"]);
  const multi = await propose(scan.profile, multiTask.task.id, multiTask.task.goal);
  assertEqual(multi.proposal.applicable, true, "multi-file proposal should be applicable");
  assertEqual(multi.proposal.files.length, 2, "multi-file proposal length");
  results.push(resultFor("multi_file_json", multi.proposal));

  const failingTest = originalTest.replace("assert.equal(divide(8, 2), 4);", "assert.equal(divide(8, 2), 5);");
  modelResponses.push(JSON.stringify({
    path: "test/calculator.test.js",
    content: failingTest,
    summary: "Create a controlled failing verification for the contract pilot."
  }));
  const failureTask = await createTask(scan.profile, "create controlled failure and ask for repair advice", ["test/calculator.test.js"]);
  const failingPatch = await propose(scan.profile, failureTask.task.id, failureTask.task.goal);
  assertEqual(failingPatch.proposal.applicable, true, "failing patch should be applicable");
  await appRequest("/api/tasks/apply-patch", { taskId: failureTask.task.id, approved: true });
  const failedVerification = await appRequest("/api/tools/call", { tool: "run_command", args: { command: "npm run test" }, rootPath: scan.profile.rootPath, taskId: failureTask.task.id, approved: true });
  if (failedVerification.result.exitCode === 0) throw new Error("controlled verification unexpectedly passed");
  modelResponses.push("Contract failure fix: inspect the changed assertion and restore the expected quotient to 4.");
  const failureFix = await fixFromFailure(scan.profile, failureTask.task.id);
  assertIncludes(failureFix.suggestion.content, "restore the expected quotient", "failure fix content");
  await appRequest("/api/tasks/revert-patch", { taskId: failureTask.task.id, patchIndex: 0, approved: true });

  assertEqual(modelResponses.length, 0, "all fake model responses consumed");
  assertEqual(modelRequests.length, 9, "fake model request count");

  const finalTest = await fs.readFile(demoTestPath, "utf8");
  const finalSource = await fs.readFile(demoSourcePath, "utf8");
  if (finalTest !== originalTest || finalSource !== originalSource) throw new Error("Model contract pilot changed demo files.");

  console.log(JSON.stringify({
    ok: true,
    appPort,
    modelPort,
    fakeModelRequests: modelRequests.length,
    workflow: {
      suggestion: taskSuggestion.suggestion.content.split("\n")[0],
      contextFiles: contextSuggestion.suggestion.files.map((file) => file.path).slice(0, 3),
      failureFix: failureFix.suggestion.content.split("\n")[0],
      controlledFailureExitCode: failedVerification.result.exitCode
    },
    cases: results,
    demoFilesUnchanged: true
  }, null, 2));
} finally {
  appServer.kill();
  fakeModelServer.close();
  await fs.rm(stateDir, { recursive: true, force: true });
}

async function createTask(repoProfile, goal, contextPaths) {
  const task = await appRequest("/api/tasks/create", { goal, rootPath: repoProfile.rootPath });
  for (const filePath of contextPaths) {
    await appRequest("/api/tools/call", { tool: "read_file", args: { path: filePath }, rootPath: repoProfile.rootPath, taskId: task.task.id });
  }
  return task;
}

async function propose(repoProfile, taskId, goal) {
  return appRequest("/api/model/patch-proposal", { goal, repoProfile, rootPath: repoProfile.rootPath, taskId });
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

async function suggest(repoProfile, taskId, goal) {
  return appRequest("/api/model/suggest", { goal, repoProfile, rootPath: repoProfile.rootPath, taskId });
}

async function suggestContext(repoProfile, taskId, goal) {
  return appRequest("/api/model/context-files", { goal, repoProfile, rootPath: repoProfile.rootPath, taskId });
}

async function fixFromFailure(repoProfile, taskId) {
  return appRequest("/api/model/fix-from-failure", { rootPath: repoProfile.rootPath, taskId });
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
