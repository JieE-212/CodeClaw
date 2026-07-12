import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { TaskStore } from "../packages/task-store/src/index.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../packages/shared/src/cross-process-lock.js";

const SOURCE_ONLY_SENTINEL = "SOURCE_ONLY_BODY_MUST_NOT_PERSIST";

test("startup replaces an invalid credential-bearing model config with a keyless Mock config", async (t) => {
  const fixture = await createFixture("invalid-config-migration");
  let server;
  t.after(() => cleanupFixture(server, fixture));
  await fs.mkdir(fixture.stateDir, { recursive: true });
  await fs.writeFile(path.join(fixture.stateDir, "model.json"), JSON.stringify({
    schemaVersion: 0,
    type: "unsupported-provider",
    name: "unsafe",
    baseUrl: "https://example.invalid/v1",
    model: "unsafe-model",
    apiKey: "INVALID_MODEL_KEY_MUST_BE_REMOVED"
  }, null, 2), "utf8");

  server = await startCodeClaw(fixture);
  const status = await request(server.baseUrl, "/api/model/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.config.type, "mock");
  assert.equal(status.payload.status.configured, true);
  const persisted = await fs.readFile(path.join(fixture.stateDir, "model.json"), "utf8");
  assert.doesNotMatch(persisted, /INVALID_MODEL_KEY_MUST_BE_REMOVED|apiKey|unsupported-provider/);
  assert.deepEqual(JSON.parse(persisted), {
    schemaVersion: 1,
    type: "mock",
    name: "mock",
    baseUrl: "",
    model: "mock-codeclaw"
  });
});

test("startup atomically removes extra fields from an otherwise valid model config", async (t) => {
  const fixture = await createFixture("canonical-config-migration");
  let server;
  t.after(() => cleanupFixture(server, fixture));
  const sentinel = "EXTRA_AUTHORIZATION_FIELD_MUST_BE_REMOVED";
  await fs.mkdir(fixture.stateDir, { recursive: true });
  await fs.writeFile(path.join(fixture.stateDir, "model.json"), JSON.stringify({
    schemaVersion: 1,
    type: "openai-compatible",
    name: "local-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model",
    authorization: `Bearer ${sentinel}`
  }, null, 2), "utf8");

  server = await startCodeClaw(fixture);
  const status = await request(server.baseUrl, "/api/model/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.config.type, "openai-compatible");
  assert.equal(status.payload.config.name, "local-compatible");
  assert.equal(status.payload.config.baseUrl, "http://127.0.0.1:11434/v1");
  assert.equal(status.payload.config.model, "local-model");
  assert.equal(status.payload.config.apiKey, "");
  assert.equal(status.payload.config.apiKeyConfigured, false);
  const persisted = await fs.readFile(path.join(fixture.stateDir, "model.json"), "utf8");
  assert.doesNotMatch(persisted, new RegExp(`${sentinel}|authorization`));
  assert.deepEqual(JSON.parse(persisted), {
    schemaVersion: 1,
    type: "openai-compatible",
    name: "local-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model"
  });
});

test("empty-model endpoint validation rejects and scrubs credential-bearing URLs", async (t) => {
  const liveFixture = await createFixture("empty-model-url-live");
  const startupFixture = await createFixture("empty-model-url-startup");
  const mockStartupFixture = await createFixture("mock-url-startup");
  let liveServer;
  let startupServer;
  let mockStartupServer;
  t.after(async () => {
    await cleanupFixture(liveServer, liveFixture);
    await cleanupFixture(startupServer, startupFixture);
    await cleanupFixture(mockStartupServer, mockStartupFixture);
  });

  liveServer = await startCodeClaw(liveFixture);
  const liveSentinel = "QUERY_CREDENTIAL_MUST_NOT_PERSIST";
  const rejected = await request(liveServer.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "custom",
    baseUrl: `https://models.example/v1?api_key=${liveSentinel}`,
    model: "",
    apiKey: ""
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.payload.code, "MODEL_CONFIG_ENDPOINT_INVALID");
  assert.doesNotMatch(await readStateFiles(liveFixture), new RegExp(liveSentinel));
  const mockSentinel = "MOCK_URL_SECRET_MUST_NOT_PERSIST";
  const normalizedMock = await request(liveServer.baseUrl, "/api/model/config", {
    type: "mock",
    name: "mock",
    baseUrl: `https://unused.invalid/?token=${mockSentinel}`,
    model: "mock-codeclaw",
    apiKey: ""
  });
  assert.equal(normalizedMock.response.status, 200);
  assert.equal(normalizedMock.payload.config.baseUrl, "");
  assert.doesNotMatch(await readStateFiles(liveFixture), new RegExp(mockSentinel));

  const startupSentinel = "STARTUP_QUERY_CREDENTIAL_MUST_BE_REMOVED";
  await fs.mkdir(startupFixture.stateDir, { recursive: true });
  await fs.writeFile(path.join(startupFixture.stateDir, "model.json"), JSON.stringify({
    schemaVersion: 1,
    type: "openai-compatible",
    name: "custom",
    baseUrl: `https://models.example/v1?api_key=${startupSentinel}`,
    model: ""
  }, null, 2), "utf8");
  startupServer = await startCodeClaw(startupFixture);
  const status = await request(startupServer.baseUrl, "/api/model/status");
  assert.equal(status.payload.config.type, "mock");
  const persisted = await fs.readFile(path.join(startupFixture.stateDir, "model.json"), "utf8");
  assert.doesNotMatch(persisted, new RegExp(`${startupSentinel}|api_key`));
  assert.equal(JSON.parse(persisted).schemaVersion, 1);

  const mockStartupSentinel = "MOCK_STARTUP_URL_SECRET_MUST_BE_REMOVED";
  await fs.mkdir(mockStartupFixture.stateDir, { recursive: true });
  await fs.writeFile(path.join(mockStartupFixture.stateDir, "model.json"), JSON.stringify({
    schemaVersion: 1,
    type: "mock",
    name: "mock",
    baseUrl: `https://unused.invalid/?token=${mockStartupSentinel}`,
    model: "mock-codeclaw"
  }, null, 2), "utf8");
  mockStartupServer = await startCodeClaw(mockStartupFixture);
  const mockStatus = await request(mockStartupServer.baseUrl, "/api/model/status");
  assert.equal(mockStatus.payload.config.baseUrl, "");
  assert.doesNotMatch(
    await fs.readFile(path.join(mockStartupFixture.stateDir, "model.json"), "utf8"),
    new RegExp(mockStartupSentinel)
  );
});

test("ignored manifests cannot contribute derived metadata to an outbound preview", async (t) => {
  const fixture = await createFixture("ignored-manifest-metadata");
  let server;
  t.after(() => cleanupFixture(server, fixture));
  await fs.writeFile(path.join(fixture.project, ".gitignore"), "package.json\nignored.js\n", "utf8");
  await fs.writeFile(path.join(fixture.project, "package.json"), JSON.stringify({
    scripts: { test: "IGNORED_SCRIPT_SENTINEL" },
    dependencies: { react: "IGNORED_DEPENDENCY_SENTINEL" }
  }), "utf8");
  server = await startCodeClaw(fixture);

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Suggest the next safe task"
  });
  assert.equal(preflight.response.status, 200);
  assert.deepEqual(preflight.payload.report.commands, []);
  assert.equal(preflight.payload.profile.frameworks.includes("React"), false);
  assert.equal(preflight.payload.profile.packageManagers.includes("npm"), false);
  const preview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId: preflight.payload.task.id
  })).payload.preview;
  assert.doesNotMatch(preview.request.bodyUtf8, /IGNORED_SCRIPT_SENTINEL|IGNORED_DEPENDENCY_SENTINEL|npm run test|React/);
  assert.deepEqual(preview.disclosure.files, []);
});

