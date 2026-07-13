import fs from "node:fs/promises";
import path from "node:path";
import { createStrictIgnoreMatcher } from "../../shared/src/ignore-utils.js";
import { isSensitiveDirectory, isSensitiveFile, isSkippedDirectory, isTextLikeFile, relativePath } from "../../shared/src/path-utils.js";
import { RUNTIME_BUDGETS, boundedBudgetValue, readFileHandleBounded, runtimeBudgetError } from "../../shared/src/runtime-budget.js";
import { openStableDirectory } from "../../shared/src/stable-directory.js";
import { throwIfAborted } from "../../shared/src/operation-manager.js";

const MAX_SYMBOLS = 80;

export async function scanRepository(rootPath, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);
  const resolvedRoot = path.resolve(rootPath || ".");
  const stats = await fs.stat(resolvedRoot);
  throwIfAborted(signal);
  if (!stats.isDirectory()) throw new Error(`Repository path is not a directory: ${resolvedRoot}`);

  const files = [];
  const skipped = [];
  const budget = normalizeScanBudget(options);
  const state = createScanState(files, skipped, budget, signal);
  const ignoreSession = options.ignoreMatcher ? null : createStrictIgnoreMatcher(resolvedRoot, {
    maxFiles: budget.maxIgnoreFiles,
    maxFileBytes: budget.maxIgnoreFileBytes,
    maxTotalBytes: budget.maxIgnoreTotalBytes,
    maxRules: budget.maxIgnoreRules,
    maxRuleEvaluations: budget.maxIgnoreRuleEvaluations,
    signal
  });
  const isIgnored = options.ignoreMatcher
    ? async (relative, isDirectory) => {
      throwIfAborted(signal);
      const ignored = await options.ignoreMatcher(relative, isDirectory, { signal });
      throwIfAborted(signal);
      return ignored;
    }
    : ignoreSession.isIgnoredTraversed;
  await walk(resolvedRoot, resolvedRoot, state, isIgnored, 0);

  throwIfAborted(signal);
  const manifests = await readKnownManifests(resolvedRoot, new Map(files.map((file) => [file.path, file])), state, signal);
  throwIfAborted(signal);
  await ignoreSession?.verify();
  throwIfAborted(signal);
  const budgetEvidence = scanBudgetEvidence(state, ignoreSession?.evidence());
  return {
    rootPath: resolvedRoot,
    name: path.basename(resolvedRoot),
    scannedAt: new Date().toISOString(),
    fileCount: files.length,
    skippedCount: state.used.skippedItemsObserved,
    languages: detectLanguages(files),
    frameworks: detectFrameworks(manifests, files),
    packageManagers: detectPackageManagers(files),
    commands: detectCommands(manifests),
    keyFiles: selectKeyFiles(files),
    files,
    skipped,
    truncated: budgetEvidence.truncated,
    truncationReasons: budgetEvidence.reasons,
    detailOmissions: budgetEvidence.detailOmissions,
    budget: budgetEvidence
  };
}

