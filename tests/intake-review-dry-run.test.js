import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestResources } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("intake-review dry run rehearses an anonymous tester without packaged local roster", async (t) => {
  const resources = await createTestResources(t, "codeclaw-intake-review-");
  const isolatedProject = await resources.copyProject(rootPath);
  const scriptPath = path.join(isolatedProject, "scripts", "run-intake-review-dry-run.js");
  const runId = "test-intake-review-isolated";
  const runPath = path.join(isolatedProject, "dist", "trial-dry-runs", runId);
  const jsonPath = path.join(runPath, "DRY_RUN_REPORT.json");
  const markdownPath = path.join(runPath, "DRY_RUN_REPORT.md");

  const result = await resources.execFile(process.execPath, [scriptPath,
    "--force",
    "--run-id", runId,
    "--json", path.relative(isolatedProject, jsonPath),
    "--markdown", path.relative(isolatedProject, markdownPath)
  ], {
    cwd: isolatedProject,
    maxBuffer: 1024 * 1024 * 5,
    label: "isolated intake-review dry run"
  });
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "DRY_RUN_READY_FOR_REAL_INTAKE");
  assert.equal(report.reviewDecision, "REVIEW_WATCH_NEXT_TESTER");
  assert.equal(report.packageInspection.dryRunOutputIgnored, true);
  assert.equal(report.packageInspection.packageContainsRoster, false);
  assert.equal(report.packageInspection.packageContainsDistDryRun, false);
  assert.match(report.rosterRelativePath, /^dist\/trial-dry-runs\//);
  assert.ok(report.steps.every((step) => step.exitCode === 0));
  assert.ok(await exists(path.join(runPath, "TESTER_ROSTER.json")));
  assert.equal(await exists(path.join(runPath, "package", ".codeclaw")), false);
  assert.equal(await exists(path.join(runPath, "package", "dist", "trial-dry-runs")), false);
});

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
