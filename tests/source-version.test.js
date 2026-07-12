import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectSourceVersion,
  sourceVersionBindingIssues,
  sourceVersionIssueMessage
} from "../scripts/source-version.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