test("a provider cannot turn the process credential into durable patch content", async (t) => {
  const fixture = await createFixture("credential-reflection");
  const apiKey = "MODEL_API_KEY_ECHO_MUST_NOT_PERSIST";
  const original = await fs.readFile(path.join(fixture.project, "src", "calculator.js"), "utf8");
  const reflectedPatch = JSON.stringify({
    path: "src/calculator.js",
    content: `${original}// ${apiKey}\n`,
    summary: "A malicious reflected patch."
  });
  let fakeModel;
  let server;
  t.after(async () => {
    await cleanupFixture(server, fixture);
    await stopHttpServer(fakeModel?.server);
  });
  fakeModel = await startStaticModel(reflectedPatch);
  server = await startCodeClaw(fixture);
  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Update the calculator implementation"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  await readTaskFile(server, fixture, taskId, "src/calculator.js");
  const configured = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "credential-echo",
    baseUrl: `http://127.0.0.1:${fakeModel.port}/v1`,
    model: "test-model",
    apiKey
  });
  assert.equal(configured.response.status, 200);

  const preview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "patch-proposal",
    taskId
  })).payload.preview;
  assert.doesNotMatch(preview.request.bodyUtf8, new RegExp(apiKey));
  const sent = await approvePreview(server, preview);
  assert.equal(sent.response.status, 502);
  assert.equal(sent.payload.code, "MODEL_RESPONSE_CREDENTIAL_REFLECTION");
  assert.doesNotMatch(JSON.stringify(sent.payload), new RegExp(apiKey));
  assert.equal(fakeModel.authorization, `Bearer ${apiKey}`);
  const task = await new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") }).get(taskId);
  assert.equal(task.patchProposal, null);
  assert.equal(task.modelEvents.at(-1).status, "error");
  assert.doesNotMatch(await readStateFiles(fixture), new RegExp(apiKey));
});

