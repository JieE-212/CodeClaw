import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../../packages/shared/src/constants.js";
import { scanRepository } from "../../packages/repo-indexer/src/index.js";
import { createTaskPlan } from "../../packages/agent-core/src/index.js";
import { classifyToolCall } from "../../packages/permission-engine/src/index.js";
import { ToolRegistry, hashContent } from "../../packages/tool-registry/src/index.js";
import { AuditLog, summarizeToolResult } from "../../packages/audit-log/src/index.js";
import { TaskStore, appliedPatchIdentity, buildTaskReviewDraft, patchProposalDigest, summarizeTask } from "../../packages/task-store/src/index.js";
import { MemoryStore } from "../../packages/memory-store/src/index.js";
import { ModelProvider, publicModelConfig, sanitizeModelConfig, selectContextFiles } from "../../packages/model-provider/src/index.js";
import { decidePreflightGate, pickSearchQuery, summarizeContextCoverage } from "../../packages/preflight/src/index.js";
import { PatchTransactionStore, recoverPatchTransactions } from "../../packages/patch-transaction/src/index.js";
import { PatchTransactionClaimStore, loadPatchStateOwnerId } from "../../packages/patch-transaction/src/claim-store.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../packages/shared/src/cross-process-lock.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity } from "../../packages/shared/src/workspace-identity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localStateDir = path.resolve(process.env.CODECLAW_STATE_DIR || path.join(process.cwd(), ".codeclaw"));
const auditLog = new AuditLog({ storagePath: path.join(localStateDir, "audit.jsonl") });
const taskStore = new TaskStore({ storagePath: path.join(localStateDir, "tasks.json") });
const patchTransactionStore = new PatchTransactionStore({ storagePath: path.join(localStateDir, "patch-transactions") });
const projectLockDir = path.resolve(process.env.CODECLAW_PROJECT_LOCK_DIR || defaultProjectCoordinationDir());
const projectWriteLockManager = new CrossProcessLockManager({
  storagePath: projectLockDir,
  namespace: "project-write",
  timeoutMs: 5000,
  lockedCode: "PROJECT_WRITE_LOCKED",
  lockedMessage: "Another CodeClaw process is already changing this project. Wait for it to finish, then retry."
});
const patchClaimStore = new PatchTransactionClaimStore({
  storagePath: path.join(projectLockDir, "claims"),
  ownerId: await loadPatchStateOwnerId(localStateDir)
});
const memoryStore = new MemoryStore({ storagePath: path.join(localStateDir, "memory.json") });
const modelConfigPath = path.join(localStateDir, "model.json");
const MAX_CONTEXT_CONTENT_CHARS = 50000;
const port = DEFAULT_PORT;
let lastRepoProfile = null;
let toolRegistry = null;
let modelConfig = sanitizeModelConfig({ type: "mock", name: "mock", model: "mock-codeclaw" });
let modelProvider = new ModelProvider(modelConfig);
let patchRecoveryStatus = emptyPatchRecoveryStatus();
const patchOperationQueues = new Map();

function defaultProjectCoordinationDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodeClaw", "transaction-coordination-v1");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "codeclaw", "transaction-coordination-v1");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, { ok: true, app: "CodeClaw", time: new Date().toISOString() });
    if (request.method === "GET" && url.pathname === "/api/system/check") return await systemCheck(response);
    if (request.method === "GET" && url.pathname === "/api/session/last") return await getLastSession(response);
    if (request.method === "GET" && url.pathname === "/api/audit/events") return await getAuditEvents(url, response);
    if (request.method === "GET" && url.pathname === "/api/memory") return await getMemory(url, response);
    if (request.method === "POST" && url.pathname === "/api/memory/notes") return await updateMemoryNotes(request, response);
    if (request.method === "GET" && url.pathname === "/api/model/status") return await getModelStatus(response);
    if (request.method === "GET" && url.pathname === "/api/patch-recovery/status") return json(response, { ok: true, recovery: patchRecoveryStatus });
    if (request.method === "POST" && url.pathname === "/api/model/config") return await setModelConfig(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/suggest") return await suggestWithModel(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/context-files") return await suggestContextFiles(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/patch-proposal") return await proposePatch(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/fix-from-failure") return await suggestFailureFix(request, response);
    if (request.method === "POST" && url.pathname === "/api/preflight/run") return await runPreflight(request, response);
    if (request.method === "GET" && url.pathname === "/api/tasks/latest") return await getLatestTask(url, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/create") return await createTask(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/complete") return await completeTask(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/context-file") return await addTaskContextFile(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/apply-patch") return await applyPatch(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/revert-patch") return await revertPatch(request, response);
    if (request.method === "POST" && url.pathname === "/api/repo/scan") return await scanRepo(request, response);
    if (request.method === "POST" && url.pathname === "/api/agent/plan") return await createPlan(request, response);
    if (request.method === "POST" && url.pathname === "/api/tools/call") return await callTool(request, response);
    return await serveStatic(url.pathname, response);
  } catch (error) {
    await recordAudit({ type: "server.error", status: "error", title: "Server error", detail: error.message, rootPath: lastRepoProfile?.rootPath });
    return json(response, { ok: false, code: error.code || "SERVER_ERROR", error: error.message }, error.status || 500);
  }
});

await startServer();

async function startServer() {
  await loadModelConfig();
  patchRecoveryStatus = await recoverPatchTransactions({
    store: patchTransactionStore,
    taskStore,
    registryFactory: (rootPath) => new ToolRegistry({ rootPath }),
    beforeRemove: markPatchClaimComplete,
    withRootLock: async (rootPath, recovery) => projectWriteLockManager.withLock(
      await canonicalPathLockKey(rootPath),
      () => withPatchRecoveryOwnership(rootPath, recovery),
      { timeoutMs: 1000 }
    )
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`CodeClaw workspace running at http://127.0.0.1:${port}`);
  });
}

async function getAuditEvents(url, response) {
  const rootPath = url.searchParams.get("rootPath");
  const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
  return json(response, { ok: true, events: await auditLog.latest({ rootPath, limit }) });
}

async function getMemory(url, response) {
  const rootPath = url.searchParams.get("rootPath") || lastRepoProfile?.rootPath;
  if (!rootPath) return json(response, { ok: true, memory: null });
  return json(response, { ok: true, memory: await memoryStore.get(rootPath) });
}

