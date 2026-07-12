import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
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
import { MODEL_OPERATIONS, ModelProvider, publicModelConfig, sanitizeModelConfig, selectContextFiles } from "../../packages/model-provider/src/index.js";
import { buildOpenAICompatibleEndpoint } from "../../packages/model-provider/src/safe-transport.js";
import { ModelOutboundPreviewStore } from "../../packages/model-outbound/src/preview-store.js";
import { buildDataBoundaryManifest, manifestsHaveSameSource, readManifestFiles } from "../../packages/data-boundary/src/index.js";
import { decidePreflightGate, pickSearchQuery, summarizeContextCoverage } from "../../packages/preflight/src/index.js";
import { PatchTransactionStore, recoverPatchTransactions } from "../../packages/patch-transaction/src/index.js";
import { PatchTransactionClaimStore, loadPatchStateOwnerId } from "../../packages/patch-transaction/src/claim-store.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../packages/shared/src/cross-process-lock.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity } from "../../packages/shared/src/workspace-identity.js";
import { isProtectedDirectory, isSensitiveFile } from "../../packages/shared/src/path-utils.js";
import { WorkspaceCapabilityStore } from "../../packages/workspace-capability/src/index.js";
import { atomicWriteFile } from "../../packages/shared/src/atomic-file.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const localStateDir = path.resolve(process.env.CODECLAW_STATE_DIR || path.join(process.cwd(), ".codeclaw"));
const demoPath = path.resolve(__dirname, "../../examples/demo-js");
const disposableCopyRoot = path.resolve(process.env.CODECLAW_DISPOSABLE_ROOT
  || (process.env.CODECLAW_STATE_DIR ? path.join(localStateDir, "disposable-copies") : defaultDisposableCopyRoot(localStateDir)));
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
const workspaceCapabilityStore = new WorkspaceCapabilityStore({
  storagePath: path.join(localStateDir, "workspace-capabilities.json"),
  copyRootPath: disposableCopyRoot,
  demoPath
});
const modelConfigPath = path.join(localStateDir, "model.json");
const MODEL_CONTEXT_MAX_FILE_BYTES = 1024 * 1024;
const MODEL_CONTEXT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MODEL_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
const UNTRUSTED_REQUEST_REJECTION_CODES = new Set(["LOCAL_ORIGIN_REQUIRED", "JSON_CONTENT_TYPE_REQUIRED", "JSON_BODY_INVALID"]);
const port = DEFAULT_PORT;
let lastRepoProfile = null;
let toolRegistry = null;
let modelConfig = sanitizeModelConfig({ type: "mock", name: "mock", model: "mock-codeclaw" });
let modelProvider = new ModelProvider(modelConfig);
let modelConfigGeneration = randomUUID();
const modelOutboundPreviews = new ModelOutboundPreviewStore();
let modelStateQueue = Promise.resolve();
let patchRecoveryStatus = emptyPatchRecoveryStatus();
let lastWorkspace = null;
let lastWorkspaceBinding = null;
const patchOperationQueues = new Map();

function defaultProjectCoordinationDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodeClaw", "transaction-coordination-v1");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "codeclaw", "transaction-coordination-v1");
}

function defaultDisposableCopyRoot(stateDir) {
  const canonicalState = process.platform === "win32" ? path.resolve(stateDir).toLowerCase() : path.resolve(stateDir);
  const stateKey = createHash("sha256").update(canonicalState, "utf8").digest("hex").slice(0, 24);
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodeClaw", "disposable-workspaces-v1", stateKey);
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "codeclaw", "disposable-workspaces-v1", stateKey);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    assertLocalJsonRequest(request);
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, { ok: true, app: "CodeClaw", time: new Date().toISOString() });
    if (request.method === "GET" && url.pathname === "/api/system/check") return await systemCheck(response);
    if (request.method === "GET" && url.pathname === "/api/session/last") return await getLastSession(response);
    if (request.method === "GET" && url.pathname === "/api/audit/events") return await getAuditEvents(url, response);
    if (request.method === "GET" && url.pathname === "/api/memory") return await getMemory(url, response);
    if (request.method === "POST" && url.pathname === "/api/memory/notes") return await updateMemoryNotes(request, response);
    if (request.method === "GET" && url.pathname === "/api/model/status") return await getModelStatus(response);
    if (request.method === "GET" && url.pathname === "/api/patch-recovery/status") return json(response, { ok: true, recovery: patchRecoveryStatus });
    if (request.method === "GET" && url.pathname === "/api/workspaces") return await listWorkspaces(response);
    if (request.method === "POST" && url.pathname === "/api/workspaces/copy/preview") return await previewWorkspaceCopy(request, response);
    if (request.method === "POST" && url.pathname === "/api/workspaces/copy/create") return await createWorkspaceCopy(request, response);
    if (request.method === "POST" && url.pathname === "/api/workspaces/activate") return await activateWorkspace(request, response);
    if (request.method === "POST" && url.pathname === "/api/workspaces/cleanup") return await cleanupWorkspace(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/config") return await setModelConfig(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/preview") return await previewModelOperation(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/cancel") return await cancelModelOperation(request, response);
    if (request.method === "POST" && url.pathname === "/api/model/send") return await sendModelOperation(request, response);
    if (request.method === "POST" && url.pathname === "/api/preflight/run") return await runPreflight(request, response);
    if (request.method === "GET" && url.pathname === "/api/tasks/latest") return await getLatestTask(url, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/create") return await createTask(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/complete") return await completeTask(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/apply-patch") return await applyPatch(request, response);
    if (request.method === "POST" && url.pathname === "/api/tasks/revert-patch") return await revertPatch(request, response);
    if (request.method === "POST" && url.pathname === "/api/repo/scan") return await scanRepo(request, response);
    if (request.method === "POST" && url.pathname === "/api/agent/plan") return await createPlan(request, response);
    if (request.method === "POST" && url.pathname === "/api/tools/call") return await callTool(request, response);
    if (url.pathname.startsWith("/api/")) throw patchOperationError("API_NOT_FOUND", "The requested CodeClaw API endpoint does not exist.", 404);
    return await serveStatic(url.pathname, response);
  } catch (error) {
    if (!UNTRUSTED_REQUEST_REJECTION_CODES.has(error.code)) {
      await recordAudit({ type: "server.error", status: "error", title: "Server error", rootPath: lastRepoProfile?.rootPath, metadata: { code: error.code || "SERVER_ERROR" } });
    }
    return json(response, { ok: false, code: error.code || "SERVER_ERROR", error: error.message }, localErrorStatus(error));
  }
});

await startServer();