test("upstream success and redirect statuses remain local 502 errors after an approved send", async (t) => {
  const fixture = await createFixture("upstream-status-boundary");
  let fakeModel;
  let server;
  t.after(async () => {
    await cleanupFixture(server, fixture);
    await stopHttpServer(fakeModel?.server);
  });
  fakeModel = await startRawModel([
    { status: 204, headers: { "content-type": "application/json" }, body: "" },
    { status: 304, headers: { "content-type": "application/json", location: "http://169.254.169.254/latest" }, body: "" }
  ]);
  server = await startCodeClaw(fixture);
  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Suggest the next safe task"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  const configured = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "status-boundary",
    baseUrl: `http://127.0.0.1:${fakeModel.port}/v1`,
    model: "test-model",
    apiKey: "status-boundary-key"
  });
  assert.equal(configured.response.status, 200);

  for (const expectedCode of ["response_not_json", "redirect_blocked"]) {
    const previewResult = await request(server.baseUrl, "/api/model/preview", {
      operation: "task-suggest",
      taskId
    });
    assert.equal(previewResult.response.status, 200);
    const preview = previewResult.payload.preview;
    const sent = await approvePreview(server, preview);
    assert.equal(sent.response.status, 502);
    assert.equal(sent.payload.ok, false);
    assert.equal(sent.payload.code, expectedCode);
    assertPreviewConsumed(await approvePreview(server, preview));
  }

  assert.equal(fakeModel.requestCount, 2);
  const task = await new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") }).get(taskId);
  assert.equal(task.patchProposal, null);
  assert.deepEqual(task.modelEvents.map((event) => event.status), ["error", "error"]);
});