async function getLastSession(response) {
  await ensureModelConfigLoaded();
  const memory = await memoryStore.latest();
  const profile = memory ? profileFromMemory(memory) : null;
  const task = profile ? await taskStore.latest({ rootPath: profile.rootPath }) : await taskStore.latest();
  if (profile) {
    lastRepoProfile = profile;
    toolRegistry = new ToolRegistry({ rootPath: profile.rootPath, allowedCommands: profile.commands });
  }
  return json(response, {
    ok: true,
    session: memory ? {
      restored: true,
      rootPath: memory.rootPath,
      restoredAt: new Date().toISOString(),
      needsPreflight: true
    } : null,
    profile,
    task,
    memory,
    model: publicModelConfig(modelConfig)
  });
}

async function updateMemoryNotes(request, response) {
  const body = await readJson(request);
  const rootPath = body.rootPath || lastRepoProfile?.rootPath;
  const memory = await memoryStore.updateNotes(rootPath, body.notes || "");
  await recordAudit({ type: "memory.notes", title: "Memory notes updated", detail: `${memory.notes.length} character(s)`, rootPath: memory.rootPath });
  return json(response, { ok: true, memory });
}

async function systemCheck(response) {
  const demoPath = path.join(process.cwd(), "examples", "demo-js");
  let demoExists = false;
  try {
    demoExists = (await fs.stat(demoPath)).isDirectory();
  } catch {}
  return json(response, {
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    demoPath,
    demoExists,
    model: modelProvider.status(),
    recovery: patchRecoveryStatus
  });
}

