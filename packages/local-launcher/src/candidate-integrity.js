import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const CANDIDATE_AUTHORITY_FILENAME = "CODECLAW_CANDIDATE_AUTHORITY.json";
export const CANDIDATE_AUTHORITY_SHA256_FILENAME = `${CANDIDATE_AUTHORITY_FILENAME}.sha256`;

const AUTHORITY_SCHEMA = "codeclaw.machine-candidate-authority";
const AUTHORITY_VERSION = 1;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_UNSAFE_CHARACTER = /[<>:"\\|?*]/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const HARD_LIMITS = Object.freeze({
  maxFiles: 50_000,
  maxDirectories: 10_000,
  maxEntries: 100_000,
  maxDepth: 64,
  maxFileBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxAuthorityBytes: 32 * 1024 * 1024
});
const AUTHORITY_PATHS = new Set([
  CANDIDATE_AUTHORITY_FILENAME,
  CANDIDATE_AUTHORITY_SHA256_FILENAME
]);

export async function writeCandidateAuthority(candidateRoot, metadata, options = {}) {
  try {
    const root = await inspectCandidateRoot(candidateRoot);
    const limits = normalizeLimits(options);
    const normalizedMetadata = normalizeMetadata(metadata);
    const inventory = await inventoryCandidate(root, limits);
    const payload = authorityPayload(normalizedMetadata, inventory);
    const payloadSha256 = sha256(canonicalJson(payload));
    const authority = {
      ...payload,
      payloadSha256,
      candidateId: candidateIdFromPayload(payloadSha256)
    };
    const authorityBytes = Buffer.from(`${canonicalJson(authority)}\n`, "utf8");
    if (authorityBytes.byteLength > limits.maxAuthorityBytes) {
      throw budgetError("authority-bytes", limits.maxAuthorityBytes, authorityBytes.byteLength);
    }
    const manifestSha256 = sha256(authorityBytes);
    const sidecarBytes = Buffer.from(`${manifestSha256}  ${CANDIDATE_AUTHORITY_FILENAME}\n`, "utf8");

    await assertAuthorityTargetsSafe(root);
    await atomicWriteInsideRoot(root, CANDIDATE_AUTHORITY_FILENAME, authorityBytes);
    await atomicWriteInsideRoot(root, CANDIDATE_AUTHORITY_SHA256_FILENAME, sidecarBytes);

    const verified = await verifyCandidateIntegrity(root.rootPath, { limits });
    return { ...verified, authority };
  } catch (error) {
    throw publicCandidateError(error);
  }
}

