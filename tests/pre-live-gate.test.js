import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "pre-live-gate.js");

test("pre-live gate passes when real tester reports are aligned", async () => {
  const fixture = await makeFixture("tester-1");
  const result = await runPreLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "PRE_LIVE_READY_TO_HOST");
  assert.equal(report.testerId, "tester-1");
  assert.equal(report.blockers.length, 0);
  assert.match(report.sessionRelativePath, /dist\/pre-live-test-/);
  assert.ok(report.launchCommands.some((item) => item.includes("trial:pre-live")));
});

test("pre-live gate blocks dry-run tester ids", async () => {
  const fixture = await makeFixture("tester-dry-run-1");
  const result = await runPreLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "PRE_LIVE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("dry-run tester ids cannot be used")));
});

async function makeFixture(testerId) {
  const safeId = testerId.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();
  const runRoot = path.join(rootPath, "dist", `pre-live-test-${process.pid}-${Date.now()}-${safeId}`);
  const sessionPath = path.join(runRoot, "session");
  const rosterPath = path.join(runRoot, "TESTER_ROSTER.json");
  const jsonPath = path.join(runRoot, "TRIAL_PRE_LIVE_REPORT.json");
  const markdownPath = path.join(runRoot, "TRIAL_PRE_LIVE_REPORT.md");
  await fs.mkdir(sessionPath, { recursive: true });

  await writeJson(rosterPath, {
    localOnly: true,
    testers: [testerRecord(testerId)]
  });
  await writeJson(path.join(runRoot, "DRY_RUN.json"), {
    ok: true,
    mode: "trial-intake-review-dry-run",
    decision: "DRY_RUN_READY_FOR_REAL_INTAKE",
    blockers: []
  });
  await writeJson(path.join(runRoot, "INTAKE.json"), {
    ok: true,
    mode: "trial-tester-intake",
    decision: "READY_FOR_SESSION",
    rosterRelativePath: path.relative(rootPath, rosterPath).split(path.sep).join("/"),
    testers: [{
      id: testerId,
      language: "zh-CN",
      hostLanguage: "zh-CN",
      allowedScope: ["demo", "real-read-only"],
      ready: true,
      needsReview: false,
      blocked: false
    }],
    nextTester: {
      id: testerId,
      language: "zh-CN",
      hostLanguage: "zh-CN",
      allowedScope: ["demo", "real-read-only"],
      ready: true,
      needsReview: false,
      blocked: false
    },
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "INTAKE_SESSION.json"), {
    ok: true,
    mode: "trial-intake-session",
    decision: "INTAKE_SESSION_READY",
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "HOST_READY.json"), {
    ok: true,
    mode: "trial-host-ready",
    decision: "READY_TO_HOST",
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "HOST_RUN.json"), {
    ok: true,
    mode: "trial-host-run",
    decision: "HOST_RUN_READY",
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(runRoot, "STATUS.json"), {
    ok: true,
    mode: "trial-status",
    decision: "NEEDS_PRE_LIVE",
    blockers: [],
    warnings: []
  });
  await writeSessionFiles(sessionPath, testerId);

  return {
    jsonPath,
    args: [
      "--allow-custom-roster",
      "--tester", testerId,
      "--roster", path.relative(rootPath, rosterPath),
      "--dry-run", path.relative(rootPath, path.join(runRoot, "DRY_RUN.json")),
      "--intake", path.relative(rootPath, path.join(runRoot, "INTAKE.json")),
      "--intake-session", path.relative(rootPath, path.join(runRoot, "INTAKE_SESSION.json")),
      "--host-ready", path.relative(rootPath, path.join(runRoot, "HOST_READY.json")),
      "--host-run", path.relative(rootPath, path.join(runRoot, "HOST_RUN.json")),
      "--status", path.relative(rootPath, path.join(runRoot, "STATUS.json")),
      "--session", path.relative(rootPath, sessionPath),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath)
    ]
  };
}

function testerRecord(testerId) {
  return {
    id: testerId,
    language: "zh-CN",
    hostLanguage: "zh-CN",
    consent: true,
    privacyAccepted: true,
    allowedScope: ["demo", "real-read-only"],
    projectPermission: "Tester confirmed they may inspect the chosen local project.",
    status: "ready"
  };
}

async function writeSessionFiles(sessionPath, testerId) {
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), `# Session\n\nTester id: ${testerId}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HOST_RUNBOOK.md"), `# Runbook\n\nTester id: ${testerId}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), "# Observation\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "# Feedback\n\nReady.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), "# Result\n\nReady.\n", "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath,
    outputRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    testerIntake: {
      id: testerId,
      consent: true,
      privacyAccepted: true,
      needsReview: false
    }
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runPreLive(args) {
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
