import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";
import { captureWorkspaceIdentity, captureWorkspaceParentIdentity, workspaceIdentityMatches } from "../../shared/src/workspace-identity.js";

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
        suggestions: [],
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

  async appendSuggestion(id, suggestion) {
    return this.update(id, (task) => ({
      suggestions: [...(task.suggestions || []), { ...suggestion, time: suggestion.time || new Date().toISOString() }]
    }));
  }

  async appendContextFile(id, contextFile) {
    return this.update(id, (task) => {
      const existing = task.contextFiles || [];
      const nextFile = { ...contextFile, time: contextFile.time || new Date().toISOString() };
      const index = existing.findIndex((item) => item.path === nextFile.path);
      const contextFiles = index === -1 ? [...existing, nextFile] : existing.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextFile } : item);
      return { contextFiles };
    });
  }

  async setPatchProposal(id, patchProposal) {
    return this.update(id, async (task) => {
      const boundPatchProposal = await bindProposalParentIdentities(patchProposal, task);
      const proposal = {
        ...boundPatchProposal,
        workspaceIdentity: task.rootIdentity || "",
        proposalId: `proposal-${Date.now()}-${randomUUID()}`,
        time: patchProposal.time || new Date().toISOString()
      };
      proposal.proposalDigest = patchProposalDigest(proposal);
      return { patchProposal: proposal, status: "patch_ready" };
    });
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

  async update(id, patch) {
    return this.serializeMutation(async () => {
      const tasks = await this.readAllUnqueued();
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) throw new Error(`Unknown task: ${id}`);
      const nextPatch = typeof patch === "function" ? await patch(tasks[index]) : patch;
      tasks[index] = { ...tasks[index], ...nextPatch, updatedAt: new Date().toISOString() };
      await this.writeAll(tasks);
      return tasks[index];
    });
  }

  async readAll() {
    await this.mutationQueue;
    return this.readAllUnqueued();
  }

  async readAllUnqueued() {
    try {
      const tasks = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      return tasks.map((task) => ({
        ...task,
        appliedPatches: (task.appliedPatches || []).map((patch) => {
          if (typeof patch.nextContent !== "string") return patch;
          const workspaceIdentity = patch.workspaceIdentity || task.rootIdentity || "";
          const hydrated = { ...patch, workspaceIdentity };
          const identity = appliedPatchIdentity(hydrated);
          return patch.patchIdentity === identity ? hydrated : { ...hydrated, patchIdentity: identity };
        })
      }));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(tasks) {
    await atomicWriteFile(this.storagePath, `${JSON.stringify(tasks, null, 2)}\n`);
  }

  serializeMutation(mutation) {
    const lockedMutation = async () => this.lockManager.withLock(await canonicalPathLockKey(this.storagePath), mutation);
    const result = this.mutationQueue.then(lockedMutation, lockedMutation);
    this.mutationQueue = result.catch(() => {});
    return result;
  }
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
  const calls = task.toolCalls.length;
  const suggestions = task.suggestions?.length || 0;
  const contextFiles = task.contextFiles?.length || 0;
  const appliedPatches = task.appliedPatches?.filter((patch) => !patch.revertedAt).length || 0;
  const verification = task.verification ? `Verification exitCode=${task.verification.exitCode}` : "No verification yet";
  return `${task.status}: ${calls} tool call(s), ${suggestions} suggestion(s), ${contextFiles} context file(s), ${appliedPatches} active patch(es). ${verification}.`;
}

export function buildTaskReviewDraft(task, summary = "") {
  if (!task) return "No task available.";
  const activePatches = (task.appliedPatches || []).filter((patch) => !patch.revertedAt);
  const changedFiles = activePatches.map((patch) => patch.path);
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