test("Mock patch send stores the applicable proposal and minimized event in one task revision", async (t) => {
  const fixture = await createFixture("mock-patch");
  let server;
  t.after(() => cleanupFixture(server, fixture));
  server = await startCodeClaw(fixture);

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Add a divide-by-zero test and verify the project"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  const sourceRead = await readTaskFile(server, fixture, taskId, "src/calculator.js");
  assert.match(sourceRead.payload.result, new RegExp(SOURCE_ONLY_SENTINEL));
  const testRead = await readTaskFile(server, fixture, taskId, "test/calculator.test.js");
  const revisionBeforeSend = testRead.payload.task.revision;

  const previewResult = await request(server.baseUrl, "/api/model/preview", {
    operation: "patch-proposal",
    taskId
  });
  assert.equal(previewResult.response.status, 200);
  const preview = previewResult.payload.preview;
  const requestBytes = Buffer.from(preview.request.bodyUtf8, "utf8");
  assert.equal(preview.request.channel, "local");
  assert.equal(preview.request.willLeaveDevice, false);
  assert.equal(preview.request.endpoint, null);
  assert.equal(preview.request.byteLength, requestBytes.byteLength);
  assert.equal(preview.request.sha256, digest(requestBytes));
  assert.match(preview.request.bodyUtf8, new RegExp(SOURCE_ONLY_SENTINEL));
  assert.deepEqual(preview.disclosure.dataClasses, [
    "goal",
    "repository-name",
    "context-file-paths",
    "context-file-content"
  ]);
  assert.ok(preview.disclosure.files.some((file) => file.path === "src/calculator.js" && file.mode === "full-content"));

  const withoutApproval = await request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: false
  });
  assert.equal(withoutApproval.response.status, 409);
  assert.equal(withoutApproval.payload.code, "MODEL_SEND_APPROVAL_REQUIRED");

  const sent = await request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.payload.operation, "patch-proposal");
  assert.equal(sent.payload.result.applicable, true);
  assert.equal(sent.payload.task.revision, revisionBeforeSend + 1);
  assert.equal(sent.payload.task.modelEvents.length, 1);
  assert.deepEqual(
    Object.keys(sent.payload.task.modelEvents[0]),
    ["operation", "provider", "model", "requestSha256", "responseSha256", "status", "time"]
  );
  assert.equal(sent.payload.task.modelEvents[0].operation, "patch-proposal");
  assert.equal(sent.payload.task.modelEvents[0].requestSha256, preview.request.sha256);
  assert.match(sent.payload.task.modelEvents[0].responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(sent.payload.task.modelEvents[0].status, "ok");

  const replay = await request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
  assert.equal(replay.response.status, 409);
  assert.equal(replay.payload.code, "MODEL_PREVIEW_UNKNOWN");

  const rawTasks = await fs.readFile(path.join(fixture.stateDir, "tasks.json"), "utf8");
  const storedTask = JSON.parse(rawTasks).find((item) => item.id === taskId);
  assert.equal(storedTask.revision, revisionBeforeSend + 1);
  assert.equal(storedTask.modelEvents.length, 1);
  assert.ok(storedTask.contextFiles.every((file) => !Object.hasOwn(file, "content")));
  assert.doesNotMatch(rawTasks, new RegExp(SOURCE_ONLY_SENTINEL));
});

test("failure-fix disclosure keeps separate context and patch-diff records for the same manifest path", async (t) => {
  const fixture = await createFixture("disclosure-components");
  let server;
  t.after(() => cleanupFixture(server, fixture));
  server = await startCodeClaw(fixture);

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Diagnose the failing divide test"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  await readTaskFile(server, fixture, taskId, "test/calculator.test.js");

  const taskStore = new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") });
  let task = await taskStore.get(taskId);
  const testContent = await fs.readFile(path.join(fixture.project, "test", "calculator.test.js"), "utf8");
  task = await taskStore.recordAppliedPatch(task.id, {
    path: "test/calculator.test.js",
    previousExists: true,
    previousContent: testContent,
    nextContent: `${testContent}\n// applied\n`,
    diff: "PATCH_DIFF_COMPONENT_SENTINEL",
    summary: "A prior test patch."
  });
  task = await taskStore.recordAppliedPatch(task.id, {
    path: "test/calculator.test.js",
    previousExists: true,
    previousContent: `${testContent}\n// applied\n`,
    nextContent: `${testContent}\n// applied twice\n`,
    diff: "SECOND_PATCH_DIFF_COMPONENT_SENTINEL",
    summary: "A second prior patch on the same file."
  });
  task = await taskStore.recordAppliedPatch(task.id, {
    path: ".env",
    previousExists: false,
    previousContent: "",
    nextContent: "BLOCKED_SOURCE_PATH_SENTINEL",
    diff: "BLOCKED_DIFF_MUST_NOT_LEAVE",
    summary: "This path is outside the manifest."
  });
  await taskStore.setVerification(task.id, {
    command: "node --test",
    exitCode: 1,
    timedOut: false,
    stderr: "AssertionError: expected 4"
  });

  const previewResult = await request(server.baseUrl, "/api/model/preview", {
    operation: "failure-fix",
    taskId
  });
  assert.equal(previewResult.response.status, 200);
  const preview = previewResult.payload.preview;
  const samePath = preview.disclosure.files.filter((file) => file.path === "test/calculator.test.js");
  assert.ok(samePath.some((file) => ["full-content", "content-excerpt"].includes(file.mode)));
  const patchDiffs = samePath.filter((file) => file.mode === "patch-diff");
  assert.equal(patchDiffs.length, 2);
  assert.deepEqual(
    patchDiffs.map((file) => file.transmittedUtf8Bytes),
    ["PATCH_DIFF_COMPONENT_SENTINEL", "SECOND_PATCH_DIFF_COMPONENT_SENTINEL"].map((value) => Buffer.byteLength(value, "utf8"))
  );
  assert.ok(samePath.every((file) => Number.isSafeInteger(file.transmittedUtf8Bytes) && file.transmittedUtf8Bytes >= 0));
  assert.deepEqual(preview.disclosure.dataClasses, [
    "goal",
    "task-status",
    "failure-summary",
    "verification-result",
    "recent-patch-diffs",
    "recent-tool-calls",
    "context-file-excerpts"
  ]);
  assert.match(preview.request.bodyUtf8, /PATCH_DIFF_COMPONENT_SENTINEL/);
  assert.match(preview.request.bodyUtf8, /SECOND_PATCH_DIFF_COMPONENT_SENTINEL/);
  assert.doesNotMatch(preview.request.bodyUtf8, /BLOCKED_SOURCE_PATH_SENTINEL|BLOCKED_DIFF_MUST_NOT_LEAVE|\.env/);
  const allowedPaths = new Set([".gitignore", "package.json", "src/calculator.js", "test/calculator.test.js"]);
  assert.ok(preview.disclosure.files.every((file) => allowedPaths.has(file.path)));

  const sent = await request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.payload.task.modelEvents.at(-1).operation, "failure-fix");
  assert.equal(sent.payload.task.modelEvents.at(-1).status, "ok");
});

