import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedProject } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("intake-session generates a tester session pack from ready intake", async (t) => {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-intake-session-ok-");
  const tempRoot = isolated.path("inputs");
  await fs.mkdir(tempRoot, { recursive: true });
  const intakePath = path.join(tempRoot, "TRIAL_TESTER_INTAKE_REPORT.json");
  const outputPath = path.join(isolated.projectRoot, "dist", "test-intake-session", "tester-ok");
  const jsonPath = path.join(tempRoot, "intake-session-report.json");
  const markdownPath = path.join(tempRoot, "intake-session-report.md");

  await writeJson(intakePath, readyIntakeReport());

  const result = await runIntakeSession(isolated, [
    "--intake", intakePath,
    "--out", outputPath,
    "--json", jsonPath,
    "--markdown", markdownPath,
    "--force"
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  const manifest = JSON.parse(await fs.readFile(path.join(outputPath, "SESSION_PACK_MANIFEST.json"), "utf8"));
  const brief = await fs.readFile(path.join(outputPath, "SESSION_BRIEF.md"), "utf8");
  const beginnerGuide = await fs.readFile(path.join(outputPath, "BEGINNER_FIRST_LIVE_GUIDE.md"), "utf8");

  assert.equal(result.code, 0);
  assert.equal(report.decision, "INTAKE_SESSION_READY");
  assert.equal(report.testerId, "tester-1");
  assert.equal(manifest.intakeDecision, "READY_FOR_SESSION");
  assert.equal(manifest.testerIntake.language, "zh-CN");
  assert.match(brief, /# Tester Intake/);
  assert.match(brief, /Allowed scope: demo, real-read-only/);
  assert.match(brief, /trial:record-draft/);
  assert.match(brief, /trial:after-live/);
  assert.doesNotMatch(brief, /trial:post-session -- --session/);
  assert.ok(manifest.files.includes("BEGINNER_FIRST_LIVE_GUIDE.md"));
  assert.deepEqual(manifest.afterSessionCommands.map((item) => item.includes("trial:")), [true, true]);
  assert.match(beginnerGuide, /CodeClaw 小白真人测试主持操作单/);
  assert.match(beginnerGuide, /trial:first-live-standby -- --tester tester-1/);
  assert.doesNotMatch(beginnerGuide, /\{\{TESTER_ID\}\}/);
});

test("intake-session blocks when intake is not ready", async (t) => {
  const isolated = await createIsolatedProject(t, rootPath, "codeclaw-intake-session-hold-");
  const tempRoot = isolated.path("inputs");
  await fs.mkdir(tempRoot, { recursive: true });
  const intakePath = path.join(tempRoot, "TRIAL_TESTER_INTAKE_REPORT.json");
  const outputPath = path.join(isolated.projectRoot, "dist", "test-intake-session", "tester-hold");
  const jsonPath = path.join(tempRoot, "intake-session-report.json");
  const markdownPath = path.join(tempRoot, "intake-session-report.md");

  await writeJson(intakePath, {
    ok: true,
    mode: "trial-tester-intake",
    decision: "WAITING_FOR_TESTER_INTAKE",
    testers: [],
    nextTester: null
  });

  const result = await runIntakeSession(isolated, [
    "--intake", intakePath,
    "--out", outputPath,
    "--json", jsonPath,
    "--markdown", markdownPath,
    "--force"
  ]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "INTAKE_SESSION_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("WAITING_FOR_TESTER_INTAKE")));
  assert.equal(await exists(path.join(outputPath, "SESSION_PACK_MANIFEST.json")), false);
});

function readyIntakeReport() {
  const tester = {
    id: "tester-1",
    language: "zh-CN",
    hostLanguage: "zh-CN",
    consent: true,
    privacyAccepted: true,
    allowedScope: ["demo", "real-read-only"],
    projectPermission: "recorded",
    status: "ready",
    ready: true,
    needsReview: false,
    blocked: false
  };
  return {
    ok: true,
    mode: "trial-tester-intake",
    decision: "READY_FOR_SESSION",
    testers: [tester],
    nextTester: tester,
    blockers: [],
    warnings: []
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runIntakeSession(isolated, args) {
  return isolated.execNodeScript("generate-intake-session.js", args, { label: "isolated intake-session" });
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
