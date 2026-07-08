import fs from "node:fs/promises";
import path from "node:path";

const MAX_TASK_SUMMARIES = 30;
const MAX_KEY_FILES = 60;

export class MemoryStore {
  constructor({ storagePath }) {
    if (!storagePath) throw new Error("Missing memory storage path.");
    this.storagePath = storagePath;
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
    const memories = await this.readAll();
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
    if (index === -1) memories.push(next);
    else {
      memories.splice(index, 1);
      memories.push(next);
    }
    await this.writeAll(memories);
    return next;
  }

  async updateNotes(rootPath, notes = "") {
    const memory = await this.ensure(rootPath);
    return this.replace(memory.rootPath, {
      ...memory,
      notes: String(notes || ""),
      updatedAt: new Date().toISOString()
    });
  }

  async appendTaskSummary(rootPath, task = {}, summary = "") {
    const memory = await this.ensure(rootPath || task.rootPath);
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
    return this.replace(memory.rootPath, {
      ...memory,
      taskSummaries: [...existing, taskSummary].slice(-MAX_TASK_SUMMARIES),
      updatedAt: now
    });
  }

  async ensure(rootPath) {
    if (!rootPath) throw new Error("Missing repository root path.");
    const resolved = path.resolve(rootPath);
    const existing = await this.get(resolved);
    if (existing) return existing;
    const now = new Date().toISOString();
    const memory = createMemory({ rootPath: resolved, name: path.basename(resolved), now });
    const memories = await this.readAll();
    memories.push(memory);
    await this.writeAll(memories);
    return memory;
  }

  async replace(rootPath, memory) {
    const resolved = path.resolve(rootPath);
    const memories = await this.readAll();
    const index = memories.findIndex((item) => item.rootPath === resolved);
    if (index === -1) memories.push(memory);
    else {
      memories.splice(index, 1);
      memories.push(memory);
    }
    await this.writeAll(memories);
    return memory;
  }

  async readAll() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.storagePath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeAll(memories) {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(memories, null, 2), "utf8");
  }
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
