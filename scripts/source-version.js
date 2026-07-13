import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const GIT_SOURCE_TIMEOUT_MS = 15_000;

export function hermeticGitEnvironment(environment = process.env) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toUpperCase().startsWith("GIT_"))
  );
  return {
    ...inherited,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1"
  };
}

export function hermeticGitArguments(rootPath, args) {
  return [
    "-c", "core.fsmonitor=false",
    "-c", `safe.directory=${path.resolve(rootPath)}`,
    ...args
  ];
}

export async function inspectSourceVersion(rootPath) {
  try {
    const commitBefore = (await runGit(rootPath, ["rev-parse", "HEAD"])).trim();
    const status = await runGit(rootPath, ["status", "--porcelain"]);
    const commitAfter = (await runGit(rootPath, ["rev-parse", "HEAD"])).trim();
    return {
      available: true,
      commit: commitAfter,
      dirty: commitBefore !== commitAfter || Boolean(status.trim())
    };
  } catch {
    return {
      available: false,
      commit: "",
      dirty: null
    };
  }
}

export function sourceVersionBindingIssues(current, references = {}) {
  const issues = [];
  const currentCommitValid = validCommit(current?.commit);

  if (current?.available !== true || !currentCommitValid) {
    issues.push({ code: "CURRENT_SOURCE_VERSION_UNAVAILABLE", label: "current" });
  }
  if (current?.dirty !== false) {
    issues.push({ code: "CURRENT_SOURCE_NOT_CLEAN", label: "current" });
  }

  for (const [label, version] of Object.entries(references)) {
    const referenceCommitValid = validCommit(version?.commit);
    if (version?.available !== true || !referenceCommitValid) {
      issues.push({ code: "RECORDED_SOURCE_VERSION_UNAVAILABLE", label });
    }
    if (version?.dirty !== false) {
      issues.push({ code: "RECORDED_SOURCE_NOT_CLEAN", label });
    }
    if (currentCommitValid && referenceCommitValid && current.commit.toLowerCase() !== version.commit.toLowerCase()) {
      issues.push({ code: "SOURCE_COMMIT_MISMATCH", label });
    }
  }

  return issues;
}

export function sourceVersionIssueMessage(issue) {
  const label = String(issue?.label || "recorded");
  if (issue?.code === "CURRENT_SOURCE_VERSION_UNAVAILABLE") {
    return "The current Git source commit is unavailable; run this gate from the CodeClaw worktree.";
  }
  if (issue?.code === "CURRENT_SOURCE_NOT_CLEAN") {
    return "The current source worktree is not clean; commit product changes before binding or sending a candidate.";
  }
  if (issue?.code === "RECORDED_SOURCE_VERSION_UNAVAILABLE") {
    return `${label} does not contain a valid recorded Git source version; regenerate it.`;
  }
  if (issue?.code === "RECORDED_SOURCE_NOT_CLEAN") {
    return `${label} was not generated from an explicitly clean source worktree; regenerate it after committing.`;
  }
  if (issue?.code === "SOURCE_COMMIT_MISMATCH") {
    return `${label} is bound to a different source commit; regenerate it from the current commit.`;
  }
  return `${label} has an unknown source-version binding problem.`;
}

function validCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function runGit(rootPath, args) {
  return new Promise((resolve, reject) => {
    execFile("git", hermeticGitArguments(rootPath, args), {
      cwd: rootPath,
      windowsHide: true,
      shell: false,
      env: hermeticGitEnvironment(),
      timeout: GIT_SOURCE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}
