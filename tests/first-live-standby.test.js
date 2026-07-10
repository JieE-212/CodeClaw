import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "first-live-standby.js");

test("first-live-standby reports ready when first-live reports and files align", async () => {
  const fixture = await makeFixture();
  await writeReadyReports(fixture, "tester-2");
  await writeReadySession(fixture.sessionPath, "tester-2");

  const result = await runStandby(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "FIRST_LIVE_STANDBY_READY");
  assert.equal(report.readyToHost, true);
  assert.equal(report.testerId, "tester-2");
  assert.equal(report.blockers.length, 0);
});

test("first-live-standby waits when tester intake is not filled", async () => {
  const fixture = await makeFixture();
  await writeJson(path.join(fixture.reportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "WAITING_FOR_TESTER_INTAKE",
    testers: [],
    blockers: [],
    warnings: []
  });

  const result = await runStandby(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "FIRST_LIVE_STANDBY_WAITING_FOR_TESTER");
  assert.equal(report.readyToHost, false);
  assert.match(report.nextCommand, /trial:intake/);
});

test("first-live-standby asks for refresh when launch plan is stale", async () => {
  const fixture = await makeFixture();
  await writeReadyReports(fixture, "tester-2", { launchFirstLive: false });
  await writeReadySession(fixture.sessionPath, "tester-2");

  const result = await runStandby(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "FIRST_LIVE_STANDBY_NEEDS_REFRESH");
  assert.equal(report.readyToHost, false);
  assert.match(report.nextCommand, /trial:tester-launch-plan/);
});

test("first-live-standby blocks mismatched tester ids", async () => {
  const fixture = await makeFixture();
  await writeReadyReports(fixture, "tester-2", { hostRunTesterId: "tester-1" });
  await writeReadySession(fixture.sessionPath, "tester-2");

  const result = await runStandby(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "FIRST_LIVE_STANDBY_BLOCKED");
  assert.ok(report.blockers.some((item) => item.includes("hostRun tester tester-1 does not match tester-2")));
});

test("first-live-standby blocks missing live capture file", async () => {
  const fixture = await makeFixture();
  await writeReadyReports(fixture, "tester-2");
  await writeReadySession(fixture.sessionPath, "tester-2", { omit: "LIVE_SESSION_CAPTURE.md" });

  const result = await runStandby(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "FIRST_LIVE_STANDBY_BLOCKED");
  assert.ok(report.blockers.some((item) => item.includes("LIVE_SESSION_CAPTURE.md")));
});

async function makeFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-first-live-standby-"));
  const reportsPath = path.join(tempRoot, "reports");
  const sessionPath = path.join(tempRoot, "session");
  const jsonPath = path.join(tempRoot, "TRIAL_FIRST_LIVE_STANDBY.json");
  const markdownPath = path.join(tempRoot, "TRIAL_FIRST_LIVE_STANDBY.md");
  await fs.mkdir(reportsPath, { recursive: true });
  await fs.mkdir(sessionPath, { recursive: true });
  return { tempRoot, reportsPath, sessionPath, jsonPath, markdownPath };
}

async function writeReadyReports(fixture, testerId, options = {}) {
  await writeJson(path.join(fixture.reportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "READY_FOR_SESSION",
    testers: [tester(testerId)],
    nextTester: tester(testerId),
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(fixture.reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"), {
    ...readyReport("trial-intake-session", "INTAKE_SESSION_READY", testerId, fixture),
    sessionManifest: { testerId }
  });
  await writeJson(path.join(fixture.reportsPath, "TRIAL_HOST_READY_REPORT.json"), readyReport("trial-host-ready", "READY_TO_HOST", testerId, fixture));
  await writeJson(path.join(fixture.reportsPath, "TRIAL_HOST_RUN_REPORT.json"), readyReport("trial-host-run", "HOST_RUN_READY", options.hostRunTesterId || testerId, fixture));
  await writeJson(path.join(fixture.reportsPath, "TRIAL_PRE_LIVE_REPORT.json"), readyReport("trial-pre-live", "PRE_LIVE_READY_TO_HOST", testerId, fixture));
  await writeJson(path.join(fixture.reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"), readyReport("trial-live-capture", "LIVE_CAPTURE_READY", testerId, fixture));
  await writeJson(path.join(fixture.reportsPath, "TRIAL_TESTER_LAUNCH_PLAN.json"), {
    ok: true,
    mode: "trial-tester-launch-plan",
    decision: "TESTER_LAUNCH_READY_TO_HOST",
    testerId,
    firstLive: options.launchFirstLive !== false,
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(fixture.reportsPath, "TRIAL_STATUS_REPORT.json"), {
    ok: true,
    mode: "trial-status",
    decision: "READY_TO_HOST",
    blockers: [],
    warnings: []
  });
}

async function writeReadySession(sessionPath, testerId, options = {}) {
  const files = {
    "SESSION_BRIEF.md": "# Session Brief\n\nStart with Demo and real-read-only.\n",
    "HOST_RUNBOOK.md": "# Host Runbook\n\nStop before Apply on every real project.\n",
    "LIVE_SESSION_CAPTURE.md": "# Live Capture\n\nStop before Apply on every real project.\n",
    "LIVE_SESSION_HOST_SUMMARY.md": "# Host Summary\n",
    "HUMAN_TRIAL_OBSERVATION.md": "# Observation\n",
    "TRIAL_FEEDBACK_TEMPLATE.md": "# Feedback\n",
    "TRIAL_RESULT_RECORD.md": "# Result\n"
  };
  for (const [file, text] of Object.entries(files)) {
    if (options.omit === file) continue;
    await fs.writeFile(path.join(sessionPath, file), text, "utf8");
  }
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    testerId,
    testerIntake: {
      consent: true,
      privacyAccepted: true,
      allowedScope: ["demo", "real-read-only"]
    }
  });
}

function tester(testerId) {
  return {
    id: testerId,
    language: "zh-CN",
    hostLanguage: "zh-CN",
    consent: true,
    privacyAccepted: true,
    allowedScope: ["demo", "real-read-only"],
    ready: true,
    blocked: false,
    needsReview: false
  };
}

function readyReport(mode, decision, testerId, fixture) {
  return {
    ok: true,
    mode,
    decision,
    testerId,
    sessionFolder: fixture.sessionPath,
    sessionRelativePath: path.relative(rootPath, fixture.sessionPath),
    blockers: [],
    warnings: []
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runStandby(fixture) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      scriptPath,
      "--tester", "tester-2",
      "--reports", path.relative(rootPath, fixture.reportsPath),
      "--session", path.relative(rootPath, fixture.sessionPath),
      "--json", path.relative(rootPath, fixture.jsonPath),
      "--markdown", path.relative(rootPath, fixture.markdownPath)
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
