import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { classifyToolCall } from "../../permission-engine/src/index.js";
import { atomicRemoveFile, atomicWriteFile, capturePathIdentity, patchWriteTemporaryPath, removeOwnedTemporaryFile } from "../../shared/src/atomic-file.js";
import { createStrictIgnoreMatcher, isPathIgnoredStrict } from "../../shared/src/ignore-utils.js";
import { isProtectedDirectory, isSensitiveFile, relativePath } from "../../shared/src/path-utils.js";
import { RUNTIME_BUDGETS, boundedBudgetValue, readFileHandleBounded, runtimeBudgetError } from "../../shared/src/runtime-budget.js";
import { openStableDirectory } from "../../shared/src/stable-directory.js";
import { captureWorkspaceIdentity, workspaceIdentityMatches, workspaceParentIdentityMatches } from "../../shared/src/workspace-identity.js";
import { throwIfAborted } from "../../shared/src/operation-manager.js";
import { processSpawnOptions, terminateProcessTree } from "../../shared/src/process-tree.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30000;
const MAX_OUTPUT_CHARS = 20000;
const BUDGETED_TOOL_RESULT = Symbol("budgeted-tool-result");
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
  constructor({ rootPath, rootIdentity = "", allowedCommands = [], runtimeBudget = {} }) {
    this.rootPath = path.resolve(rootPath);
    this.rootIdentity = String(rootIdentity || "");
    this.allowedCommands = normalizeAllowedCommands(allowedCommands);
    this.runtimeBudget = normalizeToolBudget(runtimeBudget);
    this.tools = new Map();
    this.registerDefaults();
  }

  register(name, handler) {
    this.tools.set(name, handler);
  }

  async call(name, args = {}, options = {}) {
    const signal = options.signal || null;
    throwIfAborted(signal);
    const permission = classifyToolCall(name, args);
    if (permission.requiresApproval && options.approved !== true) return { ok: false, permission, blocked: true, message: "Tool call requires approval." };
    const handler = this.tools.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    await assertWorkspaceReadIdentity(this.rootPath, this.rootIdentity);
    const execution = await handler(args, { signal });
    throwIfAborted(signal);
    if (execution?.[BUDGETED_TOOL_RESULT]) {
      return {
        ok: true,
        permission,
        result: execution.value,
        budget: execution.budget,
        truncated: execution.budget?.truncated === true
      };
    }
    return { ok: true, permission, result: execution };
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
    this.register("list_files", async (_args, { signal }) => listFiles(this.rootPath, this.rootIdentity, this.runtimeBudget, signal));
    this.register("read_file", async ({ path: filePath }, { signal }) => readFileBudgeted(this.rootPath, filePath, this.rootIdentity, this.runtimeBudget, signal));
    this.register("search_code", async ({ query }, { signal }) => searchCode(this.rootPath, query, this.rootIdentity, this.runtimeBudget, signal));
    this.register("git_status", async (_args, { signal }) => runGit(this.rootPath, ["status", "--short", "--untracked-files=normal", "--", "."], this.rootIdentity, signal));
    this.register("git_diff", async (_args, { signal }) => runGit(this.rootPath, ["diff", "--no-ext-diff", "--no-textconv", "--", "."], this.rootIdentity, signal));
    this.register("write_patch", async ({ path: filePath, content, expectedBaseline, remove = false, transactionId = "", rootIdentity = "", parentIdentity = "", onTemporaryReady = null }) => writePatch(this.rootPath, filePath, content, {
      expectedBaseline,
      remove,
      transactionId,
      rootIdentity,
      parentIdentity,
      onTemporaryReady
    }));
    this.register("run_command", async (args, { signal }) => runCommand(this.rootPath, args, this.allowedCommands, this.rootIdentity, signal));
  }
}

async function assertWorkspaceReadIdentity(rootPath, rootIdentity) {
  let current;
  try {
    current = await captureWorkspaceIdentity(rootPath);
  } catch {
    current = null;
  }
  if (!current || rootIdentity && (!validIdentityDigest(rootIdentity) || current.digest !== rootIdentity)) {
    const error = new Error("The workspace root changed after it was selected. The tool call was stopped.");
    error.code = "WORKSPACE_IDENTITY_CHANGED";
    error.status = 409;
    throw error;
  }
  return current;
}