async function assertRepositoryDirectory(inputPath, action = "scan") {
  const trimmed = String(inputPath || "").trim().replace(/^["']|["']$/g, "");
  if (!trimmed) throw pathInputError("PATH_EMPTY", `Missing repository path for ${action}.`, 400);

  const resolved = path.resolve(trimmed);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw pathInputError("PATH_NOT_FOUND", `Project path was not found: ${resolved}`, 404);
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw pathInputError("PATH_PERMISSION_DENIED", `Permission denied while reading project path: ${resolved}`, 403);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw pathInputError("PATH_IS_FILE", `Project path must be a folder, not a file: ${resolved}`, 400);
  }
  return fs.realpath(resolved);
}

function pathInputError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function scanRepositoryWithFriendlyErrors(repositoryPath) {
  try {
    return await scanRepository(repositoryPath);
  } catch (error) {
    if (error.code === "ENOENT") throw pathInputError("PATH_NOT_FOUND", `Project path changed or was not found: ${repositoryPath}`, 404);
    if (error.code === "EACCES" || error.code === "EPERM") throw pathInputError("PATH_PERMISSION_DENIED", `Permission denied while scanning project path: ${repositoryPath}`, 403);
    if (/not a directory/i.test(error.message || "")) throw pathInputError("PATH_IS_FILE", error.message, 400);
    throw error;
  }
}

function profileFromMemory(memory) {
  if (!memory?.rootPath) return null;
  return {
    name: memory.name || path.basename(memory.rootPath),
    rootPath: path.resolve(memory.rootPath),
    fileCount: memory.profile?.fileCount || 0,
    skippedCount: memory.profile?.skippedCount || 0,
    languages: memory.profile?.languages || [],
    frameworks: memory.profile?.frameworks || [],
    packageManagers: memory.profile?.packageManagers || [],
    commands: memory.commands || [],
    keyFiles: memory.profile?.keyFiles || [],
    files: [],
    scannedAt: memory.profile?.scannedAt || memory.updatedAt || null,
    restoredFromMemory: true
  };
}

async function getLatestTask(url, response) {
  const rootPath = url.searchParams.get("rootPath");
  return json(response, { ok: true, task: await taskStore.latest({ rootPath }) });
}

async function getModelStatus(response) {
  await ensureModelConfigLoaded();
  return json(response, { ok: true, config: publicModelConfig(modelConfig), status: modelProvider.status() });
}

async function setModelConfig(request, response) {
  const body = await readJson(request);
  modelConfig = sanitizeModelConfig(body);
  modelProvider = new ModelProvider(modelConfig);
  await fs.mkdir(path.dirname(modelConfigPath), { recursive: true });
  await fs.writeFile(modelConfigPath, JSON.stringify(modelConfig, null, 2), "utf8");
  await recordAudit({ type: "model.config", title: "Model configured", detail: `${modelConfig.type}: ${modelConfig.model || modelConfig.name}`, rootPath: lastRepoProfile?.rootPath, metadata: { config: publicModelConfig(modelConfig) } });
  return json(response, { ok: true, config: publicModelConfig(modelConfig), status: modelProvider.status() });
}

async function suggestWithModel(request, response) {
  await ensureModelConfigLoaded();
  const body = await readJson(request);
  const task = body.taskId ? await taskStore.get(body.taskId) : await taskStore.latest({ rootPath: body.rootPath || lastRepoProfile?.rootPath });
  const repoProfile = body.repoProfile || lastRepoProfile || {};
  const suggestion = await modelProvider.suggestTask({ goal: body.goal || task?.goal, repoProfile, task });
  let updatedTask = null;
  if (task) updatedTask = await taskStore.appendSuggestion(task.id, suggestion);
  await recordAudit({
    type: "model.suggest",
    title: "Model suggestion",
    detail: `${suggestion.provider}: ${suggestion.content.slice(0, 120)}`,
    rootPath: task?.rootPath || repoProfile.rootPath || lastRepoProfile?.rootPath,
    metadata: { taskId: task?.id || null, provider: suggestion.provider, model: suggestion.model }
  });
  return json(response, { ok: true, suggestion, task: updatedTask });
}

async function suggestContextFiles(request, response) {
  await ensureModelConfigLoaded();
  const body = await readJson(request);
  const task = body.taskId ? await taskStore.get(body.taskId) : await taskStore.latest({ rootPath: body.rootPath || lastRepoProfile?.rootPath });
  const repoProfile = body.repoProfile || lastRepoProfile || {};
  const suggestion = await modelProvider.suggestContextFiles({ goal: body.goal || task?.goal, repoProfile, task });
  await recordAudit({
    type: "model.context",
    title: "Context files suggested",
    detail: `${suggestion.files.length} candidate file(s)`,
    rootPath: task?.rootPath || repoProfile.rootPath || lastRepoProfile?.rootPath,
    metadata: { taskId: task?.id || null, provider: suggestion.provider, files: suggestion.files.map((item) => item.path) }
  });
  return json(response, { ok: true, suggestion, task });
}

async function proposePatch(request, response) {
  await ensureModelConfigLoaded();
  const body = await readJson(request);
  const task = body.taskId ? await taskStore.get(body.taskId) : await taskStore.latest({ rootPath: body.rootPath || lastRepoProfile?.rootPath });
  if (!task) throw new Error("Create a task before requesting a patch proposal.");
  const repoProfile = body.repoProfile || lastRepoProfile || {};
  const modelProposal = await modelProvider.proposePatch({ goal: body.goal || task.goal, repoProfile, task });
  const proposal = await attachPatchBaselines(modelProposal, task, getToolRegistry(task.rootPath));
  const updatedTask = await taskStore.setPatchProposal(task.id, proposal);
  await recordAudit({
    type: "model.patch",
    title: "Patch proposed",
    detail: proposal.path ? `${proposal.path}: ${proposal.summary}` : proposal.summary,
    rootPath: task.rootPath,
    metadata: { taskId: task.id, provider: proposal.provider, model: proposal.model, path: proposal.path }
  });
  return json(response, { ok: true, proposal: updatedTask.patchProposal, task: updatedTask });
}

async function suggestFailureFix(request, response) {
  await ensureModelConfigLoaded();
  const body = await readJson(request);
  const task = body.taskId ? await taskStore.get(body.taskId) : await taskStore.latest({ rootPath: body.rootPath || lastRepoProfile?.rootPath });
  if (!task) throw new Error("No task available for failure repair.");
  const suggestion = await modelProvider.suggestFailureFix({ task });
  const updatedTask = await taskStore.appendSuggestion(task.id, { ...suggestion, kind: "failure-fix" });
  await recordAudit({ type: "model.failure_fix", title: "Failure fix suggested", detail: suggestion.content.slice(0, 120), rootPath: task.rootPath, metadata: { taskId: task.id, provider: suggestion.provider } });
  return json(response, { ok: true, suggestion, task: updatedTask });
}

async function runPreflight(request, response) {
  const body = await readJson(request);
  const targetPath = Object.hasOwn(body, "path")
    ? body.path
    : Object.hasOwn(body, "rootPath")
      ? body.rootPath
      : lastRepoProfile?.rootPath;
  const goal = String(body.goal || "understand the project and identify safe first context files").trim();
  const repositoryPath = await assertRepositoryDirectory(targetPath, "preflight");

  const repoProfile = await scanRepositoryWithFriendlyErrors(repositoryPath);
  lastRepoProfile = repoProfile;
  toolRegistry = new ToolRegistry({ rootPath: repoProfile.rootPath, allowedCommands: repoProfile.commands });
  const memory = await memoryStore.upsertProfile(repoProfile);
  const task = await taskStore.create({ goal, rootPath: repoProfile.rootPath });
  const plan = createTaskPlan(goal, repoProfile);
  const plannedTask = await taskStore.setPlan(task.id, plan);
  const selected = selectContextFiles({ goal, repoProfile, task: plannedTask, limit: Number.isInteger(body.limit) ? body.limit : 5 });
  let updatedTask = plannedTask;
  const readFiles = [];
  const registry = getToolRegistry(repoProfile.rootPath);

  for (const file of selected) {
    const read = await registry.call("read_file", { path: file.path });
    await recordAudit({
      type: "preflight.read",
      status: read.ok ? "ok" : "error",
      title: "Preflight read",
      detail: file.path,
      rootPath: repoProfile.rootPath,
      metadata: { taskId: task.id, path: file.path }
    });
    if (read.ok && typeof read.result === "string") {
      updatedTask = await taskStore.appendToolCall(task.id, {
        tool: "read_file",
        args: { path: file.path },
        blocked: false,
        approved: false,
        permission: read.permission,
        summary: summarizeToolResult(read)
      });
      updatedTask = await taskStore.appendContextFile(task.id, {
        path: file.path,
        summary: summarizeContent(read.result),
        content: read.result.slice(0, MAX_CONTEXT_CONTENT_CHARS),
        contentComplete: read.result.length <= MAX_CONTEXT_CONTENT_CHARS,
        size: read.result.length,
        source: "preflight"
      });
    }
    readFiles.push({ path: file.path, ok: Boolean(read.ok), size: typeof read.result === "string" ? read.result.length : 0 });
  }

  const searchQuery = pickSearchQuery(goal, selected, repoProfile);
  const search = await registry.call("search_code", { query: searchQuery });
  updatedTask = await taskStore.appendToolCall(task.id, {
    tool: "search_code",
    args: { query: searchQuery },
    blocked: false,
    approved: false,
    permission: search.permission,
    summary: summarizeToolResult(search)
  });
  const searchHits = search.result || [];
  const report = {
    ok: true,
    mode: "read-only-preflight",
    repo: {
      name: repoProfile.name,
      rootPath: repoProfile.rootPath,
      files: repoProfile.fileCount,
      skipped: repoProfile.skippedCount,
      languages: repoProfile.languages
    },
    commands: repoProfile.commands.map((item) => ({ name: item.name, command: item.command })),
    goal,
    plan: {
      title: plan.title,
      steps: plan.steps.length,
      intent: plan.intent,
      confidence: plan.confidence
    },
    contextFiles: selected.map((item) => ({ path: item.path, reason: item.reason })),
    readFiles,
    search: {
      query: searchQuery,
      hits: searchHits.slice(0, 8).map((item) => item.path)
    },
    writeAttempted: false,
    contextCoverage: summarizeContextCoverage(selected),
    nextGate: decidePreflightGate({ goal, scan: repoProfile, selected, searchHits })
  };

  await recordAudit({
    type: "preflight.run",
    title: "Read-only preflight",
    detail: `${repoProfile.name}: ${report.contextFiles.length} context file(s), ${report.nextGate.warnings.length} warning(s)`,
    rootPath: repoProfile.rootPath,
    metadata: { taskId: task.id, contextCoverage: report.contextCoverage, warnings: report.nextGate.warnings }
  });
  return json(response, { ok: true, report, profile: repoProfile, task: updatedTask, memory });
}

async function createTask(request, response) {
  const body = await readJson(request);
  const requestedRoot = body.rootPath || lastRepoProfile?.rootPath;
  const rootPath = requestedRoot ? await assertRepositoryDirectory(requestedRoot, "create a task") : null;
  const task = await taskStore.create({ goal: body.goal, rootPath });
  await recordAudit({ type: "task.create", title: "Task created", detail: task.goal, rootPath: task.rootPath, metadata: { taskId: task.id } });
  return json(response, { ok: true, task });
}

async function completeTask(request, response) {
  const body = await readJson(request);
  const existing = await taskStore.get(body.taskId);
  const summary = body.summary || summarizeTask(existing);
  const reviewDraft = buildTaskReviewDraft(existing, summary);
  const task = await taskStore.complete(body.taskId, summary, reviewDraft);
  const memory = task.rootPath ? await memoryStore.appendTaskSummary(task.rootPath, task, summary) : null;
  await recordAudit({ type: "task.complete", title: "Task completed", detail: summary, rootPath: task.rootPath, metadata: { taskId: task.id } });
  return json(response, { ok: true, task, memory });
}

async function addTaskContextFile(request, response) {
  const body = await readJson(request);
  const task = await taskStore.appendContextFile(body.taskId, {
    path: body.path,
    summary: body.summary || "",
    content: typeof body.content === "string" ? body.content.slice(0, MAX_CONTEXT_CONTENT_CHARS) : "",
    contentComplete: typeof body.content === "string" ? body.content.length <= MAX_CONTEXT_CONTENT_CHARS : false,
    size: body.size || null,
    source: body.source || "manual"
  });
  await recordAudit({ type: "task.context", title: "Context file added", detail: body.path, rootPath: task.rootPath, metadata: { taskId: task.id, path: body.path } });
  return json(response, { ok: true, task });
}

async function applyPatch(request, response) {
  const body = await readJson(request);
  const initialTask = await taskStore.get(body.taskId);
  const proposalFiles = getProposalFiles(initialTask.patchProposal);
  if (!proposalFiles.length) throw new Error("No applicable patch proposal.");
  if (!body.approved) {
    return json(response, {
      ok: false,
      blocked: true,
      permission: classifyToolCall("write_patch", { path: proposalFiles.map((file) => file.path).join(", ") }),
      message: "Patch application requires approval."
    });
  }
  assertProposalApproval(initialTask.patchProposal, body, initialTask.rootIdentity);
  return serializePatchOperation(initialTask.rootPath, async () => {
    let task = await taskStore.get(body.taskId);
    task = await canonicalizeTaskRoot(task, "apply a patch");
    await ensurePatchRecoveryReady(task.rootPath, task.rootIdentity);
    task = await canonicalizeTaskRoot(await taskStore.get(body.taskId), "apply a patch");
    const proposal = task.patchProposal;
    assertProposalApproval(proposal, body, task.rootIdentity);
    const currentProposalFiles = getProposalFiles(proposal);
    if (!currentProposalFiles.length) throw new Error("No applicable patch proposal.");
    const registry = getToolRegistry(task.rootPath);
    const files = await preparePatchWrites(registry, task, currentProposalFiles, proposal);
    const writes = [];
    const batchId = `apply-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let transaction;
    let claimCreated = false;
    let committed = false;
    try {
      await patchClaimStore.begin({
        rootPath: task.rootPath,
        rootIdentity: task.rootIdentity,
        transactionId: batchId,
        operation: "apply"
      });
      claimCreated = true;
      transaction = await patchTransactionStore.begin({
        id: batchId,
        operation: "apply",
        taskId: task.id,
        rootPath: task.rootPath,
        rootIdentity: task.rootIdentity,
        items: files.map((file) => ({
          path: file.path,
          parentIdentity: file.parentIdentity,
          beforeExists: file.snapshot.exists,
          beforeContent: file.snapshot.content,
          afterExists: true,
          afterContent: file.content
        }))
      });
      await patchClaimStore.markJournaled({
        rootPath: transaction.rootPath,
        rootIdentity: transaction.rootIdentity,
        transactionId: transaction.id
      });
      for (const file of files) {
        const write = await registry.call("write_patch", {
          path: file.path,
          content: file.content,
          expectedBaseline: file.expectedBaseline,
          transactionId: transaction.id,
          rootIdentity: transaction.rootIdentity,
          parentIdentity: file.parentIdentity,
          onTemporaryReady: (identity) => patchTransactionStore.recordTemporaryIdentity(transaction.id, file.path, identity)
        }, { approved: true });
        writes.push(write.result);
      }
      const appliedRecords = files.map((file, index) => ({
        batchId: transaction.id,
        transactionId: transaction.id,
        path: file.path,
        previousExists: file.snapshot.exists,
          previousContent: file.snapshot.content,
          nextContent: file.content,
          parentIdentity: file.parentIdentity,
        diff: writes[index]?.diff || file.diff || "",
        summary: file.summary || proposal.summary || ""
      }));
      const updatedTask = await taskStore.recordAppliedPatches(task.id, appliedRecords.map((appliedPatch) => ({
        ...appliedPatch,
        patchIdentity: appliedPatchIdentity(appliedPatch)
      })));
      committed = true;
      const cleanupPending = !(await cleanupCommittedPatchTransaction(transaction));
      await recordAudit({ type: "task.patch.apply", title: "Patch applied", detail: `${files.length} file(s)`, rootPath: task.rootPath, metadata: { taskId: task.id, batchId: transaction.id, paths: files.map((file) => file.path), cleanupPending } });
      return json(response, { ok: true, result: { files: writes, diff: writes.map((item) => item.diff).join("\n\n"), cleanupPending }, task: updatedTask });
    } catch (error) {
      if (committed) throw error;
      if (!transaction) {
        if (!claimCreated) throw error;
        try {
          await patchClaimStore.remove({ rootPath: task.rootPath, rootIdentity: task.rootIdentity, transactionId: batchId });
        } catch {
          throw patchOperationError("PATCH_TRANSACTION_STATE_ERROR", "The patch safety claim could not be cleared after journal creation failed. No project file was changed; restart CodeClaw before retrying.", 500);
        }
        if (error.code?.startsWith("PATCH_")) throw error;
        throw patchOperationError("PATCH_TRANSACTION_STATE_ERROR", "The patch safety journal could not be created, so no project file was changed.", 500);
      }
      const recovery = await withPatchRecoveryOwnership(task.rootPath, () => recoverPatchTransactions({
        store: patchTransactionStore,
        taskStore,
        registryFactory: (rootPath) => new ToolRegistry({ rootPath }),
        beforeRemove: markPatchClaimComplete,
        rootPath: task.rootPath
      }), task.rootIdentity);
      await updateGlobalPatchRecoveryStatus(recovery);
      if (recovery.committedCleanup) {
        const updatedTask = await taskStore.get(task.id);
        await recordAudit({ type: "task.patch.apply", title: "Patch applied", detail: `${files.length} file(s)`, rootPath: task.rootPath, metadata: { taskId: task.id, batchId: transaction.id, recoveredCommit: true } });
        return json(response, { ok: true, result: { files: writes, diff: writes.map((item) => item.diff).join("\n\n"), recoveredCommit: true }, task: updatedTask });
      }
      if (!recovery.ok) {
        throw patchOperationError("PATCH_APPLY_ROLLBACK_INCOMPLETE", "Patch application stopped and automatic recovery needs review. CodeClaw will not write again until the recovery conflict is resolved.", 500);
      }
      if (error.code === "PATCH_BASELINE_CONFLICT") throw error;
      throw patchOperationError("PATCH_APPLY_FAILED", "Patch application failed. Files written during this attempt were restored; resolve the workspace write or ignore-rule problem and retry.", 409);
    }
  });
}

async function revertPatch(request, response) {
  const body = await readJson(request);
  const initialTask = await taskStore.get(body.taskId);
  const patches = initialTask.appliedPatches || [];
  const patchIndex = Number.isInteger(body.patchIndex)
    ? body.patchIndex
    : body.path
      ? patches.findLastIndex((item) => item.path === body.path && !item.revertedAt)
      : patches.findLastIndex((item) => !item.revertedAt);
  const patch = patches[patchIndex];
  if (!patch || patch.revertedAt) throw new Error("No active applied patch to revert.");
  if (!body.approved) {
    return json(response, {
      ok: false,
      blocked: true,
      permission: classifyToolCall("write_patch", { path: patch.path }),
      message: "Patch revert requires approval."
    });
  }
  assertRevertApproval(patch, body, initialTask.rootIdentity);

  return serializePatchOperation(initialTask.rootPath, async () => {
    let task = await taskStore.get(body.taskId);
    task = await canonicalizeTaskRoot(task, "revert a patch");
    await ensurePatchRecoveryReady(task.rootPath, task.rootIdentity);
    task = await canonicalizeTaskRoot(await taskStore.get(body.taskId), "revert a patch");
    const currentPatch = (task.appliedPatches || [])[patchIndex];
    if (!currentPatch || currentPatch.revertedAt) throw new Error("No active applied patch to revert.");
    assertRevertApproval(currentPatch, body, task.rootIdentity);
    const currentParentIdentity = (await captureWorkspaceParentIdentity(task.rootPath, currentPatch.path)).digest;
    if (!currentPatch.parentIdentity || currentParentIdentity !== currentPatch.parentIdentity) {
      throw patchOperationError("PATCH_PARENT_CHANGED", "The applied patch parent directory changed after review. Revert was stopped before any write.", 409);
    }
    const registry = getToolRegistry(task.rootPath);
    if (typeof currentPatch.nextContent !== "string") {
      throw patchOperationError("PATCH_REVERT_BASELINE_MISSING", `The saved patch baseline is unavailable for ${currentPatch.path}. Inspect the file and revert it manually.`, 409);
    }
    const expectedCurrent = { exists: true, sha256: hashContent(currentPatch.nextContent) };
    const snapshot = await assertCurrentBaseline(registry, currentPatch.path, expectedCurrent, "PATCH_REVERT_CONFLICT", "The file changed after CodeClaw applied the patch. Review those edits before deciding how to revert.");
    const transactionId = `revert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let transaction;
    let claimCreated = false;
    let write;
    let committed = false;
    try {
      await patchClaimStore.begin({
        rootPath: task.rootPath,
        rootIdentity: task.rootIdentity,
        transactionId,
        operation: "revert"
      });
      claimCreated = true;
      transaction = await patchTransactionStore.begin({
        id: transactionId,
        operation: "revert",
        taskId: task.id,
        rootPath: task.rootPath,
        rootIdentity: task.rootIdentity,
        patchIndex,
        items: [{
          path: currentPatch.path,
          parentIdentity: currentPatch.parentIdentity,
          beforeExists: snapshot.exists,
          beforeContent: snapshot.content,
          afterExists: currentPatch.previousExists !== false,
          afterContent: currentPatch.previousExists === false ? "" : currentPatch.previousContent ?? ""
        }]
      });
      await patchClaimStore.markJournaled({
        rootPath: transaction.rootPath,
        rootIdentity: transaction.rootIdentity,
        transactionId: transaction.id
      });
      const restoreArgs = currentPatch.previousExists === false
        ? {
            path: currentPatch.path,
            remove: true,
            expectedBaseline: expectedCurrent,
            transactionId: transaction.id,
            rootIdentity: transaction.rootIdentity,
            parentIdentity: currentPatch.parentIdentity,
            onTemporaryReady: (identity) => patchTransactionStore.recordTemporaryIdentity(transaction.id, currentPatch.path, identity)
          }
        : {
            path: currentPatch.path,
            content: currentPatch.previousContent ?? "",
            expectedBaseline: expectedCurrent,
            transactionId: transaction.id,
            rootIdentity: transaction.rootIdentity,
            parentIdentity: currentPatch.parentIdentity,
            onTemporaryReady: (identity) => patchTransactionStore.recordTemporaryIdentity(transaction.id, currentPatch.path, identity)
          };
      write = await registry.call("write_patch", restoreArgs, { approved: true });
      const updatedTask = await taskStore.markPatchReverted(task.id, patchIndex, { revertTransactionId: transaction.id });
      committed = true;
      const cleanupPending = !(await cleanupCommittedPatchTransaction(transaction));
      await recordAudit({ type: "task.patch.revert", title: "Patch reverted", detail: currentPatch.path, rootPath: task.rootPath, metadata: { taskId: task.id, path: currentPatch.path, transactionId: transaction.id, cleanupPending } });
      return json(response, { ...write, cleanupPending, task: updatedTask });
    } catch (error) {
      if (committed) throw error;
      if (!transaction) {
        if (!claimCreated) throw error;
        try {
          await patchClaimStore.remove({ rootPath: task.rootPath, rootIdentity: task.rootIdentity, transactionId });
        } catch {
          throw patchOperationError("PATCH_TRANSACTION_STATE_ERROR", "The revert safety claim could not be cleared after journal creation failed. No project file was changed; restart CodeClaw before retrying.", 500);
        }
        if (error.code?.startsWith("PATCH_")) throw error;
        throw patchOperationError("PATCH_TRANSACTION_STATE_ERROR", "The revert safety journal could not be created, so no project file was changed.", 500);
      }
      const recovery = await withPatchRecoveryOwnership(task.rootPath, () => recoverPatchTransactions({
        store: patchTransactionStore,
        taskStore,
        registryFactory: (rootPath) => new ToolRegistry({ rootPath }),
        beforeRemove: markPatchClaimComplete,
        rootPath: task.rootPath
      }), task.rootIdentity);
      await updateGlobalPatchRecoveryStatus(recovery);
      if (recovery.committedCleanup) {
        const updatedTask = await taskStore.get(task.id);
        await recordAudit({ type: "task.patch.revert", title: "Patch reverted", detail: currentPatch.path, rootPath: task.rootPath, metadata: { taskId: task.id, transactionId: transaction.id, recoveredCommit: true } });
        return json(response, { ok: true, result: write?.result, recoveredCommit: true, task: updatedTask });
      }
      if (!recovery.ok) {
        throw patchOperationError("PATCH_REVERT_STATE_ERROR", "The revert stopped and automatic recovery needs review. CodeClaw will not write again until the recovery conflict is resolved.", 500);
      }
      if (error.code === "PATCH_BASELINE_CONFLICT") throw error;
      throw patchOperationError("PATCH_REVERT_STATE_ERROR", "The revert could not be completed, so the applied patch content was restored. Retry after checking local state storage.", 500);
    }
  });
}

async function attachPatchBaselines(proposal, task, registry) {
  if (!proposal || typeof proposal !== "object") return proposal;
  if (proposal.files?.length) {
    const files = await Promise.all(proposal.files.map(async (file) => ({
      ...file,
      expectedBaseline: await baselineForProposalFile(registry, task, file.path)
    })));
    const primary = files.find((file) => samePatchPath(file.path, proposal.path)) || files[0];
    return { ...proposal, expectedBaseline: primary?.expectedBaseline || null, files };
  }
  if (proposal.path && typeof proposal.content === "string") {
    return { ...proposal, expectedBaseline: await baselineForProposalFile(registry, task, proposal.path) };
  }
  return proposal;
}

async function baselineForProposalFile(registry, task, filePath) {
  const contextBaseline = baselineFromTaskContext(task, filePath);
  if (contextBaseline) return contextBaseline;
  const current = await readRegistryFileState(registry, filePath);
  return current.exists ? null : { exists: false, sha256: null };
}

function getProposalFiles(proposal) {
  if (proposal?.files?.length) return proposal.files;
  if (proposal?.path && typeof proposal.content === "string") {
    return [{
      path: proposal.path,
      content: proposal.content,
      summary: proposal.summary,
      diff: proposal.diff,
      expectedBaseline: proposal.expectedBaseline,
      parentIdentity: proposal.parentIdentity
    }];
  }
  return [];
}

async function preparePatchWrites(registry, task, proposalFiles, proposal) {
  const prepared = [];
  const missingBaselines = [];
  const missingParentIdentities = [];
  const duplicatePaths = new Set();
  const seenPaths = new Set();

  for (const file of proposalFiles) {
    const normalizedPath = normalizePatchPath(file.path);
    if (seenPaths.has(normalizedPath)) duplicatePaths.add(file.path);
    seenPaths.add(normalizedPath);
    const expectedBaseline = validPatchBaseline(file.expectedBaseline)
      || (proposalFiles.length === 1 ? validPatchBaseline(proposal?.expectedBaseline) : null)
      || baselineFromTaskContext(task, file.path);
    if (!expectedBaseline) {
      missingBaselines.push(file.path);
      continue;
    }
    const parentIdentity = validIdentityDigest(file.parentIdentity)
      || (proposalFiles.length === 1 ? validIdentityDigest(proposal?.parentIdentity) : null);
    if (!parentIdentity) {
      missingParentIdentities.push(file.path);
      continue;
    }
    const currentParentIdentity = (await captureWorkspaceParentIdentity(task.rootPath, file.path)).digest;
    if (currentParentIdentity !== parentIdentity) {
      throw patchOperationError("PATCH_PARENT_CHANGED", `The parent directory for ${file.path} changed after review. No file was written.`, 409);
    }
    const snapshot = await assertCurrentBaseline(
      registry,
      file.path,
      expectedBaseline,
      "PATCH_BASELINE_CONFLICT",
      "The file changed after it was read for this proposal. Reread context and generate a new patch before applying."
    );
    prepared.push({ ...file, expectedBaseline, parentIdentity, snapshot });
  }

  if (duplicatePaths.size) {
    throw patchOperationError("PATCH_DUPLICATE_PATH", `The proposal targets the same file more than once: ${[...duplicatePaths].join(", ")}. Regenerate a single change per file.`, 409);
  }
  if (missingBaselines.length) {
    throw patchOperationError("PATCH_BASELINE_MISSING", `No complete safety baseline is available for: ${missingBaselines.join(", ")}. Read those files fully and regenerate the patch.`, 409);
  }
  if (missingParentIdentities.length) {
    throw patchOperationError("PATCH_PARENT_IDENTITY_MISSING", `No reviewed parent-directory identity is available for: ${missingParentIdentities.join(", ")}. Regenerate the patch.`, 409);
  }
  return prepared;
}

async function assertCurrentBaseline(registry, filePath, expectedBaseline, code, instruction) {
  const current = await readRegistryFileState(registry, filePath);
  const matchesExistence = expectedBaseline.exists === current.exists;
  const matchesContent = !current.exists || hashContent(current.content) === expectedBaseline.sha256;
  if (!matchesExistence || !matchesContent) {
    throw patchOperationError(code, `${instruction} File: ${filePath}.`, 409);
  }
  return current;
}

async function readRegistryFileState(registry, filePath) {
  try {
    const read = await registry.call("read_file", { path: filePath });
    return { exists: true, content: read.result };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, content: "" };
    throw error;
  }
}

