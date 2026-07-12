import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SKIPPED_DIRECTORIES } from "../../shared/src/constants.js";
import { createIgnoreDecisionMatcher } from "../../shared/src/ignore-utils.js";
import { isSensitiveDirectory, isSensitiveFile, relativePath } from "../../shared/src/path-utils.js";
import { captureWorkspaceIdentity } from "../../shared/src/workspace-identity.js";

export const DATA_BOUNDARY_POLICY_VERSION = "codeclaw-data-boundary-v2";
export const DISPOSABLE_COPY_MARKER = ".codeclaw-disposable-copy.json";

const DEFAULT_MAX_FILES = 100_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_READ_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_READ_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const VCS_DIRECTORIES = new Set([".git", ".hg", ".svn"]);
const NORMALIZED_SKIPPED_DIRECTORIES = new Set([...SKIPPED_DIRECTORIES].map((item) => item.toLocaleLowerCase("en-US")));

export async function buildDataBoundaryManifest(rootPath, options = {}) {
  const requestedRoot = path.resolve(rootPath || ".");
  const requestedStat = await fs.lstat(requestedRoot, { bigint: true }).catch((error) => {
    if (error.code === "ENOENT") throw boundaryError("DATA_BOUNDARY_ROOT_MISSING", "The data-boundary source does not exist.");
    throw error;
  });
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw boundaryError("DATA_BOUNDARY_ROOT_UNSAFE", "The data-boundary source must be a normal directory, not a file, symbolic link, or junction.");
  }
  const workspace = await captureWorkspaceIdentity(rootPath);
  const root = workspace.rootPath;
  const suppliedIgnoreMatcher = options.ignoreMatcher || null;
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_FILES);
  const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES);
  const allowMarker = Boolean(options.allowDisposableMarker);
  const files = [];
  const directories = [];
  const excluded = [];
  const blockers = [];
  const portablePaths = new Map();
  let totalBytes = 0;

  await walk(root, []);
  const finalWorkspace = await captureWorkspaceIdentity(root);
  if (finalWorkspace.digest !== workspace.digest) {
    throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", "The source workspace changed while CodeClaw was building its data-boundary manifest.");
  }

  files.sort(comparePath);
  directories.sort(comparePath);
  excluded.sort(comparePath);
  blockers.sort(comparePath);
  const payload = {
    schemaVersion: 1,
    policyVersion: DATA_BOUNDARY_POLICY_VERSION,
    directories: directories.map(payloadDirectory),
    files: files.map(payloadFile)
  };
  const payloadDigest = digestJson(payload);
  const entryIdentityDigest = digestJson({
    schemaVersion: 1,
    policyVersion: DATA_BOUNDARY_POLICY_VERSION,
    directories,
    files
  });
  const manifestDigest = digestJson({
    schemaVersion: 1,
    policyVersion: DATA_BOUNDARY_POLICY_VERSION,
    rootIdentity: workspace.digest,
    directories,
    files,
    excluded,
    blockers
  });

  return {
    schemaVersion: 1,
    policyVersion: DATA_BOUNDARY_POLICY_VERSION,
    directories,
    files,
    rootPath: root,
    rootIdentity: workspace.digest,
    fileCount: files.length,
    directoryCount: directories.length,
    totalBytes,
    excluded,
    blockers,
    eligible: blockers.length === 0,
    payloadDigest,
    entryIdentityDigest,
    manifestDigest,
    createdAt: new Date().toISOString()
  };

  async function walk(currentPath, parentIgnoreRules) {
    const before = await safeLstat(currentPath);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      blockers.push({ path: relativePath(root, currentPath) || ".", reason: "unsafe-directory" });
      return;
    }
    const currentRel = relativePath(root, currentPath);
    const ignoreRules = suppliedIgnoreMatcher
      ? [{ basePath: "", decide: (entryPath, isDirectory) => suppliedIgnoreMatcher(entryPath, isDirectory) ? true : null }]
      : [...parentIgnoreRules, ...await loadDirectoryIgnoreRule(currentPath, currentRel)];
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const rel = relativePath(root, absolutePath);
      const portableIssue = registerPortablePath(rel, portablePaths);
      if (portableIssue) {
        blockers.push({ path: rel, reason: portableIssue.reason, conflictsWith: portableIssue.conflictsWith || null });
        continue;
      }

      const stat = await safeLstat(absolutePath);
      if (stat.isSymbolicLink()) {
        blockers.push({ path: rel, reason: "symbolic-link" });
        continue;
      }
      if (entry.name === DISPOSABLE_COPY_MARKER) {
        if (allowMarker && stat.isFile()) excluded.push({ path: rel, reason: "codeclaw-marker" });
        else blockers.push({ path: rel, reason: "reserved-codeclaw-marker" });
        continue;
      }
      if (stat.isDirectory()) {
        if (isSensitiveDirectory(entry.name)) {
          blockers.push({ path: rel, reason: "sensitive-directory" });
          continue;
        }
        const exclusion = directoryExclusion(entry.name, rel, ignoreRules);
        if (exclusion) {
          excluded.push({ path: rel, reason: exclusion });
          continue;
        }
        directories.push({ path: rel, mode: Number(stat.mode & 0o777n), sourceIdentity: statIdentity(stat) });
        await walk(absolutePath, ignoreRules);
        continue;
      }
      if (!stat.isFile()) {
        blockers.push({ path: rel, reason: "unsupported-filesystem-entry" });
        continue;
      }
      if (stat.nlink !== 1n) {
        blockers.push({ path: rel, reason: "hard-link" });
        continue;
      }
      if (isSensitiveFile(entry.name)) {
        blockers.push({ path: rel, reason: "sensitive-file" });
        continue;
      }
      if (isIgnoredByRules(rel, false, ignoreRules)) {
        excluded.push({ path: rel, reason: "gitignore" });
        continue;
      }
      if (files.length >= maxFiles) {
        throw boundaryError("DATA_BOUNDARY_FILE_LIMIT", `The source contains more than ${maxFiles} copyable files; CodeClaw stopped instead of producing a partial manifest.`);
      }

      const fingerprint = await hashStableFile(absolutePath, stat);
      totalBytes += fingerprint.size;
      if (totalBytes > maxBytes) {
        throw boundaryError("DATA_BOUNDARY_BYTE_LIMIT", `The source contains more than ${maxBytes} copyable bytes; CodeClaw stopped instead of producing a partial manifest.`);
      }
      files.push({
        path: rel,
        size: fingerprint.size,
        sha256: fingerprint.sha256,
        mode: Number(stat.mode & 0o777n),
        sourceIdentity: statIdentity(stat)
      });
    }

    const after = await safeLstat(currentPath);
    if (!sameStableStat(before, after) || !after.isDirectory() || after.isSymbolicLink()) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source directory changed while CodeClaw was reading it: ${relativePath(root, currentPath) || "."}.`);
    }
  }
}

export async function readManifestFiles(rootPath, manifest, relativePaths, options = {}) {
  const maxFileBytes = readByteLimit(options.maxFileBytes, DEFAULT_READ_MAX_FILE_BYTES, "maxFileBytes");
  const maxTotalBytes = readByteLimit(options.maxTotalBytes, DEFAULT_READ_MAX_TOTAL_BYTES, "maxTotalBytes");
  if (!Array.isArray(relativePaths)) {
    throw boundaryError("DATA_BOUNDARY_READ_PATHS_INVALID", "Data-boundary file reads require an explicit array of manifest paths.", 400);
  }

  const workspace = await captureWorkspaceIdentity(rootPath);
  const operationRootStat = await safeLstat(workspace.rootPath);
  const { filesByPath, directoryIdentities, deniedPaths } = validateReadableManifest(workspace, manifest);
  const selected = [];
  const seen = new Set();
  let totalBytes = 0;

  for (const relative of relativePaths) {
    if (!isCanonicalReadPath(workspace.rootPath, relative)) {
      throw boundaryError("DATA_BOUNDARY_READ_PATH_REFUSED", "A requested file path is not a safe data-boundary manifest path.");
    }
    if (seen.has(relative)) {
      throw boundaryError("DATA_BOUNDARY_READ_PATH_DUPLICATE", `A data-boundary file was requested more than once: ${relative}.`);
    }
    seen.add(relative);

    const manifestFile = filesByPath.get(relative);
    if (!manifestFile
      || pathIsCoveredByBoundaryRecord(relative, deniedPaths)
      || isProtectedManifestReadPath(relative)) {
      throw boundaryError("DATA_BOUNDARY_READ_PATH_REFUSED", `The requested path is not an approved data-boundary file: ${relative}.`);
    }
    if (manifestFile.size > maxFileBytes) {
      throw boundaryError("DATA_BOUNDARY_READ_FILE_LIMIT", `The requested file exceeds the ${maxFileBytes}-byte data-boundary read limit: ${relative}.`, 413);
    }
    if (totalBytes > maxTotalBytes - manifestFile.size) {
      throw boundaryError("DATA_BOUNDARY_READ_TOTAL_LIMIT", `The requested files exceed the ${maxTotalBytes}-byte total data-boundary read limit.`, 413);
    }
    totalBytes += manifestFile.size;
    selected.push(manifestFile);
  }

  const results = [];
  for (const manifestFile of selected) {
    const before = await assertWorkspaceAndParents(
      workspace.rootPath,
      manifest.rootIdentity,
      manifestFile.path,
      manifestFile.sourceIdentity,
      false,
      directoryIdentities,
      { requireRecordedParents: true, requireStableParentIdentity: true }
    );
    const read = await readStableManifestTextFile(
      resolveManifestPath(workspace.rootPath, manifestFile.path),
      before.target,
      manifestFile,
      maxFileBytes
    );
    const after = await assertWorkspaceAndParents(
      workspace.rootPath,
      manifest.rootIdentity,
      manifestFile.path,
      manifestFile.sourceIdentity,
      false,
      directoryIdentities,
      { requireRecordedParents: true, requireStableParentIdentity: true }
    );
    assertReadPathSnapshotStable(before, after, manifestFile.path);
    results.push({
      path: manifestFile.path,
      content: read.content,
      byteLength: read.byteLength,
      sha256: read.sha256
    });
  }

  const finalWorkspace = await captureWorkspaceIdentity(workspace.rootPath);
  const finalRootStat = await safeLstat(workspace.rootPath);
  if (finalWorkspace.digest !== manifest.rootIdentity
    || !sameStableStat(operationRootStat, finalRootStat)
    || !finalRootStat.isDirectory()
    || finalRootStat.isSymbolicLink()) {
    throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", "The data-boundary workspace changed while files were being read.");
  }
  return results;
}

export async function copyManifestPayload(sourceRoot, targetRoot, manifest) {
  if (!manifest?.eligible || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) {
    throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "A complete eligible data-boundary manifest is required before copying.");
  }
  const sourceWorkspace = await captureWorkspaceIdentity(sourceRoot);
  const targetWorkspace = await captureWorkspaceIdentity(targetRoot);
  const source = sourceWorkspace.rootPath;
  const target = targetWorkspace.rootPath;
  if ((await fs.readdir(target)).length) {
    throw boundaryError("DATA_BOUNDARY_TARGET_NOT_EMPTY", "The disposable-copy target must be empty before copying begins.");
  }
  const sourceDirectoryIdentities = new Map(manifest.directories.map((item) => [item.path, item.sourceIdentity]));
  const targetDirectoryIdentities = new Map();

  for (const directory of manifest.directories) {
    await assertWorkspaceAndParents(source, sourceWorkspace.digest, directory.path, directory.sourceIdentity, true, sourceDirectoryIdentities);
    await assertWorkspaceAndParents(target, targetWorkspace.digest, directory.path, null, false, targetDirectoryIdentities);
    const targetPath = resolveManifestPath(target, directory.path);
    await fs.mkdir(targetPath, { recursive: false, mode: directory.mode || 0o700 });
    const targetDirectoryStat = await fs.lstat(targetPath, { bigint: true });
    if (!targetDirectoryStat.isDirectory() || targetDirectoryStat.isSymbolicLink()) {
      throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", `A target directory became unsafe while copying: ${directory.path}.`);
    }
    targetDirectoryIdentities.set(directory.path, statIdentity(targetDirectoryStat));
    await assertWorkspaceAndParents(target, targetWorkspace.digest, `${directory.path}/.codeclaw-parent-check`, null, false, targetDirectoryIdentities);
  }

  for (const file of manifest.files) {
    await assertWorkspaceAndParents(source, sourceWorkspace.digest, file.path, file.sourceIdentity, false, sourceDirectoryIdentities);
    await assertWorkspaceAndParents(target, targetWorkspace.digest, file.path, null, false, targetDirectoryIdentities);
    const sourcePath = resolveManifestPath(source, file.path);
    const targetPath = resolveManifestPath(target, file.path);
    const sourceStat = await safeLstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1n || !matchesRecordedIdentity(sourceStat, file.sourceIdentity)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file became unsafe before it could be copied: ${file.path}.`);
    }
    await copyStableFile(sourcePath, targetPath, sourceStat, file);
    await assertWorkspaceAndParents(source, sourceWorkspace.digest, file.path, file.sourceIdentity, false, sourceDirectoryIdentities);
    await assertWorkspaceAndParents(target, targetWorkspace.digest, file.path, null, false, targetDirectoryIdentities);
    const targetStat = await safeLstat(targetPath);
    const targetFingerprint = await hashStableFile(targetPath, targetStat);
    if (targetFingerprint.sha256 !== file.sha256 || targetFingerprint.size !== file.size) {
      throw boundaryError("DATA_BOUNDARY_COPY_VERIFY_FAILED", `The copied file did not match its manifest: ${file.path}.`, 500);
    }
  }
  if ((await captureWorkspaceIdentity(source)).digest !== sourceWorkspace.digest
    || (await captureWorkspaceIdentity(target)).digest !== targetWorkspace.digest) {
    throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", "A source or target workspace changed identity during copying.");
  }
  const targetManifest = await buildDataBoundaryManifest(target);
  if (!isExactCopyTargetManifest(manifest, targetManifest)) {
    throw boundaryError("DATA_BOUNDARY_COPY_VERIFY_FAILED", "The disposable-copy target contains content outside the reviewed source payload.", 500);
  }
}