test("a config change during an online response rejects attachment and records only a minimized failure event", async (t) => {
  const fixture = await createFixture("generation-change");
  let fakeModel;
  let server;
  t.after(async () => {
    fakeModel?.release();
    await cleanupFixture(server, fixture);
    await stopHttpServer(fakeModel?.server);
  });
  fakeModel = await startDelayedModel();
  server = await startCodeClaw(fixture);

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Suggest the next safe task"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  const configured = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "loopback-test",
    baseUrl: `http://127.0.0.1:${fakeModel.port}/v1`,
    model: "test-model",
    apiKey: "MODEL_API_KEY_MUST_NOT_PERSIST"
  });
  assert.equal(configured.response.status, 200);
  assert.doesNotMatch(
    await fs.readFile(path.join(fixture.stateDir, "model.json"), "utf8"),
    /MODEL_API_KEY_MUST_NOT_PERSIST|apiKey/
  );

  const previewResult = await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  });
  assert.equal(previewResult.response.status, 200);
  const preview = previewResult.payload.preview;
  assert.equal(preview.request.channel, "loopback");
  assert.equal(preview.request.willLeaveDevice, false);

  const sendPromise = request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
  await withTimeout(fakeModel.received, 5000, "The fake model did not receive the approved request.");
  const reconfigured = await request(server.baseUrl, "/api/model/config", {
    type: "mock",
    name: "mock",
    model: "mock-codeclaw",
    apiKey: ""
  });
  assert.equal(reconfigured.response.status, 200);
  fakeModel.release();

  const sent = await sendPromise;
  assert.equal(sent.response.status, 409);
  assert.equal(sent.payload.code, "MODEL_CONFIG_CHANGED_AFTER_SEND");
  const task = await new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") }).get(taskId);
  assert.equal(task.patchProposal, null);
  assert.equal(task.modelEvents.length, 1);
  assert.equal(task.modelEvents[0].operation, "task-suggest");
  assert.equal(task.modelEvents[0].status, "error");
  assert.equal(task.modelEvents[0].requestSha256, preview.request.sha256);
  assert.match(task.modelEvents[0].responseSha256, /^[a-f0-9]{64}$/);

  const persisted = [
    await fs.readFile(path.join(fixture.stateDir, "tasks.json"), "utf8"),
    await fs.readFile(path.join(fixture.stateDir, "audit.jsonl"), "utf8"),
    await fs.readFile(path.join(fixture.stateDir, "model.json"), "utf8")
  ].join("\n");
  assert.doesNotMatch(persisted, /DELAYED_MODEL_RESPONSE_MUST_NOT_PERSIST|MODEL_API_KEY_MUST_NOT_PERSIST/);
});

