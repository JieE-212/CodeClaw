import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { classifyToolCall } from "../../permission-engine/src/index.js";
import { atomicRemoveFile, atomicWriteFile, capturePathIdentity, patchWriteTemporaryPath, removeOwnedTemporaryFile } from "../../shared/src/atomic-file.js";
import { loadGitignoreMatcher } from "../../shared/src/ignore-utils.js";
import { isSensitiveFile, isSkippedDirectory, relativePath } from "../../shared/src/path-utils.js";
import { workspaceIdentityMatches, workspaceParentIdentityMatches } from "../../shared/src/workspace-identity.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 20000;
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\brmdir\b/i,
  /\brd\s+/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\b/i,
  /\bnpm\s+install\b/i,
  /\bpnpm\s+add\b/i,
  /\byarn\s+add\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpowershell\b/i,
  /\bcmd(?:\.exe)?\b/i
];

export class ToolRegistry {
  constructor({ rootPath, allowedCommands = [] }) {
    this.rootPath = path.resolve(rootPath);
    this.allowedCommands = normalizeAllowedCommands(allowedCommands);
    this.tools = new Map();
    this.registerDefaults();
  }

  register(name, handler) {
    this.tools.set(name, handler);
  }

  async call(name, args = {}, options = {}) {
    const permission = classifyToolCall(name, args);
    if (permission.requiresApproval && !options.approved) return { ok: false, permission, blocked: true, message: "Tool call requires approval." };
    const handler = this.tools.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return { ok: true, permission, result: await handler(args) };
  }

  async cleanupPatchTemporary({ path: filePath, transactionId, rootIdentity, parentIdentity, temporaryIdentity = null }) {
    await assertWorkspaceWriteIdentity(this.rootPath, filePath, rootIdentity, parentIdentity);
    const absolutePath = resolveInside(this.rootPath, filePath);
    await assertNoLinkedPathSegments(this.rootPath, absolutePath, "clean a patch temporary file");
    const temporaryPath = patchWriteTemporaryPath(absolutePath, transactionId);
    await assertNoLinkedPathSegments(this.rootPath, temporaryPath, "clean a patch temporary file");
    const directoryIdentity = await capturePathIdentity(path.dirname(temporaryPath), { requireDirectory: true });
    await assertNoLinkedPathSegments(this.rootPath, temporaryPath, "clean a patch temporary file");
    let currentTemporaryIdentity;
    try {
      currentTemporaryIdentity = await capturePathIdentity(temporaryPath, { requireFile: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (!validTemporaryIdentity(temporaryIdentity)
      || !temporaryIdentityMatches(currentTemporaryIdentity, temporaryIdentity)
      || currentTemporaryIdentity.nlink !== 1n) {
      const error = new Error("The patch temporary file cannot be proven to belong to this transaction. Cleanup was stopped.");
      error.code = "PATCH_TEMP_OWNERSHIP_UNKNOWN";
      error.status = 409;
      throw error;
    }
    await assertWorkspaceWriteIdentity(this.rootPath, filePath, rootIdentity, parentIdentity);
    await removeOwnedTemporaryFile(temporaryPath, { directoryIdentity, temporaryIdentity: currentTemporaryIdentity });
  }

  registerDefaults() {
    this.register("list_files", async () => listFiles(this.rootPath));
    this.register("read_file", async ({ path: filePath }) => readFileSafe(this.rootPath, filePath));
    this.register("search_code", async ({ query }) => searchCode(this.rootPath, query));
    this.register("git_status", async () => runGit(this.rootPath, ["status", "--short"]));
    this.register("git_diff", async () => runGit(this.rootPath, ["diff", "--"]));
    this.register("write_patch", async ({ path: filePath, content, expectedBaseline, remove = false, transactionId = "", rootIdentity = "", parentIdentity = "", onTemporaryReady = null }) => writePatch(this.rootPath, filePath, content, {
      expectedBaseline,
      remove,
      transactionId,
      rootIdentity,
      parentIdentity,
      onTemporaryReady
    }));
    this.register("run_command", async (args) => runCommand(this.rootPath, args, this.allowedCommands));
  }
}

async function listFiles(rootPath) {
  const output = [];
  const isIgnored = await loadGitignoreMatcher(rootPath);
  await walk(rootPath, rootPath, output, isIgnored);
  return output.slice(0, 500);
}

async function walk(rootPath, currentPath, output, isIgnored) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const rel = relativePath(rootPath, absolutePath);
    if (entry.isDirectory()) {
      if (isSkippedDirectory(entry.name) || isIgnored(rel, true)) continue;
      await walk(rootPath, absolutePath, output, isIgnored);
    } else if (entry.isFile() && !isSensitiveFile(entry.name) && !isIgnored(rel, false)) {
      output.push(rel);
    }
  }
}

async function readFileSafe(rootPath, filePath) {
  const absolutePath = resolveInside(rootPath, filePath);
  if (isSensitiveFile(path.basename(absolutePath))) throw new Error("Refusing to read sensitive file.");
  await assertNoLinkedPathSegments(rootPath, absolutePath, "read");
  return decodeUtf8(await fs.readFile(absolutePath), absolutePath);
}

async function searchCode(rootPath, query = "") {
  const files = await listFiles(rootPath);
  const normalizedQuery = String(query).toLowerCase();
  const matches = [];
  if (!normalizedQuery) return matches;

  for (const file of files.slice(0, 300)) {
    try {
      const content = await fs.readFile(path.join(rootPath, file), "utf8");
      const lineMatches = findLineMatches(content, normalizedQuery);
      if (lineMatches.length) matches.push({ path: file, matches: lineMatches, preview: lineMatches.map((item) => `${item.line}: ${item.text}`).join("\n").slice(0, 800) });
    } catch {}
  }
  return matches.slice(0, 20);
}

function findLineMatches(content, normalizedQuery) {
  const lines = String(content || "").split(/\r?\n/);
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const column = line.toLowerCase().indexOf(normalizedQuery);
    if (column === -1) continue;
    const before = lines.slice(Math.max(0, index - 2), index);
    const after = lines.slice(index + 1, Math.min(lines.length, index + 3));
    matches.push({
      line: index + 1,
      column: column + 1,
      text: line,
      before,
      after
    });
    if (matches.length >= 5) break;
  }
  return matches;
}

