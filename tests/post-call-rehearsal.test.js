import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "post-call-rehearsal.js");

test("post-call rehearsal runs record-draft into after-live without real tester data", async (t) => {
  const fixture = await makeFixture("ready");
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const result = await runRehearsal(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));
  const recordDraft = JSON.parse(await fs.readFile(path.join(fixture.runRoot, "reports", "TRIAL_RECORD_DRAFT.json"), "utf8"));
  const feedback = JSON.parse(await fs.readFile(path.join(fixture.runRoot, "reports", "TRIAL_FEEDBACK_SUMMARY.json"), "utf8"));
  const afterLive = JSON.parse(await fs.readFile(path.join(fixture.runRoot, "reports", "TRIAL_AFTER_LIVE_REPORT.json"), "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.rehearsalOnly, true);
  assert.equal(report.realTesterFeedback, false);
  assert.match(report.decision, /^POST_CALL_REHEARSAL_READY/);
  assert.match(recordDraft.decision, /^RECORD_DRAFT_READY/);
  assert.match(feedback.decision, /^READY_/);
  assert.match(afterLive.decision, /^AFTER_LIVE_READY/);
  assert.ok(await exists(path.join(fixture.runRoot, "after-live-packet", "EVIDENCE_PACKET_MANIFEST.json")));
});

test("post-call rehearsal refuses real-looking tester ids", async (t) => {
  const fixture = await makeFixture("unsafe-id");
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const result = await runRehearsal(fixture, ["--tester", "tester-2"]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr + result.stdout, /must include rehearsal/);
});

async function makeFixture(name) {
  const tempRoot = path.join(rootPath, "dist", "trial-post-call-rehearsals", `test-${process.pid}-${Date.now()}-${name}`);
  const runRoot = path.join(tempRoot, "run");
  const jsonPath = path.join(tempRoot, "TRIAL_POST_CALL_REHEARSAL_REPORT.json");
  const markdownPath = path.join(tempRoot, "TRIAL_POST_CALL_REHEARSAL_REPORT.md");
  return { tempRoot, runRoot, jsonPath, markdownPath };
}

function runRehearsal(fixture, extraArgs = []) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      scriptPath,
      "--run-id", "test-run",
      "--out", path.relative(rootPath, fixture.runRoot),
      "--json", path.relative(rootPath, fixture.jsonPath),
      "--markdown", path.relative(rootPath, fixture.markdownPath),
      "--force",
      "--skip-standby",
      ...extraArgs
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

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
