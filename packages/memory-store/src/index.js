import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";
import { STATE_LIMITS, assertUtf8Bytes, stateLimitError } from "../../shared/src/state-limits.js";

const MAX_TASK_SUMMARIES = 30;
const MAX_KEY_FILES = 60;

export class MemoryStore {
  constructor({ storagePath, lockManager = null }) {
    if (!storagePath) throw new Error("Missing memory storage path.");
    this.storagePath = path.resolve(storagePath);
    this.lockManager = lockManager || new CrossProcessLockManager({
      storagePath: path.join(path.dirname(this.storagePath), ".memory-locks"),
      namespace: "memory-store",
      lockedCode: "MEMORY_STORE_LOCKED",
      lockedMessage: "Another CodeClaw process is updating local project memory. Wait for it to finish, then retry."
    });
    this.mutationQueue = Promise.resolve();
  }

  async get(rootPath) {
    if (!rootPath) return null;
    const memories = await this.readAll();
    return memories.find((item) => item.rootPath === path.resolve(rootPath)) || null;
  }

  async initialize() {
    return this.serializeMutation(async () => {
      const raw = await this.readRawUnqueued();
      const memories = raw.map(normalizeMemoryState);
      const changed = JSON.stringify(raw) !== JSON.stringify(memories);
      if (changed) await this.writeAll(memories);
      return { changed, memoryCount: memories.length };
    });
  }