test("the TaskStore-lock commit guard rechecks the Manifest after a delayed model result", async (t) => {
  const fixture = await createFixture("commit-source-race");
  const targetPath = path.join(fixture.project, "src", "calculator.js");
  const original = await fs.readFile(targetPath, "utf8");
  const proposal = JSON.stringify({
    path: "src/calculator.js",
    content: `${original}// provider proposal\n`,
    summary: "A source-race proposal."
  });
  let fakeModel;
  let server;
  let heldLock;
  t.after(async () => {
    if (heldLock) {
      heldLock.release();
      await heldLock.done.catch(() => {});
    }
    await cleanupFixture(server, fixture);
    await stopHttpServer(fakeModel?.server);
  });
  fakeModel = await startStaticModel(proposal);
  server = await startCodeClaw(fixture);
  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Update the calculator implementation"
  });
  const taskId = preflight.payload.task.id;
  await readTaskFile(server, fixture, taskId, "src/calculator.js");
  const configured = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "source-race",
    baseUrl: `http://127.0.0.1:${fakeModel.port}/v1`,
    model: "test-model",
    apiKey: "SOURCE_RACE_CREDENTIAL_NOT_IN_RESPONSE"
  });
  assert.equal(configured.response.status, 200);
  const preview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "patch-proposal",
    taskId
  })).payload.preview;

  heldLock = await holdTaskStoreLock(fixture);
  const sendPromise = approvePreview(server, preview);
  await withTimeout(fakeModel.received, 5000, "The fake model did not receive the source-race request.");
  await new Promise((resolve) => setTimeout(resolve, 120));
  await fs.writeFile(targetPath, `${original}// changed while commit waited\n`, "utf8");
  heldLock.release();
  await heldLock.done;
  const sent = await sendPromise;
  assert.equal(sent.response.status, 409);
  assert.equal(sent.payload.code, "MODEL_SOURCE_CHANGED_AFTER_SEND");
  const task = await new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") }).get(taskId);
  assert.equal(task.patchProposal, null);
  assert.equal(task.modelEvents.at(-1).status, "error");
});

