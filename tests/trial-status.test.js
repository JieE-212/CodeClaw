import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "trial-status.js");

test("trial-status starts with readiness when reports are missing", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-empty-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_READINESS");
  assert.equal(report.currentStage, "preflight");
  assert.equal(report.nextCommand, "npm.cmd run trial:ready");
});

test("trial-status asks for host runbook before ready-to-host state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-host-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeJson(tempRoot, "TRIAL_READINESS_REPORT.json", { ok: true, mode: "trial-readiness", packagePath: "dist/CodeClaw-local-trial-20260709" });
  await writeJson(tempRoot, "TRIAL_FREEZE_REPORT.json", { ok: true, mode: "trial-freeze", decision: "GO_HOSTED_TRIAL", blockers: [] });
  await writeJson(tempRoot, "TRIAL_DISPATCH_NOTE.json", { ok: true, mode: "trial-dispatch", decision: "READY_TO_SEND", blockers: [] });
  await writeJson(tempRoot, "TRIAL_HOST_READY_REPORT.json", { ok: true, mode: "trial-host-ready", decision: "READY_TO_HOST", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_HOST_RUN");
  assert.equal(report.currentStage, "hosting");
  assert.match(report.nextCommand, /trial:host-run/);
});

test("trial-status asks for pre-live gate after host runbook", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-host-run-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_HOST_RUN_REPORT.json", { ok: true, mode: "trial-host-run", decision: "HOST_RUN_READY", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_PRE_LIVE");
  assert.equal(report.currentStage, "hosting");
  assert.match(report.nextCommand, /trial:pre-live/);
});

test("trial-status asks for live capture after pre-live gate", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-pre-live-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_HOST_RUN_REPORT.json", { ok: true, mode: "trial-host-run", decision: "HOST_RUN_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_PRE_LIVE_REPORT.json", { ok: true, mode: "trial-pre-live", decision: "PRE_LIVE_READY_TO_HOST", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_LIVE_CAPTURE");
  assert.equal(report.currentStage, "hosting");
  assert.match(report.nextCommand, /trial:live-capture/);
});

test("trial-status recognizes ready-to-host state after live capture", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-live-capture-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_HOST_RUN_REPORT.json", { ok: true, mode: "trial-host-run", decision: "HOST_RUN_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_PRE_LIVE_REPORT.json", { ok: true, mode: "trial-pre-live", decision: "PRE_LIVE_READY_TO_HOST", blockers: [] });
  await writeJson(tempRoot, "TRIAL_LIVE_CAPTURE_REPORT.json", { ok: true, mode: "trial-live-capture", decision: "LIVE_CAPTURE_READY", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "READY_TO_HOST");
  assert.equal(report.currentStage, "hosting");
  assert.match(report.nextCommand, /trial:complete-session/);
});

test("trial-status recognizes ready-for-post-session after completion check", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-complete-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_HOST_RUN_REPORT.json", { ok: true, mode: "trial-host-run", decision: "HOST_RUN_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_PRE_LIVE_REPORT.json", { ok: true, mode: "trial-pre-live", decision: "PRE_LIVE_READY_TO_HOST", blockers: [] });
  await writeJson(tempRoot, "TRIAL_LIVE_CAPTURE_REPORT.json", { ok: true, mode: "trial-live-capture", decision: "LIVE_CAPTURE_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_SESSION_COMPLETION_REPORT.json", { ok: true, mode: "trial-session-completion", decision: "SESSION_COMPLETION_READY", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "READY_FOR_POST_SESSION");
  assert.equal(report.currentStage, "post-session");
  assert.match(report.nextCommand, /trial:post-session/);
});

test("trial-status blocks when completion check holds", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-complete-hold-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_HOST_RUN_REPORT.json", { ok: true, mode: "trial-host-run", decision: "HOST_RUN_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_PRE_LIVE_REPORT.json", { ok: true, mode: "trial-pre-live", decision: "PRE_LIVE_READY_TO_HOST", blockers: [] });
  await writeJson(tempRoot, "TRIAL_LIVE_CAPTURE_REPORT.json", { ok: true, mode: "trial-live-capture", decision: "LIVE_CAPTURE_READY", blockers: [] });
  await writeJson(tempRoot, "TRIAL_SESSION_COMPLETION_REPORT.json", {
    ok: false,
    mode: "trial-session-completion",
    decision: "SESSION_COMPLETION_HOLD",
    blockers: ["Feedback is missing: Goal."]
  });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "SESSION_COMPLETION_BLOCKED");
  assert.equal(report.currentStage, "post-session");
  assert.ok(report.blockers.some((item) => item.includes("Feedback is missing")));
});

