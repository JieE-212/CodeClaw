import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SKIPPED_DIRECTORIES } from "../../shared/src/constants.js";
import { createStrictIgnoreMatcher } from "../../shared/src/ignore-utils.js";
import { throwIfAborted } from "../../shared/src/operation-manager.js";
import { isSensitiveDirectory, isSensitiveFile, relativePath } from "../../shared/src/path-utils.js";
import { RUNTIME_BUDGETS, boundedBudgetValue, runtimeBudgetError } from "../../shared/src/runtime-budget.js";
import { openStableDirectory } from "../../shared/src/stable-directory.js";
import { captureWorkspaceIdentity } from "../../shared/src/workspace-identity.js";

export const DATA_BOUNDARY_POLICY_VERSION = "codeclaw-data-boundary-v2";
export const DISPOSABLE_COPY_MARKER = ".codeclaw-disposable-copy.json";

const DEFAULT_READ_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_READ_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const VCS_DIRECTORIES = new Set([".git", ".hg", ".svn"]);
const NORMALIZED_SKIPPED_DIRECTORIES = new Set([...SKIPPED_DIRECTORIES].map((item) => item.toLocaleLowerCase("en-US")));

export async function buildDataBoundaryManifest(rootPath, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);
  const requestedRoot = path.resolve(rootPath || ".");
  const requestedStat = await fs.lstat(requestedRoot, { bigint: true }).catch((error) => {
    throwIfAborted(signal);
    if (error.code === "ENOENT") throw boundaryError("DATA_BOUNDARY_ROOT_MISSING", "The data-boundary source does not exist.");
    throw error;
  });
  throwIfAborted(signal);
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw boundaryError("DATA_BOUNDARY_ROOT_UNSAFE", "The data-boundary source must be a normal directory, not a file, symbolic link, or junction.");
  }
  const workspace = await captureWorkspaceIdentity(requestedRoot);
  throwIfAborted(signal);
  const root = workspace.rootPath;
  const suppliedIgnoreMatcher = options.ignoreMatcher || null;
  const limits = normalizeDataBoundaryBudget(options);
  const allowMarker = Boolean(options.allowDisposableMarker);
  const files = [];
  const directories = [];
  const excluded = [];
  const blockers = [];
  const portablePaths = new Map();
  const state = {
    limits,
    signal,
    files,
    directories,
    excluded,
    blockers,
    portablePaths,
    totalBytes: 0,
    used: { entriesVisited: 0, directoriesVisited: 0, maxDepthReached: 0 },
    ignoreSession: null
  };
  const ignoreSession = suppliedIgnoreMatcher ? null : createStrictIgnoreMatcher(root, {
    profile: "dataBoundary",
    signal,
    maxFiles: limits.maxIgnoreFiles,
    maxFileBytes: limits.maxIgnoreFileBytes,
    maxTotalBytes: limits.maxIgnoreTotalBytes,
    maxRules: limits.maxIgnoreRules,
    maxRuleEvaluations: limits.maxIgnoreRuleEvaluations,
    maxPatternChars: limits.maxIgnorePatternChars,
    maxMatchSteps: limits.maxIgnoreMatchSteps
  });
  state.ignoreSession = ignoreSession;
  const isIgnored = suppliedIgnoreMatcher
    ? async (relative, isDirectory) => {
      throwIfAborted(signal);
      const ignored = await suppliedIgnoreMatcher(relative, isDirectory, { signal });
      throwIfAborted(signal);
      return Boolean(ignored);
    }
    : ignoreSession.isIgnoredTraversed;

  try {
    await walk(root, 0);
    throwIfAborted(signal);
    await ignoreSession?.verify();
    throwIfAborted(signal);
    const finalWorkspace = await captureWorkspaceIdentity(root);
    throwIfAborted(signal);
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
    const budget = dataBoundaryBudgetEvidence(state);

    return {
      schemaVersion: 1,
      policyVersion: DATA_BOUNDARY_POLICY_VERSION,
      directories,
      files,
      rootPath: root,
      rootIdentity: workspace.digest,
      fileCount: files.length,
      directoryCount: directories.length,
      totalBytes: state.totalBytes,
      excluded,
      blockers,
      eligible: blockers.length === 0,
      payloadDigest,
      entryIdentityDigest,
      manifestDigest,
      truncated: false,
      truncationReasons: [],
      budget,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    throw normalizeDataBoundaryBuildError(error, state);
  }

  async function walk(currentPath, depth) {
    throwIfAborted(signal);
    if (depth > limits.maxDepth) {
      throw dataBoundaryBudgetError(
        state,
        "DATA_BOUNDARY_DEPTH_LIMIT",
        "max-depth",
        "data-boundary-depth",
        limits.maxDepth,
        depth,
        `The source exceeds the ${limits.maxDepth}-level data-boundary traversal depth; CodeClaw stopped instead of producing a partial manifest.`
      );
    }
    const directoriesObserved = state.used.directoriesVisited + 1;
    if (directoriesObserved > limits.maxDirectories) {
      throw dataBoundaryBudgetError(
        state,
        "DATA_BOUNDARY_DIRECTORY_LIMIT",
        "max-directories",
        "data-boundary-directories",
        limits.maxDirectories,
        directoriesObserved,
        `The source contains more than ${limits.maxDirectories} traversed directories; CodeClaw stopped instead of producing a partial manifest.`
      );
    }
    state.used.directoriesVisited = directoriesObserved;
    state.used.maxDepthReached = Math.max(state.used.maxDepthReached, depth);

    const before = await safeLstat(currentPath, signal);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      recordBoundaryItem(state, "blocker", { path: relativePath(root, currentPath) || ".", reason: "unsafe-directory" });
      return;
    }
    const entries = [];
    const openedDirectory = await openStableDirectory(root, currentPath, "build the data-boundary manifest", signal);
    for await (const entry of openedDirectory.directory) {
      throwIfAborted(signal);
      const entriesObserved = state.used.entriesVisited + 1;
      if (entriesObserved > limits.maxEntries) {
        throw dataBoundaryBudgetError(
          state,
          "DATA_BOUNDARY_ENTRY_LIMIT",
          "max-entries",
          "data-boundary-entries",
          limits.maxEntries,
          entriesObserved,
          `The source contains more than ${limits.maxEntries} filesystem entries; CodeClaw stopped instead of producing a partial manifest.`
        );
      }
      state.used.entriesVisited = entriesObserved;
      entries.push(entry);
    }
    throwIfAborted(signal);
    await openedDirectory.verify();
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      throwIfAborted(signal);
      await openedDirectory.verify();
      try {
        const absolutePath = path.join(currentPath, entry.name);
        const rel = relativePath(root, absolutePath);
        const portableIssue = registerPortablePath(rel, portablePaths);
        if (portableIssue) {
          recordBoundaryItem(state, "blocker", { path: rel, reason: portableIssue.reason, conflictsWith: portableIssue.conflictsWith || null });
          continue;
        }

        const stat = await safeLstat(absolutePath, signal);
        if (stat.isSymbolicLink()) {
          recordBoundaryItem(state, "blocker", { path: rel, reason: "symbolic-link" });
          continue;
        }
        if (entry.name === DISPOSABLE_COPY_MARKER) {
          if (allowMarker && stat.isFile()) recordBoundaryItem(state, "excluded", { path: rel, reason: "codeclaw-marker" });
          else recordBoundaryItem(state, "blocker", { path: rel, reason: "reserved-codeclaw-marker" });
          continue;
        }
        if (stat.isDirectory()) {
          if (isSensitiveDirectory(entry.name)) {
            recordBoundaryItem(state, "blocker", { path: rel, reason: "sensitive-directory" });
            continue;
          }
          const exclusion = staticDirectoryExclusion(entry.name)
            || (await isIgnored(rel, true) ? "gitignore" : "");
          throwIfAborted(signal);
          if (exclusion) {
            recordBoundaryItem(state, "excluded", { path: rel, reason: exclusion });
            continue;
          }
          directories.push({ path: rel, mode: Number(stat.mode & 0o777n), sourceIdentity: statIdentity(stat) });
          await walk(absolutePath, depth + 1);
          continue;
        }
        if (!stat.isFile()) {
          recordBoundaryItem(state, "blocker", { path: rel, reason: "unsupported-filesystem-entry" });
          continue;
        }
        if (stat.nlink !== 1n) {
          recordBoundaryItem(state, "blocker", { path: rel, reason: "hard-link" });
          continue;
        }
        if (isSensitiveFile(entry.name)) {
          recordBoundaryItem(state, "blocker", { path: rel, reason: "sensitive-file" });
          continue;
        }
        if (await isIgnored(rel, false)) {
          throwIfAborted(signal);
          recordBoundaryItem(state, "excluded", { path: rel, reason: "gitignore" });
          continue;
        }
        const filesObserved = files.length + 1;
        if (filesObserved > limits.maxFiles) {
          throw dataBoundaryBudgetError(
            state,
            "DATA_BOUNDARY_FILE_LIMIT",
            "max-files",
            "data-boundary-files",
            limits.maxFiles,
            filesObserved,
            `The source contains more than ${limits.maxFiles} copyable files; CodeClaw stopped instead of producing a partial manifest.`
          );
        }

        const remainingBytes = limits.maxTotalBytes - state.totalBytes;
        const byteLimitError = (fileBytes) => dataBoundaryBudgetError(
          state,
          "DATA_BOUNDARY_BYTE_LIMIT",
          "max-total-bytes",
          "data-boundary-total-bytes",
          limits.maxTotalBytes,
          safeBigIntNumber(BigInt(state.totalBytes) + BigInt(fileBytes)),
          `The source contains more than ${limits.maxTotalBytes} copyable bytes; CodeClaw stopped instead of producing a partial manifest.`
        );
        if (stat.size > BigInt(remainingBytes)) throw byteLimitError(stat.size);
        const fingerprint = await hashStableFile(absolutePath, stat, signal, {
          maxBytes: remainingBytes,
          byteLimitError
        });
        const bytesObserved = state.totalBytes + fingerprint.size;
        if (bytesObserved > limits.maxTotalBytes) {
          throw dataBoundaryBudgetError(
            state,
            "DATA_BOUNDARY_BYTE_LIMIT",
            "max-total-bytes",
            "data-boundary-total-bytes",
            limits.maxTotalBytes,
            bytesObserved,
            `The source contains more than ${limits.maxTotalBytes} copyable bytes; CodeClaw stopped instead of producing a partial manifest.`
          );
        }
        state.totalBytes = bytesObserved;
        files.push({
          path: rel,
          size: fingerprint.size,
          sha256: fingerprint.sha256,
          mode: Number(stat.mode & 0o777n),
          sourceIdentity: statIdentity(stat)
        });
      } finally {
        throwIfAborted(signal);
        await openedDirectory.verify();
      }
    }

    const after = await safeLstat(currentPath, signal);
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

