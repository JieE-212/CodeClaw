import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, capturePathIdentity, removeOwnedTemporaryFile, syncDirectory } from "../../shared/src/atomic-file.js";
import { canonicalPathLockKey } from "../../shared/src/cross-process-lock.js";

const SCHEMA_VERSION = 2;

export class PatchTransactionClaimStore {
  constructor({ storagePath, ownerId }) {
    if (!storagePath || !ownerId) throw new Error("Missing patch transaction claim configuration.");
    this.storagePath = path.resolve(storagePath);
    this.ownerId = String(ownerId);
  }

  async begin({ rootPath, rootIdentity, transactionId, operation }) {
    if (!validIdentityDigest(rootIdentity)) throw claimError("PATCH_TRANSACTION_CLAIM_INVALID", "The workspace identity for the patch transaction claim is invalid.");
    if (!["apply", "revert"].includes(operation)
      || typeof transactionId !== "string"
      || !new RegExp(`^${operation}-[a-z0-9-]{8,160}$`, "i").test(transactionId)) {
      throw claimError("PATCH_TRANSACTION_CLAIM_INVALID", "The patch transaction claim id and operation are invalid.");
    }
    const claimPath = await this.claimPath(rootPath);
    await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
    const record = {
      schemaVersion: SCHEMA_VERSION,
      rootHash: path.basename(claimPath, ".claim"),
      rootIdentity,
      ownerId: this.ownerId,
      transactionId,
      operation,
      phase: "reserved",
      createdAt: new Date().toISOString()
    };
    let handle;
    try {
      handle = await fs.open(claimPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await syncDirectory(this.storagePath);
      return record;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await this.read(rootPath);
      if (existing.valid && existing.record.ownerId === this.ownerId && existing.record.transactionId === transactionId) return existing.record;
      throw claimError("PATCH_RECOVERY_OWNED_ELSEWHERE", "Another CodeClaw state directory owns an unfinished patch operation for this project.");
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async assertCompatible({ rootPath, rootIdentity, pendingTransactionIds = [] }) {
    const claim = await this.read(rootPath);
    if (!claim.exists) {
      if (pendingTransactionIds.length) throw claimError("PATCH_TRANSACTION_CLAIM_MISSING", "A local recovery journal exists without its global project ownership claim.");
      return { ok: true, claim: null };
    }
    if (!claim.valid) throw claimError("PATCH_TRANSACTION_CLAIM_INVALID", "The project transaction ownership claim is invalid and requires review.");
    if (!validIdentityDigest(rootIdentity) || claim.record.rootIdentity !== rootIdentity) {
      throw claimError("PATCH_TRANSACTION_CLAIM_ROOT_MISMATCH", "The project transaction ownership claim belongs to a different workspace identity.");
    }
    if (claim.record.ownerId !== this.ownerId) {
      throw claimError("PATCH_RECOVERY_OWNED_ELSEWHERE", "Another CodeClaw state directory owns an unfinished patch operation for this project.");
    }
    if (pendingTransactionIds.length === 1 && pendingTransactionIds[0] === claim.record.transactionId) return { ok: true, claim: claim.record };
    if (pendingTransactionIds.length) throw claimError("PATCH_TRANSACTION_CLAIM_MISMATCH", "The project transaction claim does not match exactly one local recovery journal.");
    if (claim.record.phase === "journaled") {
      throw claimError("PATCH_TRANSACTION_JOURNAL_MISSING", "A project ownership claim indicates that workspace writes may have started, but its local recovery journal is missing.");
    }
    await this.remove({ rootPath, rootIdentity, transactionId: claim.record.transactionId });
    return { ok: true, claim: null, clearedOrphan: true };
  }

  async markJournaled({ rootPath, rootIdentity, transactionId }) {
    return this.setPhase({ rootPath, rootIdentity, transactionId, phase: "journaled", allowedPhases: ["reserved", "journaled"] });
  }

  async markComplete({ rootPath, rootIdentity, transactionId }) {
    return this.setPhase({ rootPath, rootIdentity, transactionId, phase: "complete", allowedPhases: ["reserved", "journaled", "complete"] });
  }

  async setPhase({ rootPath, rootIdentity, transactionId, phase, allowedPhases }) {
    const claimPath = await this.claimPath(rootPath);
    const claim = await this.read(rootPath);
    if (!claim.exists || !claim.valid
      || claim.record.ownerId !== this.ownerId
      || claim.record.rootIdentity !== rootIdentity
      || claim.record.transactionId !== transactionId
      || !allowedPhases.includes(claim.record.phase)) {
      throw claimError("PATCH_TRANSACTION_CLAIM_MISMATCH", "Patch transaction ownership changed unexpectedly.");
    }
    if (claim.record.phase === phase) return claim.record;
    const updated = { ...claim.record, phase, updatedAt: new Date().toISOString() };
    await atomicWriteFile(claimPath, `${JSON.stringify(updated)}\n`, {
      mode: 0o600,
      beforeReplace: async () => {
        const current = await this.read(rootPath);
        if (!current.exists || !current.valid
          || current.record.ownerId !== claim.record.ownerId
          || current.record.rootIdentity !== rootIdentity
          || current.record.transactionId !== transactionId
          || current.record.phase !== claim.record.phase) {
          throw claimError("PATCH_TRANSACTION_CLAIM_MISMATCH", "Patch transaction ownership changed during its durable phase update.");
        }
      }
    });
    return updated;
  }

  async remove({ rootPath, rootIdentity, transactionId }) {
    const claimPath = await this.claimPath(rootPath);
    const claim = await this.read(rootPath);
    if (!claim.exists) return false;
    if (!claim.valid
      || claim.record.ownerId !== this.ownerId
      || claim.record.rootIdentity !== rootIdentity
      || claim.record.transactionId !== transactionId) {
      throw claimError("PATCH_TRANSACTION_CLAIM_MISMATCH", "Patch transaction ownership changed unexpectedly.");
    }
    const directoryIdentity = await capturePathIdentity(this.storagePath, { requireDirectory: true });
    const claimIdentity = await capturePathIdentity(claimPath, { requireFile: true });
    await removeOwnedTemporaryFile(claimPath, { directoryIdentity, temporaryIdentity: claimIdentity });
    await syncDirectory(this.storagePath);
    return true;
  }

  async read(rootPath) {
    const claimPath = await this.claimPath(rootPath);
    let raw;
    try {
      raw = await fs.readFile(claimPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false, valid: true, record: null };
      throw error;
    }
    try {
      const record = JSON.parse(raw);
      const valid = record?.schemaVersion === SCHEMA_VERSION
        && record.rootHash === path.basename(claimPath, ".claim")
        && validIdentityDigest(record.rootIdentity)
        && typeof record.ownerId === "string"
        && /^(apply|revert)-[a-z0-9-]{8,160}$/i.test(record.transactionId || "")
        && ["apply", "revert"].includes(record.operation)
        && record.transactionId.toLowerCase().startsWith(`${record.operation}-`)
        && ["reserved", "journaled", "complete"].includes(record.phase);
      return { exists: true, valid, record };
    } catch {
      return { exists: true, valid: false, record: null };
    }
  }

  async claimPath(rootPath) {
    const rootKey = await canonicalPathLockKey(rootPath);
    const rootHash = createHash("sha256").update(rootKey, "utf8").digest("hex");
    return path.join(this.storagePath, `${rootHash}.claim`);
  }
}

function validIdentityDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function loadPatchStateOwnerId(statePath) {
  const directory = path.resolve(statePath);
  const ownerPath = path.join(directory, "patch-state-owner.json");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const record = JSON.parse(await fs.readFile(ownerPath, "utf8"));
      if (record?.schemaVersion !== 1 || typeof record.ownerId !== "string" || !/^[0-9a-f-]{36}$/i.test(record.ownerId)) {
        throw claimError("PATCH_STATE_OWNER_INVALID", "The local patch transaction owner identity is invalid.");
      }
      return record.ownerId;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const record = { schemaVersion: 1, ownerId: randomUUID(), createdAt: new Date().toISOString() };
    let handle;
    try {
      handle = await fs.open(ownerPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectory(directory);
      return record.ownerId;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw claimError("PATCH_STATE_OWNER_INVALID", "The local patch transaction owner identity could not be loaded.");
}

function claimError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}
