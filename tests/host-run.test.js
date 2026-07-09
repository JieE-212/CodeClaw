import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "generate-host-run.js");

test("host-run writes a live runbook when host-ready and intake-session are ready", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-host-run-ok-"));
  const sessionPath = path.join(tempRoot, "tester-1");
  const hostReadyPath = path.join(tempRoot, "TRIAL_HOST_READY_REPORT.json");
  const intakeSessionPath = path.join(tempRoot, "TRIAL_INTAKE_SESSION_REPORT.json");
  const jsonPath = path.join(tempRoot, "host-run-report.json");
  const markdownPath = path.join(tempRoot, "host-run-report.md");

  await writeSessionPack(sessionPath, "tester-1");
  await writeJson(hostReadyPath, {
    ok: true,
    mode: "trial-host-ready",
    decision: "READY_TO_HOST",
    testerId: "tester-1",
    sessionFolder: sessionPath,
    blockers: [],
    warnings: [],
    watchItems: [{ id: "W1", title: "Watch language switch", action: "Observe hesitation.", evidence: ["prior feedback"] }]
  });
  await writeJson(intakeSessionPath, {
    ok: true,
    mode: "trial-intake-session",
    decision: "INTAKE_SESSION_READY",
    testerId: "tester-1",
    tester: {
      id: "tester-1",
      language: "zh-CN",
      hostLanguage: "zh-CN",
      allowedScope: ["demo", "real-read-only"],
      needsReview: false
    }
  });

  const result = await runHostRun([
    "--host-ready", hostReadyPath,
    "--intake-session", intakeSessionPath,
    "--json", jsonPath,
    "--markdown", markdownPath
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const runbook = await fs.readFile(path.join(sessionPath, "HOST_RUNBOOK.md"), "utf8");

  assert.equal(result.code, 0);
  assert.equal(report.decision, "HOST_RUN_READY");
  assert.equal(report.testerId, "tester-1");
  assert.match(report.runbookRelativePath, /HOST_RUNBOOK\.md$/);
  assert.match(runbook, /CodeClaw Live Host Runbook/);
  assert.match(runbook, /Tester language: zh-CN/);
  assert.match(runbook, /W1 Watch language switch/);
});

test("host-run blocks when host-ready is not ready", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-host-run-hold-"));
  const sessionPath = path.join(tempRoot, "tester-1");
  const hostReadyPath = path.join(tempRoot, "TRIAL_HOST_READY_REPORT.json");
  const jsonPath = path.join(tempRoot, "host-run-report.json");
  const markdownPath = path.join(tempRoot, "host-run-report.md");

  await fs.mkdir(sessionPath, { recursive: true });
  await writeJson(hostReadyPath, {
    ok: false,
    mode: "trial-host-ready",
    decision: "HOLD",
    testerId: "tester-1",
    sessionFolder: sessionPath,
    blockers: ["missing package"],
    warnings: []
  });

  const result = await runHostRun([
    "--host-ready", hostReadyPath,
    "--json", jsonPath,
    "--markdown", markdownPath
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "HOST_RUN_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Host-ready report is not ok")));
  assert.equal(await exists(path.join(sessionPath, "HOST_RUNBOOK.md")), false);
});

async function writeSessionPack(sessionPath, testerId) {
  await fs.mkdir(sessionPath, { recursive: true });
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), "# Session Brief\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), "# Observation\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "# Feedback\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), "# Result\n", "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath,
    outputRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    testerIntake: {
      id: testerId,
      language: "zh-CN",
      hostLanguage: "zh-CN",
      allowedScope: ["demo", "real-read-only"],
      needsReview: false
    }
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runHostRun(args) {
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
