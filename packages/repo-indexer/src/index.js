import fs from "node:fs/promises";
import path from "node:path";
import { isPathIgnoredStrict } from "../../shared/src/ignore-utils.js";
import { isSensitiveDirectory, isSensitiveFile, isSkippedDirectory, isTextLikeFile, relativePath } from "../../shared/src/path-utils.js";

const MAX_FILES = 800;
const MAX_SUMMARY_BYTES = 6000;
const MAX_SYMBOLS = 80;

export async function scanRepository(rootPath, options = {}) {
  const resolvedRoot = path.resolve(rootPath || ".");
  const stats = await fs.stat(resolvedRoot);
  if (!stats.isDirectory()) throw new Error(`Repository path is not a directory: ${resolvedRoot}`);

  const files = [];
  const skipped = [];
  const isIgnored = options.ignoreMatcher
    ? async (relative, isDirectory) => options.ignoreMatcher(relative, isDirectory)
    : async (relative, isDirectory) => isPathIgnoredStrict(resolvedRoot, relative, isDirectory);
  await walk(resolvedRoot, resolvedRoot, files, skipped, options.maxFiles || MAX_FILES, isIgnored);

  const manifests = await readKnownManifests(resolvedRoot);
  return {
    rootPath: resolvedRoot,
    name: path.basename(resolvedRoot),
    scannedAt: new Date().toISOString(),
    fileCount: files.length,
    skippedCount: skipped.length,
    languages: detectLanguages(files),
    frameworks: detectFrameworks(manifests, files),
    packageManagers: detectPackageManagers(files),
    commands: detectCommands(manifests),
    keyFiles: selectKeyFiles(files),
    files,
    skipped
  };
}

async function walk(rootPath, currentPath, files, skipped, maxFiles, isIgnored) {
  if (files.length >= maxFiles) return;
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (files.length >= maxFiles) break;
    const absolutePath = path.join(currentPath, entry.name);
    const rel = relativePath(rootPath, absolutePath);

    if (entry.isDirectory()) {
      if (isSensitiveDirectory(entry.name)) {
        skipped.push({ path: rel, reason: "sensitive-directory" });
        continue;
      }
      if (isSkippedDirectory(entry.name)) {
        skipped.push({ path: rel, reason: "skipped-directory" });
        continue;
      }
      if (await isIgnored(rel, true)) {
        skipped.push({ path: rel, reason: "gitignore" });
        continue;
      }
      await walk(rootPath, absolutePath, files, skipped, maxFiles, isIgnored);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isSensitiveFile(entry.name)) {
      skipped.push({ path: rel, reason: "sensitive-file" });
      continue;
    }
    if (await isIgnored(rel, false)) {
      skipped.push({ path: rel, reason: "gitignore" });
      continue;
    }

    const stat = await fs.lstat(absolutePath, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
      skipped.push({ path: rel, reason: "unsafe-filesystem-entry" });
      continue;
    }
    const item = {
      path: rel,
      name: entry.name,
      extension: path.extname(entry.name).toLowerCase(),
      size: Number(stat.size),
      textLike: isTextLikeFile(absolutePath),
      summary: null,
      symbols: []
    };

    if (item.textLike && stat.size <= BigInt(MAX_SUMMARY_BYTES)) {
      const details = await inspectTextFile(absolutePath, item.extension);
      item.summary = details.summary;
      item.symbols = details.symbols;
    }
    files.push(item);
  }
}

async function inspectTextFile(filePath, extension) {
  try {
    const content = stripBom(await readStableUtf8File(filePath));
    return {
      summary: content.split(/\r?\n/).filter(Boolean).slice(0, 24).join("\n").slice(0, 1200),
      symbols: extractSymbols(content, extension)
    };
  } catch {
    return { summary: null, symbols: [] };
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

async function readKnownManifests(rootPath) {
  const manifests = {};
  for (const name of ["package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"]) {
    try {
      const content = stripBom(await readStableUtf8File(path.join(rootPath, name)));
      manifests[name] = content;
      if (name === "package.json") manifests.packageJson = JSON.parse(content);
    } catch {}
  }
  return manifests;
}

async function readStableUtf8File(filePath) {
  const before = await fs.lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error("Unsafe manifest or source file.");
  const handle = await fs.open(filePath, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFileStat(before, opened)) throw new Error("Source file changed before read.");
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameStableFileStat(opened, after)) throw new Error("Source file changed during read.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } finally {
    await handle.close();
  }
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