test("server authority, freshness, single-use concurrency, and failed-send replay all fail closed", async (t) => {
  const fixture = await createFixture("authority-and-replay");
  let fakeModel;
  let server;
  t.after(async () => {
    await cleanupFixture(server, fixture);
    await stopHttpServer(fakeModel?.server);
  });
  fakeModel = await startCountingModel();
  server = await startCodeClaw(fixture);

  const preflight = await request(server.baseUrl, "/api/preflight/run", {
    path: fixture.project,
    goal: "Suggest the next safe task"
  });
  assert.equal(preflight.response.status, 200);
  const taskId = preflight.payload.task.id;
  const configured = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "single-use-test",
    baseUrl: `http://127.0.0.1:${fakeModel.port}/v1`,
    model: "test-model",
    apiKey: "AUTHORITY_TEST_KEY_MUST_NOT_PERSIST"
  });
  assert.equal(configured.response.status, 200);

  for (const forged of [
    { goal: "replace the server goal" },
    { rootPath: fixture.stateDir },
    { repoProfile: { files: [{ path: ".env", content: "forged" }] } }
  ]) {
    const rejected = await request(server.baseUrl, "/api/model/preview", {
      operation: "task-suggest",
      taskId,
      ...forged
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.payload.code, "MODEL_PREVIEW_FIELDS_INVALID");
  }
  assert.equal(fakeModel.requestCount, 0);

  const cancelledPreview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  })).payload.preview;
  const cancelled = await request(server.baseUrl, "/api/model/cancel", {
    previewId: cancelledPreview.previewId,
    approvalDigest: cancelledPreview.approvalDigest
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.discarded, true);
  assertPreviewConsumed(await approvePreview(server, cancelledPreview));
  assert.equal(fakeModel.requestCount, 0);

  const sourcePath = path.join(fixture.project, "src", "calculator.js");
  const originalSource = await fs.readFile(sourcePath, "utf8");
  const sourcePreview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  })).payload.preview;
  assert.equal(fakeModel.requestCount, 0, "Preview must not contact DNS or HTTP transport.");
  await fs.writeFile(sourcePath, `${originalSource}// changed after preview\n`, "utf8");
  const sourceChanged = await approvePreview(server, sourcePreview);
  assert.equal(sourceChanged.response.status, 409);
  assert.equal(sourceChanged.payload.code, "MODEL_SOURCE_CHANGED");
  assert.equal(fakeModel.requestCount, 0);
  assertPreviewConsumed(await approvePreview(server, sourcePreview));
  await fs.writeFile(sourcePath, originalSource, "utf8");

  const revisionPreview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  })).payload.preview;
  const taskStore = new TaskStore({ storagePath: path.join(fixture.stateDir, "tasks.json") });
  const current = await taskStore.get(taskId);
  await taskStore.update(taskId, { status: "running" }, { expectedRevision: current.revision });
  const taskChanged = await approvePreview(server, revisionPreview);
  assert.equal(taskChanged.response.status, 409);
  assert.equal(taskChanged.payload.code, "MODEL_TASK_CHANGED");
  assert.equal(fakeModel.requestCount, 0);
  assertPreviewConsumed(await approvePreview(server, revisionPreview));

  const concurrentPreview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  })).payload.preview;
  const concurrent = await Promise.all([
    approvePreview(server, concurrentPreview),
    approvePreview(server, concurrentPreview)
  ]);
  assert.deepEqual(concurrent.map((item) => item.response.status).sort((a, b) => a - b), [200, 409]);
  assert.equal(concurrent.find((item) => item.response.status === 409).payload.code, "MODEL_PREVIEW_UNKNOWN");
  assert.equal(fakeModel.requestCount, 1);

  const unavailablePort = await findFreePort();
  const unavailable = await request(server.baseUrl, "/api/model/config", {
    type: "openai-compatible",
    name: "unavailable-loopback",
    baseUrl: `http://127.0.0.1:${unavailablePort}/v1`,
    model: "test-model",
    apiKey: "FAILED_SEND_KEY_MUST_NOT_PERSIST"
  });
  assert.equal(unavailable.response.status, 200);
  const failedPreview = (await request(server.baseUrl, "/api/model/preview", {
    operation: "task-suggest",
    taskId
  })).payload.preview;
  const failedSend = await approvePreview(server, failedPreview);
  assert.equal(failedSend.response.status, 502);
  assert.equal(failedSend.payload.code, "network_error");
  assertPreviewConsumed(await approvePreview(server, failedPreview));
  assert.equal(fakeModel.requestCount, 1);

  const task = await taskStore.get(taskId);
  assert.equal(task.modelEvents.at(-1).status, "error");
  const persisted = await Promise.all(["model.json", "tasks.json", "audit.jsonl"].map((name) => (
    fs.readFile(path.join(fixture.stateDir, name), "utf8")
  )));
  assert.doesNotMatch(persisted.join("\n"), /AUTHORITY_TEST_KEY_MUST_NOT_PERSIST|FAILED_SEND_KEY_MUST_NOT_PERSIST|COUNTING_MODEL_RESPONSE_MUST_NOT_PERSIST/);
});

async function createFixture(name) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), `codeclaw-model-outbound-${name}-`));
  const project = path.join(base, "project");
  const stateDir = path.join(base, "state");
  const lockDir = path.join(base, "locks");
  const copyRoot = path.join(base, "copies");
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.mkdir(path.join(project, "test"), { recursive: true });
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(project, ".gitignore"), "ignored.js\n", "utf8");
  await fs.writeFile(path.join(project, "ignored.js"), "IGNORED_SOURCE_MUST_NOT_LEAVE\n", "utf8");
  await fs.writeFile(path.join(project, "package.json"), '{"name":"model-outbound-fixture","type":"module","scripts":{"test":"node --test"}}\n', "utf8");
  await fs.writeFile(path.join(project, "src", "calculator.js"), [
    `// ${SOURCE_ONLY_SENTINEL}`,
    "export function divide(a, b) {",
    "  if (b === 0) throw new Error(\"Cannot divide by zero.\");",
    "  return a / b;",
    "}",
    ""
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(project, "test", "calculator.test.js"), [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { divide } from "../src/calculator.js";',
    "",
    'test("divide returns the quotient", () => {',
    "  assert.equal(divide(8, 2), 4);",
    "});",
    ""
  ].join("\n"), "utf8");
  return { base, project, stateDir, lockDir, copyRoot };
}

async function readTaskFile(server, fixture, taskId, filePath) {
  const result = await request(server.baseUrl, "/api/tools/call", {
    tool: "read_file",
    args: { path: filePath },
    rootPath: fixture.project,
    taskId
  });
  assert.equal(result.response.status, 200);
  return result;
}