async function hashStableFile(filePath, expectedStat, signal = null, {
  maxBytes = Number.MAX_SAFE_INTEGER,
  byteLimitError = null
} = {}) {
  throwIfAborted(signal);
  const handle = await fs.open(filePath, "r");
  try {
    throwIfAborted(signal);
    const before = await handle.stat({ bigint: true });
    throwIfAborted(signal);
    if (!before.isFile() || before.nlink !== 1n || !sameStableStat(before, expectedStat)) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed while CodeClaw was opening it: ${filePath}.`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      throwIfAborted(signal);
      const remaining = Math.max(0, maxBytes - total);
      const readLength = Math.min(buffer.length, remaining + 1);
      const { bytesRead } = await handle.read(buffer, 0, readLength, null);
      throwIfAborted(signal);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw typeof byteLimitError === "function"
          ? byteLimitError(total)
          : boundaryError("DATA_BOUNDARY_BYTE_LIMIT", `The file exceeded its ${maxBytes}-byte hashing budget.`, 413);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    throwIfAborted(signal);
    if (!sameStableStat(before, after) || BigInt(total) !== after.size) {
      throw boundaryError("DATA_BOUNDARY_SOURCE_CHANGED", `A source file changed while CodeClaw was hashing it: ${filePath}.`);
    }
    return { size: total, sha256: hash.digest("hex") };
  } finally {
    try {
      await handle.close();
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  }
}

function safeBigIntNumber(value) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
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

function staticDirectoryExclusion(name) {
  const normalizedName = name.toLocaleLowerCase("en-US");
  if (VCS_DIRECTORIES.has(normalizedName)) return "vcs-metadata";
  if (NORMALIZED_SKIPPED_DIRECTORIES.has(normalizedName)) return "generated-directory";
  return "";
}

function normalizeDataBoundaryBudget(options) {
  const hard = RUNTIME_BUDGETS.dataBoundary;
  return {
    maxFiles: boundedBudgetValue(options.maxFiles, hard.maxFiles),
    maxTotalBytes: boundedBudgetValue(options.maxBytes ?? options.maxTotalBytes, hard.maxTotalBytes),
    maxEntries: boundedBudgetValue(options.maxEntries, hard.maxEntries),
    maxDirectories: boundedBudgetValue(options.maxDirectories, hard.maxDirectories),
    maxDepth: boundedBudgetValue(options.maxDepth, hard.maxDepth, hard.maxDepth, 0),
    maxExcludedItems: boundedBudgetValue(options.maxExcludedItems, hard.maxExcludedItems),
    maxBlockerItems: boundedBudgetValue(options.maxBlockerItems, hard.maxBlockerItems),
    maxIgnoreFiles: boundedBudgetValue(options.maxIgnoreFiles, hard.maxIgnoreFiles),
    maxIgnoreFileBytes: boundedBudgetValue(options.maxIgnoreFileBytes, hard.maxIgnoreFileBytes),
    maxIgnoreTotalBytes: boundedBudgetValue(options.maxIgnoreTotalBytes, hard.maxIgnoreTotalBytes),
    maxIgnoreRules: boundedBudgetValue(options.maxIgnoreRules, hard.maxIgnoreRules),
    maxIgnoreRuleEvaluations: boundedBudgetValue(options.maxIgnoreRuleEvaluations, hard.maxIgnoreRuleEvaluations),
    maxIgnorePatternChars: boundedBudgetValue(options.maxIgnorePatternChars, hard.maxIgnorePatternChars),
    maxIgnoreMatchSteps: boundedBudgetValue(options.maxIgnoreMatchSteps, hard.maxIgnoreMatchSteps)
  };
}

function recordBoundaryItem(state, kind, item) {
  const isExcluded = kind === "excluded";
  const collection = isExcluded ? state.excluded : state.blockers;
  const limit = isExcluded ? state.limits.maxExcludedItems : state.limits.maxBlockerItems;
  const observed = collection.length + 1;
  if (observed > limit) {
    const label = isExcluded ? "excluded items" : "blocking items";
    throw dataBoundaryBudgetError(
      state,
      isExcluded ? "DATA_BOUNDARY_EXCLUDED_LIMIT" : "DATA_BOUNDARY_BLOCKER_LIMIT",
      isExcluded ? "max-excluded-items" : "max-blocker-items",
      isExcluded ? "data-boundary-excluded-items" : "data-boundary-blocker-items",
      limit,
      observed,
      `The source contains more than ${limit} ${label}; CodeClaw stopped instead of omitting data-boundary evidence.`
    );
  }
  collection.push(item);
}

function dataBoundaryBudgetError(state, code, reason, operation, limit, observed, message) {
  const error = runtimeBudgetError(code, message, { operation, limit, observed, status: 413 });
  error.runtimeBudget.reason = reason;
  error.budget = dataBoundaryBudgetEvidence(state, true, [reason]);
  return error;
}

function dataBoundaryBudgetEvidence(state, truncated = false, reasons = []) {
  const ignore = state.ignoreSession?.evidence() || {
    used: {
      filesRead: 0,
      bytesRead: 0,
      identityChecks: 0,
      cacheEntries: 0,
      rulesLoaded: 0,
      ruleEvaluations: 0,
      maxPatternCharsObserved: 0,
      matchSteps: 0
    }
  };
  return {
    operation: "data-boundary-manifest",
    limits: { ...state.limits },
    used: {
      ...state.used,
      filesCollected: state.files.length,
      totalBytes: state.totalBytes,
      directoriesCollected: state.directories.length,
      excludedItemsStored: state.excluded.length,
      blockerItemsStored: state.blockers.length,
      portablePathsTracked: state.portablePaths.size,
      ignoreFilesRead: ignore.used.filesRead,
      ignoreBytesRead: ignore.used.bytesRead,
      ignoreIdentityChecks: ignore.used.identityChecks,
      ignoreCacheEntries: ignore.used.cacheEntries,
      ignoreRulesLoaded: ignore.used.rulesLoaded,
      ignoreRuleEvaluations: ignore.used.ruleEvaluations,
      ignoreMaxPatternCharsObserved: ignore.used.maxPatternCharsObserved,
      ignoreMatchSteps: ignore.used.matchSteps
    },
    truncated,
    reasons: [...new Set(reasons)].sort()
  };
}

function normalizeDataBoundaryBuildError(error, state) {
  if (error?.code?.startsWith("DATA_BOUNDARY_") || error?.code?.startsWith("OPERATION_")) return error;
  if (error?.code === "GITIGNORE_RUNTIME_BUDGET_EXCEEDED") {
    const evidence = error.runtimeBudget || {};
    const reason = String(evidence.operation || "gitignore-runtime-budget");
    const wrapped = runtimeBudgetError(
      "DATA_BOUNDARY_IGNORE_BUDGET_EXCEEDED",
      "CodeClaw stopped because .gitignore processing exceeded the data-boundary runtime budget; no partial manifest was produced.",
      {
        operation: reason,
        limit: evidence.limit,
        observed: evidence.observed,
        status: 413
      }
    );
    wrapped.runtimeBudget.reason = reason;
    wrapped.budget = dataBoundaryBudgetEvidence(state, true, [reason]);
    return wrapped;
  }
  const ignoreMappings = {
    GITIGNORE_UNSAFE: ["DATA_BOUNDARY_IGNORE_UNSAFE", "A .gitignore is not a normal owned file, so CodeClaw refused to guess the copy boundary."],
    GITIGNORE_CHANGED: ["DATA_BOUNDARY_SOURCE_CHANGED", "A .gitignore changed while CodeClaw was building the data boundary."],
    GITIGNORE_INVALID_UTF8: ["DATA_BOUNDARY_IGNORE_UNREADABLE", "A .gitignore is not valid UTF-8, so CodeClaw refused to guess the copy boundary."],
    GITIGNORE_UNREADABLE: ["DATA_BOUNDARY_IGNORE_UNREADABLE", "CodeClaw could not safely read .gitignore, so it refused to guess the copy boundary."]
  };
  const mapped = ignoreMappings[error?.code];
  return mapped ? boundaryError(mapped[0], mapped[1]) : error;
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

async function safeLstat(targetPath, signal = null) {
  throwIfAborted(signal);
  try {
    const stat = await fs.lstat(targetPath, { bigint: true });
    throwIfAborted(signal);
    return stat;
  } catch (error) {
    throwIfAborted(signal);
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