async function writePatch(rootPath, filePath, content, {
  expectedBaseline = null,
  remove = false,
  transactionId = "",
  rootIdentity = "",
  parentIdentity = "",
  onTemporaryReady = null
} = {}) {
  if (!filePath) throw new Error("Missing path.");
  if (!remove && typeof content !== "string") throw new Error("Missing content.");
  if (!validTransactionId(transactionId)) {
    const error = new Error("Direct writes require a patch transaction.");
    error.code = "PATCH_TRANSACTION_REQUIRED";
    error.status = 409;
    throw error;
  }

  await assertWorkspaceWriteIdentity(rootPath, filePath, rootIdentity, parentIdentity);
  const absolutePath = resolveInside(rootPath, filePath);
  const rel = relativePath(rootPath, absolutePath);
  if (isSensitiveFile(path.basename(absolutePath))) throw new Error("Refusing to write sensitive file.");
  if (rel.split("/").some((segment) => isSkippedDirectory(segment.toLowerCase()))) {
    const error = new Error("Refusing to write inside a protected project metadata or generated directory.");
    error.code = "PATCH_PROTECTED_PATH_REFUSED";
    error.status = 409;
    throw error;
  }
  await assertNoLinkedPathSegments(rootPath, absolutePath, "write");

  const isIgnored = await loadGitignoreMatcher(rootPath);
  if (isIgnored(rel, false)) throw new Error("Refusing to write ignored file.");

  const current = await readFileState(absolutePath);
  assertExpectedBaseline(expectedBaseline, current, rel);
  const previous = current.content;
  const created = !current.exists;
  const verifyCurrentBaseline = async () => {
    await assertWorkspaceWriteIdentity(rootPath, filePath, rootIdentity, parentIdentity);
    await assertNoLinkedPathSegments(rootPath, absolutePath, "write");
    if ((await loadGitignoreMatcher(rootPath))(rel, false)) throw new Error("Refusing to write ignored file.");
    assertExpectedBaseline(expectedBaseline, await readFileState(absolutePath), rel);
  };

  if (remove) {
    const removed = current.exists
      ? await atomicRemoveFile(absolutePath, { beforeRemove: verifyCurrentBaseline })
      : false;
    return {
      path: rel,
      created: false,
      removed,
      bytes: 0,
      diff: createSimpleDiff(rel, previous, "")
    };
  }

  await atomicWriteFile(absolutePath, content, {
    beforeReplace: verifyCurrentBaseline,
    onTemporaryReady,
    mode: current.mode ?? 0o600,
    ...(transactionId ? { temporaryPath: patchWriteTemporaryPath(absolutePath, transactionId) } : {})
  });
  await assertWorkspaceWriteIdentity(rootPath, filePath, rootIdentity, parentIdentity);
  const applied = await readFileState(absolutePath);
  if (!applied.exists || hashContent(applied.content) !== hashContent(content)) {
    const error = new Error(`Workspace file could not be verified after the write: ${rel}.`);
    error.code = "PATCH_WRITE_VERIFY_FAILED";
    error.status = 500;
    throw error;
  }
  return {
    path: rel,
    created,
    bytes: Buffer.byteLength(content, "utf8"),
    diff: createSimpleDiff(rel, previous, content)
  };
}