function baselineFromTaskContext(task, filePath) {
  const context = (task?.contextFiles || []).find((item) => samePatchPath(item.path, filePath));
  if (!context || typeof context.content !== "string" || context.contentComplete === false) return null;
  return { exists: true, sha256: hashContent(context.content) };
}

function validPatchBaseline(baseline) {
  if (!baseline || typeof baseline.exists !== "boolean") return null;
  if (!baseline.exists) return { exists: false, sha256: null };
  if (typeof baseline.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(baseline.sha256)) return null;
  return { exists: true, sha256: baseline.sha256.toLowerCase() };
}

function validIdentityDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function samePatchPath(left, right) {
  return normalizePatchPath(left) === normalizePatchPath(right);
}

function normalizePatchPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function patchOperationError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function assertProposalApproval(proposal, requestBody, workspaceIdentity) {
  const digestIsCurrent = proposal?.proposalDigest && proposal.proposalDigest === patchProposalDigest(proposal);
  if (!proposal?.proposalId
    || !digestIsCurrent
    || !workspaceIdentity
    || proposal.workspaceIdentity !== workspaceIdentity
    || requestBody.proposalId !== proposal.proposalId
    || requestBody.proposalDigest !== proposal.proposalDigest) {
    throw patchOperationError("PATCH_APPROVAL_STALE", "The patch proposal changed after review. Review the current proposal and approve it again.", 409);
  }
}

