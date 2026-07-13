import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_AUTHORITY_FILENAME,
  CANDIDATE_AUTHORITY_SHA256_FILENAME,
  assertSafeCandidateRelativePath,
  writeCandidateAuthority,
  verifyCandidateIntegrity
} from "../packages/local-launcher/src/candidate-integrity.js";
import {
  hermeticGitArguments,
  hermeticGitEnvironment,
  inspectSourceVersion
} from "./source-version.js";

const scriptPath = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_OUTPUT_ROOT = path.join(sourceRoot, "dist");
const INCLUDE_DIRECTORIES = Object.freeze(["apps", "docs", "examples", "packages", "scripts", "tests"]);
const INCLUDE_FILES = new Set([
  ".gitignore",
  "package.json",
  "README.md",
  "start-codeclaw.cmd",
  "start-codeclaw.ps1",
  "stop-codeclaw.cmd",
  "stop-codeclaw.ps1"
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".codeclaw",
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "trial-feedback",
  "trial-privacy-risk",
  "trial-session-packs"
]);
const EXCLUDED_FILES = new Set([
  CANDIDATE_AUTHORITY_FILENAME,
  CANDIDATE_AUTHORITY_SHA256_FILENAME,
  "run-dev.cmd",
  "server-bg.log"
].map(windowsCaseKey));
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const GIT_METADATA_TIMEOUT_MS = 30_000;
const GIT_BLOB_MIN_TIMEOUT_MS = 15_000;
const GIT_BLOB_MAX_TIMEOUT_MS = 300_000;
const GIT_BLOB_BYTES_PER_MS = 4 * 1024;
const GIT_PROCESS_KILL_FALLBACK_MS = 1_000;
const GIT_PROCESS_EXIT_GRACE_MS = 5_000;