test("trial-status blocks on privacy hold", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-privacy-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_PRIVACY_REPORT.json", { ok: false, mode: "trial-privacy-check", decision: "PRIVACY_HOLD", blockers: ["secret found"] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "PRIVACY_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Privacy is PRIVACY_HOLD")));
  assert.match(report.nextCommand, /trial:privacy-check/);
});

test("trial-status asks for review after post-session", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-review-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_PRIVACY_REPORT.json", { ok: true, mode: "trial-privacy-check", decision: "PRIVACY_OK", blockers: [] });
  await writeJson(tempRoot, "TRIAL_POST_SESSION_REPORT.json", { ok: true, mode: "trial-post-session", decision: "READY_FOR_NEXT_TESTER", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_SESSION_REVIEW");
  assert.equal(report.currentStage, "review");
  assert.match(report.nextCommand, /trial:review-session/);
});

test("trial-status recognizes archived expansion-ready state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-ready-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_PRIVACY_REPORT.json", { ok: true, mode: "trial-privacy-check", decision: "PRIVACY_OK", blockers: [] });
  await writeJson(tempRoot, "TRIAL_POST_SESSION_REPORT.json", { ok: true, mode: "trial-post-session", decision: "READY_FOR_NEXT_TESTER", blockers: [] });
  await writeJson(tempRoot, "TRIAL_REVIEW_REPORT.json", { ok: true, mode: "trial-review-session", decision: "REVIEW_WATCH_NEXT_TESTER", blockers: [] });
  await writeJson(tempRoot, "TRIAL_ARCHIVE_REPORT.json", { ok: true, mode: "trial-archive-session", decision: "ARCHIVE_READY_LOCAL", blockers: [] });
  await writeJson(tempRoot, "TRIAL_TESTER_INTAKE_REPORT.json", { ok: true, mode: "trial-tester-intake", decision: "READY_FOR_SESSION", blockers: [] });
  await writeJson(tempRoot, "TRIAL_COHORT_SUMMARY.json", { ok: true, mode: "trial-cohort-summary", decision: "EXPAND_WITH_WATCH", blockers: [] });

  const archiveFolder = path.join(tempRoot, "trial-archives", "tester-1-20260709-120000");
  await fs.mkdir(archiveFolder, { recursive: true });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "READY_TO_EXPAND");
  assert.equal(report.currentStage, "cohort");
  assert.equal(report.quickLinks.latestArchive, path.relative(rootPath, archiveFolder).split(path.sep).join("/"));
});

test("trial-status asks for tester intake before the next session pack", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-status-intake-"));
  const jsonPath = path.join(tempRoot, "status.json");
  const markdownPath = path.join(tempRoot, "status.md");

  await writeReadyHostReports(tempRoot);
  await writeJson(tempRoot, "TRIAL_PRIVACY_REPORT.json", { ok: true, mode: "trial-privacy-check", decision: "PRIVACY_OK", blockers: [] });
  await writeJson(tempRoot, "TRIAL_POST_SESSION_REPORT.json", { ok: true, mode: "trial-post-session", decision: "READY_FOR_NEXT_TESTER", blockers: [] });
  await writeJson(tempRoot, "TRIAL_REVIEW_REPORT.json", { ok: true, mode: "trial-review-session", decision: "REVIEW_PROCEED", blockers: [] });
  await writeJson(tempRoot, "TRIAL_ARCHIVE_REPORT.json", { ok: true, mode: "trial-archive-session", decision: "ARCHIVE_READY_LOCAL", blockers: [] });

  const result = await runStatus(["--dist", tempRoot, "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "NEEDS_TESTER_INTAKE");
  assert.equal(report.currentStage, "intake");
  assert.match(report.nextCommand, /trial:intake/);
});

async function writeReadyHostReports(folder) {
  await writeJson(folder, "TRIAL_READINESS_REPORT.json", { ok: true, mode: "trial-readiness", blockers: [] });
  await writeJson(folder, "TRIAL_FREEZE_REPORT.json", { ok: true, mode: "trial-freeze", decision: "GO_HOSTED_TRIAL", blockers: [] });
  await writeJson(folder, "TRIAL_DISPATCH_NOTE.json", { ok: true, mode: "trial-dispatch", decision: "READY_TO_SEND", blockers: [] });
  await writeJson(folder, "TRIAL_HOST_READY_REPORT.json", { ok: true, mode: "trial-host-ready", decision: "READY_TO_HOST", blockers: [] });
}

async function writeJson(folder, name, value) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runStatus(args) {
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
