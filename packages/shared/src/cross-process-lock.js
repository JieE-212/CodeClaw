import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { capturePathIdentity, removeOwnedTemporaryFile, syncDirectory } from "./atomic-file.js";

const SCHEMA_VERSION = 1;
const INCOMPLETE_LOCK_GRACE_MS = 10000;

export class CrossProcessLockManager {
  constructor({ storagePath, namespace = "codeclaw", timeoutMs = 5000, lockedCode = "CROSS_PROCESS_LOCKED", lockedMessage = "Another CodeClaw process holds this lock." } = {}) {
    if (!storagePath) throw new Error("Missing cross-process lock storage path.");
    this.storagePath = path.resolve(storagePath);
    this.namespace = String(namespace || "codeclaw");
    this.timeoutMs = timeoutMs;
    this.lockedCode = lockedCode;
    this.lockedMessage = lockedMessage;
    this.instanceId = randomUUID();
  }

  async withLock(key, operation, options = {}) {
    const lock = await this.acquire(key, options);
    let operationError;
    try {
      return await operation();
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await this.release(lock);
      } catch (releaseError) {
        if (!operationError) throw releaseError;
      }
    }
  }

  async acquire(key, { timeoutMs = this.timeoutMs } = {}) {
    const normalizedKey = process.platform === "win32" ? String(key).toLowerCase() : String(key);
    const keyHash = hashKey(`${this.namespace}\0${normalizedKey}`);
    const lockPath = path.join(this.storagePath, `${keyHash}.lock`);
    const deadline = Date.now() + Math.max(0, timeoutMs);
    await fs.mkdir(this.storagePath, { recursive: true, mode: 0o700 });
    const directoryIdentity = await capturePathIdentity(this.storagePath, { requireDirectory: true });

    for (;;) {
      const token = randomUUID();
      let handle;
      let lockIdentity = null;
      try {
        if (!samePathIdentity(await capturePathIdentity(this.storagePath, { requireDirectory: true }), directoryIdentity)) {
          throw lockError("PROJECT_LOCK_STATE_ERROR", "The project lock directory identity changed before acquisition.");
        }
        handle = await fs.open(lockPath, "wx", 0o600);
        lockIdentity = identityFromStat(await handle.stat({ bigint: true }));
        const record = {
          schemaVersion: SCHEMA_VERSION,
          namespace: this.namespace,
          keyHash,
          pid: process.pid,
          instanceId: this.instanceId,
          token,
          acquiredAt: new Date().toISOString()
        };
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
        await syncDirectory(this.storagePath);
        const [currentDirectory, currentLock] = await Promise.all([
          capturePathIdentity(this.storagePath, { requireDirectory: true }),
          capturePathIdentity(lockPath, { requireFile: true })
        ]);
        if (!samePathIdentity(currentDirectory, directoryIdentity) || !samePathIdentity(currentLock, lockIdentity)) {
          throw lockError("PROJECT_LOCK_STATE_ERROR", "The project lock identity changed during acquisition.");
        }
        return { handle, lockPath, record, directoryIdentity, lockIdentity };
      } catch (error) {
        await handle?.close().catch(() => {});
        if (error.code !== "EEXIST") {
          if (handle && lockIdentity) await removeOwnedTemporaryFile(lockPath, { directoryIdentity, temporaryIdentity: lockIdentity });
          throw error;
        }
      }

      if (await this.reclaimIfStale(lockPath, keyHash)) continue;
      if (Date.now() >= deadline) throw lockError(this.lockedCode, this.lockedMessage);
      await delay(Math.min(80, Math.max(10, deadline - Date.now())));
    }
  }

  async release(lock) {
    await lock.handle.close();
    let current;
    try {
      current = JSON.parse(await fs.readFile(lock.lockPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw lockError("PROJECT_LOCK_STATE_ERROR", "The project lock record could not be verified during release.");
    }
    if (current.token !== lock.record.token || current.instanceId !== this.instanceId || current.pid !== process.pid) {
      throw lockError("PROJECT_LOCK_STATE_ERROR", "The project lock owner changed unexpectedly.");
    }
    await removeOwnedTemporaryFile(lock.lockPath, { directoryIdentity: lock.directoryIdentity, temporaryIdentity: lock.lockIdentity });
    await syncDirectory(this.storagePath);
  }

  async reclaimIfStale(lockPath, expectedKeyHash) {
    let raw = "";
    let stat;
    let directoryIdentity;
    let lockIdentity;
    let handle;
    try {
      handle = await fs.open(lockPath, "r");
      [raw, stat, directoryIdentity] = await Promise.all([
        handle.readFile("utf8"),
        handle.stat({ bigint: true }),
        capturePathIdentity(path.dirname(lockPath), { requireDirectory: true })
      ]);
      lockIdentity = identityFromStat(stat);
    } catch (error) {
      if (error.code === "ENOENT") return true;
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }

    let record = null;
    try {
      record = JSON.parse(raw);
    } catch {}
    const valid = record?.schemaVersion === SCHEMA_VERSION
      && record.keyHash === expectedKeyHash
      && Number.isInteger(record.pid)
      && record.pid > 0
      && typeof record.token === "string"
      && typeof record.instanceId === "string";
    if (valid && processIsAlive(record.pid)) return false;
    if (!valid && Date.now() - Number(stat.mtimeMs) < INCOMPLETE_LOCK_GRACE_MS) return false;

    try {
      await removeOwnedTemporaryFile(lockPath, { directoryIdentity, temporaryIdentity: lockIdentity });
    } catch (error) {
      if (["ATOMIC_TEMP_CLEANUP_UNSAFE", "EACCES", "EBUSY", "ENOENT", "EPERM"].includes(error.code)) return false;
      throw error;
    }
    return true;
  }
}

function identityFromStat(stat) {
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, birthtimeNs: stat.birthtimeNs };
}

function samePathIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

export function canonicalLockKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function canonicalPathLockKey(value) {
  const absolutePath = path.resolve(value);
  let current = absolutePath;
  const suffix = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      const resolved = path.join(real, ...suffix.reverse());
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return canonicalLockKey(absolutePath);
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function hashKey(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function lockError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}
