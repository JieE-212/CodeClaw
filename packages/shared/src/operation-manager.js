import { randomUUID } from "node:crypto";

export class OperationManager {
  constructor({
    maxActive = 8,
    maxPerKind = 2,
    defaultTimeoutMs = 30_000,
    maxTimeoutMs = 120_000,
    commitTimeoutMs = 10_000
  } = {}) {
    this.maxActive = positiveInteger(maxActive, 8);
    this.maxPerKind = positiveInteger(maxPerKind, 2);
    this.defaultTimeoutMs = positiveInteger(defaultTimeoutMs, 30_000);
    this.maxTimeoutMs = positiveInteger(maxTimeoutMs, 120_000);
    this.commitTimeoutMs = Math.min(positiveInteger(commitTimeoutMs, 10_000), 30_000);
    this.operations = new Map();
    this.idleWaiters = new Set();
  }

  start({ id = randomUUID(), kind = "operation", timeoutMs = this.defaultTimeoutMs, metadata = {} } = {}) {
    const operationId = normalizeOperationId(id);
    const operationKind = normalizeKind(kind);
    if (this.operations.has(operationId)) throw operationError("OPERATION_ID_CONFLICT", "An operation with this ID is already active.", 409);
    if (this.operations.size >= this.maxActive) throw operationError("OPERATION_LIMIT_REACHED", "Too many local operations are active. Wait for one to finish or cancel it.", 429);
    const sameKind = [...this.operations.values()].filter((operation) => operation.kind === operationKind).length;
    if (sameKind >= this.maxPerKind) throw operationError("OPERATION_KIND_LIMIT_REACHED", `Too many ${operationKind} operations are active. Wait for one to finish or cancel it.`, 429);

    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const deadlineMs = Math.min(positiveInteger(timeoutMs, this.defaultTimeoutMs), this.maxTimeoutMs);
    const operation = {
      id: operationId,
      kind: operationKind,
      controller,
      startedAt,
      deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
      metadata: sanitizeMetadata(metadata),
      phase: "running",
      committed: false,
      timeout: null
    };
    operation.timeout = setTimeout(() => {
      controller.abort(operationError("OPERATION_TIMEOUT", `${operationKind} exceeded its ${deadlineMs} ms deadline.`, 408));
    }, deadlineMs);
    operation.timeout.unref?.();
    this.operations.set(operationId, operation);

    let finished = false;
    return Object.freeze({
      id: operationId,
      kind: operationKind,
      signal: controller.signal,
      startedAt,
      deadlineAt: operation.deadlineAt,
      get committed() {
        return operation.committed;
      },
      beginCommit: () => {
        throwIfAborted(controller.signal);
        if (finished || this.operations.get(operationId) !== operation || operation.phase !== "running") return false;
        operation.phase = "committing";
        clearTimeout(operation.timeout);
        operation.timeout = setTimeout(() => {
          controller.abort(operationError("OPERATION_COMMIT_TIMEOUT", `The ${operationKind} local-state commit exceeded its ${this.commitTimeoutMs} ms deadline.`, 504));
        }, this.commitTimeoutMs);
        operation.timeout.unref?.();
        return true;
      },
      confirmCommit: () => {
        if (finished || this.operations.get(operationId) !== operation || operation.phase !== "committing") return false;
        operation.committed = true;
        operation.phase = "committed";
        clearTimeout(operation.timeout);
        operation.timeout = null;
        return true;
      },
      finish: () => {
        if (finished) return false;
        finished = true;
        clearTimeout(operation.timeout);
        this.operations.delete(operationId);
        this.notifyIdle();
        return true;
      }
    });
  }

  cancel(id, reason = "Cancelled by the local user.") {
    const operation = this.operations.get(String(id || ""));
    if (!operation || operation.phase !== "running" || operation.controller.signal.aborted) return false;
    operation.controller.abort(operationError("OPERATION_CANCELLED", boundedOperationMessage(reason), 409));
    return true;
  }

  abortAll(reason = "CodeClaw is shutting down.") {
    let aborted = 0;
    for (const operation of this.operations.values()) {
      if (operation.phase !== "running" || operation.controller.signal.aborted) continue;
      operation.controller.abort(operationError("OPERATION_CANCELLED", reason, 409));
      aborted += 1;
    }
    return aborted;
  }

  list() {
    return [...this.operations.values()].map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      startedAt: operation.startedAt,
      deadlineAt: operation.deadlineAt,
      metadata: operation.metadata,
      phase: operation.phase,
      aborted: operation.controller.signal.aborted
    }));
  }

  waitForIdle(timeoutMs = 1000) {
    if (this.operations.size === 0) return Promise.resolve(true);
    const deadlineMs = positiveInteger(timeoutMs, 1000);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.idleWaiters.delete(onIdle);
        resolve(value);
      };
      const onIdle = () => finish(true);
      const timeout = setTimeout(() => finish(false), deadlineMs);
      timeout.unref?.();
      this.idleWaiters.add(onIdle);
      if (this.operations.size === 0) onIdle();
    });
  }

  notifyIdle() {
    if (this.operations.size !== 0) return;
    for (const notify of [...this.idleWaiters]) notify();
  }
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw operationError("OPERATION_CANCELLED", "The local operation was cancelled.", 409);
}

function normalizeOperationId(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
    throw operationError("OPERATION_ID_INVALID", "Operation ID is invalid.", 400);
  }
  return normalized;
}

function normalizeKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(normalized)) throw operationError("OPERATION_KIND_INVALID", "Operation kind is invalid.", 400);
  return normalized;
}

function sanitizeMetadata(metadata) {
  const output = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    if (typeof value === "boolean" || Number.isSafeInteger(value)) output[key] = value;
    else if (typeof value === "string" && value.length <= 160 && !/[\\/]/.test(value)) output[key] = value;
  }
  return Object.freeze(output);
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function boundedOperationMessage(value) {
  const message = String(value || "Cancelled by the local user.").trim() || "Cancelled by the local user.";
  return message.slice(0, 240);
}

function operationError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
