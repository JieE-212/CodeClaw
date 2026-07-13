import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hermeticGitArguments,
  hermeticGitEnvironment,
  inspectSourceVersion,
  sourceVersionBindingIssues,
  sourceVersionIssueMessage
} from "../scripts/source-version.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("source-version Git subprocess inputs discard ambient Git authority", () => {
  const environment = hermeticGitEnvironment({
    Path: "fixture-path",
    HOME: "fixture-home",
    GIT_DIR: "redirected",
    git_work_tree: "redirected-worktree",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.fsmonitor",
    GIT_CONFIG_VALUE_0: "hostile-hook"
  });

  assert.equal(environment.Path, "fixture-path");
  assert.equal(environment.HOME, "fixture-home");
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.git_work_tree, undefined);
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.deepEqual(hermeticGitArguments(rootPath, ["status", "--porcelain"]), [
    "-c", "core.fsmonitor=false", "-c", `safe.directory=${rootPath}`, "status", "--porcelain"
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(environment).filter(([name]) => name.startsWith("GIT_"))), {
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1"
  });
});

test("inspectSourceVersion identifies the current Git worktree without exposing file names", async () => {
  const version = await inspectSourceVersion(rootPath);

  assert.equal(version.available, true);
  assert.match(version.commit, /^[a-f0-9]{40}$/);
  assert.equal(typeof version.dirty, "boolean");
  assert.deepEqual(Object.keys(version).sort(), ["available", "commit", "dirty"]);
});

test("source-version binding rejects stale, dirty, and unavailable candidate records", () => {
  const currentCommit = "a".repeat(40);
  const staleCommit = "b".repeat(40);
  const current = { available: true, commit: currentCommit, dirty: false };

  assert.deepEqual(sourceVersionBindingIssues(current, {
    readiness: { available: true, commit: currentCommit, dirty: false },
    simulation: { available: true, commit: currentCommit, dirty: false }
  }), []);

  const issues = sourceVersionBindingIssues(current, {
    stale: { available: true, commit: staleCommit, dirty: false },
    dirty: { available: true, commit: currentCommit, dirty: true },
    missing: { available: false, commit: "", dirty: null }
  });
  assert.ok(issues.some((item) => item.code === "SOURCE_COMMIT_MISMATCH" && item.label === "stale"));
  assert.ok(issues.some((item) => item.code === "RECORDED_SOURCE_NOT_CLEAN" && item.label === "dirty"));
  assert.ok(issues.some((item) => item.code === "RECORDED_SOURCE_VERSION_UNAVAILABLE" && item.label === "missing"));
  assert.ok(issues.every((item) => !sourceVersionIssueMessage(item).includes(currentCommit)));
});

test("source-version binding requires the worktree to be clean at gate time", () => {
  const commit = "c".repeat(40);
  const issues = sourceVersionBindingIssues(
    { available: true, commit, dirty: true },
    { freeze: { available: true, commit, dirty: false } }
  );

  assert.ok(issues.some((item) => item.code === "CURRENT_SOURCE_NOT_CLEAN"));
});
