import fs from "node:fs/promises";
import path from "node:path";
import { throwIfAborted } from "./operation-manager.js";

export async function openStableDirectory(rootPath, directoryPath, operation = "traverse the workspace", signal = null) {
  throwIfAborted(signal);
  const root = path.resolve(rootPath);
  const target = path.resolve(directoryPath);
  const before = await captureDirectoryIdentity(root, target, operation, signal);
  let directory;
  try {
    directory = await fs.opendir(target);
    throwIfAborted(signal);
    const afterOpen = await captureDirectoryIdentity(root, target, operation, signal);
    if (!sameDirectoryIdentity(before, afterOpen)) throw traversalPathChanged(operation);
    return {
      directory,
      verify: async () => {
        throwIfAborted(signal);
        const afterRead = await captureDirectoryIdentity(root, target, operation, signal);
        if (!sameDirectoryIdentity(before, afterRead)) throw traversalPathChanged(operation);
      }
    };
  } catch (error) {
    await directory?.close().catch(() => {});
    throw error;
  }
}

async function captureDirectoryIdentity(rootPath, directoryPath, operation, signal) {
  throwIfAborted(signal);
  const relative = path.relative(rootPath, directoryPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw traversalPathChanged(operation);
  }
  let current = rootPath;
  const identities = [];
  for (const segment of ["", ...relative.split(path.sep).filter(Boolean)]) {
    throwIfAborted(signal);
    if (segment) current = path.join(current, segment);
    const stat = await fs.lstat(current, { bigint: true });
    throwIfAborted(signal);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw traversalPathChanged(operation);
    identities.push({ path: current, dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs });
  }
  return identities;
}

function sameDirectoryIdentity(left, right) {
  return left.length === right.length && left.every((identity, index) => {
    const current = right[index];
    return identity.path === current.path
      && identity.dev === current.dev
      && identity.ino === current.ino
      && identity.birthtimeNs === current.birthtimeNs;
  });
}

function traversalPathChanged(operation) {
  const error = new Error(`CodeClaw stopped because a directory changed while attempting to ${operation}.`);
  error.code = "TRAVERSAL_PATH_CHANGED";
  error.status = 409;
  return error;
}