async function walk(rootPath, currentPath, state, isIgnored, depth) {
  throwIfAborted(state.signal);
  if (state.used.entriesVisited >= state.limits.maxEntries) {
    state.truncationReasons.add("max-entries");
    return;
  }
  if (state.used.directoriesVisited >= state.limits.maxDirectories) {
    state.truncationReasons.add("max-directories");
    return;
  }
  state.used.directoriesVisited += 1;
  state.used.maxDepthReached = Math.max(state.used.maxDepthReached, depth);

  const entries = [];
  const openedDirectory = await openStableDirectory(rootPath, currentPath, "scan repository files", state.signal);
  for await (const entry of openedDirectory.directory) {
    throwIfAborted(state.signal);
    if (state.used.entriesVisited >= state.limits.maxEntries) {
      state.truncationReasons.add("max-entries");
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
      state.truncationReasons.add("max-files");
      break;
    }
    const absolutePath = path.join(currentPath, entry.name);
    const rel = relativePath(rootPath, absolutePath);

    if (entry.isDirectory()) {
      if (isSensitiveDirectory(entry.name)) {
        recordSkipped(state, rel, "sensitive-directory");
        continue;
      }
      if (isSkippedDirectory(entry.name)) {
        recordSkipped(state, rel, "skipped-directory");
        continue;
      }
      if (await isIgnored(rel, true)) {
        throwIfAborted(state.signal);
        recordSkipped(state, rel, "gitignore");
        continue;
      }
      if (depth >= state.limits.maxDepth) {
        state.truncationReasons.add("max-depth");
        recordSkipped(state, rel, "runtime-budget-depth");
        continue;
      }
      await walk(rootPath, absolutePath, state, isIgnored, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isSensitiveFile(entry.name)) {
      recordSkipped(state, rel, "sensitive-file");
      continue;
    }
    if (await isIgnored(rel, false)) {
      throwIfAborted(state.signal);
      recordSkipped(state, rel, "gitignore");
      continue;
    }

    const stat = await fs.lstat(absolutePath, { bigint: true });
    throwIfAborted(state.signal);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
      recordSkipped(state, rel, "unsafe-filesystem-entry");
      continue;
    }
    const item = {
      path: rel,
      name: entry.name,
      extension: path.extname(entry.name).toLowerCase(),
      size: safeBigIntNumber(stat.size),
      textLike: isTextLikeFile(absolutePath),
      summary: null,
      symbols: []
    };

    if (item.textLike && stat.size > BigInt(state.limits.maxSummaryFileBytes)) {
      state.used.summaryFilesSkippedByBudget += 1;
      state.detailOmissions.add("max-summary-file-bytes");
    } else if (item.textLike) {
      const remainingSummaryBytes = state.limits.maxSummaryTotalBytes - state.used.summaryBytesRead;
      if (Number(stat.size) > remainingSummaryBytes) {
        state.used.summaryFilesSkippedByBudget += 1;
        state.detailOmissions.add("max-summary-total-bytes");
      } else {
        const details = await inspectTextFile(absolutePath, item.extension, state.limits.maxSummaryFileBytes, state.signal);
        throwIfAborted(state.signal);
        item.summary = details.summary;
        item.symbols = details.symbols;
        state.used.summaryBytesRead += details.byteLength;
      }
    }
    state.files.push(item);
    } finally {
      throwIfAborted(state.signal);
      await openedDirectory.verify();
    }
  }
}

async function inspectTextFile(filePath, extension, maxBytes, signal) {
  throwIfAborted(signal);
  try {
    const read = await readStableUtf8File(filePath, maxBytes, "repository-summary", signal);
    throwIfAborted(signal);
    const content = stripBom(read.content);
    return {
      summary: content.split(/\r?\n/).filter(Boolean).slice(0, 24).join("\n").slice(0, 1200),
      symbols: extractSymbols(content, extension),
      byteLength: read.byteLength
    };
  } catch (error) {
    throwIfAborted(signal);
    if (error.code === "REPO_SCAN_FILE_BUDGET_EXCEEDED") throw error;
    return { summary: null, symbols: [], byteLength: 0 };
  }
}

