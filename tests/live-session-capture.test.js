import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedProject } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("live-capture writes host capture files for a clean session folder", async (t) => {
  const fixture = await makeFixture(t, "tester-1");
  const result = await runLiveCapture(fixture);
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
  const fixture = await makeFixture(t, "tester-1");
  await fs.writeFile(path.join(fixture.sessionPath, "screenshot.png"), "not a real image", "utf8");
  await fs.appendFile(path.join(fixture.sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "\n- Name: Real Person\n- Contact: person@example.com\n", "utf8");

  const result = await runLiveCapture(fixture);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "LIVE_CAPTURE_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("screenshot.png")));
  assert.ok(report.blockers.some((item) => item.includes("Personal email")));
  assert.ok(report.blockers.some((item) => item.includes("Personal Name field")));
});

async function makeFixture(t, testerId) {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-live-capture-");
  const projectRoot = isolated.projectRoot;
  const runRoot = path.join(projectRoot, "dist", "live-capture-test");
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
    sessionRelativePath: path.relative(projectRoot, sessionPath).split(path.sep).join("/"),
    blockers: [],
    warnings: []
  });
  return {
    isolated,
    runRoot,
    sessionPath,
    jsonPath,
    args: [
      "--tester", testerId,
      "--session", path.relative(projectRoot, sessionPath),
      "--pre-live", path.relative(projectRoot, preLivePath),
      "--json", path.relative(projectRoot, jsonPath),
      "--markdown", path.relative(projectRoot, markdownPath)
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

function runLiveCapture(fixture) {
  return fixture.isolated.execNodeScript("live-session-capture.js", fixture.args, { label: "isolated live-session capture" });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