export async function verifyCandidateIntegrity(candidateRoot, options = {}) {
  try {
    const root = await inspectCandidateRoot(candidateRoot);
    const limits = normalizeLimits(options);
    const authorityRead = await readStableAuthorityFile(root, CANDIDATE_AUTHORITY_FILENAME, limits.maxAuthorityBytes);
    const sidecarRead = await readStableAuthorityFile(root, CANDIDATE_AUTHORITY_SHA256_FILENAME, 512);
    const manifestSha256 = sha256(authorityRead.buffer);
    const expectedSidecar = `${manifestSha256}  ${CANDIDATE_AUTHORITY_FILENAME}\n`;
    if (sidecarRead.text !== expectedSidecar) {
      throw candidateError("CANDIDATE_SIDECAR_INVALID", "The candidate Authority SHA-256 sidecar is missing, truncated, or does not match the Authority bytes.");
    }

    let authority;
    try {
      authority = JSON.parse(authorityRead.text);
    } catch {
      throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate Authority is not complete valid JSON.");
    }
    validateAuthority(authority, limits);
    if (authorityRead.text !== `${canonicalJson(authority)}\n`) {
      throw candidateError("CANDIDATE_AUTHORITY_NONCANONICAL", "The candidate Authority is not encoded as the required canonical JSON payload.");
    }

    const inventory = await inventoryCandidate(root, limits);
    const observed = authorityPayload({
      packageVersion: authority.packageVersion,
      sourceCommit: authority.sourceCommit,
      sourceDirty: authority.sourceDirty
    }, inventory);
    const declared = payloadFromAuthority(authority);
    if (canonicalJson(observed) !== canonicalJson(declared)) {
      throw candidateError("CANDIDATE_INTEGRITY_MISMATCH", "Candidate files or directories are missing, extra, truncated, or different from the Authority manifest.");
    }

    const finalAuthority = await readStableAuthorityFile(root, CANDIDATE_AUTHORITY_FILENAME, limits.maxAuthorityBytes);
    const finalSidecar = await readStableAuthorityFile(root, CANDIDATE_AUTHORITY_SHA256_FILENAME, 512);
    if (!finalAuthority.buffer.equals(authorityRead.buffer) || !finalSidecar.buffer.equals(sidecarRead.buffer)
      || !sameStableStat(finalAuthority.stat, authorityRead.stat)
      || !sameStableStat(finalSidecar.stat, sidecarRead.stat)) {
      throw candidateError("CANDIDATE_AUTHORITY_CHANGED", "The candidate Authority changed while integrity verification was running.");
    }
    await assertRootEntity(root);

    return {
      ok: true,
      candidateId: authority.candidateId,
      packageVersion: authority.packageVersion,
      sourceCommit: authority.sourceCommit,
      sourceDirty: false,
      directoryCount: authority.directoryCount,
      fileCount: authority.fileCount,
      totalBytes: authority.totalBytes,
      payloadSha256: authority.payloadSha256,
      manifestSha256,
      authorityFile: CANDIDATE_AUTHORITY_FILENAME,
      sidecarFile: CANDIDATE_AUTHORITY_SHA256_FILENAME,
      authority
    };
  } catch (error) {
    throw publicCandidateError(error);
  }
}

async function inventoryCandidate(root, limits) {
  const state = {
    limits,
    files: [],
    directories: [],
    entriesVisited: 0,
    directoriesVisited: 0,
    totalBytes: 0,
    portablePaths: new Map()
  };
  for (const authorityPath of AUTHORITY_PATHS) {
    state.portablePaths.set(portablePathKey(authorityPath), authorityPath);
  }

  await walkDirectory(root.rootPath, "", 0, state);
  await assertRootEntity(root);
  state.directories.sort(compareOrdinal);
  state.files.sort((left, right) => compareOrdinal(left.path, right.path));
  return {
    directories: state.directories,
    files: state.files,
    directoryCount: state.directories.length,
    fileCount: state.files.length,
    totalBytes: state.totalBytes
  };
}