export function manifestsHaveSameSource(left, right) {
  return Boolean(left?.manifestDigest
    && right?.manifestDigest
    && left.manifestDigest === right.manifestDigest
    && left.rootIdentity === right.rootIdentity
    && left.policyVersion === right.policyVersion);
}

export function manifestsHaveSamePayload(left, right) {
  return Boolean(left?.payloadDigest
    && right?.payloadDigest
    && left.payloadDigest === right.payloadDigest
    && left.policyVersion === right.policyVersion);
}

export function isExactCopyTargetManifest(source, target, { requireDisposableMarker = false } = {}) {
  if (!target?.eligible || !manifestsHaveSamePayload(source, target)) return false;
  if (!requireDisposableMarker) return Array.isArray(target.excluded) && target.excluded.length === 0;
  return Array.isArray(target.excluded)
    && target.excluded.length === 1
    && target.excluded[0]?.path === DISPOSABLE_COPY_MARKER
    && target.excluded[0]?.reason === "codeclaw-marker";
}

function validateReadableManifest(workspace, manifest) {
  if (manifest?.schemaVersion !== 1
    || manifest.policyVersion !== DATA_BOUNDARY_POLICY_VERSION
    || typeof manifest.rootPath !== "string"
    || canonicalFilesystemPath(manifest.rootPath) !== canonicalFilesystemPath(workspace.rootPath)
    || typeof manifest.rootIdentity !== "string"
    || manifest.rootIdentity !== workspace.digest
    || !Array.isArray(manifest.files)
    || !Array.isArray(manifest.directories)
    || !Array.isArray(manifest.excluded)
    || !Array.isArray(manifest.blockers)) {
    throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "A complete current data-boundary manifest is required before reading files.");
  }

  const portablePaths = new Map();
  const directoryIdentities = new Map();
  for (const directory of manifest.directories) {
    if (!validManifestEntryPath(workspace.rootPath, directory?.path, portablePaths)
      || !validRecordedIdentity(directory.sourceIdentity)
      || directoryIdentities.has(directory.path)) {
      throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "The data-boundary manifest contains an invalid or duplicate directory entry.");
    }
    directoryIdentities.set(directory.path, directory.sourceIdentity);
  }

  const filesByPath = new Map();
  for (const file of manifest.files) {
    if (!validManifestEntryPath(workspace.rootPath, file?.path, portablePaths)
      || !Number.isSafeInteger(file.size)
      || file.size < 0
      || !/^[a-f0-9]{64}$/.test(file.sha256 || "")
      || !validRecordedIdentity(file.sourceIdentity)
      || filesByPath.has(file.path)
      || isProtectedManifestReadPath(file.path)) {
      throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "The data-boundary manifest contains an invalid, duplicate, or protected file entry.");
    }
    const parentSegments = file.path.split("/").slice(0, -1);
    for (let index = 0; index < parentSegments.length; index += 1) {
      const parentPath = parentSegments.slice(0, index + 1).join("/");
      if (!directoryIdentities.has(parentPath)) {
        throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", `The data-boundary manifest is missing a parent directory identity for ${file.path}.`);
      }
    }
    filesByPath.set(file.path, file);
  }

  const deniedPaths = [];
  for (const record of [...manifest.excluded, ...manifest.blockers]) {
    if (!record || typeof record.path !== "string" || !isCanonicalReadPath(workspace.rootPath, record.path)) {
      throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "The data-boundary manifest contains an invalid exclusion or blocker path.");
    }
    deniedPaths.push(record.path);
  }
  return { filesByPath, directoryIdentities, deniedPaths };
}