function assertRevertApproval(patch, requestBody, workspaceIdentity) {
  const identityIsCurrent = patch?.patchIdentity && patch.patchIdentity === appliedPatchIdentity(patch);
  if (!identityIsCurrent
    || !workspaceIdentity
    || patch.workspaceIdentity !== workspaceIdentity
    || requestBody.workspaceIdentity !== workspaceIdentity
    || requestBody.patchIdentity !== patch.patchIdentity) {
    throw patchOperationError("PATCH_APPROVAL_STALE", "The selected applied patch changed after review. Review the current patch record and approve Revert again.", 409);
  }
}

async function canonicalizeTaskRoot(task, action) {
  if (!task?.rootPath || !task.rootIdentity) {
    throw patchOperationError("PATCH_WORKSPACE_RESCAN_REQUIRED", `The saved workspace identity is unavailable. Rescan the project and create a new task before attempting to ${action}.`, 409);
  }
  let current;
  try {
    current = await captureWorkspaceIdentity(task.rootPath);
  } catch {
    throw patchOperationError("PATCH_WORKSPACE_CHANGED", `The workspace root is unavailable or unsafe. Stop before attempting to ${action}.`, 409);
  }
  if (current.digest !== task.rootIdentity) {
    throw patchOperationError("PATCH_WORKSPACE_CHANGED", `The folder at this path is not the same workspace that was reviewed. No write was started for ${action}.`, 409);
  }
  if (current.rootPath === task.rootPath) return task;
  return taskStore.update(task.id, { rootPath: current.rootPath });
}

