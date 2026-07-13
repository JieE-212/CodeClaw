import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedProject } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("post-call rehearsal runs record-draft into after-live without real tester data", async (t) => {
  const fixture = await makeFixture(t, "ready");
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
  const fixture = await makeFixture(t, "unsafe-id");
  const result = await runRehearsal(fixture, ["--tester", "tester-2"]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr + result.stdout, /must include rehearsal/);
});

async function makeFixture(t, name) {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-post-call-");
  const tempRoot = path.join(isolated.projectRoot, "dist", "trial-post-call-rehearsals", `test-${name}`);
  const runRoot = path.join(tempRoot, "run");
  const jsonPath = path.join(tempRoot, "TRIAL_POST_CALL_REHEARSAL_REPORT.json");
  const markdownPath = path.join(tempRoot, "TRIAL_POST_CALL_REHEARSAL_REPORT.md");
  return { isolated, tempRoot, runRoot, jsonPath, markdownPath };
}

function runRehearsal(fixture, extraArgs = []) {
  return fixture.isolated.execNodeScript("post-call-rehearsal.js", [
      "--run-id", "test-run",
      "--out", path.relative(fixture.isolated.projectRoot, fixture.runRoot),
      "--json", path.relative(fixture.isolated.projectRoot, fixture.jsonPath),
      "--markdown", path.relative(fixture.isolated.projectRoot, fixture.markdownPath),
      "--force",
      "--skip-standby",
      ...extraArgs
    ], { label: "isolated post-call rehearsal", maxBuffer: 1024 * 1024 * 5 });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
