import fs from "node:fs/promises";
import path from "node:path";

export function createIgnoreDecisionMatcher(content = "") {
  const rules = String(content)
    .split(/\r?\n/)
    .map(parseRule)
    .filter(Boolean);

  return (relativePath, isDirectory = false) => {
    const normalized = normalizePath(relativePath);
    let ignored = null;
    for (const rule of rules) {
      if (matchesRule(rule, normalized, isDirectory)) ignored = !rule.negated;
    }
    return ignored;
  };
}

export async function isPathIgnoredStrict(rootPath, relativePath, isDirectory = false) {
  const normalized = normalizePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  for (let depth = 1; depth < segments.length; depth += 1) {
    const parentPath = segments.slice(0, depth).join("/");
    if (await ignoreDecisionStrict(rootPath, parentPath, true) === true) return true;
  }
  return await ignoreDecisionStrict(rootPath, normalized, isDirectory) === true;
}

async function ignoreDecisionStrict(rootPath, normalized, isDirectory) {
  const segments = normalized.split("/").filter(Boolean);
  let decision = null;
  for (let depth = 0; depth < Math.max(1, segments.length); depth += 1) {
    const baseSegments = segments.slice(0, depth);
    const scoped = segments.slice(depth).join("/");
    if (!scoped) break;
    const ignorePath = path.join(rootPath, ...baseSegments, ".gitignore");
    const content = await readIgnoreFileStrict(ignorePath);
    if (content === null) continue;
    const next = createIgnoreDecisionMatcher(content)(scoped, isDirectory);
    if (next !== null) decision = next;
  }
  return decision;
}

async function readIgnoreFileStrict(filePath) {
  let before;
  let handle;
  try {
    before = await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    const error = new Error("Refusing to trust a linked or non-file .gitignore.");
    error.code = "GITIGNORE_UNSAFE";
    throw error;
  }
  try {
    handle = await fs.open(filePath, "r");
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFileStat(before, opened) || !opened.isFile() || opened.nlink !== 1n) {
      throw ignoreError("GITIGNORE_CHANGED", "The .gitignore changed before it was read.");
    }
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await fs.lstat(filePath, { bigint: true });
    if (!sameStableFileStat(opened, after) || !sameStableFileStat(opened, pathAfter)) {
      throw ignoreError("GITIGNORE_CHANGED", "The .gitignore changed while it was read.");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw ignoreError("GITIGNORE_INVALID_UTF8", "Refusing to trust a .gitignore that is not valid UTF-8.");
    }
  } catch (error) {
    if (["GITIGNORE_CHANGED", "GITIGNORE_INVALID_UTF8"].includes(error.code)) throw error;
    if (error.code === "ENOENT") throw ignoreError("GITIGNORE_CHANGED", "The .gitignore disappeared while it was read.");
    throw ignoreError("GITIGNORE_UNREADABLE", "CodeClaw could not safely read .gitignore.");
  } finally {
    await handle?.close();
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

function ignoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseRule(line) {
  const normalizedLine = stripUnescapedTrailingSpaces(String(line || ""));
  if (!normalizedLine || normalizedLine.startsWith("#")) return null;

  const negated = normalizedLine.startsWith("!");
  const rawPattern = negated ? normalizedLine.slice(1) : normalizedLine;
  const directoryOnly = rawPattern.endsWith("/");
  const anchored = rawPattern.startsWith("/");
  const pattern = rawPattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!pattern) return null;

  return { pattern, negated, directoryOnly, anchored, hasSlash: pattern.includes("/") };
}

function matchesRule(rule, relativePath, isDirectory) {
  if (rule.directoryOnly && !isDirectory && !relativePath.startsWith(`${rule.pattern}/`)) return false;

  if (rule.directoryOnly) {
    if (relativePath === rule.pattern || relativePath.startsWith(`${rule.pattern}/`)) return true;
    if (!rule.hasSlash && relativePath.split("/").includes(rule.pattern)) return true;
  }

  if (rule.anchored || rule.hasSlash) return globToRegExp(rule.pattern).test(relativePath);

  const segments = relativePath.split("/");
  return segments.some((segment) => globToRegExp(rule.pattern).test(segment));
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      source += escapeRegExp(pattern[index + 1]);
      index += 1;
      continue;
    }
    if (character === "*") {
      let end = index;
      while (pattern[end + 1] === "*") end += 1;
      const count = end - index + 1;
      const followedBySlash = pattern[end + 1] === "/";
      if (count >= 2 && followedBySlash) {
        source += "(?:.*/)?";
        index = end + 1;
      } else {
        source += count >= 2 ? ".*" : "[^/]*";
        index = end;
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const characterClass = parseCharacterClass(pattern, index);
      if (characterClass) {
        source += characterClass.source;
        index = characterClass.end;
        continue;
      }
    }
    source += escapeRegExp(character);
  }
  return new RegExp(`^${source}$`);
}

function parseCharacterClass(pattern, start) {
  let end = start + 1;
  if (pattern[end] === "!" || pattern[end] === "^") end += 1;
  if (pattern[end] === "]") end += 1;
  while (end < pattern.length && pattern[end] !== "]") end += 1;
  if (end >= pattern.length) return null;

  let content = pattern.slice(start + 1, end);
  let negated = false;
  if (content.startsWith("!") || content.startsWith("^")) {
    negated = true;
    content = content.slice(1);
  }
  content = content
    .replaceAll("\\", "\\\\")
    .replaceAll("]", "\\]");
  return { source: `[${negated ? "^" : ""}${content}]`, end };
}

function stripUnescapedTrailingSpaces(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === " ") {
    let backslashes = 0;
    for (let index = end - 2; index >= 0 && value[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 1) break;
    end -= 1;
  }
  return value.slice(0, end);
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\/+/, "");
}
