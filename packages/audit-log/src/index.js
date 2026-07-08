import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LIMIT = 100;

export class AuditLog {
  constructor({ storagePath }) {
    if (!storagePath) throw new Error("Missing audit storage path.");
    this.storagePath = storagePath;
  }

  async record(event) {
    const entry = normalizeEvent(event);
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.appendFile(this.storagePath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async latest({ rootPath = null, limit = DEFAULT_LIMIT } = {}) {
    const entries = await this.readAll();
    const filtered = rootPath ? entries.filter((entry) => entry.rootPath === path.resolve(rootPath)) : entries;
    return filtered.slice(-limit).reverse();
  }

  async readAll() {
    try {
      const content = await fs.readFile(this.storagePath, "utf8");
      return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map(parseLine)
        .filter(Boolean);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
}

export function summarizeToolResult(result) {
  if (!result) return "No result.";
  if (result.blocked) return result.message || "Tool call blocked.";
  if (result.result?.exitCode !== undefined) return `exitCode=${result.result.exitCode}, timedOut=${Boolean(result.result.timedOut)}`;
  if (result.result?.path) return result.result.created ? `created ${result.result.path}` : `updated ${result.result.path}`;
  if (Array.isArray(result.result)) return `${result.result.length} item(s) returned.`;
  if (typeof result.result === "string") return `${result.result.length} character(s) returned.`;
  return "Tool call completed.";
}

function normalizeEvent(event = {}) {
  const rootPath = event.rootPath ? path.resolve(event.rootPath) : null;
  return {
    id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: event.time || new Date().toISOString(),
    type: event.type || "event",
    status: event.status || "ok",
    title: event.title || event.type || "event",
    detail: event.detail || "",
    rootPath,
    metadata: sanitizeMetadata(event.metadata || {})
  };
}

function sanitizeMetadata(metadata) {
  return JSON.parse(JSON.stringify(metadata, (_key, value) => {
    if (typeof value === "string" && value.length > 1200) return `${value.slice(0, 1200)}...`;
    return value;
  }));
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