async function readStableManifestTextFile(filePath, expectedStat, manifestFile, maxFileBytes) {
  const handle = await fs.open(filePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1n
      || !sameStableStat(before, expectedStat)
      || !matchesRecordedIdentity(before, manifestFile.sourceIdentity)
      || before.size > BigInt(maxFileBytes)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A manifest file changed before it could be read: ${manifestFile.path}.`);
    }

    const buffer = manifestFile.size ? Buffer.allocUnsafe(manifestFile.size) : Buffer.alloc(0);
    const hash = createHash("sha256");
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const { bytesRead: overflowBytes } = await handle.read(overflowProbe, 0, 1, null);
    const after = await handle.stat({ bigint: true });
    const pathAfter = await safeLstat(filePath);
    const sha256 = hash.digest("hex");
    if (offset !== buffer.length
      || overflowBytes !== 0
      || !after.isFile()
      || after.isSymbolicLink()
      || after.nlink !== 1n
      || !pathAfter.isFile()
      || pathAfter.isSymbolicLink()
      || pathAfter.nlink !== 1n
      || !sameStableStat(before, after)
      || !sameStableStat(after, pathAfter)
      || !matchesRecordedIdentity(after, manifestFile.sourceIdentity)
      || buffer.length !== manifestFile.size
      || sha256 !== manifestFile.sha256) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A manifest file changed while it was being read: ${manifestFile.path}.`);
    }

    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    } catch {
      throw boundaryError("DATA_BOUNDARY_TEXT_UNREADABLE", `The manifest file is not valid UTF-8 and cannot be disclosed as model text: ${manifestFile.path}.`);
    }
    return { content, byteLength: buffer.length, sha256 };
  } finally {
    await handle.close();
  }
}

