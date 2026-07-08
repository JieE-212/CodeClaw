import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "cohort-summary.js");

test("cohort-summary finds repeated tester friction and allows watched expansion", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-cohort-sample-"));
  const jsonPath = path.join(tempRoot, "cohort.json");
  const markdownPath = path.join(tempRoot, "cohort.md");
  const inputPath = path.join(rootPath, "examples", "trial-cohort-sample");

  const result = await runCohortSummary([inputPath, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const markdown = await fs.readFile(markdownPath, "utf8");

  assert.equal(result.code, 0);
  assert.equal(report.ok, true);
  assert.equal(report.decision, "EXPAND_WITH_WATCH");
  assert.equal(report.counts.testers, 2);
  assert.equal(report.counts.completed, 2);
  assert.equal(report.expansionGate.proceedToThreeToFive, true);
  assert.ok(report.repeatedThemes.some((theme) => theme.theme === "demo-real-mode" && theme.testerCount === 2));
  assert.match(markdown, /Tester Matrix/);
  assert.match(markdown, /demo-real-mode/);
});

test("cohort-summary blocks expansion when a tester has privacy hold", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-cohort-hold-"));
  const testerPath = path.join(tempRoot, "tester-1");
  const jsonPath = path.join(tempRoot, "cohort.json");
  const markdownPath = path.join(tempRoot, "cohort.md");

  await fs.mkdir(testerPath, { recursive: true });
  await fs.writeFile(path.join(testerPath, "TRIAL_PRIVACY_REPORT.json"), JSON.stringify({
    ok: false,
    mode: "trial-privacy-check",
    decision: "PRIVACY_HOLD",
    blockers: [{ rule: "openai-key" }]
  }, null, 2), "utf8");
  await fs.writeFile(path.join(testerPath, "TRIAL_FEEDBACK_SUMMARY.json"), JSON.stringify({
    ok: true,
    mode: "trial-feedback-ingest",
    decision: "READY_FOR_TESTER_2",
    blockers: [],
    warnings: [],
    safetyConcerns: [],
    frictionThemes: []
  }, null, 2), "utf8");

  const result = await runCohortSummary([tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "HOLD_EXPANSION_FIX_FIRST");
  assert.ok(report.blockers.some((item) => item.includes("privacy report is PRIVACY_HOLD")));
  assert.equal(report.expansionGate.proceedToThreeToFive, false);
});

function runCohortSummary(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [scriptPath, ...args], { cwd: rootPath }, (error, stdout, stderr) => {
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
