import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity, workspaceIdentityMatches } from "../../shared/src/workspace-identity.js";

const CONTEXT_FILE_SOURCES = new Set(["preflight", "read_file"]);

export class TaskStore {
  constructor({ storagePath, lockManager = null }) {
    if (!storagePath) throw new Error("Missing task storage path.");
    this.storagePath = path.resolve(storagePath);
    this.lockManager = lockManager || new CrossProcessLockManager({
      storagePath: path.join(path.dirname(this.storagePath), ".task-locks"),
      namespace: "task-store",
      lockedCode: "TASK_STORE_LOCKED",
      lockedMessage: "Another CodeClaw process is updating local task state. Wait for it to finish, then retry."
    });
    this.mutationQueue = Promise.resolve();
  }

  async create({ goal, rootPath, workspaceId = null }) {
    if (!goal?.trim()) throw new Error("Missing task goal.");
    const workspace = rootPath ? await captureWorkspaceIdentity(rootPath).catch(() => null) : null;
    return this.serializeMutation(async () => {
      const now = new Date().toISOString();
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        revision: 1,
        goal: goal.trim(),
        rootPath: workspace?.rootPath || (rootPath ? path.resolve(rootPath) : null),
        rootIdentity: workspace?.digest || null,
        workspaceId: typeof workspaceId === "string" && workspaceId ? workspaceId : null,
        status: "planned",
        plan: null,
        toolCalls: [],
        contextFiles: [],
        verification: null,
        verificationHistory: [],
        failureSummary: "",
        modelEvents: [],
        patchProposal: null,
        appliedPatches: [],
        summary: "",
        reviewDraft: "",
        createdAt: now,
        updatedAt: now
      };
      const tasks = await this.readAllUnqueued();
      tasks.push(task);
      await this.writeAll(tasks);
      return task;
    });
  }

  async latest({ rootPath = null } = {}) {
    const tasks = await this.readAll();
    const filtered = rootPath ? tasks.filter((task) => task.rootPath === path.resolve(rootPath)) : tasks;
    return filtered.at(-1) || null;
  }

  async get(id) {
    const task = (await this.readAll()).find((item) => item.id === id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  async setPlan(id, plan) {
    return this.update(id, { plan, status: "planned" });
  }

  async appendToolCall(id, toolCall) {
    return this.update(id, (task) => ({
      status: toolCall.blocked ? "blocked" : "running",
      toolCalls: [...task.toolCalls, { ...toolCall, time: toolCall.time || new Date().toISOString() }]
    }));
  }

  async setVerification(id, verification) {
    const failed = verification.exitCode !== 0 || verification.timedOut;
    return this.update(id, (task) => ({
      status: failed ? "failed" : "verified",
      verification,
      verificationHistory: [...(task.verificationHistory || []), { ...verification, time: verification.time || new Date().toISOString() }],
      failureSummary: failed ? summarizeVerificationFailure(verification) : ""
    }));
  }

  async recordModelEvent(id, event, options = {}) {
    return this.update(id, (task) => ({
      modelEvents: [...(task.modelEvents || []), sanitizeModelEvent(event)]
    }), options);
  }

  async appendContextFile(id, contextFile) {
    return this.update(id, (task) => {
      const existing = task.contextFiles || [];
      const nextFile = sanitizeContextFile(contextFile);
      const index = existing.findIndex((item) => item.path === nextFile.path);
      const contextFiles = index === -1 ? [...existing, nextFile] : existing.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextFile } : item);
      return { contextFiles };
    });
  }

  async setPatchProposal(id, patchProposal, options = {}) {
    return this.update(id, async (task) => {
      const boundPatchProposal = await bindProposalParentIdentities(patchProposal, task);
      const proposal = {
        ...minimizeInapplicablePatchProposal(boundPatchProposal),
        workspaceIdentity: task.rootIdentity || "",
        proposalId: `proposal-${Date.now()}-${randomUUID()}`,
        time: patchProposal.time || new Date().toISOString()
      };
      proposal.proposalDigest = patchProposalDigest(proposal);
      return {
        patchProposal: proposal,
        status: "patch_ready",
        ...(options?.modelEvent ? {
          modelEvents: [...(task.modelEvents || []), sanitizeModelEvent(options.modelEvent)]
        } : {})
      };
    }, options);
  }

  async recordAppliedPatch(id, patch) {
    return this.recordAppliedPatches(id, [patch]);
  }

  async recordAppliedPatches(id, patches) {
    if (!Array.isArray(patches) || !patches.length) throw new Error("No applied patches to record.");
    const now = new Date().toISOString();
    return this.update(id, async (task) => {
      const existing = task.appliedPatches || [];
      const transactionIds = [...new Set(patches.map((patch) => patch.transactionId).filter(Boolean))];
      if (transactionIds.length === 1) {
        const recorded = existing.filter((patch) => patch.transactionId === transactionIds[0]);
        if (recorded.length) {
          const expectedPaths = patches.map((patch) => patch.path).sort();
          const recordedPaths = recorded.map((patch) => patch.path).sort();
          if (JSON.stringify(expectedPaths) !== JSON.stringify(recordedPaths)) throw transactionStateError("Applied patch transaction is only partially recorded.");
          return {};
        }
      }
      const normalizedPatches = await Promise.all(patches.map(async (patch) => {
        const parentIdentity = patch.parentIdentity
          || (task.rootIdentity && task.rootPath ? (await captureWorkspaceParentIdentity(task.rootPath, patch.path)).digest : "");
        const normalized = { ...patch, parentIdentity, workspaceIdentity: task.rootIdentity || patch.workspaceIdentity || "" };
        return {
          ...normalized,
          ...(typeof patch.nextContent === "string" ? { patchIdentity: appliedPatchIdentity(normalized) } : {}),
          time: patch.time || now,
          revertedAt: null
        };
      }));
      return {
        status: "patched",
        appliedPatches: [
          ...existing,
          ...normalizedPatches
        ]
      };
    });
  }

  async markLastPatchReverted(id, options = {}) {
    return this.update(id, (task) => {
      const patches = [...(task.appliedPatches || [])];
      const index = patches.findLastIndex((patch) => !patch.revertedAt);
      if (index === -1) throw new Error("No applied patch to revert.");
      patches[index] = revertedPatch(patches[index], options);
      return { status: task.status === "completed" ? "completed" : "running", appliedPatches: patches };
    });
  }

  async markPatchReverted(id, index, options = {}) {
    return this.update(id, (task) => {
      const patches = [...(task.appliedPatches || [])];
      if (patches[index]?.revertedAt && options.revertTransactionId && patches[index].revertTransactionId === options.revertTransactionId) return {};
      if (!patches[index] || patches[index].revertedAt) throw new Error("No applied patch to revert.");
      patches[index] = revertedPatch(patches[index], options);
      return { status: task.status === "completed" ? "completed" : "running", appliedPatches: patches };
    });
  }

  async complete(id, summary = "", reviewDraft = "") {
    return this.update(id, (task) => ({ status: "completed", summary, reviewDraft: reviewDraft || buildTaskReviewDraft(task, summary) }));
  }

  async update(id, patch, options = {}) {
    return this.serializeMutation(async () => {
      const tasks = await this.readAllUnqueued();
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) throw new Error(`Unknown task: ${id}`);
      const expectedRevision = mutationExpectedRevision(options);
      const currentRevision = normalizeRevision(tasks[index].revision);
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw taskRevisionConflict(id, expectedRevision, currentRevision);
      }
      const nextPatch = typeof patch === "function" ? await patch(tasks[index]) : patch;
      if (typeof options?.beforeCommit === "function") {
        await options.beforeCommit({ currentTask: tasks[index], nextPatch });
      }
      tasks[index] = normalizeTaskForStorage({
        ...tasks[index],
        ...nextPatch,
        revision: currentRevision + 1,
        updatedAt: new Date().toISOString()
      });
      await this.writeAll(tasks);
      return tasks[index];
    });
  }

  async initialize() {
    return this.serializeMutation(async () => {
      const tasks = await this.readRawUnqueued();
      const now = new Date().toISOString();
      let migrated = 0;
      const nextTasks = tasks.map((task) => {
        const normalized = hydrateTask(task);
        if (sameJson(task, normalized)) return normalized;
        migrated += 1;
        return normalizeTaskForStorage({
          ...normalized,
          revision: normalizeRevision(task.revision) + 1,
          updatedAt: now
        });
      });
      if (migrated) await this.writeAll(nextTasks);
      return { migrated, taskCount: nextTasks.length };
    });
  }

  async readAll() {
    await this.mutationQueue;
    return this.readAllUnqueued();
  }

  async readAllUnqueued() {
    return (await this.readRawUnqueued()).map(hydrateTask);
  }

  async readRawUnqueued() {
    try {
      const tasks = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      if (!Array.isArray(tasks)) throw new Error("Task state must contain an array.");
      return tasks;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(tasks) {
    await atomicWriteFile(this.storagePath, `${JSON.stringify(tasks.map(normalizeTaskForStorage), null, 2)}\n`);
  }

  serializeMutation(mutation) {
    const lockedMutation = async () => this.lockManager.withLock(await canonicalPathLockKey(this.storagePath), mutation);
    const result = this.mutationQueue.then(lockedMutation, lockedMutation);
    this.mutationQueue = result.catch(() => {});
    return result;
  }
}

function hydrateTask(task = {}) {
  return normalizeTaskForStorage(task);
}

function normalizeTaskForStorage(task = {}) {
  const fallbackTime = stableTimestamp(task.updatedAt, task.createdAt);
  const legacyEvents = Array.isArray(task.suggestions)
    ? task.suggestions.map((suggestion) => legacySuggestionEvent(suggestion, fallbackTime))
    : [];
  const modelEvents = [
    ...(Array.isArray(task.modelEvents) ? task.modelEvents.map((event) => sanitizeModelEvent(event, fallbackTime)) : []),
    ...legacyEvents
  ];
  const normalized = {
    ...task,
    revision: normalizeRevision(task.revision),
    modelEvents,
    contextFiles: Array.isArray(task.contextFiles)
      ? task.contextFiles.map((contextFile) => sanitizeContextFile(contextFile, fallbackTime))
      : [],
    appliedPatches: hydrateAppliedPatches(task)
  };
  delete normalized.suggestions;
  if (normalized.patchProposal?.applicable === false) {
    normalized.patchProposal = minimizeInapplicablePatchProposal(normalized.patchProposal);
    if (normalized.patchProposal.proposalId) {
      normalized.patchProposal.proposalDigest = patchProposalDigest(normalized.patchProposal);
    }
  }
  return normalized;
}

function hydrateAppliedPatches(task) {
  return (task.appliedPatches || []).map((patch) => {
    if (typeof patch.nextContent !== "string") return patch;
    const workspaceIdentity = patch.workspaceIdentity || task.rootIdentity || "";
    const hydrated = { ...patch, workspaceIdentity };
    const identity = appliedPatchIdentity(hydrated);
    return patch.patchIdentity === identity ? hydrated : { ...hydrated, patchIdentity: identity };
  });
}

function sanitizeContextFile(contextFile = {}, fallbackTime = "") {
  const content = typeof contextFile.content === "string" ? contextFile.content : null;
  const size = content === null
    ? Number.isSafeInteger(contextFile.size) && contextFile.size >= 0
      ? contextFile.size
      : null
    : Buffer.byteLength(content, "utf8");
  return {
    path: String(contextFile.path || ""),
    summary: content === null ? safeContextMetadataSummary(contextFile.summary, size) : "",
    size,
    sha256: content === null ? validSha256(contextFile.sha256) : sha256(content),
    contentComplete: typeof contextFile.contentComplete === "boolean"
      ? contextFile.contentComplete
      : content !== null,
    source: CONTEXT_FILE_SOURCES.has(String(contextFile.source || "")) ? String(contextFile.source) : "",
    time: stableTimestamp(contextFile.time, fallbackTime, new Date().toISOString())
  };
}

function safeContextMetadataSummary(value, size) {
  const summary = String(value || "");
  const match = summary.match(/^UTF-8 text metadata: (\d+) line\(s\), (\d+) byte\(s\)\.$/);
  if (!match || size === null) return "";
  const lineCount = Number(match[1]);
  const statedBytes = Number(match[2]);
  return Number.isSafeInteger(lineCount) && lineCount >= 0 && statedBytes === size ? summary : "";
}

function sanitizeModelEvent(event = {}, fallbackTime = "") {
  return {
    operation: safeSlug(event.operation, "unknown"),
    provider: safeIdentifier(event.provider),
    model: safeIdentifier(event.model),
    requestSha256: validSha256(event.requestSha256),
    responseSha256: validSha256(event.responseSha256),
    status: safeSlug(event.status, "unknown"),
    time: stableTimestamp(event.time, fallbackTime, new Date().toISOString())
  };
}

function legacySuggestionEvent(suggestion = {}, fallbackTime = "") {
  const response = typeof suggestion.content === "string"
    ? suggestion.content
    : typeof suggestion.note === "string"
      ? suggestion.note
      : "";
  return sanitizeModelEvent({
    operation: suggestion.kind === "failure-fix" ? "failure-fix" : "suggestion",
    provider: suggestion.provider,
    model: suggestion.model,
    requestSha256: suggestion.requestSha256,
    responseSha256: validSha256(suggestion.responseSha256) || (response ? sha256(response) : ""),
    status: "migrated",
    time: suggestion.time
  }, fallbackTime);
}

function minimizeInapplicablePatchProposal(proposal = {}) {
  if (proposal?.applicable !== false) return proposal;
  const minimized = {
    applicable: false,
    path: null,
    files: []
  };
  for (const key of ["provider", "model", "reason", "summary", "createdAt", "workspaceIdentity", "proposalId", "time"]) {
    if (typeof proposal[key] === "string") minimized[key] = proposal[key];
  }
  return minimized;
}

function mutationExpectedRevision(options) {
  const expected = typeof options === "number" ? options : options?.expectedRevision;
  if (expected === undefined) return undefined;
  return Number.isSafeInteger(expected) && expected >= 0 ? expected : Number.NaN;
}

function normalizeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function taskRevisionConflict(taskId, expectedRevision, currentRevision) {
  const error = new Error(`Task ${taskId} changed after it was read. Refresh it and retry with revision ${currentRevision}.`);
  error.code = "TASK_REVISION_CONFLICT";
  error.status = 409;
  error.expectedRevision = expectedRevision;
  error.currentRevision = currentRevision;
  return error;
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : "";
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function safeSlug(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) ? normalized : fallback;
}

function safeIdentifier(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/.test(normalized) ? normalized : "";
}

function stableTimestamp(...values) {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(0).toISOString();
}

function sameJson(left, right) {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

async function bindProposalParentIdentities(proposal, task) {
  if (!task.rootIdentity || !task.rootPath) return proposal;
  if (!(await workspaceIdentityMatches(task.rootPath, task.rootIdentity))) {
    const error = new Error("The task workspace changed before the patch proposal could be bound.");
    error.code = "WORKSPACE_IDENTITY_CHANGED";
    error.status = 409;
    throw error;
  }
  if (proposal?.files?.length) {
    const files = await Promise.all(proposal.files.map(async (file) => ({
      ...file,
      parentIdentity: (await captureWorkspaceParentIdentity(task.rootPath, file.path)).digest
    })));
    return { ...proposal, files };
  }
  if (proposal?.path) {
    return { ...proposal, parentIdentity: (await captureWorkspaceParentIdentity(task.rootPath, proposal.path)).digest };
  }
  return proposal;
}

function revertedPatch(patch, { revertTransactionId = "" } = {}) {
  return {
    ...patch,
    revertedAt: new Date().toISOString(),
    ...(revertTransactionId ? { revertTransactionId } : {})
  };
}

function transactionStateError(message) {
  const error = new Error(message);
  error.code = "PATCH_TRANSACTION_STATE_ERROR";
  return error;
}

export function summarizeTask(task) {
  if (!task) return "No active task.";
  const calls = task.toolCalls?.length || 0;
  const modelEvents = task.modelEvents?.length || 0;
  const contextFiles = task.contextFiles?.length || 0;
  const appliedPatches = task.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const verification = task.verification ? `Verification exitCode=${task.verification.exitCode}` : "No verification yet";
  return `${task.status}: ${calls} tool call(s), ${modelEvents} minimized model event(s), ${contextFiles} context file(s), ${appliedPatches} active patch(es). ${verification}.`;
}

export function buildTaskReviewDraft(task, summary = "") {
  if (!task) return "No task available.";
  const activePatches = (task.appliedPatches || []).filter((patch) => !patch.revertedAt);
  const changedFiles = activePatches.map((patch) => patch.path);
  const modelEvents = task.modelEvents?.length || 0;
  const verification = task.verification
    ? task.verification.timedOut
      ? `Timed out after ${task.verification.durationMs || "unknown"}ms`
      : `Exit code ${task.verification.exitCode}`
    : "Not run";
  const riskNotes = reviewRiskNotes({ changedFiles, verification: task.verification });

  return [
    `Title: ${task.goal || "CodeClaw task update"}`,
    "",
    "Summary:",
    summary || summarizeTask(task),
    "",
    "Changed files:",
    changedFiles.length ? changedFiles.map((file) => `- ${file}`).join("\n") : "- None",
    "",
    "Verification:",
    `- ${verification}`,
    "",
    "Model activity:",
    `- ${modelEvents} minimized event(s) recorded; no prompt or response body is included.`,
    "",
    "Review notes:",
    riskNotes.map((item) => `- ${item}`).join("\n")
  ].join("\n");
}

function reviewRiskNotes({ changedFiles, verification }) {
  const notes = [];
  if (!changedFiles.length) notes.push("No active file changes were recorded.");
  if (changedFiles.some((file) => /package\.json|lock|config|\.env|settings/i.test(file))) notes.push("Review configuration or dependency-related changes carefully.");
  if (!changedFiles.some((file) => /test|spec/i.test(file))) notes.push("No test file changes were recorded.");
  if (!verification) notes.push("Verification has not been run.");
  else if (verification.timedOut || verification.exitCode !== 0) notes.push("Verification did not pass.");
  else notes.push("Verification passed.");
  return notes;
}

export function summarizeVerificationFailure(verification = {}) {
  if (verification.timedOut) return `Command timed out after ${verification.durationMs || "unknown"}ms.`;
  if (verification.exitCode === 0) return "";
  const output = `${verification.stderr || ""}\n${verification.stdout || ""}`.trim();
  const lines = failureSignalLines(output);
  return [`Command failed with exit code ${verification.exitCode}.`, ...lines].join("\n").slice(0, 1200);
}

export function patchProposalDigest(proposal = {}) {
  const value = { ...proposal };
  delete value.proposalId;
  delete value.proposalDigest;
  delete value.time;
  return createHash("sha256").update(JSON.stringify(sortJson(value)), "utf8").digest("hex");
}

export function appliedPatchIdentity(patch = {}) {
  const identity = {
    transactionId: patch.transactionId || patch.batchId || "",
    path: String(patch.path || "").replaceAll("\\", "/"),
    workspaceIdentity: patch.workspaceIdentity || "",
    parentIdentity: patch.parentIdentity || "",
    previousExists: patch.previousExists !== false,
    previousSha256: patch.previousExists === false ? null : createHash("sha256").update(String(patch.previousContent ?? ""), "utf8").digest("hex"),
    nextSha256: createHash("sha256").update(String(patch.nextContent ?? ""), "utf8").digest("hex")
  };
  return createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function failureSignalLines(output) {
  const lines = String(output || "").split(/\r?\n/).filter(Boolean);
  const failingTestsIndex = lines.findIndex((line) => /failing tests/i.test(line));
  if (failingTestsIndex !== -1) return lines.slice(failingTestsIndex, failingTestsIndex + 24);

  const assertionIndex = lines.findIndex((line) => /AssertionError|ERR_ASSERTION|actual:|expected:/i.test(line));
  if (assertionIndex !== -1) return lines.slice(Math.max(0, assertionIndex - 4), assertionIndex + 20);

  if (lines.length <= 16) return lines;
  return [...lines.slice(0, 8), "...", ...lines.slice(-8)];
}
