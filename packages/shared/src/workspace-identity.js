import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function captureWorkspaceIdentity(rootPath) {
  const realRoot = await fs.realpath(path.resolve(rootPath));
  const stat = await fs.lstat(realRoot, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    const error = new Error("Workspace root must resolve to a normal directory.");
    error.code = "PATCH_WORKSPACE_ROOT_UNSAFE";
    error.status = 409;
    throw error;
  }
  const canonicalRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  const digest = createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    canonicalRoot,
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString()
  }), "utf8").digest("hex");
  return { rootPath: realRoot, digest };
}

export async function workspaceIdentityMatches(rootPath, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || "")) return false;
  try {
    return (await captureWorkspaceIdentity(rootPath)).digest === expectedDigest;
  } catch {
    return false;
  }
}

export async function captureWorkspaceParentIdentity(rootPath, filePath) {
  const workspace = await captureWorkspaceIdentity(rootPath);
  const normalized = normalizeRelativeFilePath(filePath);
  const parentSegments = normalized.split("/").slice(0, -1);
  const directories = [];
  let current = workspace.rootPath;
  for (const [index, segment] of parentSegments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        const missing = parentSegments.slice(0, index + 1).join("/");
        const parentError = new Error(`Patch parent directory does not exist: ${missing}.`);
        parentError.code = "PATCH_PARENT_MISSING";
        parentError.status = 409;
        throw parentError;
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      const parentError = new Error("Patch parent path must contain only normal directories.");
      parentError.code = "PATCH_PARENT_UNSAFE";
      parentError.status = 409;
      throw parentError;
    }
    directories.push({
      path: parentSegments.slice(0, index + 1).join("/"),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      birthtimeNs: stat.birthtimeNs.toString()
    });
  }
  const digest = createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    workspaceIdentity: workspace.digest,
    parent: parentSegments.join("/"),
    directories
  }), "utf8").digest("hex");
  return { rootPath: workspace.rootPath, path: normalized, digest };
}

export async function workspaceParentIdentityMatches(rootPath, filePath, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || "")) return false;
  try {
    return (await captureWorkspaceParentIdentity(rootPath, filePath)).digest === expectedDigest;
  } catch {
    return false;
  }
}

function normalizeRelativeFilePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) throw new Error("Workspace file path must be relative.");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) throw new Error("Workspace file path is unsafe.");
  return segments.join("/");
}