function extractSymbols(content, extension) {
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(extension)) return [];
  const symbols = [];
  const seen = new Set();
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    { kind: "function", pattern: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "class", pattern: /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/ },
    { kind: "variable", pattern: /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/ }
  ];

  for (const [index, line] of lines.entries()) {
    for (const { kind, pattern } of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      const key = `${kind}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ name, kind, line: index + 1 });
      if (symbols.length >= MAX_SYMBOLS) return symbols;
    }
  }

  return symbols;
}

async function readKnownManifests(rootPath, allowedFiles, state, signal) {
  const manifests = {};
  for (const name of ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"]) {
    throwIfAborted(signal);
    const file = allowedFiles.get(name);
    if (!file) continue;
    if (file.size > state.limits.maxManifestFileBytes) {
      state.used.manifestFilesSkippedByBudget += 1;
      state.truncationReasons.add("max-manifest-file-bytes");
      continue;
    }
    try {
      const read = await readStableUtf8File(path.join(rootPath, name), state.limits.maxManifestFileBytes, "repository-manifest", signal);
      throwIfAborted(signal);
      const content = stripBom(read.content);
      state.used.manifestBytesRead += read.byteLength;
      manifests[name] = content;
      if (name === "package.json") manifests.packageJson = JSON.parse(content);
    } catch (error) {
      throwIfAborted(signal);
      if (error.code === "REPO_SCAN_FILE_BUDGET_EXCEEDED") {
        state.used.manifestFilesSkippedByBudget += 1;
        state.truncationReasons.add("max-manifest-file-bytes");
      }
    }
  }
  return manifests;
}

async function readStableUtf8File(filePath, maxBytes, operation, signal) {
  throwIfAborted(signal);
  const before = await fs.lstat(filePath, { bigint: true });
  throwIfAborted(signal);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error("Unsafe manifest or source file.");
  assertFileWithinBudget(before.size, maxBytes, operation);
  const handle = await fs.open(filePath, "r");
  try {
    throwIfAborted(signal);
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFileStat(before, opened)) throw new Error("Source file changed before read.");
    assertFileWithinBudget(opened.size, maxBytes, operation);
    const bounded = await readFileHandleBounded(handle, maxBytes);
    throwIfAborted(signal);
    if (bounded.exceeded) assertFileWithinBudget(BigInt(bounded.byteLength), maxBytes, operation);
    const after = await handle.stat({ bigint: true });
    throwIfAborted(signal);
    if (!sameStableFileStat(opened, after)) throw new Error("Source file changed during read.");
    return {
      content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bounded.buffer),
      byteLength: bounded.byteLength
    };
  } finally {
    try {
      await handle.close();
    } catch (error) {
      throwIfAborted(signal);
      throw error;
    }
  }
}

function normalizeScanBudget(options) {
  const hard = RUNTIME_BUDGETS.repositoryScan;
  return {
    maxFiles: boundedBudgetValue(options.maxFiles, hard.maxFiles),
    maxEntries: boundedBudgetValue(options.maxEntries, hard.maxEntries),
    maxDirectories: boundedBudgetValue(options.maxDirectories, hard.maxDirectories),
    maxDepth: boundedBudgetValue(options.maxDepth, hard.maxDepth, hard.maxDepth, 0),
    maxSkippedItems: boundedBudgetValue(options.maxSkippedItems, hard.maxSkippedItems),
    maxSummaryFileBytes: boundedBudgetValue(options.maxSummaryFileBytes, hard.maxSummaryFileBytes),
    maxSummaryTotalBytes: boundedBudgetValue(options.maxSummaryTotalBytes, hard.maxSummaryTotalBytes),
    maxManifestFileBytes: boundedBudgetValue(options.maxManifestFileBytes, hard.maxManifestFileBytes),
    maxIgnoreFiles: boundedBudgetValue(options.maxIgnoreFiles, hard.maxIgnoreFiles),
    maxIgnoreFileBytes: boundedBudgetValue(options.maxIgnoreFileBytes, hard.maxIgnoreFileBytes),
    maxIgnoreTotalBytes: boundedBudgetValue(options.maxIgnoreTotalBytes, hard.maxIgnoreTotalBytes),
    maxIgnoreRules: boundedBudgetValue(options.maxIgnoreRules, hard.maxIgnoreRules),
    maxIgnoreRuleEvaluations: boundedBudgetValue(options.maxIgnoreRuleEvaluations, hard.maxIgnoreRuleEvaluations)
  };
}

function createScanState(files, skipped, limits, signal) {
  return {
    files,
    skipped,
    limits,
    signal,
    truncationReasons: new Set(),
    detailOmissions: new Set(),
    used: {
      entriesVisited: 0,
      directoriesVisited: 0,
      maxDepthReached: 0,
      skippedItemsObserved: 0,
      summaryBytesRead: 0,
      summaryFilesSkippedByBudget: 0,
      manifestBytesRead: 0,
      manifestFilesSkippedByBudget: 0
    }
  };
}

function recordSkipped(state, filePath, reason) {
  state.used.skippedItemsObserved += 1;
  if (state.skipped.length < state.limits.maxSkippedItems) {
    state.skipped.push({ path: filePath, reason });
  } else {
    state.truncationReasons.add("max-skipped-items");
  }
}

function scanBudgetEvidence(state, ignoreEvidence = null) {
  const reasons = [...state.truncationReasons].sort();
  const detailOmissions = [...state.detailOmissions].sort();
  const ignore = ignoreEvidence || { used: { filesRead: 0, bytesRead: 0, identityChecks: 0, cacheEntries: 0, rulesLoaded: 0, ruleEvaluations: 0 } };
  return {
    operation: "repository-scan",
    limits: { ...state.limits },
    used: {
      ...state.used,
      filesCollected: state.files.length,
      skippedItemsStored: state.skipped.length,
      ignoreFilesRead: ignore.used.filesRead,
      ignoreBytesRead: ignore.used.bytesRead,
      ignoreIdentityChecks: ignore.used.identityChecks,
      ignoreCacheEntries: ignore.used.cacheEntries,
      ignoreRulesLoaded: ignore.used.rulesLoaded,
      ignoreRuleEvaluations: ignore.used.ruleEvaluations
    },
    truncated: reasons.length > 0,
    reasons,
    detailOmissions
  };
}

function assertFileWithinBudget(size, maxBytes, operation) {
  if (size <= BigInt(maxBytes)) return;
  throw runtimeBudgetError(
    "REPO_SCAN_FILE_BUDGET_EXCEEDED",
    `Repository metadata read exceeded the ${maxBytes}-byte ${operation} budget.`,
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

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function detectLanguages(files) {
  const counts = new Map();
  const byExt = { ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".py": "Python", ".rs": "Rust", ".go": "Go", ".java": "Java", ".kt": "Kotlin", ".cs": "C#", ".php": "PHP", ".rb": "Ruby" };
  for (const file of files) {
    const language = byExt[file.extension];
    if (language) counts.set(language, (counts.get(language) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function detectFrameworks(manifests, files) {
  const frameworks = new Set();
  const deps = { ...manifests.packageJson?.dependencies, ...manifests.packageJson?.devDependencies };
  if (deps.next) frameworks.add("Next.js");
  if (deps.react) frameworks.add("React");
  if (deps.vue) frameworks.add("Vue");
  if (deps.svelte) frameworks.add("Svelte");
  if (deps.vite) frameworks.add("Vite");
  if (deps.express) frameworks.add("Express");
  if (manifests["pyproject.toml"]?.toLowerCase().includes("django")) frameworks.add("Django");
  if (manifests["pyproject.toml"]?.toLowerCase().includes("fastapi")) frameworks.add("FastAPI");
  if (files.some((file) => file.name === "vite.config.ts" || file.name === "vite.config.js")) frameworks.add("Vite");
  return [...frameworks];
}

function detectPackageManagers(files) {
  const names = new Set(files.map((file) => file.name));
  const managers = [];
  if (names.has("pnpm-lock.yaml")) managers.push("pnpm");
  if (names.has("yarn.lock")) managers.push("yarn");
  if (names.has("package-lock.json") || names.has("package.json")) managers.push("npm");
  if (names.has("requirements.txt") || names.has("pyproject.toml")) managers.push("pip/uv/poetry");
  if (names.has("Cargo.lock") || names.has("Cargo.toml")) managers.push("cargo");
  if (names.has("go.mod")) managers.push("go");
  return managers;
}

function detectCommands(manifests) {
  const commands = [];
  const scripts = manifests.packageJson?.scripts || {};
  for (const key of ["dev", "start", "test", "lint", "build"]) {
    if (scripts[key]) commands.push({ name: key, command: `npm run ${key}`, source: "package.json" });
  }
  if (manifests["requirements.txt"] || manifests["pyproject.toml"]) commands.push({ name: "test", command: "python -m pytest", source: "python-default" });
  return commands;
}

function selectKeyFiles(files) {
  const preferred = new Set(["README.md", "package.json", "pyproject.toml", "requirements.txt", "tsconfig.json", "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs"]);
  return files.filter((file) => preferred.has(file.name) || file.path.startsWith("src/")).slice(0, 40).map((file) => file.path);
}
