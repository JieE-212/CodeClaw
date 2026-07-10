import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "tester-launch-plan.js");

test("tester-launch-plan waits for local tester intake when roster is empty", async () => {
  const fixture = await makeFixture();
  await writeJson(path.join(fixture.reportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "WAITING_FOR_TESTER_INTAKE",
    testers: [],
    nextTester: null,
    blockers: [],
    warnings: ["Roster has no tester entries."]
  });

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_WAITING_FOR_INTAKE");
  assert.match(report.nextCommand, /trial:intake/);
  assert.ok(report.rosterChecklist.some((item) => item.includes("tester-2")));
});

test("tester-launch-plan recommends intake-session after ready intake", async () => {
  const fixture = await makeFixture();
  await writeReadyIntake(fixture.reportsPath, "tester-2");

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_READY_FOR_INTAKE_SESSION");
  assert.equal(report.testerId, "tester-2");
  assert.match(report.nextCommand, /trial:intake-session/);
});

test("tester-launch-plan treats stale current-step holds as rerun warnings", async () => {
  const fixture = await makeFixture();
  await writeReadyIntake(fixture.reportsPath, "tester-2");
  await writeJson(path.join(fixture.reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"), {
    ok: false,
    mode: "trial-intake-session",
    decision: "INTAKE_SESSION_HOLD",
    testerId: "tester-2",
    blockers: ["old hold"],
    warnings: []
  });

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_READY_FOR_INTAKE_SESSION");
  assert.ok(report.warnings.some((item) => item.includes("intake-session report is not ok yet")));
  assert.ok(report.warnings.some((item) => item.includes("INTAKE_SESSION_HOLD")));
});

test("tester-launch-plan reaches ready-to-host after next-live passes", async () => {
  const fixture = await makeFixture();
  await writeFullLaunchReports(fixture.reportsPath, "tester-2");

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_READY_TO_HOST");
  assert.equal(report.currentStep, "host");
  assert.match(report.nextCommand, /NEXT_LIVE_HOST_HANDOFF/);
});

test("tester-launch-plan can launch a first real tester without previous after-live", async () => {
  const fixture = await makeFixture(["--first-live"]);
  await writeFirstLiveReports(fixture.reportsPath, "tester-2");

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_READY_TO_HOST");
  assert.equal(report.firstLive, true);
  assert.equal(report.previousTester, "");
  assert.match(report.nextCommand, /BEGINNER_FIRST_LIVE_GUIDE/);
  assert.match(report.nextCommand, /LIVE_SESSION_CAPTURE/);
  assert.ok(report.nextSteps.some((item) => item.includes("record-draft")));
  assert.ok(!report.commandSequence.some((item) => item.includes("trial:next-live")));
});

test("tester-launch-plan blocks mismatched tester ids", async () => {
  const fixture = await makeFixture();
  await writeReadyIntake(fixture.reportsPath, "tester-2");
  await writeJson(path.join(fixture.reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"), readyReport("trial-intake-session", "INTAKE_SESSION_READY", "tester-2"));
  await writeJson(path.join(fixture.reportsPath, "TRIAL_HOST_READY_REPORT.json"), {
    ok: true,
    mode: "trial-host-ready",
    decision: "READY_TO_HOST",
    testerId: "tester-1",
    blockers: [],
    warnings: []
  });

  const result = await runPlan(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "TESTER_LAUNCH_BLOCKED");
  assert.ok(report.blockers.some((item) => item.includes("does not match target tester tester-2")));
});

async function makeFixture(extraArgs = []) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-launch-plan-"));
  const reportsPath = path.join(tempRoot, "reports");
  const jsonPath = path.join(tempRoot, "TRIAL_TESTER_LAUNCH_PLAN.json");
  const markdownPath = path.join(tempRoot, "TRIAL_TESTER_LAUNCH_PLAN.md");
  await fs.mkdir(reportsPath, { recursive: true });
  return {
    reportsPath,
    jsonPath,
    args: [
      "--tester", "tester-2",
      "--reports", path.relative(rootPath, reportsPath),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath),
      ...extraArgs
    ]
  };
}

async function writeReadyIntake(reportsPath, testerId) {
  await writeJson(path.join(reportsPath, "TRIAL_TESTER_INTAKE_REPORT.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "READY_FOR_SESSION",
    testers: [tester(testerId)],
    nextTester: tester(testerId),
    blockers: [],
    warnings: []
  });
}

async function writeFullLaunchReports(reportsPath, testerId) {
  await writeReadyIntake(reportsPath, testerId);
  await writeJson(path.join(reportsPath, "TRIAL_AFTER_LIVE_REPORT.json"), {
    ok: true,
    mode: "trial-after-live",
    decision: "AFTER_LIVE_READY",
    testerId: "tester-1",
    nextTester: testerId,
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"), readyReport("trial-intake-session", "INTAKE_SESSION_READY", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_HOST_READY_REPORT.json"), readyReport("trial-host-ready", "READY_TO_HOST", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_HOST_RUN_REPORT.json"), readyReport("trial-host-run", "HOST_RUN_READY", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_PRE_LIVE_REPORT.json"), readyReport("trial-pre-live", "PRE_LIVE_READY_TO_HOST", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"), readyReport("trial-live-capture", "LIVE_CAPTURE_READY", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_NEXT_LIVE_REPORT.json"), readyReport("trial-next-live", "NEXT_LIVE_READY", testerId));
}

async function writeFirstLiveReports(reportsPath, testerId) {
  await writeReadyIntake(reportsPath, testerId);
  await writeJson(path.join(reportsPath, "TRIAL_INTAKE_SESSION_REPORT.json"), readyReport("trial-intake-session", "INTAKE_SESSION_READY", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_HOST_READY_REPORT.json"), readyReport("trial-host-ready", "READY_TO_HOST", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_HOST_RUN_REPORT.json"), readyReport("trial-host-run", "HOST_RUN_READY", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_PRE_LIVE_REPORT.json"), readyReport("trial-pre-live", "PRE_LIVE_READY_TO_HOST", testerId));
  await writeJson(path.join(reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"), readyReport("trial-live-capture", "LIVE_CAPTURE_READY", testerId));
}

function tester(testerId) {
  return {
    id: testerId,
    language: "zh-CN",
    hostLanguage: "zh-CN",
    allowedScope: ["demo", "real-read-only"],
    ready: true,
    needsReview: false,
    blocked: false
  };
}

function readyReport(mode, decision, testerId) {
  return {
    ok: true,
    mode,
    decision,
    testerId,
    blockers: [],
    warnings: []
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runPlan(args) {
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