async function walkDirectory(absoluteDirectory, relativeDirectory, depth, state) {
  const observedDirectories = state.directoriesVisited + 1;
  if (observedDirectories > state.limits.maxDirectories) {
    throw budgetError("directories", state.limits.maxDirectories, observedDirectories);
  }
  state.directoriesVisited = observedDirectories;
  const before = await lstatCandidateEntry(absoluteDirectory, relativeDirectory || ".");
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw unsafeEntryError(relativeDirectory || ".", "directory-link-or-special-object");
  }

  let directory;
  const entries = [];
  try {
    directory = await fs.opendir(absoluteDirectory);
    await assertPathIdentity(absoluteDirectory, before, relativeDirectory || ".", true);
    for await (const entry of directory) {
      const isAuthorityException = !relativeDirectory && AUTHORITY_PATHS.has(entry.name);
      if (!isAuthorityException) {
        const observedEntries = state.entriesVisited + 1;
        if (observedEntries > state.limits.maxEntries) {
          throw budgetError("entries", state.limits.maxEntries, observedEntries);
        }
        state.entriesVisited = observedEntries;
      }
      entries.push(entry.name);
    }
  } finally {
    await closeDirectory(directory);
  }
  entries.sort(compareOrdinal);

  for (const name of entries) {
    await assertPathIdentity(absoluteDirectory, before, relativeDirectory || ".", true);
    const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const authorityException = !relativeDirectory && AUTHORITY_PATHS.has(name);
    if (authorityException) {
      registerPortablePath(relative, state.portablePaths);
      const stat = await lstatCandidateEntry(path.join(absoluteDirectory, name), relative);
      assertNormalOwnedFile(stat, relative, "authority-exception");
      continue;
    }
    const entryDepth = depth + 1;
    if (entryDepth > state.limits.maxDepth) {
      throw budgetError("depth", state.limits.maxDepth, entryDepth);
    }
    assertSafeCandidateRelativePath(relative);
    registerPortablePath(relative, state.portablePaths);
    const absolute = path.join(absoluteDirectory, name);
    const stat = await lstatCandidateEntry(absolute, relative);

    if (stat.isSymbolicLink()) throw unsafeEntryError(relative, "symbolic-link-or-junction");
    if (stat.isDirectory()) {
      state.directories.push(relative);
      await walkDirectory(absolute, relative, entryDepth, state);
      continue;
    }
    assertNormalOwnedFile(stat, relative, "candidate-payload");
    const observedFiles = state.files.length + 1;
    if (observedFiles > state.limits.maxFiles) {
      throw budgetError("files", state.limits.maxFiles, observedFiles);
    }
    if (stat.size > BigInt(state.limits.maxFileBytes)) {
      throw budgetError("file-bytes", state.limits.maxFileBytes, safeBigIntNumber(stat.size));
    }
    const remainingBytes = state.limits.maxTotalBytes - state.totalBytes;
    if (stat.size > BigInt(remainingBytes)) {
      throw budgetError("total-bytes", state.limits.maxTotalBytes, safeBigIntNumber(BigInt(state.totalBytes) + stat.size));
    }
    const limitedByFile = state.limits.maxFileBytes <= remainingBytes;
    const maxBytes = Math.min(state.limits.maxFileBytes, remainingBytes);
    const fingerprint = await hashStableCandidateFile(absolute, relative, stat, {
      maxBytes,
      byteLimitError: (observed) => limitedByFile
        ? budgetError("file-bytes", state.limits.maxFileBytes, observed)
        : budgetError("total-bytes", state.limits.maxTotalBytes, state.totalBytes + observed)
    });
    state.totalBytes += fingerprint.size;
    state.files.push({ path: relative, size: fingerprint.size, sha256: fingerprint.sha256 });
  }
  await assertPathIdentity(absoluteDirectory, before, relativeDirectory || ".", true);
}

async function hashStableCandidateFile(filePath, relative, expectedStat, { maxBytes, byteLimitError }) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const opened = await handle.stat({ bigint: true });
    assertNormalOwnedFile(opened, relative, "candidate-payload");
    if (!sameStableStat(expectedStat, opened)) throw changedEntryError(relative);

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    let total = 0;
    for (;;) {
      const remaining = Math.max(0, maxBytes - total);
      const readLength = Math.min(buffer.length, remaining + 1);
      const { bytesRead } = await handle.read(buffer, 0, readLength, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw byteLimitError(total);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }

    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstatCandidateEntry(filePath, relative);
    if (!sameStableStat(opened, after) || !sameStableStat(opened, pathAfter) || BigInt(total) !== after.size) {
      throw changedEntryError(relative);
    }
    return { size: total, sha256: hash.digest("hex") };
  } finally {
    if (handle) await handle.close();
  }
}

function authorityPayload(metadata, inventory) {
  return {
    schema: AUTHORITY_SCHEMA,
    version: AUTHORITY_VERSION,
    packageVersion: metadata.packageVersion,
    sourceCommit: metadata.sourceCommit,
    sourceDirty: metadata.sourceDirty,
    directoryCount: inventory.directoryCount,
    fileCount: inventory.fileCount,
    totalBytes: inventory.totalBytes,
    directories: inventory.directories,
    files: inventory.files
  };
}