async function listFiles(rootPath, rootIdentity = "", runtimeBudget = normalizeToolBudget(), signal = null) {
  throwIfAborted(signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  const collection = await collectFiles(rootPath, rootIdentity, {
    maxFiles: runtimeBudget.maxListFiles,
    maxEntries: runtimeBudget.maxTraversalEntries,
    maxDirectories: runtimeBudget.maxTraversalDirectories,
    maxDepth: runtimeBudget.maxTraversalDepth,
    maxIgnoreFiles: runtimeBudget.maxIgnoreFiles,
    maxIgnoreFileBytes: runtimeBudget.maxIgnoreFileBytes,
    maxIgnoreTotalBytes: runtimeBudget.maxIgnoreTotalBytes,
    maxIgnoreRules: runtimeBudget.maxIgnoreRules,
    maxIgnoreRuleEvaluations: runtimeBudget.maxIgnoreRuleEvaluations
  }, "tool-list-files", signal);
  throwIfAborted(signal);
  await collection.ignoreSession.verify();
  throwIfAborted(signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  return budgetedToolResult(collection.files, traversalBudgetEvidence(collection, "tool-list-files"));
}

async function collectFiles(rootPath, rootIdentity, limits, operation, signal = null) {
  const ignoreSession = createStrictIgnoreMatcher(rootPath, {
    maxFiles: limits.maxIgnoreFiles,
    maxFileBytes: limits.maxIgnoreFileBytes,
    maxTotalBytes: limits.maxIgnoreTotalBytes,
    maxRules: limits.maxIgnoreRules,
    maxRuleEvaluations: limits.maxIgnoreRuleEvaluations,
    signal
  });
  const state = {
    files: [],
    limits,
    operation,
    reasons: new Set(),
    used: { entriesVisited: 0, directoriesVisited: 0, maxDepthReached: 0, nonTextFilesSkipped: 0 },
    ignoreSession,
    isIgnored: ignoreSession.isIgnoredTraversed,
    signal
  };
  throwIfAborted(signal);
  await walk(rootPath, rootPath, state, rootIdentity, 0);
  throwIfAborted(signal);
  return state;
}

async function walk(rootPath, currentPath, state, rootIdentity, depth) {
  throwIfAborted(state.signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  if (state.used.entriesVisited >= state.limits.maxEntries) {
    state.reasons.add("max-entries");
    return;
  }
  if (state.used.directoriesVisited >= state.limits.maxDirectories) {
    state.reasons.add("max-directories");
    return;
  }
  state.used.directoriesVisited += 1;
  state.used.maxDepthReached = Math.max(state.used.maxDepthReached, depth);

  const entries = [];
  const openedDirectory = await openStableDirectory(rootPath, currentPath, "traverse tool files", state.signal);
  for await (const entry of openedDirectory.directory) {
    throwIfAborted(state.signal);
    if (state.used.entriesVisited >= state.limits.maxEntries) {
      state.reasons.add("max-entries");
      break;
    }
    state.used.entriesVisited += 1;
    entries.push(entry);
  }
  throwIfAborted(state.signal);
  await openedDirectory.verify();
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    throwIfAborted(state.signal);
    await openedDirectory.verify();
    try {
    if (state.files.length >= state.limits.maxFiles) {
      state.reasons.add("max-files");
      break;
    }
    const absolutePath = path.join(currentPath, entry.name);
    const rel = relativePath(rootPath, absolutePath);
    if (entry.isDirectory()) {
      if (isProtectedDirectory(entry.name) || await state.isIgnored(rel, true)) continue;
      throwIfAborted(state.signal);
      if (depth >= state.limits.maxDepth) {
        state.reasons.add("max-depth");
        continue;
      }
      await walk(rootPath, absolutePath, state, rootIdentity, depth + 1);
    } else if (entry.isFile() && !isSensitiveFile(entry.name) && !(await state.isIgnored(rel, false))) {
      throwIfAborted(state.signal);
      state.files.push(rel);
    }
    } finally {
      throwIfAborted(state.signal);
      await openedDirectory.verify();
    }
  }
}

async function readFileBudgeted(rootPath, filePath, rootIdentity, runtimeBudget, signal = null) {
  throwIfAborted(signal);
  const ignoreSession = createStrictIgnoreMatcher(rootPath, {
    maxFiles: runtimeBudget.maxIgnoreFiles,
    maxFileBytes: runtimeBudget.maxIgnoreFileBytes,
    maxTotalBytes: runtimeBudget.maxIgnoreTotalBytes,
    maxRules: runtimeBudget.maxIgnoreRules,
    maxRuleEvaluations: runtimeBudget.maxIgnoreRuleEvaluations,
    signal
  });
  const read = await readFileSafe(rootPath, filePath, rootIdentity, {
    maxBytes: runtimeBudget.maxReadBytes,
    operation: "tool-read-file",
    includeMetadata: true,
    ignoreMatcher: ignoreSession.isIgnored,
    signal
  });
  throwIfAborted(signal);
  await ignoreSession.verify();
  const ignore = ignoreSession.evidence();
  return budgetedToolResult(read.content, {
    operation: "tool-read-file",
    limits: {
      maxBytes: runtimeBudget.maxReadBytes,
      maxIgnoreFiles: runtimeBudget.maxIgnoreFiles,
      maxIgnoreFileBytes: runtimeBudget.maxIgnoreFileBytes,
      maxIgnoreTotalBytes: runtimeBudget.maxIgnoreTotalBytes,
      maxIgnoreRules: runtimeBudget.maxIgnoreRules,
      maxIgnoreRuleEvaluations: runtimeBudget.maxIgnoreRuleEvaluations
    },
    used: {
      bytesRead: read.byteLength,
      ignoreFilesRead: ignore.used.filesRead,
      ignoreBytesRead: ignore.used.bytesRead,
      ignoreIdentityChecks: ignore.used.identityChecks,
      ignoreCacheEntries: ignore.used.cacheEntries,
      ignoreRulesLoaded: ignore.used.rulesLoaded,
      ignoreRuleEvaluations: ignore.used.ruleEvaluations
    },
    truncated: false,
    reasons: []
  });
}

async function readFileSafe(rootPath, filePath, rootIdentity = "", options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  const absolutePath = resolveInside(rootPath, filePath);
  const rel = relativePath(rootPath, absolutePath);
  if (rel.split("/").slice(0, -1).some(isProtectedDirectory)) {
    const error = new Error("Refusing to read protected project metadata or generated content.");
    error.code = "READ_PROTECTED_PATH_REFUSED";
    error.status = 409;
    throw error;
  }
  if (isSensitiveFile(path.basename(absolutePath))) throw new Error("Refusing to read sensitive file.");
  await assertNoLinkedPathSegments(rootPath, absolutePath, "read");
  throwIfAborted(signal);
  const ignored = options.ignoreMatcher
    ? await options.ignoreMatcher(rel, false)
    : await isPathIgnoredStrict(rootPath, rel, false);
  if (ignored) {
    const error = new Error("Refusing to read an ignored file.");
    error.code = "READ_IGNORED_PATH_REFUSED";
    error.status = 409;
    throw error;
  }
  throwIfAborted(signal);
  const maxBytes = options.maxBytes || RUNTIME_BUDGETS.toolRegistry.maxReadBytes;
  const raw = await readStableRegularFile(rootPath, absolutePath, {
    maxBytes,
    operation: options.operation || "tool-read-file",
    signal
  });
  throwIfAborted(signal);
  let content;
  try {
    content = decodeUtf8(raw, absolutePath);
  } catch (error) {
    error.bytesRead = raw.byteLength;
    throw error;
  }
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  throwIfAborted(signal);
  return options.includeMetadata ? { content, byteLength: raw.byteLength } : content;
}

async function searchCode(rootPath, query = "", rootIdentity = "", runtimeBudget = normalizeToolBudget(), signal = null) {
  throwIfAborted(signal);
  const collection = await collectFiles(rootPath, rootIdentity, {
    maxFiles: runtimeBudget.maxSearchFiles,
    maxEntries: runtimeBudget.maxTraversalEntries,
    maxDirectories: runtimeBudget.maxTraversalDirectories,
    maxDepth: runtimeBudget.maxTraversalDepth,
    maxIgnoreFiles: runtimeBudget.maxIgnoreFiles,
    maxIgnoreFileBytes: runtimeBudget.maxIgnoreFileBytes,
    maxIgnoreTotalBytes: runtimeBudget.maxIgnoreTotalBytes,
    maxIgnoreRules: runtimeBudget.maxIgnoreRules,
    maxIgnoreRuleEvaluations: runtimeBudget.maxIgnoreRuleEvaluations
  }, "tool-search-code", signal);
  const normalizedQuery = String(query).toLowerCase();
  const matches = [];
  const reasons = new Set(collection.reasons);
  const used = {
    ...collection.used,
    candidateFiles: collection.files.length,
    filesRead: 0,
    bytesRead: 0,
    oversizedFilesSkipped: 0,
    unreadableFilesSkipped: 0,
    resultsReturned: 0,
    resultBytes: 2
  };
  if (!normalizedQuery) {
    throwIfAborted(signal);
    await collection.ignoreSession.verify();
    attachIgnoreUsage(used, collection);
    return budgetedToolResult(matches, searchBudgetEvidence(runtimeBudget, used, reasons));
  }

  for (const file of collection.files) {
    throwIfAborted(signal);
    if (matches.length >= runtimeBudget.maxSearchResults) {
      reasons.add("max-results");
      break;
    }
    const remainingBytes = runtimeBudget.maxSearchTotalBytes - used.bytesRead;
    if (remainingBytes <= 0) {
      reasons.add("max-total-read-bytes");
      break;
    }
    try {
      const read = await readFileSafe(rootPath, file, rootIdentity, {
        maxBytes: Math.min(runtimeBudget.maxReadBytes, remainingBytes),
        operation: "tool-search-code",
        includeMetadata: true,
        ignoreMatcher: collection.isIgnored,
        signal
      });
      throwIfAborted(signal);
      used.filesRead += 1;
      used.bytesRead += read.byteLength;
      const lineMatches = findLineMatches(read.content, normalizedQuery, runtimeBudget.maxMatchesPerFile, runtimeBudget.maxSearchLineChars);
      if (lineMatches.length) {
        const match = {
          path: file,
          matches: lineMatches,
          preview: lineMatches.map((item) => `${item.line}: ${item.text}`).join("\n").slice(0, runtimeBudget.maxSearchPreviewChars)
        };
        const resultBytes = Buffer.byteLength(JSON.stringify(match), "utf8") + (matches.length ? 1 : 0);
        if (used.resultBytes + resultBytes > runtimeBudget.maxSearchResultBytes) {
          reasons.add("max-result-bytes");
          break;
        }
        matches.push(match);
        used.resultBytes += resultBytes;
      }
    } catch (error) {
      throwIfAborted(signal);
      if (error.code === "TOOL_READ_FILE_TOO_LARGE") {
        if ((error.runtimeBudget?.observed || 0) > runtimeBudget.maxReadBytes) {
          used.oversizedFilesSkipped += 1;
          reasons.add("max-file-bytes");
          continue;
        }
        reasons.add("max-total-read-bytes");
        break;
      }
      if (error.code === "WORKSPACE_IDENTITY_CHANGED") throw error;
      if (String(error.code || "").startsWith("GITIGNORE_")) throw error;
      if (error.code === "PATCH_NON_UTF8_REFUSED") {
        used.filesRead += 1;
        used.bytesRead += Number.isSafeInteger(error.bytesRead) ? error.bytesRead : 0;
        used.nonTextFilesSkipped += 1;
        continue;
      }
      used.unreadableFilesSkipped += 1;
      reasons.add("unreadable-files");
    }
  }
  throwIfAborted(signal);
  await collection.ignoreSession.verify();
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  used.resultsReturned = matches.length;
  attachIgnoreUsage(used, collection);
  return budgetedToolResult(matches, searchBudgetEvidence(runtimeBudget, used, reasons));
}

function findLineMatches(content, normalizedQuery, maxMatches, maxLineChars) {
  const lines = String(content || "").split(/\r?\n/);
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const column = line.toLowerCase().indexOf(normalizedQuery);
    if (column === -1) continue;
    const matchWindow = boundedMatchedLine(line, column, maxLineChars);
    const before = lines.slice(Math.max(0, index - 2), index).map((item) => boundedSearchLine(item, maxLineChars));
    const after = lines.slice(index + 1, Math.min(lines.length, index + 3)).map((item) => boundedSearchLine(item, maxLineChars));
    matches.push({
      line: index + 1,
      column: column + 1,
      text: matchWindow.text,
      textStartColumn: matchWindow.start + 1,
      textTruncated: matchWindow.truncated,
      before,
      after
    });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

function boundedSearchLine(value, maxChars) {
  return String(value || "").slice(0, maxChars);
}

function boundedMatchedLine(value, matchColumn, maxChars) {
  const line = String(value || "");
  if (line.length <= maxChars) return { text: line, start: 0, truncated: false };
  const preferredStart = Math.max(0, matchColumn - Math.floor(maxChars / 3));
  const start = Math.min(preferredStart, line.length - maxChars);
  return { text: line.slice(start, start + maxChars), start, truncated: true };
}

function attachIgnoreUsage(used, collection) {
  const ignore = collection.ignoreSession.evidence().used;
  used.ignoreFilesRead = ignore.filesRead;
  used.ignoreBytesRead = ignore.bytesRead;
  used.ignoreIdentityChecks = ignore.identityChecks;
  used.ignoreCacheEntries = ignore.cacheEntries;
  used.ignoreRulesLoaded = ignore.rulesLoaded;
  used.ignoreRuleEvaluations = ignore.ruleEvaluations;
}

async function readStableRegularFile(rootPath, absolutePath, { maxBytes, operation, signal = null }) {
  throwIfAborted(signal);
  await assertNoLinkedPathSegments(rootPath, absolutePath, "read");
  const expected = await fs.lstat(absolutePath, { bigint: true });
  if (!expected.isFile() || expected.isSymbolicLink() || expected.nlink !== 1n) {
    throw toolError("READ_PATH_CHANGED", "The file selected for reading is linked or is not a normal file.");
  }
  assertToolReadWithinBudget(expected.size, maxBytes, operation);

  const handle = await fs.open(absolutePath, "r");
  try {
    throwIfAborted(signal);
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFileStat(expected, opened) || !opened.isFile() || opened.nlink !== 1n) {
      throw toolError("READ_PATH_CHANGED", "The file changed identity while it was opened for reading.");
    }
    assertToolReadWithinBudget(opened.size, maxBytes, operation);
    const bounded = await readFileHandleBounded(handle, maxBytes);
    throwIfAborted(signal);
    if (bounded.exceeded) assertToolReadWithinBudget(BigInt(bounded.byteLength), maxBytes, operation);
    const [afterHandle, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(absolutePath, { bigint: true })
    ]);
    await assertNoLinkedPathSegments(rootPath, absolutePath, "read");
    throwIfAborted(signal);
    if (!sameStableFileStat(opened, afterHandle)
      || !sameStableFileStat(opened, afterPath)
      || !afterPath.isFile()
      || afterPath.isSymbolicLink()
      || afterPath.nlink !== 1n
      || BigInt(bounded.byteLength) !== afterHandle.size) {
      throw toolError("READ_PATH_CHANGED", "The file or one of its parent directories changed while it was being read.");
    }
    return bounded.buffer;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  }
}

function normalizeToolBudget(options = {}) {
  const hard = RUNTIME_BUDGETS.toolRegistry;
  return {
    maxListFiles: boundedBudgetValue(options.maxListFiles, hard.maxListFiles),
    maxTraversalEntries: boundedBudgetValue(options.maxTraversalEntries, hard.maxTraversalEntries),
    maxTraversalDirectories: boundedBudgetValue(options.maxTraversalDirectories, hard.maxTraversalDirectories),
    maxTraversalDepth: boundedBudgetValue(options.maxTraversalDepth, hard.maxTraversalDepth, hard.maxTraversalDepth, 0),
    maxReadBytes: boundedBudgetValue(options.maxReadBytes, hard.maxReadBytes),
    maxSearchFiles: boundedBudgetValue(options.maxSearchFiles, hard.maxSearchFiles),
    maxSearchTotalBytes: boundedBudgetValue(options.maxSearchTotalBytes, hard.maxSearchTotalBytes),
    maxSearchResults: boundedBudgetValue(options.maxSearchResults, hard.maxSearchResults),
    maxMatchesPerFile: boundedBudgetValue(options.maxMatchesPerFile, hard.maxMatchesPerFile),
    maxSearchPreviewChars: boundedBudgetValue(options.maxSearchPreviewChars, hard.maxSearchPreviewChars),
    maxSearchLineChars: boundedBudgetValue(options.maxSearchLineChars, hard.maxSearchLineChars),
    maxSearchResultBytes: boundedBudgetValue(options.maxSearchResultBytes, hard.maxSearchResultBytes, hard.maxSearchResultBytes, 2),
    maxIgnoreFiles: boundedBudgetValue(options.maxIgnoreFiles, hard.maxIgnoreFiles),
    maxIgnoreFileBytes: boundedBudgetValue(options.maxIgnoreFileBytes, hard.maxIgnoreFileBytes),
    maxIgnoreTotalBytes: boundedBudgetValue(options.maxIgnoreTotalBytes, hard.maxIgnoreTotalBytes),
    maxIgnoreRules: boundedBudgetValue(options.maxIgnoreRules, hard.maxIgnoreRules),
    maxIgnoreRuleEvaluations: boundedBudgetValue(options.maxIgnoreRuleEvaluations, hard.maxIgnoreRuleEvaluations)
  };
}

function budgetedToolResult(value, budget) {
  return { [BUDGETED_TOOL_RESULT]: true, value, budget };
}

function traversalBudgetEvidence(collection, operation) {
  const reasons = [...collection.reasons].sort();
  const ignore = collection.ignoreSession.evidence().used;
  return {
    operation,
    limits: { ...collection.limits },
    used: {
      ...collection.used,
      filesCollected: collection.files.length,
      ignoreFilesRead: ignore.filesRead,
      ignoreBytesRead: ignore.bytesRead,
      ignoreIdentityChecks: ignore.identityChecks,
      ignoreCacheEntries: ignore.cacheEntries,
      ignoreRulesLoaded: ignore.rulesLoaded,
      ignoreRuleEvaluations: ignore.ruleEvaluations
    },
    truncated: reasons.length > 0,
    reasons
  };
}

function searchBudgetEvidence(runtimeBudget, used, reasons) {
  const sortedReasons = [...reasons].sort();
  return {
    operation: "tool-search-code",
    limits: {
      maxFiles: runtimeBudget.maxSearchFiles,
      maxEntries: runtimeBudget.maxTraversalEntries,
      maxDirectories: runtimeBudget.maxTraversalDirectories,
      maxDepth: runtimeBudget.maxTraversalDepth,
      maxFileBytes: runtimeBudget.maxReadBytes,
      maxTotalReadBytes: runtimeBudget.maxSearchTotalBytes,
      maxResults: runtimeBudget.maxSearchResults,
      maxMatchesPerFile: runtimeBudget.maxMatchesPerFile,
      maxPreviewChars: runtimeBudget.maxSearchPreviewChars,
      maxLineChars: runtimeBudget.maxSearchLineChars,
      maxResultBytes: runtimeBudget.maxSearchResultBytes,
      maxIgnoreFiles: runtimeBudget.maxIgnoreFiles,
      maxIgnoreFileBytes: runtimeBudget.maxIgnoreFileBytes,
      maxIgnoreTotalBytes: runtimeBudget.maxIgnoreTotalBytes,
      maxIgnoreRules: runtimeBudget.maxIgnoreRules,
      maxIgnoreRuleEvaluations: runtimeBudget.maxIgnoreRuleEvaluations
    },
    used,
    truncated: sortedReasons.length > 0,
    reasons: sortedReasons
  };
}

function assertToolReadWithinBudget(size, maxBytes, operation) {
  if (size <= BigInt(maxBytes)) return;
  throw runtimeBudgetError(
    "TOOL_READ_FILE_TOO_LARGE",
    `CodeClaw refused to read a file larger than the ${maxBytes}-byte ${operation} budget.`,
    { operation, limit: maxBytes, observed: safeBigIntNumber(size) }
  );
}

function safeBigIntNumber(value) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function sameStableFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
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
  if (rel.split("/").slice(0, -1).some(isProtectedDirectory)) {
    const error = new Error("Refusing to write inside a protected project metadata or generated directory.");
    error.code = "PATCH_PROTECTED_PATH_REFUSED";
    error.status = 409;
    throw error;
  }
  if (isSensitiveFile(path.basename(absolutePath))) throw new Error("Refusing to write sensitive file.");
  await assertNoLinkedPathSegments(rootPath, absolutePath, "write");

  if (await isPathIgnoredStrict(rootPath, rel, false)) throw new Error("Refusing to write ignored file.");

  const current = await readFileState(absolutePath);
  assertExpectedBaseline(expectedBaseline, current, rel);
  const previous = current.content;
  const created = !current.exists;
  const verifyCurrentBaseline = async () => {
    await assertWorkspaceWriteIdentity(rootPath, filePath, rootIdentity, parentIdentity);
    await assertNoLinkedPathSegments(rootPath, absolutePath, "write");
    if (await isPathIgnoredStrict(rootPath, rel, false)) throw new Error("Refusing to write ignored file.");
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
  const rootStat = await fs.lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    const error = new Error(`Refusing to ${action} through a linked or non-directory workspace root.`);
    error.code = "PATH_SYMLINK_REFUSED";
    error.status = 409;
    throw error;
  }
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

async function runGit(rootPath, args, rootIdentity = "", signal = null) {
  throwIfAborted(signal);
  const realRoot = (await assertWorkspaceReadIdentity(rootPath, rootIdentity)).rootPath;
  const env = safeGitEnvironment(realRoot);
  let topLevel;
  try {
    const result = await execFileAsync("git", ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], {
      cwd: realRoot,
      timeout: 10000,
      env,
      ...(signal ? { signal } : {})
    });
    throwIfAborted(signal);
    topLevel = await fs.realpath(path.resolve(realRoot, result.stdout.trim()));
    throwIfAborted(signal);
  } catch (error) {
    throwIfAborted(signal);
    throw toolError("GIT_WORKSPACE_ROOT_REQUIRED", "Git metadata was not found at this workspace root. CodeClaw will not discover a repository from a parent directory.");
  }
  if (!sameCanonicalPath(topLevel, realRoot)) {
    throw toolError("GIT_WORKSPACE_ROOT_REQUIRED", "Git metadata belongs to a parent or different workspace. CodeClaw refused to cross the active workspace boundary.");
  }

  let output;
  try {
    output = await execFileAsync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd: realRoot,
      timeout: 10000,
      env,
      ...(signal ? { signal } : {})
    });
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  throwIfAborted(signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  throwIfAborted(signal);
  return { stdout: output.stdout, stderr: output.stderr };
}

