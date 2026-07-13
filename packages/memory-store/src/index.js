import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";

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
      const now = new Date().toISOString();
      const existing = index === -1 ? createMemory({ rootPath, name: repoProfile.name, now }) : memories[index];
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
        commands: mergeCommands(existing.commands || [], repoProfile.commands || [], now),
        updatedAt: now
      };
      replaceMemory(memories, rootPath, next);
      await this.writeAll(memories);
      return next;
    });
  }

  async updateNotes(rootPath, notes = "") {
    const resolved = resolveMemoryRoot(rootPath);
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
      const next = {
        ...memory,
        taskSummaries: [...existing, taskSummary].slice(-MAX_TASK_SUMMARIES),
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
    try {
      const parsed = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(memories) {
    await atomicWriteFile(this.storagePath, `${JSON.stringify(memories, null, 2)}\n`);
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
    notes: "",
    taskSummaries: [],
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
