import { execFile } from "node:child_process";

export async function inspectSourceVersion(rootPath) {
  try {
    const [commit, status] = await Promise.all([
      runGit(rootPath, ["rev-parse", "HEAD"]),
      runGit(rootPath, ["status", "--porcelain"])
    ]);
    return {
      available: true,
      commit: commit.trim(),
      dirty: Boolean(status.trim())
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
    execFile("git", args, { cwd: rootPath, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}
