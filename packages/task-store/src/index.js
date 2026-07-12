import fs from "node:fs/promises";
import path from "node:path";

export class TaskStore {
  constructor({ storagePath }) {
    if (!storagePath) throw new Error("Missing task storage path.");
    this.storagePath = storagePath;
  }

  async create({ goal, rootPath }) {
    if (!goal?.trim()) throw new Error("Missing task goal.");
    const now = new Date().toISOString();
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      goal: goal.trim(),
      rootPath: rootPath ? path.resolve(rootPath) : null,
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
    const tasks = await this.readAll();
    tasks.push(task);
    await this.writeAll(tasks);
    return task;
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
    const task = await this.get(id);
    return this.update(id, {
      status: toolCall.blocked ? "blocked" : "running",
      toolCalls: [...task.toolCalls, { ...toolCall, time: toolCall.time || new Date().toISOString() }]
    });
  }

  async setVerification(id, verification) {
    const task = await this.get(id);
    const failed = verification.exitCode !== 0 || verification.timedOut;
    return this.update(id, {
      status: failed ? "failed" : "verified",
      verification,
      verificationHistory: [...(task.verificationHistory || []), { ...verification, time: verification.time || new Date().toISOString() }],
      failureSummary: failed ? summarizeVerificationFailure(verification) : ""
    });
  }

  async appendSuggestion(id, suggestion) {
    const task = await this.get(id);
    return this.update(id, {
      suggestions: [...(task.suggestions || []), { ...suggestion, time: suggestion.time || new Date().toISOString() }]
    });
  }

  async appendContextFile(id, contextFile) {
    const task = await this.get(id);
    const existing = task.contextFiles || [];
    const nextFile = { ...contextFile, time: contextFile.time || new Date().toISOString() };
    const index = existing.findIndex((item) => item.path === nextFile.path);
    const contextFiles = index === -1 ? [...existing, nextFile] : existing.map((item, itemIndex) => itemIndex === index ? { ...item, ...nextFile } : item);
    return this.update(id, { contextFiles });
  }

  async setPatchProposal(id, patchProposal) {
    return this.update(id, { patchProposal: { ...patchProposal, time: patchProposal.time || new Date().toISOString() }, status: "patch_ready" });
  }

  async recordAppliedPatch(id, patch) {
    return this.recordAppliedPatches(id, [patch]);
  }

  async recordAppliedPatches(id, patches) {
    const task = await this.get(id);
    if (!Array.isArray(patches) || !patches.length) throw new Error("No applied patches to record.");
    const now = new Date().toISOString();
    return this.update(id, {
      status: "patched",
      appliedPatches: [
        ...(task.appliedPatches || []),
        ...patches.map((patch) => ({ ...patch, time: patch.time || now, revertedAt: null }))
      ]
    });
  }

  async markLastPatchReverted(id) {
    const task = await this.get(id);
    const patches = [...(task.appliedPatches || [])];
    const index = patches.findLastIndex((patch) => !patch.revertedAt);
    if (index === -1) throw new Error("No applied patch to revert.");
    return this.markPatchReverted(id, index);
  }

  async markPatchReverted(id, index) {
    const task = await this.get(id);
    const patches = [...(task.appliedPatches || [])];
    if (!patches[index] || patches[index].revertedAt) throw new Error("No applied patch to revert.");
    patches[index] = { ...patches[index], revertedAt: new Date().toISOString() };
    return this.update(id, { status: task.status === "completed" ? "completed" : "running", appliedPatches: patches });
  }

  async complete(id, summary = "", reviewDraft = "") {
    const task = await this.get(id);
    return this.update(id, { status: "completed", summary, reviewDraft: reviewDraft || buildTaskReviewDraft(task, summary) });
  }

  async update(id, patch) {
    const tasks = await this.readAll();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) throw new Error(`Unknown task: ${id}`);
    tasks[index] = { ...tasks[index], ...patch, updatedAt: new Date().toISOString() };
    await this.writeAll(tasks);
    return tasks[index];
  }

  async readAll() {
    try {
      return JSON.parse(await fs.readFile(this.storagePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(tasks) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(tasks, null, 2), "utf8");
  }
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

function failureSignalLines(output) {
  const lines = String(output || "").split(/\r?\n/).filter(Boolean);
  const failingTestsIndex = lines.findIndex((line) => /failing tests/i.test(line));
  if (failingTestsIndex !== -1) return lines.slice(failingTestsIndex, failingTestsIndex + 24);

  const assertionIndex = lines.findIndex((line) => /AssertionError|ERR_ASSERTION|actual:|expected:/i.test(line));
  if (assertionIndex !== -1) return lines.slice(Math.max(0, assertionIndex - 4), assertionIndex + 20);

  if (lines.length <= 16) return lines;
  return [...lines.slice(0, 8), "...", ...lines.slice(-8)];
}