export async function prepareMachineCandidate({
  rootPath = sourceRoot,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  outputPath = "",
  force = false
} = {}) {
  const root = path.resolve(rootPath);
  const source = await inspectSourceVersion(root);
  assertCleanSource(source);
  const committed = await inspectCommittedSnapshot(root, source.commit);

  const resolvedOutputRoot = path.resolve(outputRoot);
  await assertOutputRoot(root, resolvedOutputRoot);
  await fs.mkdir(resolvedOutputRoot, { recursive: true });
  await assertNormalDirectoryPath(resolvedOutputRoot, "MACHINE_CANDIDATE_OUTPUT_UNSAFE");
  const stagingPath = path.join(resolvedOutputRoot, `.codeclaw-machine-staging-${randomUUID()}`);
  await fs.mkdir(stagingPath, { recursive: false });
  let finalPath = "";
  let finalCreated = false;
  let completed = false;
  let workError = null;
  try {
    let totalBytes = 0;
    for (const file of committed.files) {
      const copied = await copyCommittedBlob(root, stagingPath, file, committed.objectFormat, MAX_TOTAL_BYTES - totalBytes);
      totalBytes += copied;
    }
    await assertSourceStillClean(root, source);

    const packageDocument = await readJsonDocument(path.join(stagingPath, "package.json"));
    const packageVersion = String(packageDocument.version || "").trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(packageVersion)) {
      throw candidatePackageError("MACHINE_CANDIDATE_VERSION_INVALID", "package.json contains an invalid candidate version.");
    }

    await writeHumanManifest(stagingPath, { packageVersion, sourceCommit: source.commit });
    await writeCandidateAuthority(stagingPath, {
      packageVersion,
      sourceCommit: source.commit,
      sourceDirty: false
    });
    const authority = await verifyCandidateIntegrity(stagingPath);
    await assertSourceStillClean(root, source);

    const defaultName = `CodeClaw-machine-candidate-v${packageVersion}-${source.commit.slice(0, 12)}-${authority.candidateId.slice(-12)}`;
    finalPath = outputPath ? path.resolve(outputPath) : path.join(resolvedOutputRoot, defaultName);
    await assertFinalOutput(resolvedOutputRoot, finalPath, stagingPath);
    if (await exists(finalPath)) {
      if (!force) throw candidatePackageError("MACHINE_CANDIDATE_EXISTS", `Candidate output already exists: ${path.basename(finalPath)}`);
      await removeNormalDirectory(finalPath, resolvedOutputRoot);
    }
    await fs.rename(stagingPath, finalPath);
    finalCreated = true;
    const verified = await verifyCandidateIntegrity(finalPath);
    await assertSourceStillClean(root, source);
    completed = true;
    return {
      ok: true,
      status: "MACHINE_CANDIDATE_PACKAGED",
      outputPath: finalPath,
      outputName: path.basename(finalPath),
      ...verified
    };
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    if (!completed) {
      const cleanupErrors = [];
      if (await exists(stagingPath)) {
        try {
          await removeNormalDirectory(stagingPath, resolvedOutputRoot);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (finalCreated && finalPath && await exists(finalPath)) {
        try {
          await removeNormalDirectory(finalPath, resolvedOutputRoot);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length) {
        const aggregate = new AggregateError(
          [...(workError ? [workError] : []), ...cleanupErrors],
          "Machine candidate packaging failed and temporary output cleanup was incomplete."
        );
        aggregate.code = "MACHINE_CANDIDATE_CLEANUP_FAILED";
        throw aggregate;
      }
    }
  }
}

async function inspectCommittedSnapshot(root, expectedCommit) {
  const [topLevel, head, objectFormat, tree] = await Promise.all([
    runGitText(root, ["rev-parse", "--show-toplevel"]),
    runGitText(root, ["rev-parse", "HEAD"]),
    runGitText(root, ["rev-parse", "--show-object-format"]),
    runGitBuffer(root, ["ls-tree", "-r", "-z", "--long", "--full-tree", expectedCommit])
  ]).catch(() => {
    throw candidatePackageError("MACHINE_CANDIDATE_GIT_SNAPSHOT_FAILED", "The committed Git source snapshot could not be read safely.");
  });
  if (canonicalPath(topLevel.trim()) !== canonicalPath(root)
    || head.trim().toLowerCase() !== expectedCommit.toLowerCase()) {
    throw candidatePackageError("MACHINE_CANDIDATE_SOURCE_CHANGED", "The Git source root or HEAD changed while candidate packaging started.");
  }
  const normalizedFormat = objectFormat.trim().toLowerCase();
  if (!["sha1", "sha256"].includes(normalizedFormat)) {
    throw candidatePackageError("MACHINE_CANDIDATE_GIT_FORMAT_UNSUPPORTED", "The Git object format is unsupported for exact candidate packaging.");
  }
  const files = parseGitTree(tree, normalizedFormat).filter((file) => shouldInclude(file.path) && !shouldExclude(file.path));
  validatePortableTrackedPaths(files);
  for (const required of INCLUDE_FILES) {
    if (!files.some((file) => file.path === required)) {
      throw candidatePackageError("MACHINE_CANDIDATE_ENTRY_MISSING", `Required tracked candidate entry is missing: ${required}`);
    }
  }
  for (const directory of INCLUDE_DIRECTORIES) {
    if (!files.some((file) => file.path.startsWith(`${directory}/`))) {
      throw candidatePackageError("MACHINE_CANDIDATE_ENTRY_MISSING", `Required tracked candidate directory is empty or missing: ${directory}`);
    }
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { objectFormat: normalizedFormat, files };
}

function parseGitTree(buffer, objectFormat) {
  const records = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0) continue;
    if (index > start) records.push(buffer.subarray(start, index));
    start = index + 1;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const expectedObjectLength = objectFormat === "sha256" ? 64 : 40;
  return records.map((record) => {
    const tab = record.indexOf(0x09);
    if (tab <= 0) throw candidatePackageError("MACHINE_CANDIDATE_GIT_TREE_INVALID", "The committed Git tree contains an invalid record.");
    const header = record.subarray(0, tab).toString("ascii");
    let relative;
    try {
      relative = decoder.decode(record.subarray(tab + 1));
    } catch {
      throw candidatePackageError("MACHINE_CANDIDATE_PATH_INVALID", "A tracked candidate path is not valid UTF-8.");
    }
    if (relative.includes("\ufeff")) {
      throw candidatePackageError("MACHINE_CANDIDATE_PATH_INVALID", "A tracked candidate path contains an unsafe byte-order mark.");
    }
    const matched = header.match(/^(100644|100755) blob ([a-f0-9]+)\s+(\d+)$/);
    if (!matched || matched[2].length !== expectedObjectLength || !Number.isSafeInteger(Number(matched[3]))) {
      throw candidatePackageError("MACHINE_CANDIDATE_GIT_ENTRY_UNSAFE", "The included Git tree contains a link, submodule, or unsupported object.");
    }
    return { mode: matched[1], objectId: matched[2], size: Number(matched[3]), path: relative };
  });
}

async function copyCommittedBlob(root, stagingRoot, file, objectFormat, remainingBytes) {
  const targetPath = path.join(stagingRoot, ...file.path.split("/"));
  if (file.size > MAX_FILE_BYTES || file.size > Math.max(0, remainingBytes)) {
    throw candidatePackageError("MACHINE_CANDIDATE_BUDGET_EXCEEDED", "Tracked candidate files exceed the bounded package size.");
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  let targetHandle;
  let child;
  let childExit;
  let childTimeout;
  let timedOut = false;
  let total = 0;
  let workError = null;
  try {
    targetHandle = await fs.open(targetPath, "wx", file.mode === "100755" ? 0o755 : 0o644);
    const objectHash = createHash(objectFormat);
    objectHash.update(Buffer.from(`blob ${file.size}\0`, "utf8"));
    const timeoutMs = gitBlobTimeoutMs(file.size);
    child = spawn("git", hermeticGitArguments(root, ["cat-file", "blob", file.objectId]), {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: hermeticGitEnvironment(),
      timeout: timeoutMs + GIT_PROCESS_KILL_FALLBACK_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stderr.resume();
    childExit = observeChildExit(child);
    childTimeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
      child.stdout.destroy(candidatePackageError(
        "MACHINE_CANDIDATE_GIT_TIMEOUT",
        `A committed Git blob exceeded its materialization deadline: ${file.path}`
      ));
    }, timeoutMs);
    childTimeout.unref?.();
    for await (const chunk of child.stdout) {
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > file.size || total > MAX_FILE_BYTES || total > remainingBytes) {
        terminateChild(child);
        throw candidatePackageError("MACHINE_CANDIDATE_GIT_BLOB_INVALID", "A committed Git blob exceeded its declared bounded size.");
      }
      objectHash.update(buffer);
      await writeAll(targetHandle, buffer, buffer.byteLength);
    }
    const exit = await childExit;
    if (timedOut) {
      throw candidatePackageError("MACHINE_CANDIDATE_GIT_TIMEOUT", `A committed Git blob exceeded its materialization deadline: ${file.path}`);
    }
    if (exit.error || exit.code !== 0 || total !== file.size || objectHash.digest("hex") !== file.objectId) {
      throw candidatePackageError("MACHINE_CANDIDATE_GIT_BLOB_INVALID", `A committed Git blob could not be materialized exactly: ${file.path}`);
    }
    await targetHandle.sync();
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    clearTimeout(childTimeout);
    const cleanupErrors = [];
    if (child && childExit) {
      try {
        await ensureChildExited(child, childExit);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (targetHandle) {
      try {
        await targetHandle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      const aggregate = new AggregateError(
        [...(workError ? [workError] : []), ...cleanupErrors],
        "Machine candidate Git materialization failed and its resources could not be fully released."
      );
      aggregate.code = "MACHINE_CANDIDATE_GIT_PROCESS_CLEANUP_FAILED";
      throw aggregate;
    }
  }
  return total;
}

function observeChildExit(child) {
  return new Promise((resolve) => {
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => resolve({ code, signal, error: spawnError }));
  });
}

async function ensureChildExited(child, exit) {
  if (child.exitCode === null && child.signalCode === null) terminateChild(child);
  let timer;
  try {
    const result = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(candidatePackageError(
          "MACHINE_CANDIDATE_GIT_PROCESS_CLEANUP_FAILED",
          "A Git materialization child did not exit after forced termination."
        )), GIT_PROCESS_EXIT_GRACE_MS);
        timer.unref?.();
      })
    ]);
    if (result.code === null && result.signal === null && !result.error) {
      throw candidatePackageError(
        "MACHINE_CANDIDATE_GIT_PROCESS_CLEANUP_FAILED",
        "A Git materialization child closed without a verifiable exit status."
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // ensureChildExited is the authority for deciding whether termination completed.
  }
}

function gitBlobTimeoutMs(fileSize) {
  return Math.min(
    GIT_BLOB_MAX_TIMEOUT_MS,
    GIT_BLOB_MIN_TIMEOUT_MS + Math.ceil(fileSize / GIT_BLOB_BYTES_PER_MS)
  );
}

async function writeAll(handle, buffer, length) {
  let offset = 0;
  while (offset < length) {
    const { bytesWritten } = await handle.write(buffer, offset, length - offset, null);
    if (!bytesWritten) throw candidatePackageError("MACHINE_CANDIDATE_COPY_FAILED", "A tracked candidate file could not be copied completely.");
    offset += bytesWritten;
  }
}

function shouldInclude(relative) {
  return INCLUDE_FILES.has(relative) || INCLUDE_DIRECTORIES.some((directory) => relative.startsWith(`${directory}/`));
}

function shouldExclude(relative) {
  const parts = relative.split("/").map(windowsCaseKey);
  if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part))) return true;
  const basename = parts.at(-1) || "";
  return EXCLUDED_FILES.has(basename)
    || basename === ".env"
    || basename.startsWith(".env.")
    || basename.endsWith(".local")
    || basename.endsWith(".log");
}

