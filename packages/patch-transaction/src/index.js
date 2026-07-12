import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, syncDirectory } from "../../shared/src/atomic-file.js";
import {
  captureWorkspaceIdentity,
  captureWorkspaceParentIdentity,
  workspaceIdentityMatches,
  workspaceParentIdentityMatches
} from "../../shared/src/workspace-identity.js";

const JOURNAL_FILE = "journal.json";
const SCHEMA_VERSION = 2;

export class PatchTransactionStore {
  constructor({ storagePath }) {
    if (!storagePath) throw new Error("Missing patch transaction storage path.");
    this.storagePath = path.resolve(storagePath);
  }

  async begin({ id = "", operation, taskId, rootPath, rootIdentity, patchIndex = null, items }) {
    const transactionId = validTransactionId(id) ? id : `${operation}-${Date.now()}-${randomUUID()}`;
    validateTransactionInput({ transactionId, operation, taskId, rootPath, rootIdentity, patchIndex, items });
    const workspace = await captureWorkspaceIdentity(rootPath).catch(() => null);
    if (!workspace || workspace.digest !== rootIdentity) throw transactionIdentityError("PATCH_TRANSACTION_ROOT_CHANGED", "The workspace root changed before the safety journal was created.");
    const preparedItems = [];
    for (const item of items) {
      const relativePath = normalizeRelativePath(item.path);
      const parent = await captureWorkspaceParentIdentity(workspace.rootPath, relativePath).catch(() => null);
      if (!parent || parent.digest !== item.parentIdentity) {
        throw transactionIdentityError("PATCH_TRANSACTION_PARENT_CHANGED", `The parent directory for ${relativePath} changed before the safety journal was created.`);
      }
      preparedItems.push({ ...item, path: relativePath });
    }
    const transactionPath = this.transactionPath(transactionId);
    await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
    await fs.mkdir(transactionPath, { recursive: false, mode: 0o700 });
    await syncDirectory(this.storagePath);

    try {
      const journalItems = [];
      for (const [index, item] of preparedItems.entries()) {
        const relativePath = item.path;
        const beforeExists = item.beforeExists === true;
        const afterExists = item.afterExists === true;
        const backupFile = beforeExists ? `${String(index).padStart(4, "0")}.before` : "";
        if (beforeExists) {
          if (typeof item.beforeContent !== "string") throw new Error(`Missing before content for ${relativePath}.`);
          await writePrivateFile(path.join(transactionPath, backupFile), item.beforeContent);
        }
        if (afterExists && typeof item.afterContent !== "string") throw new Error(`Missing after content for ${relativePath}.`);
        journalItems.push({
          path: relativePath,
          parentIdentity: item.parentIdentity,
          temporaryIdentity: null,
          before: {
            exists: beforeExists,
            sha256: beforeExists ? hashContent(item.beforeContent) : null,
            backupFile
          },
          after: {
            exists: afterExists,
            sha256: afterExists ? hashContent(item.afterContent) : null
          }
        });
      }

      const journal = {
        schemaVersion: SCHEMA_VERSION,
        id: transactionId,
        operation,
        taskId,
        rootPath: workspace.rootPath,
        rootIdentity,
        patchIndex: Number.isInteger(patchIndex) ? patchIndex : null,
        createdAt: new Date().toISOString(),
        items: journalItems
      };
      await writePrivateFile(path.join(transactionPath, JOURNAL_FILE), `${JSON.stringify(journal, null, 2)}\n`);
      await syncDirectory(transactionPath);
      return journal;
    } catch (error) {
      await fs.rm(transactionPath, { recursive: true, force: true }).catch(() => {});
      await syncDirectory(this.storagePath).catch(() => {});
      throw error;
    }
  }

