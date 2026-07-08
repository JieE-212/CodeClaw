import path from "node:path";
import { SENSITIVE_FILE_PATTERNS, SKIPPED_DIRECTORIES, TEXT_EXTENSIONS } from "./constants.js";

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export function isSkippedDirectory(name) {
  return SKIPPED_DIRECTORIES.has(name);
}

export function isSensitiveFile(name) {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isTextLikeFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function relativePath(rootPath, absolutePath) {
  return toPosixPath(path.relative(rootPath, absolutePath));
}
