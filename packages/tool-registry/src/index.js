import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { classifyToolCall } from "../../permission-engine/src/index.js";
import { loadGitignoreMatcher } from "../../shared/src/ignore-utils.js";
import { isSensitiveFile, isSkippedDirectory, relativePath } from "../../shared/src/path-utils.js";

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

  registerDefaults() {
    this.register("list_files", async () => listFiles(this.rootPath));
    this.register("read_file", async ({ path: filePath }) => readFileSafe(this.rootPath, filePath));
    this.register("search_code", async ({ query }) => searchCode(this.rootPath, query));
    this.register("git_status", async () => runGit(this.rootPath, ["status", "--short"]));
    this.register("git_diff", async () => runGit(this.rootPath, ["diff", "--"]));
    this.register("write_patch", async ({ path: filePath, content }) => writePatch(this.rootPath, filePath, content));
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
  return fs.readFile(absolutePath, "utf8");
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

async function writePatch(rootPath, filePath, content) {
  if (!filePath) throw new Error("Missing path.");
  if (typeof content !== "string") throw new Error("Missing content.");

  const absolutePath = resolveInside(rootPath, filePath);
  const rel = relativePath(rootPath, absolutePath);
  if (isSensitiveFile(path.basename(absolutePath))) throw new Error("Refusing to write sensitive file.");

  const isIgnored = await loadGitignoreMatcher(rootPath);
  if (isIgnored(rel, false)) throw new Error("Refusing to write ignored file.");

  let previous = "";
  let created = false;
  try {
    previous = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    created = true;
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return {
    path: rel,
    created,
    bytes: Buffer.byteLength(content, "utf8"),
    diff: createSimpleDiff(rel, previous, content)
  };
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
  const absolutePath = path.resolve(rootPath, filePath || "");
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes project root.");
  return absolutePath;
}