function payloadFromAuthority(authority) {
  return authorityPayload(authority, authority);
}

function validateAuthority(authority, limits) {
  assertPlainObject(authority, "CANDIDATE_AUTHORITY_INVALID", "The candidate Authority must be a JSON object.");
  assertExactKeys(authority, [
    "candidateId",
    "directories",
    "directoryCount",
    "fileCount",
    "files",
    "packageVersion",
    "payloadSha256",
    "schema",
    "sourceCommit",
    "sourceDirty",
    "totalBytes",
    "version"
  ], "CANDIDATE_AUTHORITY_INVALID");
  if (authority.schema !== AUTHORITY_SCHEMA || authority.version !== AUTHORITY_VERSION) {
    throw candidateError("CANDIDATE_AUTHORITY_VERSION_UNSUPPORTED", "The candidate Authority schema or version is unsupported.");
  }
  const normalizedMetadata = normalizeMetadata(authority);
  if (authority.packageVersion !== normalizedMetadata.packageVersion
    || authority.sourceCommit !== normalizedMetadata.sourceCommit
    || authority.sourceDirty !== false) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "Candidate source metadata is not canonical.");
  }
  if (!Array.isArray(authority.directories) || !Array.isArray(authority.files)) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate Authority must contain directory and file arrays.");
  }
  if (authority.directories.length > limits.maxDirectories || authority.files.length > limits.maxFiles) {
    throw candidateError("CANDIDATE_AUTHORITY_BUDGET_INVALID", "The candidate Authority declares content beyond the verification budget.", 413);
  }
  assertSafeCount(authority.directoryCount, authority.directories.length, "directoryCount");
  assertSafeCount(authority.fileCount, authority.files.length, "fileCount");
  if (!Number.isSafeInteger(authority.totalBytes) || authority.totalBytes < 0 || authority.totalBytes > limits.maxTotalBytes) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate Authority total byte count is invalid.");
  }

  const portablePaths = new Map();
  for (const authorityPath of AUTHORITY_PATHS) portablePaths.set(portablePathKey(authorityPath), authorityPath);
  const declaredDirectories = new Set();
  let previousDirectory = null;
  for (const relative of authority.directories) {
    assertSafeCandidateRelativePath(relative);
    assertNotAuthorityPath(relative);
    if (previousDirectory !== null && compareOrdinal(previousDirectory, relative) >= 0) {
      throw candidateError("CANDIDATE_AUTHORITY_ORDER_INVALID", "Candidate Authority directories must be unique and sorted exactly.");
    }
    previousDirectory = relative;
    registerPortablePath(relative, portablePaths);
    declaredDirectories.add(relative);
  }

  let previousFile = null;
  let totalBytes = 0;
  for (const file of authority.files) {
    assertPlainObject(file, "CANDIDATE_AUTHORITY_INVALID", "Every candidate file record must be an object.");
    assertExactKeys(file, ["path", "sha256", "size"], "CANDIDATE_AUTHORITY_INVALID");
    assertSafeCandidateRelativePath(file.path);
    assertNotAuthorityPath(file.path);
    if (previousFile !== null && compareOrdinal(previousFile, file.path) >= 0) {
      throw candidateError("CANDIDATE_AUTHORITY_ORDER_INVALID", "Candidate Authority files must be unique and sorted exactly.");
    }
    previousFile = file.path;
    registerPortablePath(file.path, portablePaths);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) {
      throw candidateError("CANDIDATE_AUTHORITY_INVALID", "A candidate file size is invalid or exceeds the verification budget.");
    }
    if (typeof file.sha256 !== "string" || !HASH_PATTERN.test(file.sha256)) {
      throw candidateError("CANDIDATE_AUTHORITY_INVALID", "A candidate file SHA-256 is invalid.");
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw candidateError("CANDIDATE_AUTHORITY_INVALID", "Candidate file byte totals exceed the verification budget.");
    }
    for (const parent of parentRelativePaths(file.path)) {
      if (!declaredDirectories.has(parent)) {
        throw candidateError("CANDIDATE_AUTHORITY_INVALID", "A candidate file parent directory is missing from the Authority.");
      }
    }
  }
  for (const directory of authority.directories) {
    for (const parent of parentRelativePaths(directory)) {
      if (!declaredDirectories.has(parent)) {
        throw candidateError("CANDIDATE_AUTHORITY_INVALID", "A candidate directory parent is missing from the Authority.");
      }
    }
  }
  if (totalBytes !== authority.totalBytes) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate Authority total byte count does not match its file records.");
  }

  if (typeof authority.payloadSha256 !== "string" || !HASH_PATTERN.test(authority.payloadSha256)) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate payload digest is invalid.");
  }
  const expectedPayloadDigest = sha256(canonicalJson(payloadFromAuthority(authority)));
  if (authority.payloadSha256 !== expectedPayloadDigest
    || authority.candidateId !== candidateIdFromPayload(expectedPayloadDigest)) {
    throw candidateError("CANDIDATE_IDENTITY_INVALID", "The candidate ID does not match the canonical Authority payload.");
  }
}