function windowsCaseKey(value) {
  return String(value).normalize("NFC").toLocaleLowerCase("en-US");
}

function validatePortableTrackedPaths(files) {
  const seen = new Map();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let length = 1; length <= segments.length; length += 1) {
      const relative = segments.slice(0, length).join("/");
      try {
        assertSafeCandidateRelativePath(relative);
      } catch {
        throw candidatePackageError("MACHINE_CANDIDATE_PATH_INVALID", "A tracked candidate path is not portable and safe for Windows.");
      }
      const key = windowsCaseKey(relative);
      const previous = seen.get(key);
      if (previous && previous !== relative) {
        throw candidatePackageError("MACHINE_CANDIDATE_PATH_COLLISION", "Tracked candidate paths collide under Windows case folding or Unicode normalization.");
      }
      seen.set(key, relative);
    }
  }
}

async function assertSourceStillClean(root, expected) {
  const current = await inspectSourceVersion(root);
  if (current.available !== true || current.dirty !== false
    || current.commit.toLowerCase() !== expected.commit.toLowerCase()) {
    throw candidatePackageError("MACHINE_CANDIDATE_SOURCE_CHANGED", "The source worktree or HEAD changed while the candidate was being packaged.");
  }
}

function assertCleanSource(version) {
  if (version.available !== true || !/^[0-9a-f]{40}$/i.test(version.commit) || version.dirty !== false) {
    throw candidatePackageError("MACHINE_CANDIDATE_SOURCE_NOT_CLEAN", "Create a machine candidate only from a clean Git commit.");
  }
}