async function scanRepo(request, response) {
  const body = await readJson(request);
  const repositoryPath = await assertRepositoryDirectory(body.path, "scan");
  lastRepoProfile = await scanRepositoryWithFriendlyErrors(repositoryPath);
  toolRegistry = new ToolRegistry({ rootPath: lastRepoProfile.rootPath, allowedCommands: lastRepoProfile.commands });
  const memory = await memoryStore.upsertProfile(lastRepoProfile);
  await recordAudit({
    type: "repo.scan",
    title: "Repository scanned",
    detail: `${lastRepoProfile.fileCount} files, ${lastRepoProfile.skippedCount} skipped`,
    rootPath: lastRepoProfile.rootPath,
    metadata: { languages: lastRepoProfile.languages, commands: lastRepoProfile.commands }
  });
  return json(response, { ok: true, profile: lastRepoProfile, memory });
}

async function createPlan(request, response) {
  const body = await readJson(request);
  const repoProfile = body.repoProfile || lastRepoProfile || {};
  const plan = createTaskPlan(body.goal, repoProfile);
  const permissions = plan.steps.flatMap((step) => step.tools.map((tool) => classifyToolCall(tool)));
  let task = null;
  if (body.taskId) task = await taskStore.setPlan(body.taskId, plan);
  await recordAudit({
    type: "agent.plan",
    title: "Plan generated",
    detail: `${plan.title}: ${plan.steps.length} step(s)`,
    rootPath: repoProfile.rootPath || lastRepoProfile?.rootPath,
    metadata: { taskId: body.taskId || null, goal: body.goal, intent: plan.intent, confidence: plan.confidence }
  });
  return json(response, { ok: true, plan, permissions, task });
}