function assertReadPathSnapshotStable(before, after, relative) {
  const sameParents = before.parents.length === after.parents.length
    && before.parents.every((item, index) => item.path === after.parents[index].path
      && sameStableStat(item.stat, after.parents[index].stat));
  if (!sameStableStat(before.root, after.root)
    || !sameParents
    || !before.target
    || !after.target
    || !sameStableStat(before.target, after.target)) {
    throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A workspace path changed while a manifest file was being read: ${relative}.`);
  }
}

function validManifestEntryPath(rootPath, relative, seenPortablePaths) {
  if (!isCanonicalReadPath(rootPath, relative)) return false;
  return !registerPortablePath(relative, seenPortablePaths);
}

function isCanonicalReadPath(rootPath, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || path.isAbsolute(relative)) return false;
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"))) return false;
  try {
    const absolute = resolveManifestPath(rootPath, relative);
    return relativePath(rootPath, absolute) === relative;
  } catch {
    return false;
  }
}

function isProtectedManifestReadPath(relative) {
  const segments = String(relative || "").split("/");
  const basename = segments.at(-1) || "";
  if (basename === DISPOSABLE_COPY_MARKER || isSensitiveFile(basename)) return true;
  return segments.slice(0, -1).some((segment) => isSensitiveDirectory(segment)
    || VCS_DIRECTORIES.has(segment.toLocaleLowerCase("en-US"))
    || NORMALIZED_SKIPPED_DIRECTORIES.has(segment.toLocaleLowerCase("en-US")));
}

function pathIsCoveredByBoundaryRecord(relative, records) {
  return records.some((recordPath) => relative === recordPath || relative.startsWith(`${recordPath}/`));
}

function validRecordedIdentity(identity) {
  return identity
    && ["dev", "ino", "birthtimeNs", "mtimeNs", "ctimeNs", "size"]
      .every((field) => typeof identity[field] === "string" && /^\d+$/.test(identity[field]));
}

function readByteLimit(value, fallback, name) {
  if (value === undefined) return fallback;
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw boundaryError("DATA_BOUNDARY_READ_LIMIT_INVALID", `${name} must be a non-negative safe integer.`, 400);
}

function canonicalFilesystemPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

async function hashStableFile(filePath, expectedStat) {
  const handle = await fs.open(filePath, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || !sameStableStat(before, expectedStat)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed while CodeClaw was opening it: ${filePath}.`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameStableStat(before, after) || BigInt(total) !== after.size) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed while CodeClaw was hashing it: ${filePath}.`);
    }
    return { size: total, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function copyStableFile(sourcePath, targetPath, expectedStat, manifestFile) {
  const sourceHandle = await fs.open(sourcePath, "r");
  let targetHandle;
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || !sameStableStat(before, expectedStat)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed before copying: ${manifestFile.path}.`);
    }
    targetHandle = await fs.open(targetPath, "wx", manifestFile.mode || 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await targetHandle.write(buffer, written, bytesRead - written, null);
        written += result.bytesWritten;
      }
      total += bytesRead;
    }
    await targetHandle.sync();
    const after = await sourceHandle.stat({ bigint: true });
    const sha256 = hash.digest("hex");
    if (!sameStableStat(before, after)
      || total !== manifestFile.size
      || sha256 !== manifestFile.sha256) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed while being copied: ${manifestFile.path}.`);
    }
  } finally {
    await Promise.all([sourceHandle.close(), targetHandle?.close()]);
  }
}

function directoryExclusion(name, rel, ignoreRules) {
  const normalizedName = name.toLocaleLowerCase("en-US");
  if (VCS_DIRECTORIES.has(normalizedName)) return "vcs-metadata";
  if (NORMALIZED_SKIPPED_DIRECTORIES.has(normalizedName)) return "generated-directory";
  if (isIgnoredByRules(rel, true, ignoreRules)) return "gitignore";
  return "";
}

function registerPortablePath(rel, seen) {
  const segments = rel.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.includes(":") || segment.includes("\\")) return { reason: "non-portable-path" };
    if (/[. ]$/.test(segment) || /[\u0000-\u001f]/.test(segment)) return { reason: "non-portable-path" };
    const stem = segment.split(".")[0];
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return { reason: "reserved-windows-path" };
  }
  const key = segments.map((segment) => segment.normalize("NFC").toLocaleLowerCase("en-US")).join("/");
  const previous = seen.get(key);
  if (previous && previous !== rel) return { reason: "portable-path-collision", conflictsWith: previous };
  seen.set(key, rel);
  return null;
}

function resolveManifestPath(rootPath, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || path.isAbsolute(relative)) {
    throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "The manifest contains an unsafe path.");
  }
  const absolute = path.resolve(rootPath, ...relative.split("/"));
  const rel = path.relative(rootPath, absolute);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", "The manifest path escapes its workspace.");
  }
  return absolute;
}

async function safeLstat(targetPath) {
  try {
    return await fs.lstat(targetPath, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A data-boundary path disappeared during inspection: ${targetPath}.`);
    throw error;
  }
}