async function startServer() {
  await taskStore.initialize();
  await auditLog.redactLegacyModelData();
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
  await workspaceCapabilityStore.initialize();
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
  const memory = await memoryStore.latest();
  let profile = memory ? profileFromMemory(memory) : null;
  if (profile) {
    try {
      profile.rootPath = await assertRepositoryDirectory(profile.rootPath, "restore a saved session");
    } catch {
      profile = null;
    }
  }
  const restorableMemory = profile ? memory : null;
  const task = profile
    ? await taskStore.latest({ rootPath: profile.rootPath })
    : memory
      ? null
      : await taskStore.latest();
  let workspace = null;
  if (profile) {
    workspace = await workspaceCapabilityStore.register(profile.rootPath).catch(() => null);
    if (workspace) {
      lastRepoProfile = profile;
      await bindLastWorkspace(workspace, profile.rootPath, profile.commands);
    }
  }
  return json(response, {
    ok: true,
    session: restorableMemory ? {
      restored: true,
      rootPath: restorableMemory.rootPath,
      restoredAt: new Date().toISOString(),
      needsPreflight: true
    } : null,
    profile,
    task,
    memory: restorableMemory,
    workspace,
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
  let demoDirectoryPresent = false;
  try {
    demoDirectoryPresent = (await fs.stat(demoPath)).isDirectory();
  } catch {}
  const workspace = demoDirectoryPresent ? await workspaceCapabilityStore.describePath(demoPath) : null;
  const demoExists = workspace?.kind === "built-in-demo";
  return json(response, {
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    demoPath,
    demoExists,
    workspace,
    model: modelProvider.status(),
    recovery: patchRecoveryStatus
  });
}

async function listWorkspaces(response) {
  const result = await workspaceCapabilityStore.list();
  return json(response, { ok: true, ...result });
}

async function previewWorkspaceCopy(request, response) {
  const body = await readJson(request);
  const sourcePath = await assertDisposableCopySourceDirectory(body.sourcePath);
  const preview = await workspaceCapabilityStore.previewCopy(sourcePath);
  await recordAudit({
    type: "workspace.copy.preview",
    status: preview.eligible ? "ok" : "blocked",
    title: "Disposable copy previewed",
    detail: `${preview.fileCount} file(s), ${preview.excluded.length} excluded, ${preview.blockers.length} blocked`,
    rootPath: preview.sourcePath,
    metadata: { policyVersion: preview.policyVersion, eligible: preview.eligible, fileCount: preview.fileCount, excluded: preview.excluded.length, blockers: preview.blockers.length }
  });
  return json(response, { ok: true, preview });
}

async function createWorkspaceCopy(request, response) {
  const body = await readJson(request);
  const workspace = await workspaceCapabilityStore.createCopy({
    previewId: body.previewId,
    previewDigest: body.previewDigest
  });
  await recordAudit({
    type: "workspace.copy.create",
    title: "Disposable copy created",
    detail: workspace.id,
    rootPath: workspace.rootPath,
    metadata: { workspaceId: workspace.id, kind: workspace.kind }
  });
  return json(response, { ok: true, workspace });
}

async function activateWorkspace(request, response) {
  const body = await readJson(request);
  const listed = await workspaceCapabilityStore.list();
  const selected = listed.workspaces.find((item) => item.id === body.workspaceId);
  if (selected?.rootPath) await assertRepositoryDirectory(selected.rootPath, "activate a workspace");
  const workspace = await workspaceCapabilityStore.activate({
    workspaceId: body.workspaceId,
    workspaceDigest: body.workspaceDigest
  });
  const repositoryPath = await assertRepositoryDirectory(workspace.rootPath, "activate a workspace");
  const profile = await scanRepositoryWithFriendlyErrors(repositoryPath);
  lastRepoProfile = profile;
  await bindLastWorkspace(workspace, profile.rootPath, profile.commands);
  const memory = await memoryStore.upsertProfile(profile);
  await recordAudit({
    type: "workspace.activate",
    title: "Workspace activated",
    detail: `${workspace.kind}: ${workspace.id}`,
    rootPath: workspace.rootPath,
    metadata: { workspaceId: workspace.id, kind: workspace.kind, canWrite: workspace.canWrite, canRunCommands: workspace.canRunCommands }
  });
  return json(response, { ok: true, workspace, profile, memory });
}

async function cleanupWorkspace(request, response) {
  const body = await readJson(request);
  if (body.approved !== true) {
    throw patchOperationError("WORKSPACE_CLEANUP_APPROVAL_REQUIRED", "Permanently deleting a disposable copy requires explicit approval.", 409);
  }
  const listed = await workspaceCapabilityStore.list();
  const selected = listed.workspaces.find((item) => item.id === body.workspaceId && item.kind === "disposable-copy");
  if (!selected) throw patchOperationError("WORKSPACE_UNKNOWN", "The disposable copy is not registered by this CodeClaw state.", 404);
  const result = await serializePatchOperation(selected.rootPath, async () => {
    if (selected.status !== "cleanup-pending") {
      const identity = await captureWorkspaceIdentity(selected.rootPath);
      await ensurePatchRecoveryReady(selected.rootPath, identity.digest);
    }
    return workspaceCapabilityStore.cleanup({ workspaceId: body.workspaceId, workspaceDigest: body.workspaceDigest });
  });
  if (lastRepoProfile && canonicalRootPath(lastRepoProfile.rootPath) === canonicalRootPath(selected.rootPath)) {
    lastRepoProfile = null;
    lastWorkspace = null;
    lastWorkspaceBinding = null;
    toolRegistry = null;
  }
  await recordAudit({
    type: "workspace.copy.cleanup",
    title: "Disposable copy removed",
    detail: result.workspaceId,
    metadata: { workspaceId: result.workspaceId }
  });
  return json(response, { ok: true, result });
}

async function assertDisposableCopySourceDirectory(inputPath) {
  const action = "preview a disposable copy";
  const trimmed = String(inputPath || "").trim().replace(/^["']|["']$/g, "");
  if (!trimmed) throw pathInputError("PATH_EMPTY", `Missing repository path for ${action}.`, 400);

  const requestedRoot = path.resolve(trimmed);
  let before;
  try {
    before = await fs.lstat(requestedRoot, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") throw pathInputError("PATH_NOT_FOUND", `Project path was not found: ${requestedRoot}`, 404);
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw pathInputError("PATH_PERMISSION_DENIED", `Permission denied while reading project path: ${requestedRoot}`, 403);
    }
    throw error;
  }
  if (before.isSymbolicLink()) {
    throw pathInputError("PATH_LINKED_DIRECTORY", "A disposable-copy source must be the real project directory, not a symbolic link or junction.", 409);
  }
  if (!before.isDirectory()) {
    throw pathInputError("PATH_IS_FILE", `Project path must be a folder, not a file: ${requestedRoot}`, 400);
  }

  let canonicalRoot;
  let after;
  let canonicalStat;
  try {
    canonicalRoot = await fs.realpath(requestedRoot);
    [after, canonicalStat] = await Promise.all([
      fs.lstat(requestedRoot, { bigint: true }),
      fs.lstat(canonicalRoot, { bigint: true })
    ]);
  } catch {
    throw pathInputError("PATH_CHANGED", "The disposable-copy source changed while CodeClaw was checking it.", 409);
  }
  if (after.isSymbolicLink()
    || !after.isDirectory()
    || canonicalStat.isSymbolicLink()
    || !canonicalStat.isDirectory()
    || !sameRequestedDirectoryEntity(before, after)
    || !sameRequestedDirectoryEntity(after, canonicalStat)) {
    throw pathInputError("PATH_CHANGED", "The disposable-copy source changed while CodeClaw was checking it.", 409);
  }
  await assertRepositoryRootAllowed(canonicalRoot, action);
  return requestedRoot;
}

function sameRequestedDirectoryEntity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs;
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
  const canonicalRoot = await fs.realpath(resolved);
  await assertRepositoryRootAllowed(canonicalRoot, action);
  return canonicalRoot;
}

async function assertRepositoryRootAllowed(rootPath, action) {
  const stateRoot = await fs.realpath(localStateDir).catch(() => path.resolve(localStateDir));
  const copyManagerRoot = await fs.realpath(disposableCopyRoot).catch(() => path.resolve(disposableCopyRoot));
  const coordinationRoot = await fs.realpath(projectLockDir).catch(() => path.resolve(projectLockDir));
  if (canonicalRootPath(rootPath) === canonicalRootPath(copyManagerRoot)) {
    throw pathInputError("PATH_PROTECTED_STATE", `The disposable-copy manager directory cannot be used to ${action}.`, 403);
  }
  if (pathIsAtOrWithin(rootPath, copyManagerRoot)) {
    const registered = await workspaceCapabilityStore.describePath(rootPath).catch(() => null);
    if (registered?.kind === "disposable-copy") return;
    throw pathInputError("PATH_PROTECTED_STATE", `Only an exact registered disposable-copy root can be used to ${action}.`, 403);
  }
  if (pathIsAtOrWithin(rootPath, stateRoot)) {
    throw pathInputError("PATH_PROTECTED_STATE", `CodeClaw private state cannot be used to ${action}.`, 403);
  }
  if (pathIsAtOrWithin(rootPath, coordinationRoot)) {
    throw pathInputError("PATH_PROTECTED_STATE", `CodeClaw private coordination state cannot be used to ${action}.`, 403);
  }
  if (isProtectedDirectory(path.basename(rootPath))) {
    throw pathInputError("PATH_PROTECTED_ROOT", `Protected metadata or generated directories cannot be used to ${action}.`, 403);
  }
  if (privateRootWouldBeVisible(rootPath, stateRoot)
    || privateRootWouldBeVisible(rootPath, copyManagerRoot)
    || privateRootWouldBeVisible(rootPath, coordinationRoot)) {
    throw pathInputError("PATH_PROTECTED_STATE", `This project selection would expose CodeClaw private state while attempting to ${action}.`, 403);
  }
}

function privateRootWouldBeVisible(workspaceRoot, privateRoot) {
  if (!pathIsAtOrWithin(privateRoot, workspaceRoot) || canonicalRootPath(privateRoot) === canonicalRootPath(workspaceRoot)) return false;
  const relative = path.relative(workspaceRoot, privateRoot);
  return relative.split(path.sep).filter(Boolean).every((segment) => !isProtectedDirectory(segment));
}

function pathIsAtOrWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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
  return json(response, { ok: true, config: publicModelConfig(modelConfig), status: modelProvider.status() });
}

async function setModelConfig(request, response) {
  const body = await readJson(request);
  assertOnlyRequestFields(body, ["type", "name", "baseUrl", "model", "apiKey"], "MODEL_CONFIG_FIELDS_INVALID");
  const requested = sanitizeModelConfig({
    type: String(body.type || "mock").trim(),
    name: String(body.name || body.type || "mock").trim(),
    baseUrl: String(body.baseUrl || "").trim(),
    model: String(body.model || (body.type === "openai-compatible" ? "" : "mock-codeclaw")).trim(),
    apiKey: ""
  });
  if (!["mock", "openai-compatible"].includes(requested.type)) {
    throw patchOperationError("MODEL_CONFIG_TYPE_INVALID", "Model type must be mock or openai-compatible.", 400);
  }
  const suppliedKey = body.apiKey == null ? "" : String(body.apiKey);
  if (suppliedKey === "configured" || /[\u0000-\u001f\u007f]/.test(suppliedKey)) {
    throw patchOperationError("MODEL_CONFIG_KEY_INVALID", "The model API key is invalid.", 400);
  }
  const normalizedRequested = requested.type === "mock" ? { ...requested, baseUrl: "", apiKey: "" } : requested;
  if (normalizedRequested.type === "openai-compatible" && normalizedRequested.baseUrl) {
    try {
      validateModelBaseUrl(normalizedRequested);
    } catch (error) {
      throw patchOperationError("MODEL_CONFIG_ENDPOINT_INVALID", error.message, 400);
    }
  }

  const updated = await serializeModelState(async () => {
    const sameEndpoint = modelConfig.type === normalizedRequested.type
      && modelConfig.name === normalizedRequested.name
      && modelConfig.baseUrl === normalizedRequested.baseUrl
      && modelConfig.model === normalizedRequested.model;
    const apiKey = normalizedRequested.type === "mock" ? "" : suppliedKey || (sameEndpoint ? modelConfig.apiKey : "");
    const nextConfig = { ...normalizedRequested, apiKey };
    const nextProvider = new ModelProvider(nextConfig);
    await persistPublicModelConfig(nextConfig);
    modelConfig = nextConfig;
    modelProvider = nextProvider;
    modelConfigGeneration = randomUUID();
    modelOutboundPreviews.clear();
    await recordAudit({
      type: "model.config",
      title: "Model configured",
      rootPath: lastRepoProfile?.rootPath,
      metadata: { operation: "config", provider: modelConfig.name, model: modelConfig.model, status: modelProvider.status().configured ? "configured" : "incomplete" }
    });
    return { config: publicModelConfig(modelConfig), status: modelProvider.status() };
  });
  return json(response, { ok: true, ...updated });
}

async function previewModelOperation(request, response) {
  const body = await readJson(request);
  assertOnlyRequestFields(body, ["operation", "taskId"], "MODEL_PREVIEW_FIELDS_INVALID");
  const operation = String(body.operation || "");
  if (!MODEL_OPERATIONS.includes(operation)) {
    throw patchOperationError("MODEL_OPERATION_INVALID", "Choose a supported model operation before building a preview.", 400);
  }
  if (typeof body.taskId !== "string" || !body.taskId) {
    throw patchOperationError("MODEL_TASK_REQUIRED", "Create a task before building a model request preview.", 409);
  }

  const task = await taskStore.get(body.taskId);
  const binding = await assertTaskWorkspaceCurrent(task, `preview model operation ${operation}`);
  const initialManifest = await buildModelBoundaryManifest(task.rootPath, binding.workspace);
  assertModelManifestEligible(initialManifest);
  const repoProfile = filterProfileToManifest(
    await scanRepositoryWithFriendlyErrors(task.rootPath),
    initialManifest
  );
  const contextReads = await readModelContext(task, operation, initialManifest);
  const finalManifest = await buildModelBoundaryManifest(task.rootPath, binding.workspace);
  if (!manifestsHaveSameSource(initialManifest, finalManifest)) {
    throw patchOperationError("MODEL_SOURCE_CHANGED", "The workspace changed while CodeClaw was building the model request. Review a fresh preview.", 409);
  }
  const latestTask = await taskStore.get(task.id);
  assertTaskRevision(latestTask, task.revision, "MODEL_TASK_CHANGED");
  await assertTaskWorkspaceCurrent(latestTask, `finish model preview ${operation}`);

  const taskSnapshot = buildModelTaskSnapshot(latestTask, operation, contextReads, finalManifest);
  const prepared = modelProvider.prepare(operation, {
    goal: latestTask.goal,
    repoProfile,
    task: taskSnapshot,
    limit: 8
  });
  if (prepared.byteLength > MODEL_REQUEST_MAX_BYTES) {
    throw patchOperationError("MODEL_REQUEST_TOO_LARGE", `The exact model request exceeds the ${MODEL_REQUEST_MAX_BYTES}-byte limit. Select less context and preview again.`, 413);
  }
  const disclosure = buildServerModelDisclosure(prepared, finalManifest);
  const preview = modelOutboundPreviews.create({
    operation,
    task: latestTask,
    workspace: binding.workspace,
    manifest: finalManifest,
    configGeneration: modelConfigGeneration,
    prepared,
    disclosure
  });
  await recordAudit({
    type: "model.preview",
    title: "Model request previewed",
    rootPath: latestTask.rootPath,
    metadata: {
      operation,
      taskId: latestTask.id,
      provider: prepared.provider.name,
      model: prepared.provider.model,
      requestSha256: preview.request.sha256,
      requestBytes: preview.request.byteLength,
      fileCount: preview.disclosure.files.length,
      channel: preview.request.channel,
      willLeaveDevice: preview.request.willLeaveDevice
    }
  });
  return json(response, { ok: true, preview });
}

async function sendModelOperation(request, response) {
  const body = await readJson(request);
  assertOnlyRequestFields(body, ["previewId", "approvalDigest", "approved"], "MODEL_SEND_FIELDS_INVALID");
  const record = modelOutboundPreviews.take(body);
  let result;
  try {
    assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED");
    let task = await taskStore.get(record.taskId);
    assertTaskRevision(task, record.taskRevision, "MODEL_TASK_CHANGED");
    const binding = await assertTaskWorkspaceCurrent(task, `send model operation ${record.operation}`);
    if (binding.workspace.id !== record.workspaceId || task.rootIdentity !== record.rootIdentity) {
      throw patchOperationError("MODEL_WORKSPACE_CHANGED", "The task workspace changed after preview. No model request was sent.", 409);
    }
    const manifest = await buildModelBoundaryManifest(task.rootPath, binding.workspace);
    if (manifest.manifestDigest !== record.manifestDigest || manifest.policyVersion !== record.manifestPolicyVersion) {
      throw patchOperationError("MODEL_SOURCE_CHANGED", "The workspace changed after preview. No model request was sent.", 409);
    }

    assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED_BEFORE_SEND");
    result = await modelProvider.executePrepared(record.prepared);
    assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED_AFTER_SEND");

    const committed = await serializeModelState(async () => {
      assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED_AFTER_SEND");
      const commitTask = await taskStore.get(record.taskId);
      await assertModelCommitStillCurrent(record, commitTask);
      const responseSummary = summarizeModelResponse(result);
      const modelEvent = modelEventForResult(record, result, responseSummary, "ok");
      const beforeCommit = ({ currentTask }) => assertModelCommitStillCurrent(record, currentTask);
      let updatedTask;
      let publicResult = result;
      if (record.operation === "patch-proposal") {
        const proposal = await attachPatchBaselines(result, commitTask, getToolRegistry(commitTask.rootPath, commitTask.rootIdentity));
        updatedTask = await taskStore.setPatchProposal(commitTask.id, proposal, {
          expectedRevision: record.taskRevision,
          modelEvent,
          beforeCommit
        });
        publicResult = updatedTask.patchProposal;
      } else {
        updatedTask = await taskStore.recordModelEvent(commitTask.id, modelEvent, {
          expectedRevision: record.taskRevision,
          beforeCommit
        });
      }
      return { task: commitTask, updatedTask, publicResult, responseSummary };
    });
    await recordAudit({
      type: "model.send",
      title: "Model request completed",
      rootPath: committed.task.rootPath,
      metadata: {
        operation: record.operation,
        taskId: committed.task.id,
        provider: record.prepared.provider.name,
        model: record.prepared.provider.model,
        requestSha256: record.requestSha256,
        requestBytes: record.byteLength,
        responseSha256: committed.responseSummary.sha256,
        responseBytes: committed.responseSummary.byteLength,
        fileCount: record.disclosure.files.length,
        channel: record.target.channel,
        willLeaveDevice: record.target.willLeaveDevice
      }
    });
    return json(response, { ok: true, operation: record.operation, result: committed.publicResult, task: committed.updatedTask });
  } catch (error) {
    await bestEffortRecordFailedModelEvent(record, result);
    await recordAudit({
      type: "model.send",
      status: "error",
      title: "Model request failed",
      rootPath: record.rootPath,
      metadata: {
        operation: record.operation,
        taskId: record.taskId,
        provider: record.prepared.provider.name,
        model: record.prepared.provider.model,
        requestSha256: record.requestSha256,
        requestBytes: record.byteLength,
        fileCount: record.disclosure.files.length,
        code: error.code || "MODEL_SEND_FAILED",
        channel: record.target.channel,
        willLeaveDevice: record.target.willLeaveDevice
      }
    });
    throw error;
  } finally {
    modelOutboundPreviews.release(record);
    result = null;
  }
}

async function cancelModelOperation(request, response) {
  const body = await readJson(request);
  assertOnlyRequestFields(body, ["previewId", "approvalDigest"], "MODEL_CANCEL_FIELDS_INVALID");
  const result = modelOutboundPreviews.discard(body);
  return json(response, { ok: true, ...result });
}

async function buildModelBoundaryManifest(rootPath, workspace) {
  return buildDataBoundaryManifest(rootPath, {
    allowDisposableMarker: workspace?.kind === "disposable-copy"
  });
}

function assertModelManifestEligible(manifest) {
  if (!manifest?.eligible) {
    throw patchOperationError(
      "MODEL_DATA_BOUNDARY_BLOCKED",
      `The Data Boundary Manifest found ${manifest?.blockers?.length || 0} unsafe or sensitive item(s). No model request was prepared.`,
      409
    );
  }
}

function filterProfileToManifest(profile, manifest) {
  const allowed = new Set((manifest.files || []).map((file) => file.path));
  const files = (profile.files || []).filter((file) => allowed.has(file.path));
  return {
    name: profile.name || "",
    fileCount: files.length,
    skippedCount: profile.skippedCount || 0,
    languages: profile.languages || [],
    frameworks: profile.frameworks || [],
    packageManagers: profile.packageManagers || [],
    commands: (profile.commands || []).map((command) => ({ name: command.name, command: command.command })),
    keyFiles: (profile.keyFiles || []).filter((file) => allowed.has(file)),
    files
  };
}

async function readModelContext(task, operation, manifest) {
  if (!['patch-proposal', 'failure-fix'].includes(operation)) return [];
  const all = Array.isArray(task.contextFiles) ? task.contextFiles : [];
  const selected = operation === "failure-fix" ? all.slice(-8) : all;
  if (operation === "patch-proposal" && selected.some((file) => file.contentComplete !== true)) {
    throw patchOperationError("MODEL_CONTEXT_INCOMPLETE", "A selected context file was not fully read. Read it again before building a patch request.", 409);
  }
  if (!selected.length) return [];
  const reads = await readManifestFiles(task.rootPath, manifest, selected.map((file) => file.path), {
    maxFileBytes: MODEL_CONTEXT_MAX_FILE_BYTES,
    maxTotalBytes: MODEL_CONTEXT_MAX_TOTAL_BYTES
  });
  for (const [index, read] of reads.entries()) {
    const stored = selected[index];
    if (!/^[a-f0-9]{64}$/i.test(stored.sha256 || "") || stored.sha256.toLowerCase() !== read.sha256) {
      throw patchOperationError("MODEL_CONTEXT_CHANGED", `The selected context changed after it was read: ${read.path}. Read it again before previewing model data.`, 409);
    }
  }
  return reads;
}

function buildModelTaskSnapshot(task, operation, contextReads, manifest) {
  const contextByPath = new Map(contextReads.map((file) => [file.path, file]));
  const contextFiles = (task.contextFiles || []).map((file) => {
    const read = contextByPath.get(file.path);
    return {
      path: file.path,
      summary: file.summary || "",
      size: read?.byteLength ?? file.size ?? null,
      sha256: read?.sha256 || file.sha256 || "",
      contentComplete: file.contentComplete === true,
      source: file.source || "",
      ...(read ? { content: read.content } : {})
    };
  });
  const verification = task.verification ? {
    command: task.verification.command || "",
    exitCode: Number.isInteger(task.verification.exitCode) ? task.verification.exitCode : null,
    timedOut: Boolean(task.verification.timedOut),
    durationMs: Number.isFinite(task.verification.durationMs) ? task.verification.durationMs : null
  } : null;
  const snapshot = {
    id: task.id,
    revision: task.revision,
    goal: task.goal,
    status: task.status,
    verification,
    contextFiles
  };
  if (operation === "task-suggest") {
    snapshot.toolCalls = (task.toolCalls || []).map((call) => ({ tool: call.tool || "unknown" }));
  }
  if (operation === "failure-fix") {
    const allowedPaths = new Set((manifest.files || []).map((file) => file.path));
    snapshot.failureSummary = task.failureSummary || "";
    snapshot.toolCalls = (task.toolCalls || []).slice(-8).map((call) => ({
      tool: call.tool || "unknown",
      args: sanitizeModelToolArgs(call.args, allowedPaths),
      summary: call.summary || ""
    }));
    snapshot.appliedPatches = (task.appliedPatches || [])
      .filter((patch) => !patch.revertedAt && allowedPaths.has(patch.path))
      .slice(-4)
      .map((patch) => ({
        path: patch.path,
        summary: patch.summary || "",
        diff: patch.diff || "",
        revertedAt: null
      }));
  }
  return snapshot;
}

function sanitizeModelToolArgs(args, allowedPaths = new Set()) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const output = {};
  if (typeof args.path === "string") {
    const normalizedPath = normalizePatchPath(args.path);
    if (allowedPaths.has(normalizedPath)) output.path = normalizedPath;
  }
  for (const key of ["query", "command"]) {
    if (typeof args[key] === "string") output[key] = args[key].slice(0, 1000);
  }
  return output;
}

function buildServerModelDisclosure(prepared, manifest) {
  assertPreparedDisclosureMatchesTarget(prepared);
  const manifestFiles = new Map((manifest.files || []).map((file) => [file.path, file]));
  const files = [];
  for (const disclosed of prepared.disclosure.files || []) {
    addDisclosureFile(disclosed.path, disclosed.mode, disclosed.transmittedUtf8Bytes);
  }
  const dataClasses = [...prepared.disclosure.dataKinds];
  const containsSourceCode = files.some((file) => file.contentIncluded)
    || dataClasses.some((item) => ["recent-patch-diffs", "failure-summary"].includes(item));
  return {
    policyVersion: manifest.policyVersion,
    manifestDigest: manifest.manifestDigest,
    containsSourceCode,
    anonymized: false,
    safeToShare: false,
    excludedCount: manifest.excluded.length,
    files,
    dataClasses
  };

  function addDisclosureFile(filePath, mode, transmittedUtf8Bytes) {
    const file = manifestFiles.get(filePath);
    if (!file) {
      throw patchOperationError("MODEL_DISCLOSURE_PATH_BLOCKED", `A model request referenced a file outside the current Data Boundary Manifest: ${filePath}.`, 409);
    }
    if (typeof mode !== "string" || !mode
      || !Number.isSafeInteger(transmittedUtf8Bytes) || transmittedUtf8Bytes < 0) {
      throw patchOperationError("MODEL_DISCLOSURE_INVALID", `The model disclosure for ${filePath} is incomplete.`, 500);
    }
    files.push({
      path: filePath,
      mode,
      contentIncluded: ["full-content", "content-excerpt", "patch-diff"].includes(mode),
      byteLength: file.size,
      sha256: file.sha256,
      transmittedUtf8Bytes
    });
  }
}

function assertPreparedDisclosureMatchesTarget(prepared) {
  const disclosure = prepared?.disclosure;
  const target = prepared?.target;
  if (!disclosure || !target
    || !Array.isArray(disclosure.dataKinds) || disclosure.dataKinds.some((item) => typeof item !== "string" || !item)
    || !Array.isArray(disclosure.files)
    || disclosure.sendsNetworkRequest !== prepared.networkRequired
    || disclosure.sendsNetworkRequest !== (target.channel !== "local")
    || disclosure.willLeaveDevice !== target.willLeaveDevice
    || disclosure.endpoint !== target.endpoint) {
    throw patchOperationError("MODEL_DISCLOSURE_INVALID", "The model disclosure does not match the prepared request target.", 500);
  }
}

function assertTaskRevision(task, expectedRevision, code) {
  if (!Number.isSafeInteger(task?.revision) || task.revision !== expectedRevision) {
    throw patchOperationError(code, "The task changed after the model request was previewed. Build and approve a fresh preview.", 409);
  }
}

function assertModelConfigGeneration(record, code) {
  if (record.configGeneration !== modelConfigGeneration) {
    throw patchOperationError(code, "The model configuration changed after preview. Build and approve a fresh request.", 409);
  }
}

async function assertModelCommitStillCurrent(record, task) {
  assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED_BEFORE_COMMIT");
  assertTaskRevision(task, record.taskRevision, "MODEL_TASK_CHANGED_AFTER_SEND");
  const binding = await assertTaskWorkspaceCurrent(task, `commit model result ${record.operation}`);
  if (binding.workspace.id !== record.workspaceId || task.rootIdentity !== record.rootIdentity) {
    throw patchOperationError("MODEL_WORKSPACE_CHANGED_AFTER_SEND", "The task workspace changed while the model request was running. The response was not attached to the task.", 409);
  }
  const manifest = await buildModelBoundaryManifest(task.rootPath, binding.workspace);
  if (manifest.manifestDigest !== record.manifestDigest || manifest.policyVersion !== record.manifestPolicyVersion) {
    throw patchOperationError("MODEL_SOURCE_CHANGED_AFTER_SEND", "The workspace changed while the model request was running. The response was not attached to the task.", 409);
  }
  assertModelConfigGeneration(record, "MODEL_CONFIG_CHANGED_BEFORE_COMMIT");
}

function serializeModelState(operation) {
  const result = modelStateQueue.then(operation, operation);
  modelStateQueue = result.catch(() => {});
  return result;
}

function modelEventForResult(record, result, responseSummary, status) {
  return {
    operation: record.operation,
    provider: result?.provider || record.prepared.provider.name,
    model: result?.model || record.prepared.provider.model,
    requestSha256: record.requestSha256,
    responseSha256: responseSummary?.sha256 || "",
    status
  };
}

async function bestEffortRecordFailedModelEvent(record, result) {
  try {
    const task = await taskStore.get(record.taskId);
    if (task.revision !== record.taskRevision) return;
    const responseSummary = result === undefined ? null : summarizeModelResponse(result);
    await taskStore.recordModelEvent(
      task.id,
      modelEventForResult(record, result, responseSummary, "error"),
      { expectedRevision: record.taskRevision }
    );
  } catch {}
}

function summarizeModelResponse(result) {
  const content = Buffer.from(JSON.stringify(result ?? null), "utf8");
  return {
    byteLength: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

function assertOnlyRequestFields(body, allowedFields, code) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw patchOperationError(code, "The request body must be a JSON object.", 400);
  }
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw patchOperationError(code, `The request contains unsupported authority fields: ${unexpected.join(", ")}.`, 400);
  }
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
  const workspace = await workspaceCapabilityStore.register(repoProfile.rootPath);
  lastRepoProfile = repoProfile;
  await bindLastWorkspace(workspace, repoProfile.rootPath, repoProfile.commands);
  const memory = await memoryStore.upsertProfile(repoProfile);
  const task = await taskStore.create({ goal, rootPath: repoProfile.rootPath, workspaceId: workspace.id });
  await assertTaskWorkspaceCurrent(task, "run preflight tools");
  const plan = createTaskPlan(goal, repoProfile);
  const plannedTask = await taskStore.setPlan(task.id, plan);
  const selected = selectContextFiles({ goal, repoProfile, task: plannedTask, limit: Number.isInteger(body.limit) ? body.limit : 5 });
  let updatedTask = plannedTask;
  const readFiles = [];
  const registry = getToolRegistry(repoProfile.rootPath, task.rootIdentity);

  for (const file of selected) {
    const read = await registry.call("read_file", { path: file.path });
    await assertTaskWorkspaceCurrent(await taskStore.get(task.id), "complete a preflight read");
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
        ...contextFileMetadata(file.path, read.result, "preflight")
      });
    }
    readFiles.push({ path: file.path, ok: Boolean(read.ok), size: typeof read.result === "string" ? Buffer.byteLength(read.result, "utf8") : 0 });
  }

  const searchQuery = pickSearchQuery(goal, selected, repoProfile);
  const search = await registry.call("search_code", { query: searchQuery });
  await assertTaskWorkspaceCurrent(await taskStore.get(task.id), "complete a preflight search");
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
  return json(response, { ok: true, report, profile: repoProfile, task: updatedTask, memory, workspace });
}