async function callTool(request, response) {
  const body = await readJson(request);
  if (body.tool === "write_patch") {
    throw patchOperationError("PATCH_TRANSACTION_REQUIRED", "Direct file writes are disabled. Generate a patch proposal, review it, and use the transaction-protected Apply action.", 409);
  }
  const registry = getToolRegistry(body.rootPath);
  const result = await registry.call(body.tool, body.args || {}, { approved: Boolean(body.approved) });
  const rootPath = lastRepoProfile?.rootPath || body.rootPath;

  let task = null;
  if (body.taskId) {
    task = await taskStore.appendToolCall(body.taskId, {
      tool: body.tool,
      args: summarizeArgs(body.args || {}),
      blocked: Boolean(result.blocked),
      approved: Boolean(body.approved),
      permission: result.permission,
      summary: summarizeToolResult(result)
    });
    if (body.tool === "run_command" && result.ok && result.result && !result.blocked) {
      task = await taskStore.setVerification(body.taskId, result.result);
    }
    if (body.tool === "read_file" && result.ok && typeof result.result === "string") {
      task = await taskStore.appendContextFile(body.taskId, {
        path: body.args?.path,
        summary: summarizeContent(result.result),
        content: result.result.slice(0, MAX_CONTEXT_CONTENT_CHARS),
        contentComplete: result.result.length <= MAX_CONTEXT_CONTENT_CHARS,
        size: result.result.length,
        source: "read_file"
      });
    }
  }

  await recordAudit({
    type: "tool.call",
    status: result.blocked ? "blocked" : result.ok ? "ok" : "error",
    title: `Tool ${body.tool}`,
    detail: summarizeToolResult(result),
    rootPath,
    metadata: {
      taskId: body.taskId || null,
      tool: body.tool,
      args: summarizeArgs(body.args || {}),
      approved: Boolean(body.approved),
      permission: result.permission
    }
  });
  return json(response, { ...result, task });
}

function getToolRegistry(rootPath) {
  if (rootPath && (!lastRepoProfile || path.resolve(rootPath) !== lastRepoProfile.rootPath)) {
    lastRepoProfile = { rootPath: path.resolve(rootPath), commands: [] };
    toolRegistry = new ToolRegistry({ rootPath });
  }
  if (!toolRegistry) throw new Error("Scan a repository before calling tools.");
  return toolRegistry;
}

async function ensurePatchRecoveryReady(rootPath, rootIdentity) {
  const recovery = await withPatchRecoveryOwnership(rootPath, () => recoverPatchTransactions({
    store: patchTransactionStore,
    taskStore,
    registryFactory: (selectedRoot) => new ToolRegistry({ rootPath: selectedRoot }),
    beforeRemove: markPatchClaimComplete,
    rootPath
  }), rootIdentity);
  await updateGlobalPatchRecoveryStatus(recovery);
  const hasUnscopedInvalidJournal = (await patchTransactionStore.listPending()).some((transaction) => transaction.invalid);
  if (!recovery.ok || hasUnscopedInvalidJournal) {
    throw patchOperationError("PATCH_RECOVERY_REQUIRED", "An unfinished patch operation needs review. CodeClaw has stopped all Apply and Revert writes for this project to avoid overwriting unknown edits.", 409);
  }
}