function sameEntity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function sameStableStat(left, right) {
  return sameEntity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    size: String(stat.size)
  };
}

function matchesRecordedIdentity(stat, identity) {
  return identity
    && String(stat.dev) === identity.dev
    && String(stat.ino) === identity.ino
    && String(stat.birthtimeNs) === identity.birthtimeNs
    && String(stat.mtimeNs) === identity.mtimeNs
    && String(stat.ctimeNs) === identity.ctimeNs
    && String(stat.size) === identity.size;
}

function matchesRecordedEntity(stat, identity) {
  return identity
    && String(stat.dev) === identity.dev
    && String(stat.ino) === identity.ino
    && String(stat.birthtimeNs) === identity.birthtimeNs;
}

function payloadDirectory(directory) {
  return { path: directory.path, mode: directory.mode };
}

function payloadFile(file) {
  return { path: file.path, size: file.size, sha256: file.sha256, mode: file.mode };
}

async function loadDirectoryIgnoreRule(directoryPath, basePath) {
  const ignorePath = path.join(directoryPath, ".gitignore");
  let handle;
  let found = false;
  try {
    const before = await fs.lstat(ignorePath, { bigint: true });
    found = true;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
      throw boundaryError("DATA_BOUNDARY_IGNORE_UNSAFE", `${basePath ? `${basePath}/` : ""}.gitignore is not a normal owned file.`);
    }
    handle = await fs.open(ignorePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameStableStat(before, opened) || !opened.isFile() || opened.nlink !== 1n) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `${basePath ? `${basePath}/` : ""}.gitignore changed before CodeClaw could read it.`);
    }
    const rawContent = await handle.readFile();
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(rawContent);
    } catch {
      throw boundaryError("DATA_BOUNDARY_IGNORE_UNREADABLE", `${basePath ? `${basePath}/` : ""}.gitignore is not valid UTF-8, so CodeClaw refused to guess the copy boundary.`);
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(ignorePath, { bigint: true });
    if (!sameStableStat(opened, after) || !sameEntity(opened, pathAfter)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `${basePath ? `${basePath}/` : ""}.gitignore changed during inspection.`);
    }
    return [{ basePath, decide: createIgnoreDecisionMatcher(content) }];
  } catch (error) {
    if (error.code === "ENOENT" && !found) return [];
    if (error.code?.startsWith("DATA_BOUNDARY_")) throw error;
    throw boundaryError("DATA_BOUNDARY_IGNORE_UNREADABLE", `CodeClaw could not read ${basePath ? `${basePath}/` : ""}.gitignore, so it refused to guess the copy boundary.`);
  } finally {
    await handle?.close();
  }
}