async function createTask(request, response) {
  const body = await readJson(request);
  const requestedRoot = body.rootPath || lastRepoProfile?.rootPath;
  const rootPath = requestedRoot ? await assertRepositoryDirectory(requestedRoot, "create a task") : null;
  const workspace = rootPath ? await workspaceCapabilityStore.register(rootPath) : null;
  const task = await taskStore.create({ goal: body.goal, rootPath, workspaceId: workspace?.id || null });
  if (rootPath) await assertTaskWorkspaceCurrent(task, "create a task");
  await recordAudit({ type: "task.create", title: "Task created", detail: task.goal, rootPath: task.rootPath, metadata: { taskId: task.id } });
  return json(response, { ok: true, task, workspace });
}

async function completeTask(request, response) {
  const body = await readJson(request);
  assertOnlyRequestFields(body, ["taskId"], "TASK_COMPLETE_FIELDS_INVALID");
  const existing = await taskStore.get(body.taskId);
  const summary = summarizeTask(existing);
  const reviewDraft = buildTaskReviewDraft(existing, summary);
  const task = await taskStore.complete(body.taskId, summary, reviewDraft);
  const memory = task.rootPath ? await memoryStore.appendTaskSummary(task.rootPath, task, summary) : null;
  await recordAudit({ type: "task.complete", title: "Task completed", detail: summary, rootPath: task.rootPath, metadata: { taskId: task.id } });
  return json(response, { ok: true, task, memory });
}