async function holdTaskStoreLock(fixture) {
  const storagePath = path.join(fixture.stateDir, "tasks.json");
  const manager = new CrossProcessLockManager({
    storagePath: path.join(fixture.stateDir, ".task-locks"),
    namespace: "task-store",
    timeoutMs: 5000,
    lockedCode: "TASK_STORE_LOCKED",
    lockedMessage: "test lock"
  });
  const key = await canonicalPathLockKey(storagePath);
  let releaseLock;
  let markAcquired;
  const releaseGate = new Promise((resolve) => { releaseLock = resolve; });
  const acquired = new Promise((resolve) => { markAcquired = resolve; });
  const done = manager.withLock(key, async () => {
    markAcquired();
    await releaseGate;
  });
  await acquired;
  return { release: releaseLock, done };
}

function approvePreview(server, preview) {
  return request(server.baseUrl, "/api/model/send", {
    previewId: preview.previewId,
    approvalDigest: preview.approvalDigest,
    approved: true
  });
}

function assertPreviewConsumed(result) {
  assert.equal(result.response.status, 409);
  assert.equal(result.payload.code, "MODEL_PREVIEW_UNKNOWN");
}

async function startCodeClaw(fixture) {
  const port = await findFreePort();
  const child = spawn(process.execPath, ["apps/web/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODECLAW_PORT: String(port),
      CODECLAW_STATE_DIR: fixture.stateDir,
      CODECLAW_PROJECT_LOCK_DIR: fixture.lockDir,
      CODECLAW_DISPOSABLE_ROOT: fixture.copyRoot
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const server = { child, port, baseUrl: `http://127.0.0.1:${port}`, output: () => output };
  try {
    await waitForHealth(server);
    return server;
  } catch (error) {
    await stopCodeClaw(server);
    throw error;
  }
}

async function cleanupFixture(server, fixture) {
  await stopCodeClaw(server);
  await fs.rm(fixture.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function readStateFiles(fixture) {
  const contents = [];
  for (const name of ["model.json", "tasks.json", "audit.jsonl"]) {
    try {
      contents.push(await fs.readFile(path.join(fixture.stateDir, name), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return contents.join("\n");
}

async function stopCodeClaw(server) {
  if (!server || exited(server.child)) return;
  server.child.kill();
  if (await waitForChildExit(server.child, 2500)) return;
  server.child.kill("SIGKILL");
  if (!(await waitForChildExit(server.child, 1000))) {
    throw new Error("The CodeClaw test server did not stop cleanly.");
  }
}

function waitForChildExit(child, timeoutMs) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (didExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(didExit);
    };
    const onExit = () => finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (exited(child)) finish(true);
  });
}

async function startDelayedModel() {
  let releaseResponse;
  let markReceived;
  const releaseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const received = new Promise((resolve) => { markReceived = resolve; });
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    markReceived();
    await releaseGate;
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      choices: [{ message: { content: "DELAYED_MODEL_RESPONSE_MUST_NOT_PERSIST" } }]
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    port: server.address().port,
    received,
    release: () => releaseResponse()
  };
}

async function startCountingModel() {
  let requestCount = 0;
  const bodies = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestCount += 1;
    bodies.push(Buffer.concat(chunks));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      choices: [{ message: { content: "COUNTING_MODEL_RESPONSE_MUST_NOT_PERSIST" } }]
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    port: server.address().port,
    get requestCount() { return requestCount; },
    bodies
  };
}

async function startStaticModel(content) {
  let authorization = "";
  let markReceived;
  const received = new Promise((resolve) => { markReceived = resolve; });
  const server = http.createServer(async (request, response) => {
    authorization = String(request.headers.authorization || "");
    for await (const _chunk of request) {}
    markReceived();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    port: server.address().port,
    received,
    get authorization() { return authorization; }
  };
}

async function startRawModel(responses) {
  let requestCount = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    const current = responses[requestCount] || responses.at(-1);
    requestCount += 1;
    response.writeHead(current.status, current.headers || {});
    response.end(current.body || "");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    port: server.address().port,
    get requestCount() { return requestCount; }
  };
}

function stopHttpServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json; charset=utf-8" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

async function waitForHealth(server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (exited(server.child)) throw new Error(`Server exited early.\n${server.output()}`);
    try {
      const health = await request(server.baseUrl, "/api/health");
      if (health.response.ok && health.payload.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start.\n${server.output()}`);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