  async listPending() {
    let entries = [];
    try {
      entries = await fs.readdir(this.storagePath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    const pending = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      if (!validTransactionId(entry.name)) {
        if (/^(apply|revert)-/i.test(entry.name)) pending.push(invalidTransaction(entry.name));
        continue;
      }
      const journalPath = path.join(this.storagePath, entry.name, JOURNAL_FILE);
      try {
        const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
        validateJournal(journal, entry.name);
        pending.push(journal);
      } catch (error) {
        pending.push(invalidTransaction(entry.name));
      }
    }
    return pending;
  }

  async readBeforeContent(transaction, item) {
    if (!item.before.exists) return "";
    const backupFile = String(item.before.backupFile || "");
    if (!/^\d{4}\.before$/.test(backupFile)) throw new Error("Patch transaction backup reference is invalid.");
    const content = await fs.readFile(path.join(this.transactionPath(transaction.id), backupFile), "utf8");
    if (hashContent(content) !== item.before.sha256) throw new Error("Patch transaction backup checksum does not match.");
    return content;
  }

  async recordTemporaryIdentity(id, filePath, temporaryIdentity) {
    if (!validTransactionId(id) || !validTemporaryIdentity(temporaryIdentity)) throw new Error("Invalid patch temporary-file identity.");
    const journalPath = path.join(this.transactionPath(id), JOURNAL_FILE);
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
    validateJournal(journal, id);
    const normalizedPath = normalizeRelativePath(filePath);
    const item = journal.items.find((entry) => portablePathKey(entry.path) === portablePathKey(normalizedPath));
    if (!item) throw new Error("Patch temporary-file identity does not match a journal item.");
    item.temporaryIdentity = temporaryIdentity;
    await writePrivateFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    await syncDirectory(this.transactionPath(id));
    return temporaryIdentity;
  }

  async remove(id) {
    await fs.rm(this.transactionPath(id), { recursive: true, force: true });
    await syncDirectory(this.storagePath);
  }

  transactionPath(id) {
    if (!validTransactionId(id)) throw new Error("Invalid patch transaction id.");
    return path.join(this.storagePath, id);
  }
}

export async function recoverPatchTransactions({ store, taskStore, registryFactory, rootPath = "", withRootLock = null, beforeRemove = null }) {
  const pending = await store.listPending();
  const selectedRoot = rootPath ? canonicalRoot(rootPath) : "";
  const results = [];

  for (const transaction of pending) {
    if (selectedRoot && transaction.rootPath && canonicalRoot(transaction.rootPath) !== selectedRoot) continue;
    if (transaction.invalid) {
      results.push(publicResult(transaction, "blocked", 1, "PATCH_TRANSACTION_JOURNAL_INVALID"));
      continue;
    }

    const recoverOne = () => recoverPatchTransaction({ store, taskStore, transaction, registryFactory, beforeRemove });
    try {
      results.push(withRootLock ? await withRootLock(transaction.rootPath, recoverOne) : await recoverOne());
    } catch (error) {
      results.push(publicResult(transaction, "blocked", 1, publicRecoveryErrorCode(error, "PATCH_TRANSACTION_LOCK_FAILED")));
    }
  }

  return summarizeRecovery(results);
}

async function recoverPatchTransaction({ store, taskStore, transaction, registryFactory, beforeRemove }) {
  const identityConflict = await transactionWorkspaceConflict(transaction);
  if (identityConflict) return publicResult(transaction, "blocked", 1, identityConflict);
  const commitState = await transactionCommitState(taskStore, transaction);
  if (!commitState.known) return publicResult(transaction, "blocked", 1, "PATCH_TRANSACTION_TASK_STATE_UNKNOWN");
  if (!commitState.committed) return rollbackPatchTransaction({ store, transaction, registryFactory, beforeRemove });

  let registry;
  try {
    registry = registryFactory(transaction.rootPath);
    for (const item of transaction.items) {
      await assertTransactionWorkspace(transaction, item);
      const current = await readRegistryState(registry, item.path);
      if (!stateMatches(current, item.after)) return publicResult(transaction, "blocked", 1, "PATCH_TRANSACTION_COMMITTED_DRIFT");
    }
    for (const item of transaction.items) {
      await assertTransactionWorkspace(transaction, item);
      await registry.cleanupPatchTemporary({
        path: item.path,
        transactionId: transaction.id,
        rootIdentity: transaction.rootIdentity,
        parentIdentity: item.parentIdentity,
        temporaryIdentity: item.temporaryIdentity
      });
    }
    await assertTransactionWorkspace(transaction);
    if (beforeRemove) await beforeRemove(transaction);
    await store.remove(transaction.id);
    return publicResult(transaction, "committed-cleanup", 0, "");
  } catch (error) {
    return publicResult(transaction, "blocked", 1, publicRecoveryErrorCode(error, "PATCH_TRANSACTION_CLEANUP_FAILED"));
  }
}

export async function rollbackPatchTransaction({ store, transaction, registryFactory, beforeRemove = null }) {
  const identityConflict = await transactionWorkspaceConflict(transaction);
  if (identityConflict) return publicResult(transaction, "blocked", 1, identityConflict);
  let registry;
  try {
    registry = registryFactory(transaction.rootPath);
  } catch {
    return publicResult(transaction, "blocked", transaction.items.length || 1, "PATCH_TRANSACTION_ROOT_UNAVAILABLE");
  }

  try {
    for (const item of transaction.items) {
      await assertTransactionWorkspace(transaction, item);
      await registry.cleanupPatchTemporary({
        path: item.path,
        transactionId: transaction.id,
        rootIdentity: transaction.rootIdentity,
        parentIdentity: item.parentIdentity,
        temporaryIdentity: item.temporaryIdentity
      });
    }
  } catch (error) {
    return publicResult(transaction, "blocked", 1, publicRecoveryErrorCode(error, "PATCH_TRANSACTION_TEMP_CLEANUP_FAILED"));
  }

  const observed = [];
  for (const item of transaction.items) {
    try {
      await assertTransactionWorkspace(transaction, item);
      const current = await readRegistryState(registry, item.path);
      const relation = stateMatches(current, item.before)
        ? "before"
        : stateMatches(current, item.after)
          ? "after"
          : "conflict";
      observed.push({ item, current, relation });
    } catch {
      observed.push({ item, current: null, relation: "conflict" });
    }
  }

  const conflicts = observed.filter((entry) => entry.relation === "conflict").length;
  if (conflicts) return publicResult(transaction, "blocked", conflicts, "PATCH_TRANSACTION_RECOVERY_CONFLICT");

  try {
    for (const entry of observed) {
      if (entry.relation === "after" && entry.item.before.exists) {
        entry.beforeContent = await store.readBeforeContent(transaction, entry.item);
      }
    }
  } catch {
    return publicResult(transaction, "blocked", 1, "PATCH_TRANSACTION_BACKUP_INVALID");
  }

  try {
    for (const entry of [...observed].reverse()) {
      if (entry.relation !== "after") continue;
      const expectedBaseline = baselineFromState(entry.item.after);
      const args = entry.item.before.exists
        ? {
            path: entry.item.path,
            content: entry.beforeContent,
            expectedBaseline,
            transactionId: transaction.id,
            rootIdentity: transaction.rootIdentity,
            parentIdentity: entry.item.parentIdentity,
            onTemporaryReady: (identity) => store.recordTemporaryIdentity(transaction.id, entry.item.path, identity)
          }
        : {
            path: entry.item.path,
            remove: true,
            expectedBaseline,
            transactionId: transaction.id,
            rootIdentity: transaction.rootIdentity,
            parentIdentity: entry.item.parentIdentity,
            onTemporaryReady: (identity) => store.recordTemporaryIdentity(transaction.id, entry.item.path, identity)
          };
      await assertTransactionWorkspace(transaction, entry.item);
      await registry.call("write_patch", args, { approved: true });
    }

    for (const item of transaction.items) {
      await assertTransactionWorkspace(transaction, item);
      const current = await readRegistryState(registry, item.path);
      if (!stateMatches(current, item.before)) {
        return publicResult(transaction, "blocked", 1, "PATCH_TRANSACTION_RECOVERY_VERIFY_FAILED");
      }
    }
    await assertTransactionWorkspace(transaction);
    if (beforeRemove) await beforeRemove(transaction);
    await store.remove(transaction.id);
    return publicResult(transaction, "recovered", 0, "");
  } catch (error) {
    return publicResult(transaction, "blocked", 1, publicRecoveryErrorCode(error, "PATCH_TRANSACTION_RECOVERY_WRITE_FAILED"));
  }
}

export function hashContent(content) {
  return createHash("sha256").update(String(content), "utf8").digest("hex");
}

async function transactionCommitState(taskStore, transaction) {
  try {
    const task = await taskStore.get(transaction.taskId);
    if (!task.rootPath || canonicalRoot(task.rootPath) !== canonicalRoot(transaction.rootPath)) return { known: false, committed: false };
    if (task.rootIdentity !== transaction.rootIdentity) return { known: false, committed: false };
    if (transaction.operation === "apply") {
      const recorded = (task.appliedPatches || []).filter((patch) => patch.transactionId === transaction.id || patch.batchId === transaction.id);
      if (!recorded.length) return { known: true, committed: false };
      if (recorded.length !== transaction.items.length) return { known: false, committed: false };
      const matches = transaction.items.every((item) => {
        const candidates = recorded.filter((patch) => portablePathKey(normalizeRelativePath(patch.path)) === portablePathKey(normalizeRelativePath(item.path)));
        return candidates.length === 1 && appliedRecordMatches(candidates[0], item, transaction);
      });
      return { known: matches, committed: matches };
    }
    if (transaction.operation === "revert") {
      const patch = (task.appliedPatches || [])[transaction.patchIndex];
      if (patch?.revertTransactionId !== transaction.id) return { known: true, committed: false };
      const item = transaction.items[0];
      const matches = transaction.items.length === 1 && Boolean(patch.revertedAt) && revertRecordMatches(patch, item, transaction);
      return { known: matches, committed: matches };
    }
    return { known: false, committed: false };
  } catch {
    return { known: false, committed: false };
  }
}

function appliedRecordMatches(patch, item, transaction) {
  const previousExists = patch.previousExists !== false;
  return patch.workspaceIdentity === transaction.rootIdentity
    && patch.parentIdentity === item.parentIdentity
    && previousExists === item.before.exists
    && (!previousExists || typeof patch.previousContent === "string" && hashContent(patch.previousContent) === item.before.sha256)
    && typeof patch.nextContent === "string"
    && item.after.exists
    && hashContent(patch.nextContent) === item.after.sha256;
}

function revertRecordMatches(patch, item, transaction) {
  const previousExists = patch.previousExists !== false;
  return patch.workspaceIdentity === transaction.rootIdentity
    && patch.parentIdentity === item.parentIdentity
    && portablePathKey(normalizeRelativePath(patch.path)) === portablePathKey(normalizeRelativePath(item.path))
    && item.before.exists
    && typeof patch.nextContent === "string"
    && hashContent(patch.nextContent) === item.before.sha256
    && previousExists === item.after.exists
    && (!previousExists || typeof patch.previousContent === "string" && hashContent(patch.previousContent) === item.after.sha256);
}

async function readRegistryState(registry, filePath) {
  try {
    const read = await registry.call("read_file", { path: filePath });
    return { exists: true, content: read.result, sha256: hashContent(read.result) };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, content: "", sha256: null };
    throw error;
  }
}