function safeGitEnvironment(rootPath) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")));
  return {
    ...env,
    GIT_CEILING_DIRECTORIES: path.dirname(rootPath),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_EXTERNAL_DIFF: "",
    GIT_TERMINAL_PROMPT: "0"
  };
}

function sameCanonicalPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function toolError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function runCommand(rootPath, request = {}, allowedCommands, rootIdentity = "", signal = null) {
  throwIfAborted(signal);
  const current = await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  const selected = selectAllowedCommand(request, allowedCommands);
  if (isDangerousCommand(selected.command)) throw new Error("Refusing to run dangerous command.");

  const parts = splitCommandLine(selected.command);
  if (!parts.length) throw new Error("Missing command.");

  const executable = resolveExecutable(parts[0]);
  const args = parts.slice(1);
  throwIfAborted(signal);
  const result = await executeCommand(current.rootPath, executable, args, selected.command, request.timeoutMs, signal);
  throwIfAborted(signal);
  await assertWorkspaceReadIdentity(rootPath, rootIdentity);
  throwIfAborted(signal);
  return result;
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

function executeCommand(rootPath, command, args, commandLine, timeoutMs = COMMAND_TIMEOUT_MS, signal = null) {
  throwIfAborted(signal);
  const startedAt = Date.now();
  const timeout = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 50), COMMAND_TIMEOUT_MS) : COMMAND_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const spawnTarget = command.endsWith(".cmd") && process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : command;
    const spawnArgs = spawnTarget === command ? args : ["/d", "/s", "/c", command, ...args];
    const child = spawn(spawnTarget, spawnArgs, processSpawnOptions({ cwd: rootPath }));
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationPromise = null;
    let terminationTrigger = null;
    let terminationOperationError = null;

    const onStdout = (chunk) => {
      stdout = appendOutput(stdout, chunk);
    };
    const onStderr = (chunk) => {
      stderr = appendOutput(stderr, chunk);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
    };
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const commandResult = ({ exitCode, timedOut, treeTermination = null }) => ({
      command: commandLine,
      stdout,
      stderr,
      exitCode,
      durationMs: Date.now() - startedAt,
      timedOut,
      treeTermination
    });
    const requestTermination = (trigger, operationError = null) => {
      if (settled) return;
      if (trigger === "abort") {
        terminationTrigger = "abort";
        terminationOperationError = operationError;
      } else if (!terminationTrigger) {
        terminationTrigger = trigger;
      }
      if (terminationPromise) return;
      terminationPromise = (async () => {
        let evidence;
        try {
          evidence = await terminateProcessTree(child);
        } catch (error) {
          evidence = {
            attempted: true,
            terminated: false,
            treeTerminationVerified: false,
            errorCode: String(error.code || "PROCESS_TREE_TERMINATION_FAILED")
          };
        }
        if (evidence?.treeTerminationVerified !== true) {
          const error = toolError(
            "PROCESS_TREE_TERMINATION_UNVERIFIED",
            "CodeClaw could not verify that the command process tree stopped. The operation failed closed.",
            500
          );
          error.trigger = terminationTrigger;
          error.treeTermination = evidence;
          if (terminationOperationError?.code) error.operationCode = terminationOperationError.code;
          finishReject(error);
          return;
        }
        if (terminationTrigger === "abort") {
          finishReject(abortErrorWithTreeEvidence(terminationOperationError, evidence));
          return;
        }
        finishResolve(commandResult({ exitCode: null, timedOut: true, treeTermination: evidence }));
      })();
      terminationPromise.catch(finishReject);
    };
    const onAbort = () => requestTermination("abort", signalAbortError(signal));
    const onError = (error) => {
      if (terminationPromise) return;
      stderr = appendOutput(stderr, error.message);
      finishResolve(commandResult({ exitCode: null, timedOut: false }));
    };
    const onClose = (code) => {
      if (terminationPromise) return;
      if (signal?.aborted) {
        requestTermination("abort", signalAbortError(signal));
        return;
      }
      finishResolve(commandResult({ exitCode: code, timedOut: false }));
    };
    const timer = setTimeout(() => requestTermination("timeout"), timeout);
    timer.unref?.();

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function signalAbortError(signal) {
  try {
    throwIfAborted(signal);
  } catch (error) {
    return error;
  }
  return toolError("OPERATION_CANCELLED", "The local command operation was cancelled.");
}

function abortErrorWithTreeEvidence(error, treeTermination) {
  if (error && Object.isExtensible(error)) {
    error.treeTermination = treeTermination;
    return error;
  }
  const wrapped = toolError(
    String(error?.code || "OPERATION_CANCELLED"),
    String(error?.message || "The local command operation was cancelled."),
    Number.isInteger(error?.status) ? error.status : 409
  );
  wrapped.treeTermination = treeTermination;
  return wrapped;
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
