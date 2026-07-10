import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "ingest-trial-feedback.js");

test("feedback ingest recognizes neutral next-tester decision fields", async () => {
  const fixture = await makeFixture([
    "- Safe to continue to the next tester: Yes",
    "- Should this build continue to the next tester? Yes",
    "- Proceed to the next tester: Yes"
  ]);
  const result = await runIngest(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.decision, "READY_FOR_TESTER_2");
  assert.equal(report.decisionSignals.length, 3);
  assert.equal(report.blockers.length, 0);
  assert.ok(report.nextSteps.some((item) => /next tester/i.test(item)));
  assert.ok(report.nextSteps.every((item) => !/tester[ -]?2/i.test(item)));
});

test("feedback ingest blocks a neutral next-tester no decision with neutral guidance", async () => {
  const fixture = await makeFixture([
    "- Proceed to the next tester: No"
  ]);
  const result = await runIngest(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.decision, "NO_GO_FIX_FIRST");
  assert.equal(report.blockers.length, 1);
  assert.match(report.blockers[0].reason, /next tester/i);
  assert.doesNotMatch(report.blockers[0].reason, /tester 2/i);
  assert.ok(report.nextSteps.every((item) => !/tester 2/i.test(item)));
});

test("feedback ingest keeps legacy tester-2 decision fields compatible", async () => {
  const fixture = await makeFixture([
    "- Should this build go to tester 2? Yes"
  ]);
  const result = await runIngest(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.decision, "READY_FOR_TESTER_2");
  assert.equal(report.decisionSignals.length, 1);
});

async function makeFixture(fields) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-feedback-ingest-"));
  const inputPath = path.join(tempRoot, "feedback");
  const jsonPath = path.join(tempRoot, "TRIAL_FEEDBACK_SUMMARY.json");
  const markdownPath = path.join(tempRoot, "TRIAL_FEEDBACK_SUMMARY.md");
  await fs.mkdir(inputPath, { recursive: true });
  await fs.writeFile(path.join(inputPath, "TRIAL_RESULT_RECORD.md"), [
    "# Trial Result",
    "",
    ...fields,
    ""
  ].join("\n"), "utf8");
  return { inputPath, jsonPath, markdownPath };
}

function runIngest(fixture) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      scriptPath,
      "--input", fixture.inputPath,
      "--json", fixture.jsonPath,
      "--markdown", fixture.markdownPath
    ], { cwd: rootPath }, (error, stdout, stderr) => {
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