function stateMatches(current, expected) {
  if (current.exists !== expected.exists) return false;
  return !current.exists || current.sha256 === expected.sha256;
}

function baselineFromState(state) {
  return state.exists ? { exists: true, sha256: state.sha256 } : { exists: false, sha256: null };
}

async function transactionWorkspaceConflict(transaction) {
  if (!(await workspaceIdentityMatches(transaction.rootPath, transaction.rootIdentity))) return "PATCH_TRANSACTION_ROOT_CHANGED";
  for (const item of transaction.items) {
    if (!(await workspaceParentIdentityMatches(transaction.rootPath, item.path, item.parentIdentity))) return "PATCH_TRANSACTION_PARENT_CHANGED";
  }
  return "";
}

async function assertTransactionWorkspace(transaction, item = null) {
  if (!(await workspaceIdentityMatches(transaction.rootPath, transaction.rootIdentity))) {
    throw transactionIdentityError("PATCH_TRANSACTION_ROOT_CHANGED", "The workspace root no longer matches the patch transaction journal.");
  }
  if (item && !(await workspaceParentIdentityMatches(transaction.rootPath, item.path, item.parentIdentity))) {
    throw transactionIdentityError("PATCH_TRANSACTION_PARENT_CHANGED", "A target parent directory no longer matches the patch transaction journal.");
  }
}