async function assertWorkspaceWriteIdentity(rootPath, filePath, rootIdentity, parentIdentity) {
  if (!validIdentityDigest(rootIdentity) || !validIdentityDigest(parentIdentity)) {
    const error = new Error("Patch writes require the reviewed workspace and parent-directory identities.");
    error.code = "PATCH_TRANSACTION_IDENTITY_REQUIRED";
    error.status = 409;
    throw error;
  }
  if (!(await workspaceIdentityMatches(rootPath, rootIdentity))) {
    const error = new Error("The workspace root changed after review. The write was stopped.");
    error.code = "PATCH_WORKSPACE_CHANGED";
    error.status = 409;
    throw error;
  }
  if (!(await workspaceParentIdentityMatches(rootPath, filePath, parentIdentity))) {
    const error = new Error("The target parent directory changed after review. The write was stopped.");
    error.code = "PATCH_PARENT_CHANGED";
    error.status = 409;
    throw error;
  }
}

function validIdentityDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function validTransactionId(value) {
  return typeof value === "string" && /^(apply|revert)-[a-z0-9-]{8,160}$/i.test(value);
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

function temporaryIdentityMatches(current, expected) {
  return String(current.dev) === expected.dev
    && String(current.ino) === expected.ino
    && String(current.birthtimeNs) === expected.birthtimeNs;
}

async function assertNoLinkedPathSegments(rootPath, absolutePath, action) {
  const rel = path.relative(rootPath, absolutePath);
  let current = rootPath;
  for (const segment of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        const error = new Error(`Refusing to ${action} through a symbolic link inside the project: ${relativePath(rootPath, current)}.`);
        error.code = "PATH_SYMLINK_REFUSED";
        error.status = 409;
        throw error;
      }
      if (current === absolutePath && stat.isFile() && stat.nlink > 1) {
        const error = new Error(`Refusing to ${action} a hard-linked file inside the project: ${relativePath(rootPath, current)}.`);
        error.code = "PATH_HARDLINK_REFUSED";
        error.status = 409;
        throw error;
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function readFileState(absolutePath) {
  try {
    const [buffer, stat] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);
    return { exists: true, content: decodeUtf8(buffer, absolutePath), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, content: "", mode: null };
    throw error;
  }
}

function decodeUtf8(buffer, filePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    const error = new Error(`Refusing to patch a file that is not valid UTF-8 text: ${filePath}.`);
    error.code = "PATCH_NON_UTF8_REFUSED";
    error.status = 409;
    throw error;
  }
}

function assertExpectedBaseline(expectedBaseline, current, rel) {
  if (!expectedBaseline) return;
  const validHash = typeof expectedBaseline.sha256 === "string" && /^[a-f0-9]{64}$/i.test(expectedBaseline.sha256);
  const matchesExistence = Boolean(expectedBaseline.exists) === current.exists;
  const matchesContent = !current.exists || (validHash && hashContent(current.content) === expectedBaseline.sha256.toLowerCase());
  if (matchesExistence && matchesContent) return;

  const error = new Error(`Workspace file changed before the write: ${rel}. Reread it and regenerate the patch before retrying.`);
  error.code = "PATCH_BASELINE_CONFLICT";
  error.status = 409;
  throw error;
}

export function hashContent(content) {
  return createHash("sha256").update(String(content), "utf8").digest("hex");
}

function createSimpleDiff(filePath, before, after) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@"];

  for (let index = 0; index < maxLines; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      if (oldLine !== undefined) lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) lines.push(`-${oldLine}`);
    if (newLine !== undefined) lines.push(`+${newLine}`);
    if (lines.length >= 240) {
      lines.push("... diff truncated ...");
      break;
    }
  }

  return lines.join("\n");
}