async function applyPatch(request, response) {
  const body = await readJson(request);
  const initialTask = await taskStore.get(body.taskId);
  await assertTaskCanMutate(initialTask, "apply patches");
  const proposalFiles = getProposalFiles(initialTask.patchProposal);
  if (!proposalFiles.length) throw new Error("No applicable patch proposal.");
  if (body.approved !== true) {
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
    await assertTaskCanMutate(task, "apply patches");
    await ensurePatchRecoveryReady(task.rootPath, task.rootIdentity);
    task = await canonicalizeTaskRoot(await taskStore.get(body.taskId), "apply a patch");
    await assertTaskCanMutate(task, "apply patches");
    const proposal = task.patchProposal;
    assertProposalApproval(proposal, body, task.rootIdentity);
    const currentProposalFiles = getProposalFiles(proposal);
    if (!currentProposalFiles.length) throw new Error("No applicable patch proposal.");
    const registry = getToolRegistry(task.rootPath, task.rootIdentity);
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
  await assertTaskCanMutate(initialTask, "revert patches");
  const patches = initialTask.appliedPatches || [];
  const patchIndex = Number.isInteger(body.patchIndex)
    ? body.patchIndex
    : body.path
      ? patches.findLastIndex((item) => item.path === body.path && !item.revertedAt)
      : patches.findLastIndex((item) => !item.revertedAt);
  const patch = patches[patchIndex];
  if (!patch || patch.revertedAt) throw new Error("No active applied patch to revert.");
  if (body.approved !== true) {
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
    await assertTaskCanMutate(task, "revert patches");
    await ensurePatchRecoveryReady(task.rootPath, task.rootIdentity);
    task = await canonicalizeTaskRoot(await taskStore.get(body.taskId), "revert a patch");
    await assertTaskCanMutate(task, "revert patches");
    const currentPatch = (task.appliedPatches || [])[patchIndex];
    if (!currentPatch || currentPatch.revertedAt) throw new Error("No active applied patch to revert.");
    assertRevertApproval(currentPatch, body, task.rootIdentity);
    const currentParentIdentity = (await captureWorkspaceParentIdentity(task.rootPath, currentPatch.path)).digest;
    if (!currentPatch.parentIdentity || currentParentIdentity !== currentPatch.parentIdentity) {
      throw patchOperationError("PATCH_PARENT_CHANGED", "The applied patch parent directory changed after review. Revert was stopped before any write.", 409);
    }
    const registry = getToolRegistry(task.rootPath, task.rootIdentity);
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
  if (!context || context.contentComplete !== true || !/^[a-f0-9]{64}$/i.test(context.sha256 || "")) return null;
  return { exists: true, sha256: context.sha256.toLowerCase() };
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

async function assertTaskCanMutate(task, action) {
  await assertTaskWorkspaceCurrent(task, action);
  const workspace = await workspaceCapabilityStore.assertCanMutate(task.rootPath, action);
  if (task.workspaceId && task.workspaceId !== workspace.id) {
    throw patchOperationError("WORKSPACE_CAPABILITY_MISMATCH", `The task belongs to a different workspace and cannot ${action}. Create a new task in the active workspace.`, 409);
  }
  if (!task.workspaceId && workspace.kind !== "built-in-demo") {
    throw patchOperationError("WORKSPACE_TASK_RESCAN_REQUIRED", `This saved task predates server-bound workspace capabilities. Scan the active disposable copy and create a new task before attempting to ${action}.`, 409);
  }
  return workspace;
}

async function assertTaskWorkspaceCurrent(task, action) {
  if (!task?.rootPath || !task.rootIdentity || !task.workspaceId) {
    throw patchOperationError("WORKSPACE_TASK_RESCAN_REQUIRED", `This task does not have a complete server-bound workspace identity. Rescan the project and create a new task before attempting to ${action}.`, 409);
  }
  return assertBoundWorkspaceCurrent({
    rootPath: task.rootPath,
    rootIdentity: task.rootIdentity,
    workspaceId: task.workspaceId
  }, action);
}

async function assertLastWorkspaceCurrent(rootPath, action) {
  if (!lastWorkspaceBinding
    || !rootPath
    || canonicalRootPath(rootPath) !== canonicalRootPath(lastWorkspaceBinding.rootPath)) {
    throw patchOperationError("WORKSPACE_CONTEXT_MISSING", `Scan or activate a server-registered workspace before attempting to ${action}.`, 409);
  }
  return assertBoundWorkspaceCurrent(lastWorkspaceBinding, action);
}

async function assertBoundWorkspaceCurrent(binding, action) {
  let current;
  try {
    current = await captureWorkspaceIdentity(binding.rootPath);
  } catch {
    throw patchOperationError("WORKSPACE_IDENTITY_CHANGED", `The workspace root is unavailable, linked, or unsafe. CodeClaw stopped before attempting to ${action}.`, 409);
  }
  if (current.digest !== binding.rootIdentity) {
    throw patchOperationError("WORKSPACE_IDENTITY_CHANGED", `The folder at this path is not the same workspace that the server selected. CodeClaw stopped before attempting to ${action}.`, 409);
  }
  await assertRepositoryRootAllowed(current.rootPath, action);
  const workspace = await workspaceCapabilityStore.describePath(current.rootPath).catch(() => null);
  if (!workspace || workspace.id !== binding.workspaceId) {
    throw patchOperationError("WORKSPACE_CAPABILITY_MISMATCH", `The workspace is no longer registered to this server state. Rescan it before attempting to ${action}.`, 409);
  }
  return { current, workspace };
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
  const workspace = await workspaceCapabilityStore.register(lastRepoProfile.rootPath);
  await bindLastWorkspace(workspace, lastRepoProfile.rootPath, lastRepoProfile.commands);
  const memory = await memoryStore.upsertProfile(lastRepoProfile);
  await recordAudit({
    type: "repo.scan",
    title: "Repository scanned",
    detail: `${lastRepoProfile.fileCount} files, ${lastRepoProfile.skippedCount} skipped`,
    rootPath: lastRepoProfile.rootPath,
    metadata: { languages: lastRepoProfile.languages, commands: lastRepoProfile.commands }
  });
  return json(response, { ok: true, profile: lastRepoProfile, memory, workspace: lastWorkspace });
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
  if (!new Set(["list_files", "read_file", "search_code", "git_status", "git_diff", "run_command"]).has(body.tool)) {
    throw patchOperationError("WORKSPACE_TOOL_NOT_ALLOWED", "This tool is not available through the generic workspace endpoint.", 409);
  }
  if (body.tool === "read_file") assertPublicReadPath(body.args?.path);
  let task = body.taskId ? await taskStore.get(body.taskId) : null;
  const rootPath = task?.rootPath || lastRepoProfile?.rootPath;
  if (!rootPath) throw patchOperationError("WORKSPACE_CONTEXT_MISSING", "Scan or activate a server-registered workspace before calling tools.", 409);
  if (body.rootPath && canonicalRootPath(body.rootPath) !== canonicalRootPath(rootPath)) {
    throw patchOperationError("WORKSPACE_CAPABILITY_MISMATCH", "The client path does not match the server-bound task or active workspace.", 409);
  }
  const binding = task
    ? await assertTaskWorkspaceCurrent(task, `call ${body.tool}`)
    : await assertLastWorkspaceCurrent(rootPath, `call ${body.tool}`);
  const registry = getToolRegistry(rootPath, binding.current.digest);
  let result;
  if (["run_command", "git_status", "git_diff"].includes(body.tool)) {
    if (task) await assertTaskCanMutate(task, "run project commands");
    else await workspaceCapabilityStore.assertCanMutate(rootPath, "run project commands");
    if (body.tool !== "run_command" || body.approved === true) {
      result = await serializePatchOperation(rootPath, async () => {
        if (task) await assertTaskCanMutate(await taskStore.get(task.id), "run project commands");
        else await workspaceCapabilityStore.assertCanMutate(rootPath, "run project commands");
        return registry.call(body.tool, body.args || {}, { approved: body.approved === true });
      });
    } else {
      result = await registry.call(body.tool, body.args || {}, { approved: false });
    }
  } else {
    result = await registry.call(body.tool, body.args || {}, { approved: body.approved === true });
  }

  if (!result.blocked) {
    if (task) await assertTaskWorkspaceCurrent(await taskStore.get(task.id), `complete ${body.tool}`);
    else await assertLastWorkspaceCurrent(rootPath, `complete ${body.tool}`);
  }

  if (task) {
    task = await taskStore.appendToolCall(body.taskId, {
      tool: body.tool,
      args: summarizeArgs(body.args || {}),
      blocked: Boolean(result.blocked),
      approved: body.approved === true,
      permission: result.permission,
      summary: summarizeToolResult(result)
    });
    if (body.tool === "run_command" && result.ok && result.result && !result.blocked) {
      task = await taskStore.setVerification(body.taskId, result.result);
    }
    if (body.tool === "read_file" && result.ok && typeof result.result === "string") {
      task = await taskStore.appendContextFile(body.taskId, {
        ...contextFileMetadata(body.args?.path, result.result, "read_file")
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
      approved: body.approved === true,
      permission: result.permission
    }
  });
  return json(response, { ...result, task });
}

function assertPublicReadPath(filePath) {
  const segments = String(filePath || "").replaceAll("\\", "/").split("/").filter((segment) => segment && segment !== ".");
  const basename = segments.at(-1) || "";
  if (isSensitiveFile(basename) || segments.slice(0, -1).some(isProtectedDirectory)) {
    throw patchOperationError("READ_PROTECTED_PATH_REFUSED", "CodeClaw refused to read private workspace metadata or sensitive files.", 409);
  }
}

function getToolRegistry(rootPath, rootIdentity = "") {
  if (!rootPath) throw new Error("Scan a repository before calling tools.");
  const resolved = path.resolve(rootPath);
  if (toolRegistry
    && lastRepoProfile?.rootPath
    && canonicalRootPath(lastRepoProfile.rootPath) === canonicalRootPath(resolved)
    && (!rootIdentity || toolRegistry.rootIdentity === rootIdentity)) return toolRegistry;
  return new ToolRegistry({ rootPath: resolved, rootIdentity, allowedCommands: [] });
}

async function bindLastWorkspace(workspace, rootPath, allowedCommands = []) {
  const current = await captureWorkspaceIdentity(rootPath);
  await assertRepositoryRootAllowed(current.rootPath, "bind the active workspace");
  const registered = await workspaceCapabilityStore.describePath(current.rootPath).catch(() => null);
  if (!registered || registered.id !== workspace.id) {
    throw patchOperationError("WORKSPACE_CAPABILITY_MISMATCH", "The selected folder no longer matches the workspace registered by this server state.", 409);
  }
  lastWorkspace = workspace;
  lastWorkspaceBinding = {
    workspaceId: workspace.id,
    rootPath: current.rootPath,
    rootIdentity: current.digest
  };
  toolRegistry = new ToolRegistry({
    rootPath: current.rootPath,
    rootIdentity: current.digest,
    allowedCommands
  });
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

function assertLocalJsonRequest(request) {
  if (request.method !== "POST") return;
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw patchOperationError("JSON_CONTENT_TYPE_REQUIRED", "CodeClaw accepts state-changing requests only as application/json.", 415);
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw patchOperationError("LOCAL_ORIGIN_REQUIRED", "CodeClaw rejected an invalid request origin.", 403);
  }
  const loopback = parsed.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    && Number(parsed.port || 80) === port;
  if (!loopback) throw patchOperationError("LOCAL_ORIGIN_REQUIRED", "CodeClaw rejected a cross-site request to the local workspace service.", 403);
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw patchOperationError("JSON_BODY_INVALID", "CodeClaw rejected a malformed JSON request body.", 400);
  }
}

function localErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

async function loadModelConfig() {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(modelConfigPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      await replaceModelConfigWithSafeFallback();
    }
    return;
  }
  const persisted = sanitizeModelConfig({
    type: String(parsed?.type || "mock").trim(),
    name: String(parsed?.name || parsed?.type || "mock").trim(),
    baseUrl: String(parsed?.baseUrl || "").trim(),
    model: String(parsed?.model || (parsed?.type === "openai-compatible" ? "" : "mock-codeclaw")).trim(),
    apiKey: ""
  });
  if (!["mock", "openai-compatible"].includes(persisted.type)) {
    await replaceModelConfigWithSafeFallback();
    return;
  }
  if (persisted.type === "mock") persisted.baseUrl = "";
  try {
    validateModelBaseUrl(persisted);
  } catch {
    await replaceModelConfigWithSafeFallback();
    return;
  }
  if (!persistedModelConfigIsCanonical(parsed, persisted)) {
    await persistPublicModelConfig(persisted);
  }
  modelConfig = persisted;
  modelProvider = new ModelProvider(persisted);
  modelConfigGeneration = randomUUID();
  modelOutboundPreviews.clear();
}

async function replaceModelConfigWithSafeFallback() {
  const fallback = sanitizeModelConfig({ type: "mock", name: "mock", model: "mock-codeclaw", apiKey: "" });
  await persistPublicModelConfig(fallback);
  modelConfig = fallback;
  modelProvider = new ModelProvider(fallback);
  modelConfigGeneration = randomUUID();
  modelOutboundPreviews.clear();
}

function validateModelBaseUrl(config) {
  if (config?.type === "openai-compatible" && config.baseUrl) {
    buildOpenAICompatibleEndpoint(config.baseUrl);
  }
}

async function persistPublicModelConfig(config) {
  const document = publicModelConfigDocument(config);
  await atomicWriteFile(modelConfigPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
}

function publicModelConfigDocument(config) {
  return {
    schemaVersion: 1,
    type: config.type,
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.model
  };
}

function persistedModelConfigIsCanonical(parsed, config) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const expected = publicModelConfigDocument(config);
  const parsedKeys = Object.keys(parsed).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(parsedKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => parsed[key] === expected[key]);
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

function contextFileMetadata(filePath, content, source) {
  const text = String(content || "");
  const byteLength = Buffer.byteLength(text, "utf8");
  const lineCount = text ? text.split(/\r?\n/).length : 0;
  return {
    path: filePath,
    summary: `UTF-8 text metadata: ${lineCount} line(s), ${byteLength} byte(s).`,
    size: byteLength,
    sha256: hashContent(text),
    contentComplete: true,
    source
  };
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}