function publicRecoveryErrorCode(error, fallback) {
  return typeof error?.code === "string" && /^(PATCH_|PROJECT_)/.test(error.code) ? error.code : fallback;
}

function transactionIdentityError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

function summarizeRecovery(results) {
  const blocked = results.filter((item) => item.status === "blocked").length;
  return {
    ok: blocked === 0,
    mode: "patch-transaction-recovery",
    checkedAt: new Date().toISOString(),
    pending: results.length,
    recovered: results.filter((item) => item.status === "recovered").length,
    committedCleanup: results.filter((item) => item.status === "committed-cleanup").length,
    blocked,
    transactions: results
  };
}

function publicResult(transaction, status, conflicts, code) {
  return {
    operation: transaction.operation,
    status,
    itemCount: transaction.items.length,
    conflicts,
    code
  };
}

function validateTransactionInput({ transactionId, operation, taskId, rootPath, rootIdentity, patchIndex, items }) {
  if (!validTransactionId(transactionId)) throw new Error("Invalid patch transaction id.");
  if (!["apply", "revert"].includes(operation)) throw new Error("Invalid patch transaction operation.");
  if (!transactionId.toLowerCase().startsWith(`${operation}-`)) throw new Error("Patch transaction id does not match its operation.");
  if (typeof taskId !== "string" || !taskId) throw new Error("Missing patch transaction task id.");
  if (typeof rootPath !== "string" || !rootPath || !path.isAbsolute(rootPath)) throw new Error("Missing patch transaction root path.");
  if (!validIdentityDigest(rootIdentity)) throw new Error("Missing patch transaction workspace identity.");
  if (!Array.isArray(items) || !items.length) throw new Error("Patch transaction has no items.");
  if (operation === "apply" && patchIndex !== null) throw new Error("Apply transactions cannot select a patch index.");
  if (operation === "revert" && (!Number.isInteger(patchIndex) || patchIndex < 0 || items.length !== 1)) throw new Error("Revert transactions require one valid patch index and one item.");
  const seen = new Set();
  for (const item of items) {
    const relativePath = normalizeRelativePath(item?.path);
    if (!validIdentityDigest(item?.parentIdentity)) throw new Error(`Missing patch transaction parent identity for ${relativePath}.`);
    if (typeof item.beforeExists !== "boolean" || typeof item.afterExists !== "boolean") throw new Error(`Missing patch transaction state for ${relativePath}.`);
    if (item.beforeExists && typeof item.beforeContent !== "string") throw new Error(`Missing before content for ${relativePath}.`);
    if (item.afterExists && typeof item.afterContent !== "string") throw new Error(`Missing after content for ${relativePath}.`);
    const pathKey = portablePathKey(relativePath);
    if (seen.has(pathKey)) throw new Error(`Duplicate patch transaction path: ${relativePath}.`);
    seen.add(pathKey);
  }
}