function normalizeMetadata(metadata) {
  assertPlainObject(metadata, "CANDIDATE_METADATA_INVALID", "Candidate metadata must be an object.");
  const packageVersion = String(metadata.packageVersion || "");
  const sourceCommit = String(metadata.sourceCommit || "").toLowerCase();
  if (!SEMVER_PATTERN.test(packageVersion)) {
    throw candidateError("CANDIDATE_METADATA_INVALID", "Candidate packageVersion must be a valid semantic version.", 400);
  }
  if (!COMMIT_PATTERN.test(sourceCommit)) {
    throw candidateError("CANDIDATE_METADATA_INVALID", "Candidate sourceCommit must be exactly 40 hexadecimal characters.", 400);
  }
  if (metadata.sourceDirty !== false) {
    throw candidateError("CANDIDATE_SOURCE_DIRTY", "A machine candidate can only be authorized from sourceDirty:false metadata.", 409);
  }
  return { packageVersion, sourceCommit, sourceDirty: false };
}

function normalizeLimits(options = {}) {
  const supplied = options?.limits && typeof options.limits === "object" ? options.limits : options;
  const limits = {};
  for (const [name, hardMaximum] of Object.entries(HARD_LIMITS)) {
    const minimum = name === "maxDepth" ? 0 : 1;
    const value = supplied?.[name];
    if (value === undefined) {
      limits[name] = hardMaximum;
      continue;
    }
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw candidateError("CANDIDATE_OPTIONS_INVALID", `Candidate integrity option ${name} is invalid.`, 400);
    }
    limits[name] = Math.min(value, hardMaximum);
  }
  return Object.freeze(limits);
}

async function inspectCandidateRoot(candidateRoot) {
  if (typeof candidateRoot !== "string" || !candidateRoot.trim()) {
    throw candidateError("CANDIDATE_ROOT_INVALID", "A candidate root directory is required.", 400);
  }
  const rootPath = path.resolve(candidateRoot);
  let stat;
  let realPath;
  try {
    [stat, realPath] = await Promise.all([
      fs.lstat(rootPath, { bigint: true }),
      fs.realpath(rootPath)
    ]);
  } catch {
    throw candidateError("CANDIDATE_ROOT_UNSAFE", "The candidate root is missing or cannot be inspected safely.");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalFilesystemPath(realPath) !== canonicalFilesystemPath(rootPath)) {
    throw candidateError("CANDIDATE_ROOT_UNSAFE", "The candidate root or one of its path ancestors is a link, junction, or non-directory.");
  }
  return { rootPath, identity: entityIdentity(stat) };
}

