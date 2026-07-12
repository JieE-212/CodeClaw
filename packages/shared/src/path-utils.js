import path from "node:path";
import {
  SENSITIVE_DIRECTORIES,
  SENSITIVE_FILE_NAMES,
  SENSITIVE_FILE_PATTERNS,
  SKIPPED_DIRECTORIES,
  TEXT_EXTENSIONS
} from "./constants.js";

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function isSkippedDirectory(name) {
  return SKIPPED_DIRECTORIES.has(normalizePolicyName(name));
}

export function isSensitiveDirectory(name) {
  return SENSITIVE_DIRECTORIES.has(normalizePolicyName(name));
}

export function isProtectedDirectory(name) {
  return isSkippedDirectory(name) || isSensitiveDirectory(name);
}

export function isSensitiveFile(name) {
  const normalized = normalizePolicyName(path.basename(String(name || "")));
  return SENSITIVE_FILE_NAMES.has(normalized)
    || SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isTextLikeFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function relativePath(rootPath, absolutePath) {
  return toPosixPath(path.relative(rootPath, absolutePath));
}

function normalizePolicyName(value) {
  return String(value || "").toLocaleLowerCase("en-US");
}
