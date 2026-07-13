import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "../../shared/src/atomic-file.js";
import { CrossProcessLockManager, canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";
import { STATE_LIMITS, stateLimitError } from "../../shared/src/state-limits.js";

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
  constructor({ storagePath, lockManager = null, limits = {} }) {
    if (!storagePath) throw new Error("Missing audit storage path.");
    this.storagePath = path.resolve(storagePath);
    this.rotatedPath = `${this.storagePath}.1`;
    this.entryBytes = positiveLimit(limits.entryBytes, STATE_LIMITS.auditEntryBytes);
    this.segmentBytes = Math.max(this.entryBytes * 2, positiveLimit(limits.segmentBytes, STATE_LIMITS.auditSegmentBytes));
    this.readBytes = Math.max(this.segmentBytes, positiveLimit(limits.readBytes, STATE_LIMITS.auditReadBytes));
    this.lockManager = lockManager || new CrossProcessLockManager({
      storagePath: path.join(path.dirname(this.storagePath), ".audit-locks"),
      namespace: "audit-log",
      lockedCode: "AUDIT_LOG_LOCKED",
      lockedMessage: "Another CodeClaw process is updating the local audit log. Wait for it to finish, then retry."
    });
    this.mutationQueue = Promise.resolve();
  }

  async record(event, options = {}) {
    const entry = normalizeEvent(event);
    const line = `${JSON.stringify(entry)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.entryBytes) {
      throw stateLimitError("AUDIT_ENTRY_TOO_LARGE", `Audit entry exceeds the ${this.entryBytes}-byte safety limit. It was not recorded.`, 413);
    }
    return this.serializeMutation(async () => {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const currentSize = await fileSize(this.storagePath);
      if (currentSize + lineBytes > this.segmentBytes) {
        await this.rotateCurrentSegment();
      }
      await fs.appendFile(this.storagePath, line, "utf8");
      return entry;
    }, options);
  }

  async latest({ rootPath = null, limit = DEFAULT_LIMIT } = {}) {
    const entries = await this.readAll();
    const filtered = rootPath ? entries.filter((entry) => entry.rootPath === path.resolve(rootPath)) : entries;
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(limit, 1000)) : DEFAULT_LIMIT;
    return filtered.slice(-safeLimit).reverse();
  }

  async readAll() {
    await this.mutationQueue;
    return this.readAllUnqueued();
  }

  async redactLegacyModelData() {
    return this.serializeMutation(async () => {
      let changed = false;
      let entries = 0;
      for (const segmentPath of [this.rotatedPath, this.storagePath]) {
        const segment = await readAuditSegment(segmentPath, this.readBytes);
        entries += segment.entries.length;
        const redacted = segment.entries.map(redactLegacyEntry);
        if (JSON.stringify(redacted) === JSON.stringify(segment.entries)) continue;
        changed = true;
        const content = redacted.length ? `${redacted.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
        await atomicWriteFile(segmentPath, content, { mode: 0o600 });
      }
      return { changed, entries };
    });
  }

  async readAllUnqueued() {
    const [rotated, current] = await Promise.all([
      readAuditSegment(this.rotatedPath, this.readBytes),
      readAuditSegment(this.storagePath, this.readBytes)
    ]);
    return [...rotated.entries, ...current.entries];
  }

  async rotateCurrentSegment() {
    const current = await readAuditSegment(this.storagePath, this.readBytes);
    const previous = await readAuditSegment(this.rotatedPath, this.readBytes);
    if (current.content) await atomicWriteFile(this.rotatedPath, current.content, { mode: 0o600 });
    const marker = normalizeEvent({
      type: "audit.rotation",
      title: "Audit log rotated",
      detail: "",
      metadata: {
        rotatedEntries: current.entries.length,
        rotatedBytes: Buffer.byteLength(current.content, "utf8"),
        rotatedSha256: sha256(current.content),
        replacedBytes: Buffer.byteLength(previous.content, "utf8"),
        replacedSha256: previous.content ? sha256(previous.content) : ""
      }
    });
    await atomicWriteFile(this.storagePath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  }

  serializeMutation(mutation, options = {}) {
    const lockedMutation = async () => this.lockManager.withLock(await canonicalPathLockKey(this.storagePath), mutation, options);
    const result = this.mutationQueue.then(lockedMutation, lockedMutation);
    this.mutationQueue = result.catch(() => {});
    return result;
  }
}

export function summarizeToolResult(result) {
  if (!result) return "No result.";
  if (result.blocked) return result.message || "Tool call blocked.";
  let summary = "Tool call completed.";
  if (result.result?.exitCode !== undefined) summary = `exitCode=${result.result.exitCode}, timedOut=${Boolean(result.result.timedOut)}`;
  else if (result.result?.path) summary = result.result.created ? `created ${result.result.path}` : `updated ${result.result.path}`;
  else if (Array.isArray(result.result)) summary = `${result.result.length} item(s) returned.`;
  else if (typeof result.result === "string") summary = `${result.result.length} character(s) returned.`;
  if (result.truncated) {
    const reasons = Array.isArray(result.budget?.reasons) && result.budget.reasons.length
      ? result.budget.reasons.join(", ")
      : "runtime-budget";
    summary += ` Partial result (${reasons}).`;
  }
  return summary;
}

async function fileSize(filePath) {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function readAuditSegment(filePath, readBytes) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > readBytes) {
      throw stateLimitError("AUDIT_SEGMENT_TOO_LARGE", `Audit segment exceeds the ${readBytes}-byte read limit. Move it aside and review it before restarting CodeClaw.`);
    }
    const content = await fs.readFile(filePath, "utf8");
    return {
      content,
      entries: content.split(/\r?\n/).filter(Boolean).map(parseLine).filter(Boolean)
    };
  } catch (error) {
    if (error.code === "ENOENT") return { content: "", entries: [] };
    throw error;
  }
}

function redactLegacyEntry(entry) {
  if (!isModelEvent(entry) && entry.type !== "server.error") return entry;
  return {
    ...entry,
    detail: "",
    metadata: isModelEvent(entry)
      ? sanitizeModelMetadata(entry.metadata || {})
      : sanitizeServerErrorMetadata(entry.metadata || {})
  };
}

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
