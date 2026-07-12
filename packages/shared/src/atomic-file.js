import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const WINDOWS_RETRY_DELAYS_MS = [15, 40, 90, 160];

export async function atomicWriteFile(targetPath, content, {
  encoding = "utf8",
  mode = 0o600,
  beforeReplace = null,
  onTemporaryReady = null,
  temporaryPath = ""
} = {}) {
  const absolutePath = path.resolve(targetPath);
  const directory = path.dirname(absolutePath);
  const selectedTemporaryPath = temporaryPath
    ? path.resolve(temporaryPath)
    : path.join(directory, `.${path.basename(absolutePath)}.codeclaw-${process.pid}-${randomUUID()}.tmp`);
  if (path.dirname(selectedTemporaryPath) !== directory || selectedTemporaryPath === absolutePath) throw new Error("Atomic temporary file must be beside its target.");
  await fs.mkdir(directory, { recursive: true });
  const directoryIdentity = await fileIdentity(directory, { requireDirectory: true });

  let temporaryExists = false;
  let temporaryIdentity = null;
  try {
    const handle = await fs.open(selectedTemporaryPath, "wx", mode);
    temporaryExists = true;
    try {
      temporaryIdentity = identityFromStat(await handle.stat({ bigint: true }));
      await handle.writeFile(content, encoding);
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (onTemporaryReady) await onTemporaryReady(serializableIdentity(temporaryIdentity));

    await retryWindowsFileOperation(async () => {
      if (beforeReplace) await beforeReplace();
      const currentDirectoryIdentity = await fileIdentity(directory, { requireDirectory: true });
      const currentTemporaryIdentity = await fileIdentity(selectedTemporaryPath, { requireFile: true });
      if (!sameIdentity(currentDirectoryIdentity, directoryIdentity)
        || !sameIdentity(currentTemporaryIdentity, temporaryIdentity)
        || currentTemporaryIdentity.nlink !== 1n) throw atomicCleanupError();
      await fs.rename(selectedTemporaryPath, absolutePath);
    });
    temporaryExists = false;
    await syncDirectory(directory);
  } finally {
    if (temporaryExists) await removeOwnedTemporaryFile(selectedTemporaryPath, { directoryIdentity, temporaryIdentity });
  }
}

export function patchWriteTemporaryPath(targetPath, transactionId) {
  if (typeof transactionId !== "string" || !/^(apply|revert)-[a-z0-9-]{8,160}$/i.test(transactionId)) throw new Error("Invalid patch transaction id.");
  const absolutePath = path.resolve(targetPath);
  const suffix = createHash("sha256").update(transactionId, "utf8").digest("hex").slice(0, 20);
  return path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.codeclaw-${suffix}.tmp`);
}

export async function atomicRemoveFile(targetPath, { beforeRemove = null } = {}) {
  const absolutePath = path.resolve(targetPath);
  const directoryIdentity = await fileIdentity(path.dirname(absolutePath), { requireDirectory: true });
  const targetIdentity = await fileIdentity(absolutePath, { requireFile: true });
  if (beforeRemove) await beforeRemove();
  try {
    await removeOwnedTemporaryFile(absolutePath, { directoryIdentity, temporaryIdentity: targetIdentity });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
  await syncDirectory(path.dirname(absolutePath));
  return true;
}

export async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await fs.open(directoryPath, "r");
    await handle.sync();
  } catch (error) {
    if (!isUnsupportedDirectorySync(error)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function removeOwnedTemporaryFile(temporaryPath, { directoryIdentity, temporaryIdentity }) {
  if (!directoryIdentity || !temporaryIdentity) throw atomicCleanupError();
  await retryWindowsFileOperation(async () => {
    let currentDirectory;
    let currentFile;
    try {
      currentDirectory = await fileIdentity(path.dirname(temporaryPath), { requireDirectory: true });
      currentFile = await fileIdentity(temporaryPath, { requireFile: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (!sameIdentity(currentDirectory, directoryIdentity)
      || !sameIdentity(currentFile, temporaryIdentity)
      || currentFile.nlink !== 1n) {
      throw atomicCleanupError();
    }
    await fs.unlink(temporaryPath);
  });
}

export async function capturePathIdentity(targetPath, options = {}) {
  return fileIdentity(targetPath, options);
}

async function retryWindowsFileOperation(operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (process.platform !== "win32" || !["EACCES", "EBUSY", "EPERM"].includes(error.code) || attempt >= WINDOWS_RETRY_DELAYS_MS.length) throw error;
      await delay(WINDOWS_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function isUnsupportedDirectorySync(error) {
  return process.platform === "win32" && ["EACCES", "EBADF", "EINVAL", "EISDIR", "EPERM"].includes(error.code);
}

async function fileIdentity(targetPath, { requireDirectory = false, requireFile = false } = {}) {
  const stat = await fs.lstat(targetPath, { bigint: true });
  if (stat.isSymbolicLink() || requireDirectory && !stat.isDirectory() || requireFile && !stat.isFile()) throw atomicCleanupError();
  return identityFromStat(stat);
}

function identityFromStat(stat) {
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, birthtimeNs: stat.birthtimeNs };
}

function serializableIdentity(identity) {
  return {
    dev: String(identity.dev),
    ino: String(identity.ino),
    birthtimeNs: String(identity.birthtimeNs),
    nlink: Number(identity.nlink)
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function atomicCleanupError() {
  const error = new Error("Atomic temporary file ownership changed; cleanup was stopped to avoid deleting an unrelated file.");
  error.code = "ATOMIC_TEMP_CLEANUP_UNSAFE";
  error.status = 409;
  return error;
}
