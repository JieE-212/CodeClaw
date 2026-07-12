import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";

const DEFAULT_LIMIT = 100;
const MODEL_METADATA_KEYS = new Set([
  "channel",
  "code",
  "fileCount",
  "model",
  "operation",
  "provider",
  "requestBytes",
  "requestSha256",
  "responseBytes",
  "responseSha256",
  "taskId",
  "willLeaveDevice"
]);
const PRIVATE_METADATA_KEYS = /^(?:api[-_]?key|authorization|body|bodyUtf8|content|error|messages|prompt|raw|requestBody|response|responseBody|secret|token|upstreamError)$/i;

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

  async redactLegacyModelData() {
    const entries = await this.readAll();
    let changed = false;
    const redacted = entries.map((entry) => {
      if (!isModelEvent(entry) && entry.type !== "server.error") return entry;
      const next = {
        ...entry,
        detail: "",
        metadata: isModelEvent(entry)
          ? sanitizeModelMetadata(entry.metadata || {})
          : sanitizeServerErrorMetadata(entry.metadata || {})
      };
      if (JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
      return next;
    });
    if (changed) {
      const content = redacted.length ? `${redacted.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
      await atomicWriteFile(this.storagePath, content, { mode: 0o600 });
    }
    return { changed, entries: redacted.length };
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
  const entry = {
    id: event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: event.time || new Date().toISOString(),
    type: event.type || "event",
    status: event.status || "ok",
    title: event.title || event.type || "event",
    detail: event.detail || "",
    rootPath,
    metadata: sanitizeMetadata(event.metadata || {})
  };
  if (isModelEvent(entry)) {
    entry.detail = "";
    entry.metadata = sanitizeModelMetadata(entry.metadata);
  } else if (entry.type === "server.error") {
    entry.detail = "";
    entry.metadata = sanitizeServerErrorMetadata(entry.metadata);
  }
  return entry;
}

function sanitizeMetadata(metadata) {
  return JSON.parse(JSON.stringify(metadata, (key, value) => {
    if (key && PRIVATE_METADATA_KEYS.test(key)) return "[redacted]";
    if (typeof value === "string" && value.length > 1200) return `${value.slice(0, 1200)}...`;
    return value;
  }));
}

function sanitizeModelMetadata(metadata) {
  const output = {};
  for (const key of MODEL_METADATA_KEYS) {
    const value = metadata?.[key];
    if (value === undefined || value === null) continue;
    if (["requestBytes", "responseBytes", "fileCount"].includes(key)) {
      if (Number.isSafeInteger(value) && value >= 0) output[key] = value;
      continue;
    }
    if (key === "willLeaveDevice") {
      if (typeof value === "boolean") output[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 256) output[key] = value;
  }
  return output;
}

function sanitizeServerErrorMetadata(metadata) {
  const code = typeof metadata?.code === "string" && metadata.code.length <= 128 ? metadata.code : null;
  return code ? { code } : {};
}

function isModelEvent(entry) {
  return typeof entry?.type === "string" && entry.type.startsWith("model.");
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