function isIgnoredByRules(rel, isDirectory, rules) {
  let decision = null;
  for (const rule of rules) {
    const scoped = rule.basePath ? path.posix.relative(rule.basePath, rel) : rel;
    if (!scoped || scoped.startsWith("../") || scoped === "..") continue;
    const next = rule.decide(scoped, isDirectory);
    if (next !== null && next !== undefined) decision = next;
  }
  return decision === true;
}

async function assertWorkspaceAndParents(
  rootPath,
  expectedRootIdentity,
  relative,
  expectedTargetIdentity,
  targetIsDirectory,
  expectedParents = new Map(),
  { requireRecordedParents = false, requireStableParentIdentity = false } = {}
) {
  const workspace = await captureWorkspaceIdentity(rootPath);
  if (workspace.digest !== expectedRootIdentity) throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", "A copy workspace root changed identity during the operation.");
  const rootStat = await safeLstat(workspace.rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", "A copy workspace root became a link or non-directory.");
  }
  const segments = String(relative || "").split("/").filter(Boolean);
  let current = workspace.rootPath;
  const parentCount = Math.max(0, segments.length - 1);
  const parents = [];
  for (let index = 0; index < parentCount; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await safeLstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", "A copy path parent became a link or non-directory.");
    const parentRel = segments.slice(0, index + 1).join("/");
    const expectedParent = expectedParents.get(parentRel);
    if (requireRecordedParents && !expectedParent) {
      throw boundaryError("DATA_BOUNDARY_MANIFEST_INVALID", `A manifest parent identity is missing: ${parentRel}.`);
    }
    const parentMatches = requireStableParentIdentity
      ? matchesRecordedIdentity(stat, expectedParent)
      : matchesRecordedEntity(stat, expectedParent);
    if (expectedParent && !parentMatches) {
      throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", `A copy path parent changed identity: ${parentRel}.`);
    }
    parents.push({ path: parentRel, stat });
  }
  let targetStat = null;
  if (expectedTargetIdentity) {
    const target = resolveManifestPath(workspace.rootPath, relative);
    targetStat = await safeLstat(target);
    if (!matchesRecordedIdentity(targetStat, expectedTargetIdentity)
      || targetIsDirectory && (!targetStat.isDirectory() || targetStat.isSymbolicLink())
      || !targetIsDirectory && (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1n)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A manifest source entry changed identity: ${relative}.`);
    }
  }
  const finalWorkspace = await captureWorkspaceIdentity(workspace.rootPath);
  if (finalWorkspace.digest !== expectedRootIdentity) {
    throw boundaryError("DATA_BOUNDARY_PATH_CHANGED", "A copy workspace root changed identity during the operation.");
  }
  return { root: rootStat, parents, target: targetStat };
}

function comparePath(left, right) {
  return String(left.path || "").localeCompare(String(right.path || ""));
}

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(sortJson(value)), "utf8").digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function boundaryError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