  async latest() {
    const memories = await this.readAll();
    return memories
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item?.rootPath)
      .sort((a, b) => {
        const byTime = String(a.item.updatedAt || "").localeCompare(String(b.item.updatedAt || ""));
        return byTime || a.index - b.index;
      })
      .at(-1)?.item || null;
  }

  async upsertProfile(repoProfile = {}) {
    if (!repoProfile.rootPath) throw new Error("Missing repository root path.");
    const rootPath = path.resolve(repoProfile.rootPath);
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      const index = memories.findIndex((item) => item.rootPath === rootPath);
      if (index === -1 && memories.length >= STATE_LIMITS.memoryProjects) {
        throw stateLimitError("MEMORY_STORE_CAPACITY", `Project memory reached its ${STATE_LIMITS.memoryProjects}-project safety limit. Remove old local memory before adding another project.`);
      }
      const now = new Date().toISOString();
      const existing = index === -1 ? createMemory({ rootPath, name: repoProfile.name, now }) : memories[index];
      const commandHistory = boundCommands(
        mergeCommands(existing.commands || [], repoProfile.commands || [], now),
        existing.commandsDropped
      );
      const next = {
        ...existing,
        rootPath,
        name: repoProfile.name || existing.name || path.basename(rootPath),
        profile: {
          fileCount: repoProfile.fileCount || 0,
          skippedCount: repoProfile.skippedCount || 0,
          languages: repoProfile.languages || [],
          frameworks: repoProfile.frameworks || [],
          packageManagers: repoProfile.packageManagers || [],
          keyFiles: (repoProfile.keyFiles || []).slice(0, MAX_KEY_FILES),
          scannedAt: repoProfile.scannedAt || now
        },
        commands: commandHistory.values,
        commandsDropped: commandHistory.dropped,
        updatedAt: now
      };
      replaceMemory(memories, rootPath, next);
      await this.writeAll(memories);
      return next;
    });
  }

  async updateNotes(rootPath, notes = "") {
    const resolved = resolveMemoryRoot(rootPath);
    assertUtf8Bytes(notes, STATE_LIMITS.memoryNotesBytes, "MEMORY_NOTES_TOO_LARGE", "Project notes");
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      const memory = findOrCreateMemory(memories, resolved);
      const next = {
        ...memory,
        notes: String(notes || ""),
        updatedAt: new Date().toISOString()
      };
      replaceMemory(memories, resolved, next);
      await this.writeAll(memories);
      return next;
    });
  }

  async appendTaskSummary(rootPath, task = {}, summary = "") {
    const resolved = resolveMemoryRoot(rootPath || task.rootPath);
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      const memory = findOrCreateMemory(memories, resolved);
      const now = new Date().toISOString();
      const taskSummary = {
        taskId: task.id || null,
        goal: task.goal || "",
        status: task.status || "",
        summary: summary || task.summary || "",
        verification: task.verification ? {
          exitCode: task.verification.exitCode,
          timedOut: Boolean(task.verification.timedOut)
        } : null,
        time: now
      };
      const existing = (memory.taskSummaries || []).filter((item) => item.taskId !== taskSummary.taskId);
      const combined = [...existing, taskSummary];
      const overflow = Math.max(0, combined.length - MAX_TASK_SUMMARIES);
      const next = {
        ...memory,
        taskSummaries: overflow ? combined.slice(-MAX_TASK_SUMMARIES) : combined,
        taskSummariesDropped: (memory.taskSummariesDropped || 0) + overflow,
        updatedAt: now
      };
      replaceMemory(memories, resolved, next);
      await this.writeAll(memories);
      return next;
    });
  }

  async removeTaskSummary(rootPath, taskId) {
    const resolved = resolveMemoryRoot(rootPath);
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      const memory = findOrCreateMemory(memories, resolved);
      if (!taskId) return memory;
      const taskSummaries = (memory.taskSummaries || []).filter((item) => item.taskId !== taskId);
      if (taskSummaries.length === (memory.taskSummaries || []).length) return memory;
      const next = { ...memory, taskSummaries, updatedAt: new Date().toISOString() };
      replaceMemory(memories, resolved, next);
      await this.writeAll(memories);
      return next;
    });
  }

  async reconcileTaskSummaries(tasks = []) {
    const statuses = new Map(tasks.filter((task) => task?.id).map((task) => [task.id, task.status]));
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      let removed = 0;
      const nextMemories = memories.map((memory) => {
        const existing = memory.taskSummaries || [];
        const taskSummaries = existing.filter((summary) => !summary.taskId || statuses.get(summary.taskId) === "completed");
        removed += existing.length - taskSummaries.length;
        return taskSummaries.length === existing.length
          ? memory
          : { ...memory, taskSummaries, updatedAt: new Date().toISOString() };
      });
      if (removed) await this.writeAll(nextMemories);
      return { removed, memoryCount: nextMemories.length };
    });
  }

  async ensure(rootPath) {
    const resolved = resolveMemoryRoot(rootPath);
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      const existing = memories.find((item) => item.rootPath === resolved);
      if (existing) return existing;
      const memory = findOrCreateMemory(memories, resolved);
      await this.writeAll(memories);
      return memory;
    });
  }

  async replace(rootPath, memory) {
    const resolved = resolveMemoryRoot(rootPath);
    return this.serializeMutation(async () => {
      const memories = await this.readAllUnqueued();
      replaceMemory(memories, resolved, memory);
      await this.writeAll(memories);
      return memory;
    });
  }

  async readAll() {
    await this.mutationQueue;
    return this.readAllUnqueued();
  }

  async readAllUnqueued() {
    return (await this.readRawUnqueued()).map(normalizeMemoryState);
  }

  async readRawUnqueued() {
    try {
      const stat = await fs.stat(this.storagePath);
      if (stat.size > STATE_LIMITS.memoryStoreBytes) {
        throw stateLimitError("MEMORY_STORE_TOO_LARGE", `Project memory exceeds the ${STATE_LIMITS.memoryStoreBytes}-byte safety limit. Move it aside and review it before restarting CodeClaw.`);
      }
      const parsed = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      if (parsed.length > STATE_LIMITS.memoryProjects) {
        throw stateLimitError("MEMORY_STORE_CAPACITY", `Project memory contains ${parsed.length} projects, above the ${STATE_LIMITS.memoryProjects}-project safety limit.`);
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(memories) {
    const content = `${JSON.stringify(memories, null, 2)}\n`;
    if (Buffer.byteLength(content, "utf8") > STATE_LIMITS.memoryStoreBytes) {
      throw stateLimitError("MEMORY_STORE_TOO_LARGE", `The memory update would exceed the ${STATE_LIMITS.memoryStoreBytes}-byte safety limit. No project memory was written.`);
    }
    await atomicWriteFile(this.storagePath, content);
  }

  serializeMutation(mutation) {
    const lockedMutation = async () => this.lockManager.withLock(await canonicalPathLockKey(this.storagePath), mutation);
    const result = this.mutationQueue.then(lockedMutation, lockedMutation);
    this.mutationQueue = result.catch(() => {});
    return result;
  }
}

function resolveMemoryRoot(rootPath) {
  if (!rootPath) throw new Error("Missing repository root path.");
  return path.resolve(rootPath);
}

function findOrCreateMemory(memories, rootPath) {
  const existing = memories.find((item) => item.rootPath === rootPath);
  if (existing) return existing;
  if (memories.length >= STATE_LIMITS.memoryProjects) {
    throw stateLimitError("MEMORY_STORE_CAPACITY", `Project memory reached its ${STATE_LIMITS.memoryProjects}-project safety limit. Remove old local memory before adding another project.`);
  }
  const now = new Date().toISOString();
  const memory = createMemory({ rootPath, name: path.basename(rootPath), now });
  memories.push(memory);
  return memory;
}

function replaceMemory(memories, rootPath, memory) {
  const index = memories.findIndex((item) => item.rootPath === rootPath);
  if (index !== -1) memories.splice(index, 1);
  memories.push(memory);
}

function normalizeMemoryState(memory = {}) {
  assertUtf8Bytes(memory.notes || "", STATE_LIMITS.memoryNotesBytes, "MEMORY_NOTES_TOO_LARGE", "Project notes");
  const commandHistory = boundCommands(Array.isArray(memory.commands) ? memory.commands : [], memory.commandsDropped);
  const summaries = Array.isArray(memory.taskSummaries) ? memory.taskSummaries : [];
  const summaryOverflow = Math.max(0, summaries.length - MAX_TASK_SUMMARIES);
  return {
    ...memory,
    profile: {
      ...(memory.profile || {}),
      keyFiles: Array.isArray(memory.profile?.keyFiles) ? memory.profile.keyFiles.slice(0, MAX_KEY_FILES) : []
    },
    commands: commandHistory.values,
    commandsDropped: commandHistory.dropped,
    taskSummaries: summaryOverflow ? summaries.slice(-MAX_TASK_SUMMARIES) : summaries,
    taskSummariesDropped: (Number.isSafeInteger(memory.taskSummariesDropped) && memory.taskSummariesDropped >= 0 ? memory.taskSummariesDropped : 0) + summaryOverflow
  };
}

function createMemory({ rootPath, name, now }) {
  return {
    rootPath,
    name: name || path.basename(rootPath),
    profile: {
      fileCount: 0,
      skippedCount: 0,
      languages: [],
      frameworks: [],
      packageManagers: [],
      keyFiles: [],
      scannedAt: null
    },
    commands: [],
    commandsDropped: 0,
    notes: "",
    taskSummaries: [],
    taskSummariesDropped: 0,
    createdAt: now,
    updatedAt: now
  };
}

function mergeCommands(existing, scanned, now) {
  const byCommand = new Map(existing.map((item) => [item.command, item]));
  for (const item of scanned) {
    if (!item?.command) continue;
    const previous = byCommand.get(item.command);
    byCommand.set(item.command, {
      name: item.name || previous?.name || "",
      command: item.command,
      source: item.source || previous?.source || "scan",
      lastSeenAt: now
    });
  }
  return [...byCommand.values()].sort((a, b) => a.command.localeCompare(b.command));
}

function boundCommands(commands, dropped = 0) {
  const overflow = Math.max(0, commands.length - STATE_LIMITS.memoryCommands);
  const values = overflow
    ? [...commands]
      .sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")))
      .slice(0, STATE_LIMITS.memoryCommands)
      .sort((left, right) => left.command.localeCompare(right.command))
    : commands;
  return {
    values,
    dropped: (Number.isSafeInteger(dropped) && dropped >= 0 ? dropped : 0) + overflow
  };
}