async function writeHumanManifest(candidateRoot, { packageVersion, sourceCommit }) {
  const content = [
    "# CodeClaw Stage 4B Machine Candidate",
    "",
    `Package version: ${packageVersion}`,
    `Source commit: ${sourceCommit}`,
    "Source dirty: false",
    "Packaging status: integrity-verified snapshot; not by itself a completed Stage 4B machine gate.",
    "",
    `Authority: \`${CANDIDATE_AUTHORITY_FILENAME}\` plus \`${CANDIDATE_AUTHORITY_SHA256_FILENAME}\`.`,
    "The launcher verifies every candidate file before spawning the service or opening a browser.",
    "Only tracked blobs from the recorded Git commit are copied; ignored and untracked worktree files are not package inputs.",
    "SHA-256 detects candidate changes but is not a publisher signature if an attacker can replace the launcher and authority files together.",
    "",
    "Use `npm.cmd run stage4b:machine` in the source worktree as the single complete machine gate.",
    "Runtime state and the writable Demo are stored outside this candidate under the current user's local application-data directory.",
    "No source-worktree absolute path is recorded in this package.",
    ""
  ].join("\n");
  await fs.writeFile(path.join(candidateRoot, "PACKAGE_MANIFEST.md"), content, "utf8");
}

async function readJsonDocument(filePath) {
  const bytes = await fs.readFile(filePath);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw candidatePackageError("MACHINE_CANDIDATE_PACKAGE_JSON_INVALID", "package.json is not valid UTF-8.");
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw candidatePackageError("MACHINE_CANDIDATE_PACKAGE_JSON_INVALID", "package.json is not valid JSON.");
  }
}