async function assertRootEntity(root) {
  let stat;
  try {
    stat = await fs.lstat(root.rootPath, { bigint: true });
  } catch {
    throw candidateError("CANDIDATE_ROOT_CHANGED", "The candidate root changed during integrity processing.");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameEntityIdentity(root.identity, entityIdentity(stat))) {
    throw candidateError("CANDIDATE_ROOT_CHANGED", "The candidate root changed during integrity processing.");
  }
}

async function assertAuthorityTargetsSafe(root) {
  await assertRootEntity(root);
  for (const relative of AUTHORITY_PATHS) {
    const target = path.join(root.rootPath, relative);
    try {
      const stat = await fs.lstat(target, { bigint: true });
      assertNormalOwnedFile(stat, relative, "authority-exception");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
  }
}

async function readStableAuthorityFile(root, relative, maxBytes) {
  const filePath = path.join(root.rootPath, relative);
  let expected;
  try {
    expected = await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw candidateError("CANDIDATE_AUTHORITY_MISSING", "The candidate Authority JSON or SHA-256 sidecar is missing.");
    }
    throw error;
  }
  assertNormalOwnedFile(expected, relative, "authority-exception");
  if (expected.size > BigInt(maxBytes)) throw budgetError("authority-bytes", maxBytes, safeBigIntNumber(expected.size));

  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const opened = await handle.stat({ bigint: true });
    assertNormalOwnedFile(opened, relative, "authority-exception");
    if (!sameStableStat(expected, opened)) throw changedEntryError(relative);
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    for (;;) {
      const remaining = Math.max(0, maxBytes - total);
      const readLength = Math.min(buffer.length, remaining + 1);
      const { bytesRead } = await handle.read(buffer, 0, readLength, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) throw budgetError("authority-bytes", maxBytes, total);
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    if (!sameStableStat(opened, after) || !sameStableStat(opened, pathAfter) || BigInt(total) !== after.size) {
      throw changedEntryError(relative);
    }
    const content = Buffer.concat(chunks, total);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      throw candidateError("CANDIDATE_AUTHORITY_INVALID", "The candidate Authority files must be valid UTF-8.");
    }
    return { buffer: content, text, stat: expected };
  } finally {
    if (handle) await handle.close();
  }
}

