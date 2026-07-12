import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "live-session-capture.js");

test("live-capture writes host capture files for a clean session folder", async (t) => {
  const fixture = await makeFixture("tester-1");
  t.after(() => fs.rm(fixture.runRoot, { recursive: true, force: true }));
  const result = await runLiveCapture(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "LIVE_CAPTURE_READY");
  assert.equal(report.blockers.length, 0);
  assert.ok(await exists(path.join(fixture.sessionPath, "LIVE_SESSION_CAPTURE.md")));
  assert.ok(await exists(path.join(fixture.sessionPath, "LIVE_SESSION_HOST_SUMMARY.md")));
  assert.ok(report.afterCallCommands.some((item) => item.includes("trial:record-draft")));
  assert.ok(report.afterCallCommands.some((item) => item.includes("trial:after-live")));
  assert.equal(report.afterCallCommands.length, 2);
  assert.ok(report.hygiene.scannedFiles.some((item) => item.endsWith("BEGINNER_FIRST_LIVE_GUIDE.md")));
});

test("live-capture blocks screenshots and personal contact data", async (t) => {
  const fixture = await makeFixture("tester-1");
  t.after(() => fs.rm(fixture.runRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture.sessionPath, "screenshot.png"), "not a real image", "utf8");
  await fs.appendFile(path.join(fixture.sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "\n- Name: Real Person\n- Contact: person@example.com\n", "utf8");

  const result = await runLiveCapture(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "LIVE_CAPTURE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("screenshot.png")));
  assert.ok(report.blockers.some((item) => item.includes("Personal email")));
  assert.ok(report.blockers.some((item) => item.includes("Personal Name field")));
});

async function makeFixture(testerId) {
  const runRoot = path.join(rootPath, "dist", `live-capture-test-${process.pid}-${Date.now()}`);
  const sessionPath = path.join(runRoot, "session");
  const preLivePath = path.join(runRoot, "TRIAL_PRE_LIVE_REPORT.json");
  const jsonPath = path.join(runRoot, "TRIAL_LIVE_CAPTURE_REPORT.json");
  const markdownPath = path.join(runRoot, "TRIAL_LIVE_CAPTURE_REPORT.md");
  await fs.mkdir(sessionPath, { recursive: true });
  await writeSessionFiles(sessionPath, testerId);
  await writeJson(preLivePath, {
    ok: true,
    mode: "trial-pre-live",
    decision: "PRE_LIVE_READY_TO_HOST",
    testerId,
    sessionFolder: sessionPath,
    sessionRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  });
  return {
    runRoot,
    sessionPath,
    jsonPath,
    args: [
      "--tester", testerId,
      "--session", path.relative(rootPath, sessionPath),
      "--pre-live", path.relative(rootPath, preLivePath),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath)
    ]
  };
}

async function writeSessionFiles(sessionPath, testerId) {
  await fs.writeFile(path.join(sessionPath, "BEGINNER_FIRST_LIVE_GUIDE.md"), "# Beginner Guide\n\nReconfirm consent.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), `# Session\n\nTester id: ${testerId}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HOST_RUNBOOK.md"), `# Runbook\n\nTester id: ${testerId}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), "# Observation\n\n- Tester: tester-1\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "# Feedback\n\n- Name: tester-1\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), "# Result\n\n- Host: codeclaw-host\n", "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runLiveCapture(args) {
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