async function assertOutputRoot(root, outputRoot) {
  if (!isInside(outputRoot, root) || outputRoot === root) {
    throw candidatePackageError("MACHINE_CANDIDATE_OUTPUT_UNSAFE", "Candidate output must stay inside the source project.");
  }
  const stat = await fs.lstat(outputRoot).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) {
    throw candidatePackageError("MACHINE_CANDIDATE_OUTPUT_UNSAFE", "Candidate output root must be a normal directory.");
  }
}

async function assertFinalOutput(outputRoot, finalPath, stagingPath) {
  if (finalPath === stagingPath || path.dirname(finalPath) !== outputRoot || !isInside(finalPath, outputRoot)) {
    throw candidatePackageError("MACHINE_CANDIDATE_OUTPUT_UNSAFE", "Final candidate output must be a direct child of the candidate output root.");
  }
}

async function assertNormalDirectoryPath(directory, code) {
  const [stat, realPath] = await Promise.all([fs.lstat(directory), fs.realpath(directory)]);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalPath(realPath) !== canonicalPath(directory)) {
    throw candidatePackageError(code, "Candidate output uses a linked or non-directory path.");
  }
}

async function removeNormalDirectory(target, outputRoot) {
  if (path.dirname(target) !== outputRoot) throw candidatePackageError("MACHINE_CANDIDATE_OUTPUT_UNSAFE", "Refusing to remove an output outside the candidate root.");
  await assertNormalDirectoryPath(target, "MACHINE_CANDIDATE_OUTPUT_UNSAFE");
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function runGitText(root, args) {
  return new Promise((resolve, reject) => {
    execFile("git", hermeticGitArguments(root, args), {
      cwd: root,
      windowsHide: true,
      shell: false,
      env: hermeticGitEnvironment(),
      timeout: GIT_METADATA_TIMEOUT_MS,
      killSignal: "SIGKILL",
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ""));
    });
  });
}

function runGitBuffer(root, args) {
  return new Promise((resolve, reject) => {
    execFile("git", hermeticGitArguments(root, args), {
      cwd: root,
      windowsHide: true,
      shell: false,
      env: hermeticGitEnvironment(),
      timeout: GIT_METADATA_TIMEOUT_MS,
      killSignal: "SIGKILL",
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(Buffer.from(stdout || []));
    });
  });
}

function parseArgs(args) {
  const options = { outputPath: "", force: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--out") options.outputPath = args[++index] || "";
    else if (argument.startsWith("--out=")) options.outputPath = argument.slice(6);
    else throw candidatePackageError("MACHINE_CANDIDATE_ARGUMENT_INVALID", `Unknown argument: ${argument}`);
  }
  return options;
}

function candidatePackageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

if (path.resolve(process.argv[1] || "") === scriptPath) {
  try {
    const result = await prepareMachineCandidate(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({
      ok: result.ok,
      status: result.status,
      outputName: result.outputName,
      candidateId: result.candidateId,
      packageVersion: result.packageVersion,
      sourceCommit: result.sourceCommit,
      fileCount: result.fileCount,
      totalBytes: result.totalBytes
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: String(error?.code || "MACHINE_CANDIDATE_FAILED"),
      error: String(error?.message || "Machine candidate preparation failed.").replace(/[A-Za-z]:\\[^\r\n]*/g, "[local path redacted]")
    }, null, 2));
    process.exitCode = 1;
  }
}
