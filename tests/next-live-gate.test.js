import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "next-live-gate.js");

test("next-live passes when after-live and next tester launch reports are aligned", async () => {
  const fixture = await makeFixture({ testerId: "tester-2", previousTester: "tester-1", watchId: "WATCH-1" });
  const result = await runNextLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.decision, "NEXT_LIVE_READY_WITH_REVIEW");
  assert.equal(report.previousTester, "tester-1");
  assert.equal(report.testerId, "tester-2");
  assert.equal(report.watchItems.length, 1);
  assert.ok(await exists(path.join(fixture.sessionPath, "NEXT_LIVE_HOST_HANDOFF.md")));
});

test("next-live blocks when the next launch still points to the previous tester", async () => {
  const fixture = await makeFixture({ testerId: "tester-1", previousTester: "tester-1", watchId: "" });
  const result = await runNextLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "NEXT_LIVE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("matches the previous tester")));
});

test("next-live blocks when after-live is missing", async () => {
  const fixture = await makeFixture({ testerId: "tester-2", previousTester: "tester-1", watchId: "" });
  await fs.rm(path.join(fixture.runRoot, "TRIAL_AFTER_LIVE_REPORT.json"), { force: true });

  const result = await runNextLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "NEXT_LIVE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("After-live report is missing")));
});

test("next-live blocks stale watch items that are not copied into the next host files", async () => {
  const fixture = await makeFixture({ testerId: "tester-2", previousTester: "tester-1", watchId: "WATCH-MISSING" });
  await fs.writeFile(path.join(fixture.sessionPath, "HOST_RUNBOOK.md"), "# Host Runbook\n\nNo watch marker here.\n", "utf8");

  const result = await runNextLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "NEXT_LIVE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("HOST_RUNBOOK.md is missing accepted watch item WATCH-MISSING")));
});

async function makeFixture({ testerId, previousTester, watchId }) {
  const safeId = testerId.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
  const runRoot = path.join(rootPath, "dist", `next-live-test-${process.pid}-${Date.now()}-${safeId}`);
  const sessionPath = path.join(runRoot, "trial-session-packs", testerId);
  const jsonPath = path.join(runRoot, "TRIAL_NEXT_LIVE_REPORT.json");
  const markdownPath = path.join(runRoot, "TRIAL_NEXT_LIVE_REPORT.md");
  await fs.mkdir(sessionPath, { recursive: true });

  const watchItems = watchId ? [watchItem(watchId)] : [];
  await writeJson(path.join(runRoot, "TRIAL_AFTER_LIVE_REPORT.json"), {
    ok: true,
    mode: "trial-after-live",
    decision: watchId ? "AFTER_LIVE_READY_WITH_REVIEW" : "AFTER_LIVE_READY",
    testerId: previousTester,
    nextTester: testerId,
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "TRIAL_TESTER_INTAKE_REPORT.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "READY_FOR_SESSION",
    nextTester: testerRecord(testerId),
    testers: [testerRecord(testerId)],
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "TRIAL_INTAKE_SESSION_REPORT.json"), readyReport("trial-intake-session", "INTAKE_SESSION_READY", testerId, sessionPath));
  await writeJson(path.join(runRoot, "TRIAL_HOST_READY_REPORT.json"), {
    ...readyReport("trial-host-ready", "READY_TO_HOST", testerId, sessionPath),
    watchItems
  });
  await writeJson(path.join(runRoot, "TRIAL_HOST_RUN_REPORT.json"), {
    ...readyReport("trial-host-run", "HOST_RUN_READY", testerId, sessionPath),
    watchItems
  });
  await writeJson(path.join(runRoot, "TRIAL_PRE_LIVE_REPORT.json"), readyReport("trial-pre-live", "PRE_LIVE_READY_TO_HOST", testerId, sessionPath));
  await writeJson(path.join(runRoot, "TRIAL_LIVE_CAPTURE_REPORT.json"), readyReport("trial-live-capture", "LIVE_CAPTURE_READY", testerId, sessionPath));
  await writeJson(path.join(runRoot, "TRIAL_REVIEW_REPORT.json"), {
    ok: true,
    mode: "trial-review-session",
    decision: watchId ? "REVIEW_WATCH_NEXT_TESTER" : "REVIEW_PROCEED",
    testerId: previousTester,
    actionItems: watchItems.map((item) => ({ ...item, lane: "watch" })),
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "TRIAL_FIX_BACKLOG.json"), {
    ok: true,
    mode: "trial-fix-backlog",
    decision: watchId ? "WATCH_DURING_TESTER_2" : "NO_FIXES_REQUIRED",
    watchDuringTester2: watchItems,
    blockers: [],
    warnings: []
  });
  await writeSessionFiles(sessionPath, testerId, watchItems);

  return {
    runRoot,
    sessionPath,
    jsonPath,
    args: [
      "--reports", path.relative(rootPath, runRoot),
      "--tester", testerId,
      "--session", path.relative(rootPath, sessionPath),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath),
      "--accept-review",
      "--accepted-by", "host-test"
    ]
  };
}

function readyReport(mode, decision, testerId, sessionPath) {
  return {
    ok: true,
    mode,
    decision,
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  };
}

function testerRecord(testerId) {
  return {
    id: testerId,
    language: "zh-CN",
    hostLanguage: "zh-CN",
    allowedScope: ["demo", "real-read-only"],
    ready: true,
    blocked: false,
    needsReview: false,
    consent: true,
    privacyAccepted: true
  };
}

function watchItem(id) {
  return {
    id,
    priority: "P1",
    title: "Check tester confusion around read-only preflight",
    owner: "Host",
    action: "Watch during the next live session",
    verificationCommand: "npm.cmd run trial:next-live",
    evidence: ["Previous tester asked for a clearer stop condition."]
  };
}

async function writeSessionFiles(sessionPath, testerId, watchItems) {
  const watchText = watchItems.map((item) => `${item.id}: ${item.title}`).join("\n");
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), `# Session Brief\n\nTester id: ${testerId}\n${watchText}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HOST_RUNBOOK.md"), `# Host Runbook\n\nTester id: ${testerId}\n${watchText}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), `# Observation\n\nTester id: ${testerId}\n${watchText}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "# Feedback\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), "# Result\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "LIVE_SESSION_CAPTURE.md"), "# Live Capture\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "LIVE_SESSION_HOST_SUMMARY.md"), "# Host Summary\n\nReady.\n", "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath,
    outputRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    watchItems
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNextLive(args) {
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

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