async function withPatchRecoveryOwnership(rootPath, recovery, expectedRootIdentity = "") {
  const pendingBefore = await pendingPatchTransactionsForRoot(rootPath);
  const journalIdentities = [...new Set(pendingBefore.map((transaction) => transaction.rootIdentity))];
  if (journalIdentities.length > 1) {
    throw patchOperationError("PATCH_TRANSACTION_CLAIM_MISMATCH", "More than one workspace identity is present in local recovery journals for this project.", 409);
  }
  const rootIdentity = expectedRootIdentity || journalIdentities[0] || (await captureWorkspaceIdentity(rootPath)).digest;
  if (journalIdentities.length && journalIdentities[0] !== rootIdentity) {
    throw patchOperationError("PATCH_TRANSACTION_CLAIM_ROOT_MISMATCH", "The local recovery journal belongs to a different workspace identity.", 409);
  }
  await patchClaimStore.assertCompatible({
    rootPath,
    rootIdentity,
    pendingTransactionIds: pendingBefore.map((transaction) => transaction.id)
  });
  const result = await recovery();
  const pendingAfter = await pendingPatchTransactionsForRoot(rootPath);
  if (!pendingAfter.length) {
    await patchClaimStore.assertCompatible({ rootPath, rootIdentity, pendingTransactionIds: [] });
  }
  return result;
}

async function pendingPatchTransactionsForRoot(rootPath) {
  const selected = canonicalRootPath(rootPath);
  return (await patchTransactionStore.listPending()).filter((transaction) => !transaction.invalid
    && transaction.rootPath
    && canonicalRootPath(transaction.rootPath) === selected);
}

function canonicalRootPath(rootPath) {
  const resolved = path.resolve(rootPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function updateGlobalPatchRecoveryStatus(recovery) {
  const pending = await patchTransactionStore.listPending();
  if (!pending.length) {
    patchRecoveryStatus = recovery;
    return;
  }
  patchRecoveryStatus = {
    ...recovery,
    ok: false,
    checkedAt: new Date().toISOString(),
    pending: pending.length,
    blocked: Math.max(1, recovery.blocked || 0),
    transactions: recovery.transactions.length
      ? recovery.transactions
      : [{ operation: "unknown", status: "blocked", itemCount: 0, conflicts: 0, code: "PATCH_RECOVERY_REQUIRED" }]
  };
}

async function cleanupCommittedPatchTransaction(transaction) {
  try {
    await assertCommittedPatchTransactionState(transaction);
    await markPatchClaimComplete(transaction);
    await patchTransactionStore.remove(transaction.id);
    await patchClaimStore.remove({
      rootPath: transaction.rootPath,
      rootIdentity: transaction.rootIdentity,
      transactionId: transaction.id
    });
    return true;
  } catch {
    patchRecoveryStatus = {
      ok: false,
      mode: "patch-transaction-recovery",
      checkedAt: new Date().toISOString(),
      pending: 1,
      recovered: 0,
      committedCleanup: 0,
      blocked: 1,
      transactions: [{ operation: transaction.operation, status: "blocked", itemCount: 0, conflicts: 1, code: "PATCH_TRANSACTION_CLEANUP_FAILED" }]
    };
    return false;
  }
}

async function assertCommittedPatchTransactionState(transaction) {
  const workspace = await captureWorkspaceIdentity(transaction.rootPath).catch(() => null);
  if (!workspace || workspace.digest !== transaction.rootIdentity) {
    throw patchOperationError("PATCH_TRANSACTION_ROOT_CHANGED", "The committed patch workspace changed before transaction cleanup.", 409);
  }
  const registry = new ToolRegistry({ rootPath: transaction.rootPath });
  for (const item of transaction.items) {
    const parent = await captureWorkspaceParentIdentity(transaction.rootPath, item.path).catch(() => null);
    if (!parent || parent.digest !== item.parentIdentity) {
      throw patchOperationError("PATCH_TRANSACTION_PARENT_CHANGED", "A committed patch parent directory changed before transaction cleanup.", 409);
    }
    const current = await readRegistryFileState(registry, item.path);
    const parentAfterRead = await captureWorkspaceParentIdentity(transaction.rootPath, item.path).catch(() => null);
    if (!parentAfterRead || parentAfterRead.digest !== item.parentIdentity) {
      throw patchOperationError("PATCH_TRANSACTION_PARENT_CHANGED", "A committed patch parent directory changed during transaction cleanup verification.", 409);
    }
    const matches = current.exists === item.after.exists
      && (!current.exists || hashContent(current.content) === item.after.sha256);
    if (!matches) {
      throw patchOperationError("PATCH_TRANSACTION_COMMITTED_DRIFT", "The committed patch result changed before transaction cleanup.", 409);
    }
  }
}

async function markPatchClaimComplete(transaction) {
  await patchClaimStore.markComplete({
    rootPath: transaction.rootPath,
    rootIdentity: transaction.rootIdentity,
    transactionId: transaction.id
  });
}

function emptyPatchRecoveryStatus() {
  return {
    ok: true,
    mode: "patch-transaction-recovery",
    checkedAt: null,
    pending: 0,
    recovered: 0,
    committedCleanup: 0,
    blocked: 0,
    transactions: []
  };
}

async function serializePatchOperation(rootPath, operation) {
  const resolved = path.resolve(rootPath);
  const key = await canonicalPathLockKey(resolved);
  const previous = patchOperationQueues.get(key) || Promise.resolve();
  const lockedOperation = () => projectWriteLockManager.withLock(key, operation);
  const result = previous.then(lockedOperation, lockedOperation);
  const settled = result.catch(() => {});
  patchOperationQueues.set(key, settled);
  try {
    return await result;
  } finally {
    if (patchOperationQueues.get(key) === settled) patchOperationQueues.delete(key);
  }
}

async function serveStatic(pathname, response) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const requested = path.normalize(normalized).replace(/^([.][.][\\/])+/, "");
  const filePath = path.join(publicDir, requested);
  const content = await fs.readFile(filePath);
  response.writeHead(200, { "content-type": contentType(filePath) });
  response.end(content);
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function loadModelConfig() {
  try {
    modelConfig = sanitizeModelConfig(JSON.parse(await fs.readFile(modelConfigPath, "utf8")));
    modelProvider = new ModelProvider(modelConfig);
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Failed to load model config: ${error.message}`);
  }
}

async function ensureModelConfigLoaded() {
  if (modelConfig.type === "mock") await loadModelConfig();
}

async function recordAudit(event) {
  try {
    await auditLog.record(event);
  } catch {}
}

function summarizeArgs(args) {
  const clone = { ...args };
  if (typeof clone.content === "string") clone.content = `${clone.content.length} character(s)`;
  return clone;
}

function summarizeContent(content) {
  return String(content || "").split(/\r?\n/).filter(Boolean).slice(0, 12).join("\n").slice(0, 800);
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}