async function atomicWriteInsideRoot(root, relative, content) {
  await assertRootEntity(root);
  const targetPath = path.join(root.rootPath, relative);
  const temporaryName = `.${relative}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryPath = path.join(root.rootPath, temporaryName);
  let handle;
  let renamed = false;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await assertRootEntity(root);
    await fs.rename(temporaryPath, targetPath);
    renamed = true;
    await assertRootEntity(root);
  } finally {
    await handle?.close().catch(() => {});
    if (!renamed && await rootEntityStillMatches(root)) await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function rootEntityStillMatches(root) {
  try {
    const stat = await fs.lstat(root.rootPath, { bigint: true });
    return stat.isDirectory() && !stat.isSymbolicLink() && sameEntityIdentity(root.identity, entityIdentity(stat));
  } catch {
    return false;
  }
}

async function assertPathIdentity(absolute, expected, relative, requireDirectory = false) {
  const current = await lstatCandidateEntry(absolute, relative);
  if (!sameStableStat(expected, current)
    || requireDirectory && (!current.isDirectory() || current.isSymbolicLink())) {
    throw changedEntryError(relative);
  }
}

async function lstatCandidateEntry(absolute, relative) {
  try {
    return await fs.lstat(absolute, { bigint: true });
  } catch {
    throw changedEntryError(relative);
  }
}

async function closeDirectory(directory) {
  if (!directory) return;
  try {
    await directory.close();
  } catch (error) {
    if (error.code !== "ERR_DIR_CLOSED") throw error;
  }
}

function assertNormalOwnedFile(stat, relative, purpose) {
  if (!stat.isFile() || stat.isSymbolicLink()) throw unsafeEntryError(relative, `${purpose}-link-or-special-object`);
  if (stat.nlink !== 1n) throw unsafeEntryError(relative, `${purpose}-hard-link`);
}

export function assertSafeCandidateRelativePath(relative) {
  if (typeof relative !== "string" || !relative
    || relative.includes("\\") || path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)
    || relative.length > 4096) {
    throw candidateError("CANDIDATE_PATH_UNSAFE", "A candidate path is not a canonical safe relative path.");
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.length > 255
    || CONTROL_CHARACTER.test(segment) || WINDOWS_UNSAFE_CHARACTER.test(segment)
    || /[ .]$/.test(segment) || WINDOWS_RESERVED_NAME.test(segment))) {
    throw candidateError("CANDIDATE_PATH_UNSAFE", "A candidate path is not portable and safe for Windows launch.");
  }
}

function assertNotAuthorityPath(relative) {
  if (AUTHORITY_PATHS.has(relative)) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", "Authority files cannot list themselves as candidate payload files.");
  }
}

function registerPortablePath(relative, seen) {
  const key = portablePathKey(relative);
  const previous = seen.get(key);
  if (previous && previous !== relative) {
    throw candidateError("CANDIDATE_PATH_COLLISION", "Candidate paths collide under Windows case folding or Unicode NFC normalization.");
  }
  seen.set(key, relative);
}

function portablePathKey(relative) {
  return String(relative).normalize("NFC").toLocaleLowerCase("en-US");
}

function parentRelativePaths(relative) {
  const segments = relative.split("/");
  const parents = [];
  for (let index = 1; index < segments.length; index += 1) parents.push(segments.slice(0, index).join("/"));
  return parents;
}

function entityIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs };
}

function sameEntityIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}

function sameStableStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.mode === right.mode
    && left.nlink === right.nlink;
}

function canonicalFilesystemPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort(compareOrdinal);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw candidateError("CANDIDATE_AUTHORITY_INVALID", "Candidate Authority contains a non-JSON value.");
  return encoded;
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateIdFromPayload(payloadSha256) {
  return `codeclaw-${payloadSha256}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeBigIntNumber(value) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw candidateError(code, message, 400);
}

function assertExactKeys(value, expected, code) {
  const actual = Object.keys(value).sort(compareOrdinal);
  const sortedExpected = [...expected].sort(compareOrdinal);
  if (canonicalJson(actual) !== canonicalJson(sortedExpected)) {
    throw candidateError(code, "The candidate Authority contains missing or unsupported fields.", 400);
  }
}

function assertSafeCount(value, expected, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value !== expected) {
    throw candidateError("CANDIDATE_AUTHORITY_INVALID", `The candidate Authority ${label} is invalid.`);
  }
}

function budgetError(resource, limit, observed) {
  const error = candidateError("CANDIDATE_BUDGET_EXCEEDED", `Candidate integrity processing exceeded the ${resource} safety budget.`, 413);
  error.budget = {
    resource,
    limit: Number.isSafeInteger(limit) ? limit : null,
    observed: Number.isSafeInteger(observed) ? observed : null
  };
  return error;
}

function unsafeEntryError(relative, reason) {
  const error = candidateError("CANDIDATE_ENTRY_UNSAFE", `Candidate entry ${JSON.stringify(relative)} is a link, junction, hard link, or unsupported special object.`);
  error.reason = reason;
  return error;
}

function changedEntryError(relative) {
  return candidateError("CANDIDATE_ENTRY_CHANGED", `Candidate entry ${JSON.stringify(relative)} changed during integrity processing.`);
}

function candidateError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function publicCandidateError(error) {
  if (typeof error?.code === "string" && error.code.startsWith("CANDIDATE_")) return error;
  return candidateError("CANDIDATE_INTEGRITY_IO_FAILED", "Candidate integrity processing could not safely complete.", 500);
}