function splitLines(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  if (!normalized) return [];
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

async function runGit(rootPath, args) {
  const { stdout, stderr } = await execFileAsync("git", args, { cwd: rootPath, timeout: 10000 });
  return { stdout, stderr };
}

async function runCommand(rootPath, request = {}, allowedCommands) {
  const selected = selectAllowedCommand(request, allowedCommands);
  if (isDangerousCommand(selected.command)) throw new Error("Refusing to run dangerous command.");

  const parts = splitCommandLine(selected.command);
  if (!parts.length) throw new Error("Missing command.");

  const executable = resolveExecutable(parts[0]);
  const args = parts.slice(1);
  return executeCommand(rootPath, executable, args, selected.command, request.timeoutMs);
}

function normalizeAllowedCommands(commands = []) {
  return commands
    .map((item) => typeof item === "string" ? { command: item } : item)
    .filter((item) => item?.command)
    .map((item) => ({
      name: item.name || null,
      command: normalizeCommandLine(item.command),
      source: item.source || "allowlist"
    }));
}

function selectAllowedCommand(request, allowedCommands) {
  if (!allowedCommands.length) throw new Error("No commands are allowed for this repository.");

  const requested = normalizeRequestedCommand(request);
  const selected = allowedCommands.find((item) => {
    if (requested.name && item.name === requested.name) return true;
    return item.command === requested.command;
  });
  if (!selected) throw new Error(`Command is not allowed: ${requested.command || requested.name || "unknown"}`);
  return selected;
}

function normalizeRequestedCommand(request = {}) {
  if (request.name) return { name: request.name, command: "" };
  const command = request.args?.length ? [request.command, ...request.args].join(" ") : request.command;
  if (!command) throw new Error("Missing command.");
  return { name: null, command: normalizeCommandLine(command) };
}

function normalizeCommandLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isDangerousCommand(command) {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function splitCommandLine(command) {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match = pattern.exec(command);
  while (match) {
    parts.push(match[1] ?? match[2] ?? match[0]);
    match = pattern.exec(command);
  }
  return parts;
}

function resolveExecutable(executable) {
  if (process.platform !== "win32") return executable;
  if (["npm", "pnpm", "yarn"].includes(executable)) return `${executable}.cmd`;
  return executable;
}

function executeCommand(rootPath, command, args, commandLine, timeoutMs = COMMAND_TIMEOUT_MS) {
  const startedAt = Date.now();
  const timeout = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 50), COMMAND_TIMEOUT_MS) : COMMAND_TIMEOUT_MS;

  return new Promise((resolve) => {
    const spawnTarget = command.endsWith(".cmd") && process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
    const spawnArgs = spawnTarget === command ? args : ["/d", "/s", "/c", command, ...args];
    const child = spawn(spawnTarget, spawnArgs, { cwd: rootPath, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);

    child.stdout?.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ command: commandLine, stdout, stderr: appendOutput(stderr, error.message), exitCode: null, durationMs: Date.now() - startedAt, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ command: commandLine, stdout, stderr, exitCode: timedOut ? null : code, durationMs: Date.now() - startedAt, timedOut });
    });
  });
}

function appendOutput(current, chunk) {
  const next = current + String(chunk);
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next;
}

function resolveInside(rootPath, filePath) {
  assertPortableProjectPath(filePath);
  const absolutePath = path.resolve(rootPath, filePath || "");
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes project root.");
  return absolutePath;
}

function assertPortableProjectPath(filePath) {
  const value = String(filePath || "").replaceAll("\\", "/");
  if (!value || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value)) throw new Error("Path must be a relative project file.");
  const segments = value.split("/");
  for (const segment of segments) {
    const stem = segment.split(".")[0];
    if (segment === "..") throw new Error("Path escapes project root.");
    if (!segment || segment === "." || segment.includes(":")) throw new Error("Path contains an unsafe segment.");
    if (/[. ]$/.test(segment)) throw new Error("Path cannot end with a dot or space.");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) throw new Error("Path uses a reserved Windows device name.");
  }
}
