import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "run-intake-review-dry-run.js");

test("intake-review dry run rehearses an anonymous tester without packaged local roster", async (t) => {
  const runId = `test-intake-review-${process.pid}-${Date.now()}`;
  const runPath = path.join(rootPath, "dist", "trial-dry-runs", runId);
  const jsonPath = path.join(runPath, "DRY_RUN_REPORT.json");
  const markdownPath = path.join(runPath, "DRY_RUN_REPORT.md");
  t.after(() => fs.rm(runPath, { recursive: true, force: true }));

  const result = await runDryRun([
    "--force",
    "--run-id", runId,
    "--json", path.relative(rootPath, jsonPath),
    "--markdown", path.relative(rootPath, markdownPath)
  ]);
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

function runDryRun(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath, ...args], { cwd: rootPath, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        code: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