function validateJournal(journal, directoryName) {
  if (journal?.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported patch transaction schema.");
  if (journal.id !== directoryName || !validTransactionId(journal.id)) throw new Error("Patch transaction id does not match its folder.");
  if (!["apply", "revert"].includes(journal.operation)) throw new Error("Patch transaction operation is invalid.");
  if (!journal.id.toLowerCase().startsWith(`${journal.operation}-`)) throw new Error("Patch transaction id does not match its operation.");
  if (typeof journal.taskId !== "string" || !journal.taskId) throw new Error("Patch transaction task id is invalid.");
  if (!path.isAbsolute(journal.rootPath || "")) throw new Error("Patch transaction root path is invalid.");
  if (!validIdentityDigest(journal.rootIdentity)) throw new Error("Patch transaction workspace identity is invalid.");
  if (!Array.isArray(journal.items) || !journal.items.length) throw new Error("Patch transaction items are invalid.");
  if (journal.operation === "apply" && journal.patchIndex !== null) throw new Error("Apply transaction patch index is invalid.");
  if (journal.operation === "revert" && (!Number.isInteger(journal.patchIndex) || journal.patchIndex < 0 || journal.items.length !== 1)) throw new Error("Revert transaction patch index is invalid.");
  const seen = new Set();
  for (const item of journal.items) {
    const relativePath = normalizeRelativePath(item.path);
    if (!validIdentityDigest(item.parentIdentity)) throw new Error("Patch transaction parent identity is invalid.");
    if (item.temporaryIdentity !== null && !validTemporaryIdentity(item.temporaryIdentity)) throw new Error("Patch transaction temporary-file identity is invalid.");
    const pathKey = portablePathKey(relativePath);
    if (seen.has(pathKey)) throw new Error("Patch transaction contains duplicate paths.");
    seen.add(pathKey);
    if (typeof item.before?.exists !== "boolean" || typeof item.after?.exists !== "boolean") throw new Error("Patch transaction state is invalid.");
    if (item.before.exists && !/^[0-9a-f]{64}$/.test(item.before.sha256 || "")) throw new Error("Patch transaction before hash is invalid.");
    if (item.after.exists && !/^[0-9a-f]{64}$/.test(item.after.sha256 || "")) throw new Error("Patch transaction after hash is invalid.");
    if (item.before.exists && !/^\d{4}\.before$/.test(item.before.backupFile || "")) throw new Error("Patch transaction backup reference is invalid.");
    if (!item.before.exists && (item.before.sha256 !== null || item.before.backupFile)) throw new Error("Patch transaction missing-file state is invalid.");
    if (!item.after.exists && item.after.sha256 !== null) throw new Error("Patch transaction missing-file state is invalid.");
  }
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) throw new Error("Patch transaction path must be relative.");
  const segments = normalized.split("/");
  if (segments.some((segment) => unsafePortableSegment(segment))) throw new Error("Patch transaction path is invalid.");
  return segments.join("/");
}

function unsafePortableSegment(segment) {
  const stem = segment.split(".")[0];
  return !segment
    || segment === "."
    || segment === ".."
    || segment.includes(":")
    || /[. ]$/.test(segment)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
}

function portablePathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function canonicalRoot(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validTransactionId(value) {
  return typeof value === "string" && /^(apply|revert)-[a-z0-9-]{8,160}$/i.test(value);
}

function validIdentityDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validTemporaryIdentity(value) {
  return value
    && typeof value.dev === "string"
    && /^\d+$/.test(value.dev)
    && typeof value.ino === "string"
    && /^\d+$/.test(value.ino)
    && typeof value.birthtimeNs === "string"
    && /^\d+$/.test(value.birthtimeNs)
    && value.nlink === 1;
}

async function writePrivateFile(targetPath, content) {
  await atomicWriteFile(targetPath, content, { mode: 0o600 });
}

function invalidTransaction(id) {
  return {
    id,
    operation: "unknown",
    taskId: "",
    rootPath: "",
    rootIdentity: "",
    patchIndex: null,
    createdAt: "",
    items: [],
    invalid: true
  };
}
