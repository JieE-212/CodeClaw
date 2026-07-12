import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { releasePreparedModelRequest } from "../../model-provider/src/index.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PREVIEWS = 32;

export class ModelOutboundPreviewStore {
  #ttlMs;
  #maxPreviews;
  #now;
  #secret;
  #previews;

  constructor({ ttlMs = DEFAULT_TTL_MS, maxPreviews = DEFAULT_MAX_PREVIEWS, now = () => Date.now(), secret = null } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Model preview TTL must be a positive integer.");
    if (!Number.isSafeInteger(maxPreviews) || maxPreviews <= 0) throw new Error("Model preview capacity must be a positive integer.");
    this.#ttlMs = ttlMs;
    this.#maxPreviews = maxPreviews;
    this.#now = now;
    this.#secret = secret ? Buffer.from(secret) : randomBytes(32);
    if (this.#secret.length < 32) throw new Error("Model preview secret must contain at least 32 bytes.");
    this.#previews = new Map();
  }

  create({ operation, task, workspace, manifest, configGeneration, prepared, disclosure }) {
    this.prune();
    assertCreateInput({ operation, task, workspace, manifest, configGeneration, prepared, disclosure });
    while (this.#previews.size >= this.#maxPreviews) {
      const oldestId = this.#previews.keys().next().value;
      this.releaseRecord(this.#previews.get(oldestId));
      this.#previews.delete(oldestId);
    }

    const previewId = `model-preview-${randomUUID()}`;
    const createdAtMs = this.#now();
    const expiresAtMs = createdAtMs + this.#ttlMs;
    const body = prepared.bodyBuffer;
    const requestSha256 = createHash("sha256").update(body).digest("hex");
    const target = targetForPrepared(prepared);
    const record = {
      previewId,
      operation,
      taskId: task.id,
      taskRevision: task.revision,
      workspaceId: workspace.id,
      rootPath: task.rootPath,
      rootIdentity: task.rootIdentity,
      manifestDigest: manifest.manifestDigest,
      manifestPolicyVersion: manifest.policyVersion,
      configGeneration,
      requestSha256,
      byteLength: body.length,
      disclosureDigest: digestJson(disclosure),
      createdAtMs,
      expiresAtMs,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      prepared,
      publicBody: body,
      target,
      disclosure: structuredClone(disclosure)
    };
    record.approvalDigest = this.sign(record);
    this.#previews.set(previewId, record);
    this.scheduleExpiry(record);
    return publicPreview(record);
  }

  take({ previewId, approvalDigest, approved } = {}) {
    if (approved !== true) {
      throw previewError("MODEL_SEND_APPROVAL_REQUIRED", "Sending the reviewed model request requires explicit approval.", 409);
    }
    this.prune();
    const record = this.#previews.get(String(previewId || ""));
    if (!record) throw previewError("MODEL_PREVIEW_UNKNOWN", "The model preview is missing, expired, or already used.", 409);
    if (!safeDigestEqual(record.approvalDigest, approvalDigest)) {
      throw previewError("MODEL_PREVIEW_APPROVAL_MISMATCH", "The approval does not match the reviewed model request.", 409);
    }
    if (!recordIntegrityMatches(record, this.sign(record))) {
      this.#previews.delete(record.previewId);
      this.releaseRecord(record);
      throw previewError("MODEL_PREVIEW_INTEGRITY_FAILED", "The prepared model request changed after review and was discarded.", 409);
    }

    // This deletion is deliberately synchronous and happens before the caller's
    // first await. Every approved attempt is single-use, including failed sends.
    this.#previews.delete(record.previewId);
    this.cancelExpiry(record);
    return record;
  }

  discard({ previewId, approvalDigest } = {}) {
    this.prune();
    const record = this.#previews.get(String(previewId || ""));
    if (!record) throw previewError("MODEL_PREVIEW_UNKNOWN", "The model preview is missing, expired, or already used.", 409);
    if (!safeDigestEqual(record.approvalDigest, approvalDigest)) {
      throw previewError("MODEL_PREVIEW_APPROVAL_MISMATCH", "The cancellation does not match the reviewed model request.", 409);
    }
    if (!recordIntegrityMatches(record, this.sign(record))) {
      this.#previews.delete(record.previewId);
      this.releaseRecord(record);
      throw previewError("MODEL_PREVIEW_INTEGRITY_FAILED", "The prepared model request changed after review and was discarded.", 409);
    }
    this.#previews.delete(record.previewId);
    this.releaseRecord(record);
    return { discarded: true };
  }

  clear() {
    for (const record of this.#previews.values()) this.releaseRecord(record);
    this.#previews.clear();
  }

  release(record) {
    this.releaseRecord(record);
  }

  get size() {
    this.prune();
    return this.#previews.size;
  }

  prune() {
    const now = this.#now();
    for (const [previewId, record] of this.#previews) {
      if (record.expiresAtMs > now) continue;
      this.releaseRecord(record);
      this.#previews.delete(previewId);
    }
  }

  scheduleExpiry(record) {
    record.expiryTimer = setTimeout(() => {
      if (this.#previews.get(record.previewId) !== record) return;
      this.#previews.delete(record.previewId);
      this.releaseRecord(record);
    }, this.#ttlMs);
    record.expiryTimer.unref?.();
  }

  cancelExpiry(record) {
    if (record?.expiryTimer) clearTimeout(record.expiryTimer);
    if (record) record.expiryTimer = null;
  }

  sign(record) {
    return createHmac("sha256", this.#secret).update(JSON.stringify(signingPayload(record)), "utf8").digest("hex");
  }

  releaseRecord(record) {
    if (!record || typeof record !== "object") return;
    this.cancelExpiry(record);
    if (Buffer.isBuffer(record.publicBody)) record.publicBody.fill(0);
    if (record.prepared) releasePreparedModelRequest(record.prepared);
    record.publicBody = null;
    record.prepared = null;
    record.disclosure = null;
    record.rootPath = "";
  }
}

function assertCreateInput({ operation, task, workspace, manifest, configGeneration, prepared, disclosure }) {
  if (!/^(?:task-suggest|context-files|patch-proposal|failure-fix)$/.test(operation || "")) {
    throw previewError("MODEL_OPERATION_INVALID", "The requested model operation is not supported.", 400);
  }
  if (!task?.id || !Number.isSafeInteger(task.revision) || task.revision < 1 || !task.rootPath || !validDigest(task.rootIdentity)) {
    throw previewError("MODEL_TASK_BINDING_INVALID", "The model request needs a revisioned server-bound task.", 409);
  }
  if (!workspace?.id || task.workspaceId !== workspace.id) {
    throw previewError("MODEL_WORKSPACE_BINDING_INVALID", "The task and workspace binding do not match.", 409);
  }
  if (!validDigest(manifest?.manifestDigest)
    || typeof manifest.policyVersion !== "string"
    || !manifest.policyVersion
    || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.excluded)) {
    throw previewError("MODEL_MANIFEST_BINDING_INVALID", "A complete Data Boundary Manifest is required.", 409);
  }
  if (typeof configGeneration !== "string" || !configGeneration) {
    throw previewError("MODEL_CONFIG_BINDING_INVALID", "The model configuration generation is unavailable.", 409);
  }
  const body = prepared?.bodyBuffer;
  if (!prepared || !Buffer.isBuffer(body) || !body.length || !prepared.provider || !prepared.target || !prepared.disclosure
    || prepared.operation !== operation
    || typeof prepared.bodyText !== "string" || typeof prepared.exactBody !== "string"
    || prepared.bodyText !== prepared.exactBody
    || prepared.bodyText !== body.toString("utf8")
    || prepared.byteLength !== body.byteLength
    || prepared.sha256 !== createHash("sha256").update(body).digest("hex")
    || typeof prepared.networkRequired !== "boolean"
    || prepared.disclosure.sendsNetworkRequest !== prepared.networkRequired
    || prepared.disclosure.willLeaveDevice !== prepared.target.willLeaveDevice
    || prepared.disclosure.endpoint !== prepared.target.endpoint) {
    throw previewError("MODEL_REQUEST_INVALID", "The prepared model request is incomplete.", 500);
  }
  if (!disclosureMatchesPrepared(disclosure, prepared.disclosure, manifest)) {
    throw previewError("MODEL_DISCLOSURE_INVALID", "The model request disclosure is incomplete.", 500);
  }
}

function disclosureMatchesPrepared(disclosure, preparedDisclosure, manifest) {
  if (!disclosure
    || !Array.isArray(disclosure.files)
    || !Array.isArray(disclosure.dataClasses)
    || !Array.isArray(preparedDisclosure?.files)
    || !Array.isArray(preparedDisclosure?.dataKinds)
    || disclosure.policyVersion !== manifest.policyVersion
    || disclosure.manifestDigest !== manifest.manifestDigest
    || disclosure.anonymized !== false
    || disclosure.safeToShare !== false
    || !Number.isSafeInteger(disclosure.excludedCount)
    || disclosure.excludedCount !== manifest.excluded.length
    || JSON.stringify(disclosure.dataClasses) !== JSON.stringify(preparedDisclosure.dataKinds)
    || disclosure.files.length !== preparedDisclosure.files.length) return false;

  const manifestFiles = new Map(manifest.files.map((file) => [file?.path, file]));
  for (const [index, source] of preparedDisclosure.files.entries()) {
    const displayed = disclosure.files[index];
    const manifestFile = manifestFiles.get(source?.path);
    const contentIncluded = ["full-content", "content-excerpt", "patch-diff"].includes(source?.mode);
    if (!displayed
      || !manifestFile
      || displayed.path !== source.path
      || displayed.mode !== source.mode
      || displayed.contentIncluded !== contentIncluded
      || displayed.byteLength !== manifestFile.size
      || displayed.sha256 !== manifestFile.sha256
      || displayed.transmittedUtf8Bytes !== source.transmittedUtf8Bytes
      || !Number.isSafeInteger(source.transmittedUtf8Bytes)
      || source.transmittedUtf8Bytes < 0) return false;
  }
  const containsSourceCode = preparedDisclosure.files.some((file) => ["full-content", "content-excerpt", "patch-diff"].includes(file?.mode))
    || preparedDisclosure.dataKinds.some((item) => ["recent-patch-diffs", "failure-summary"].includes(item));
  return disclosure.containsSourceCode === containsSourceCode;
}

function publicPreview(record) {
  return {
    previewId: record.previewId,
    approvalDigest: record.approvalDigest,
    operation: record.operation,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    provider: structuredClone(record.prepared.provider),
    request: {
      channel: record.target.channel,
      willLeaveDevice: record.target.willLeaveDevice,
      method: "POST",
      endpoint: record.target.endpoint,
      redirects: "refused",
      contentType: "application/json; charset=utf-8",
      bodyUtf8: record.publicBody.toString("utf8"),
      byteLength: record.byteLength,
      sha256: record.requestSha256
    },
    disclosure: structuredClone(record.disclosure)
  };
}

function signingPayload(record) {
  return {
    schemaVersion: 1,
    previewId: record.previewId,
    operation: record.operation,
    taskId: record.taskId,
    taskRevision: record.taskRevision,
    workspaceId: record.workspaceId,
    rootPath: record.rootPath,
    rootIdentity: record.rootIdentity,
    manifestDigest: record.manifestDigest,
    manifestPolicyVersion: record.manifestPolicyVersion,
    configGeneration: record.configGeneration,
    provider: record.prepared.provider,
    target: record.target,
    requestSha256: record.requestSha256,
    byteLength: record.byteLength,
    disclosureDigest: record.disclosureDigest,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt
  };
}

function targetForPrepared(prepared) {
  const channel = String(prepared.target?.channel || "");
  if (!/^(?:local|loopback|network)$/.test(channel)
    || typeof prepared.target?.willLeaveDevice !== "boolean"
    || prepared.networkRequired !== (channel !== "local")
    || prepared.target.willLeaveDevice !== (channel === "network")
    || (prepared.networkRequired ? typeof prepared.target.endpoint !== "string" : prepared.target.endpoint !== null)
    || (prepared.networkRequired ? prepared.target.endpoint !== prepared.endpoint : prepared.target.endpoint !== null)) {
    throw previewError("MODEL_REQUEST_INVALID", "The prepared model target is incomplete.", 500);
  }
  return Object.freeze({
    channel,
    willLeaveDevice: prepared.target.willLeaveDevice,
    endpoint: prepared.target.endpoint
  });
}

function recordIntegrityMatches(record, expectedApprovalDigest) {
  if (!safeDigestEqual(record.approvalDigest, expectedApprovalDigest)
    || !record.prepared
    || !record.disclosure
    || record.disclosureDigest !== digestJson(record.disclosure)) return false;
  const body = record.prepared.bodyBuffer;
  if (!Buffer.isBuffer(body) || !Buffer.isBuffer(record.publicBody)) return false;
  const sha256 = createHash("sha256").update(body).digest("hex");
  return body.byteLength === record.byteLength
    && record.publicBody.byteLength === record.byteLength
    && record.publicBody.equals(body)
    && record.requestSha256 === sha256
    && record.prepared.byteLength === body.byteLength
    && record.prepared.sha256 === sha256
    && record.prepared.bodyText === body.toString("utf8");
}

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function safeDigestEqual(expected, supplied) {
  if (typeof expected !== "string" || typeof supplied !== "string") return false;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(supplied, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function validDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function previewError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
