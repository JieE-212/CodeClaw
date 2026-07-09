import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "review-trial-session.js");

test("review-session proceeds when reports are complete and clean", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-review-proceed-"));
  const jsonPath = path.join(tempRoot, "review.json");
  const markdownPath = path.join(tempRoot, "review.md");

  await writeReportSet(tempRoot, { backlog: { decision: "READY_FOR_TESTER_2" } });

  const result = await runReview(["--reports", tempRoot, "--session", tempRoot, "--tester", "tester-1", "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "REVIEW_PROCEED");
  assert.equal(report.actionItems.length, 0);
});

test("review-session allows next tester with P1 watch ownership and verification", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-review-watch-"));
  const jsonPath = path.join(tempRoot, "review.json");
  const markdownPath = path.join(tempRoot, "review.md");

  await writeReportSet(tempRoot, {
    backlog: {
      decision: "READY_FOR_TESTER_2_WITH_SAFETY_WATCH",
      watchDuringTester2: [{
        id: "P1-001",
        priority: "P1",
        lane: "watch",
        theme: "safety",
        title: "Watch write-boundary confidence",
        action: "Ask tester to explain Apply before continuing.",
        evidence: ["Tester hesitated at Apply."]
      }]
    }
  });

  const result = await runReview(["--reports", tempRoot, "--session", tempRoot, "--tester", "tester-1", "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.equal(result.code, 0);
  assert.equal(report.decision, "REVIEW_WATCH_NEXT_TESTER");
  assert.equal(report.actionItems[0].owner, "Host");
  assert.match(report.actionItems[0].verificationCommand, /trial:host-ready/);
});

test("review-session blocks when P0 must-fix exists", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-review-fix-"));
  const jsonPath = path.join(tempRoot, "review.json");
  const markdownPath = path.join(tempRoot, "review.md");

  await writeReportSet(tempRoot, {
    backlog: {
      decision: "FIX_BLOCKERS_BEFORE_TESTER_2",
      mustFixBeforeTester2: [{
        id: "P0-001",
        priority: "P0",
        lane: "must-fix",
        theme: "startup",
        title: "Fix launch failure",
        action: "Make launcher recovery copy clear.",
        evidence: "App did not launch."
      }]
    }
  });

  const result = await runReview(["--reports", tempRoot, "--session", tempRoot, "--tester", "tester-1", "--json", jsonPath, "--markdown", markdownPath]);
  const report = JSON.parse(await fs.readFile(jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "REVIEW_FIX_NOW");
  assert.equal(report.actionItems[0].owner, "Product owner");
  assert.match(report.actionItems[0].verificationCommand, /trial:simulate/);
});

async function writeReportSet(folder, overrides = {}) {
  const backlog = {
    ok: true,
    mode: "trial-fix-backlog",
    decision: "READY_FOR_TESTER_2",
    mustFixBeforeTester2: [],
    watchDuringTester2: [],
    optionalPolish: [],
    ...(overrides.backlog || {})
  };
  await writeJson(folder, "TRIAL_SESSION_COMPLETION_REPORT.json", {
    ok: true,
    mode: "trial-session-completion",
    decision: "SESSION_COMPLETION_READY",
    blockers: []
  });
  await writeJson(folder, "TRIAL_PRIVACY_REPORT.json", {
    ok: true,
    mode: "trial-privacy-check",
    decision: "PRIVACY_OK",
    blockers: []
  });
  await writeJson(folder, "TRIAL_FEEDBACK_SUMMARY.json", {
    ok: true,
    mode: "trial-feedback-ingest",
    decision: "READY_FOR_TESTER_2",
    blockers: [],
    warnings: []
  });
  await writeJson(folder, "TRIAL_FIX_BACKLOG.json", backlog);
  await writeJson(folder, "TRIAL_POST_SESSION_REPORT.json", {
    ok: true,
    mode: "trial-post-session",
    decision: "READY_FOR_NEXT_TESTER",
    blockers: []
  });
}

async function writeJson(folder, name, value) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runReview(args) {
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
