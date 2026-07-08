import fs from "node:fs/promises";

export async function loadGitignoreMatcher(rootPath) {
  try {
    const content = await fs.readFile(`${rootPath}/.gitignore`, "utf8");
    return createIgnoreMatcher(content);
  } catch {
    return () => false;
  }
}

export function createIgnoreMatcher(content = "") {
  const rules = String(content)
    .split(/\r?\n/)
    .map(parseRule)
    .filter(Boolean);

  return (relativePath, isDirectory = false) => {
    const normalized = normalizePath(relativePath);
    let ignored = false;
    for (const rule of rules) {
      if (matchesRule(rule, normalized, isDirectory)) ignored = !rule.negated;
    }
    return ignored;
  };
}

function parseRule(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const negated = trimmed.startsWith("!");
  const rawPattern = negated ? trimmed.slice(1) : trimmed;
  const directoryOnly = rawPattern.endsWith("/");
  const anchored = rawPattern.startsWith("/");
  const pattern = normalizePath(rawPattern.replace(/^\/+/, "").replace(/\/+$/, ""));
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
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\/+/, "");
}
