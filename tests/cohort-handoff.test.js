import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_REMEDIATION_HOST_CHECKS } from "../scripts/trial-remediation-contract.js";
import { createTestResources } from "./helpers/test-resources.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "cohort-handoff.js");

test("cohort-handoff creates expansion handoff when watch expansion is accepted", async (t) => {
  const fixture = await makeFixture(t, { decision: "EXPAND_WITH_WATCH", includeAfterLive: true });
  const result = await runHandoff([...fixture.args, "--accept-review", "--accepted-by", "host-test"]);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.decision, "COHORT_HANDOFF_EXPAND_WITH_WATCH");
  assert.equal(report.expansion.allowed, true);
  assert.equal(report.counts.afterLiveReady, 2);
  assert.ok(await exists(fixture.handoffPath));
});

test("cohort-handoff blocks watch expansion without host acceptance", async (t) => {
  const fixture = await makeFixture(t, { decision: "EXPAND_WITH_WATCH", includeAfterLive: true });
  const result = await runHandoff(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "COHORT_HANDOFF_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("Host acceptance is required")));
  assert.equal(await exists(fixture.handoffPath), false);
});

test("cohort-handoff blocks when completed testers are missing after-live evidence", async (t) => {
  const fixture = await makeFixture(t, { decision: "READY_TO_EXPAND_3_5", includeAfterLive: false });
  const result = await runHandoff(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "COHORT_HANDOFF_HOLD");
  assert.ok(report.blockers.some((item) => item.includes("tester-1: after-live evidence is missing")));
});

test("cohort-handoff marks repeated safety as review required", async (t) => {
  const fixture = await makeFixture(t, { decision: "REVIEW_REPEATED_SAFETY", includeAfterLive: true, safety: true });
  const result = await runHandoff(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.decision, "COHORT_HANDOFF_REVIEW_REQUIRED");
  assert.equal(report.expansion.allowed, false);
  assert.equal(report.safetyReviews.length, 1);
  assert.ok(await exists(fixture.handoffPath));
});

test("cohort-handoff preserves remediation history but requires two clean post-fix after-live results", async (t) => {
  const fixture = await makeFixture(t, { decision: "READY_TO_EXPAND_3_5", includeAfterLive: true });
  await fs.rm(path.join(fixture.afterLiveDir, "tester-1-20260709"), { recursive: true, force: true });
  await writeRemediation(fixture.remediationDir, "tester-1");

  const result = await runHandoff(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.decision, "COHORT_HANDOFF_HOLD");
  assert.equal(report.counts.afterLiveReady, 1);
  assert.equal(report.counts.remediatedHistorical, 1);
  assert.ok(report.warnings.some((item) => item.includes("does not count as clean after-live evidence")));
  assert.ok(report.blockers.some((item) => item.includes("two completed post-fix testers")));
  assert.ok(!report.blockers.some((item) => item.includes("tester-1: after-live evidence is missing")));
});

test("cohort-handoff does not trust remediation without all manual host checks", async (t) => {
  const fixture = await makeFixture(t, { decision: "READY_TO_EXPAND_3_5", includeAfterLive: true });
  await fs.rm(path.join(fixture.afterLiveDir, "tester-1-20260709"), { recursive: true, force: true });
  await writeRemediation(fixture.remediationDir, "tester-1", { includeHostChecks: false });

  const result = await runHandoff(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.counts.remediatedHistorical, 0);
  assert.ok(report.blockers.some((item) => item.includes("tester-1: after-live evidence is missing")));
});

async function makeFixture(t, { decision, includeAfterLive, safety = false }) {
  const { rootPath: tempRoot } = await createTestResources(t, "codeclaw-cohort-handoff-");
  const cohortPath = path.join(tempRoot, "TRIAL_COHORT_SUMMARY.json");
  const afterLiveDir = path.join(tempRoot, "trial-after-live");
  const remediationDir = path.join(tempRoot, "trial-remediation");
  const jsonPath = path.join(tempRoot, "TRIAL_COHORT_HANDOFF.json");
  const markdownPath = path.join(tempRoot, "TRIAL_COHORT_HANDOFF.md");
  const handoffPath = path.join(tempRoot, "COHORT_EXPANSION_HANDOFF.md");
  const repeatedThemes = safety ? [] : [{
    theme: "demo-real-mode",
    testerCount: 2,
    warnings: 2,
    blockers: 0,
    testers: ["tester-1", "tester-2"],
    examples: ["Both testers asked when to leave Demo."]
  }];
  const safetyRepeats = safety ? [{
    theme: "safety",
    testerCount: 2,
    warnings: 2,
    blockers: 0,
    testers: ["tester-1", "tester-2"],
    examples: ["Both testers wanted a clearer Apply stop condition."]
  }] : [];

  await writeJson(cohortPath, {
    ok: decision !== "HOLD_EXPANSION_FIX_FIRST",
    mode: "trial-cohort-summary",
    decision,
    counts: {
      testers: 2,
      completed: 2,
      repeatedThemes: repeatedThemes.length,
      safetyRepeats: safetyRepeats.length
    },
    testers: [tester("tester-1"), tester("tester-2")],
    repeatedThemes,
    safetyRepeats,
    blockers: [],
    warnings: [],
    expansionGate: {
      proceedToThreeToFive: decision === "READY_TO_EXPAND_3_5" || decision === "EXPAND_WITH_WATCH",
      requiresHostAcceptance: decision === "EXPAND_WITH_WATCH" || decision === "REVIEW_REPEATED_SAFETY"
    }
  });

  if (includeAfterLive) {
    await writeAfterLive(afterLiveDir, "tester-1");
    await writeAfterLive(afterLiveDir, "tester-2");
  }

  return {
    jsonPath,
    handoffPath,
    afterLiveDir,
    remediationDir,
    args: [
      "--cohort", path.relative(rootPath, cohortPath),
      "--after-live-dir", path.relative(rootPath, afterLiveDir),
      "--remediation-dir", path.relative(rootPath, remediationDir),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath),
      "--out", path.relative(rootPath, handoffPath)
    ]
  };
}

async function writeRemediation(remediationDir, testerId, { includeHostChecks = true } = {}) {
  const folder = path.join(remediationDir, `${testerId}-20260712`, "reports");
  const commit = "e".repeat(40);
  await writeJson(path.join(folder, "TRIAL_REMEDIATION_REPORT.json"), {
    ok: true,
    mode: "trial-remediation-gate",
    decision: "REMEDIATION_READY_FOR_RETEST",
    testerId,
    originalAfterLiveDecision: "AFTER_LIVE_BLOCKED",
    currentCommit: commit,
    worktreeClean: true,
    readinessSourceVersion: { available: true, commit, dirty: false },
    observedReports: { afterLive: { sha256: "f".repeat(64) } },
    unresolvedItems: [],
    hostAcceptance: {
      accepted: true,
      acceptedBy: "host-test",
      acceptedCommit: commit,
      originalRecordsUnchanged: true,
      hostChecks: includeHostChecks
        ? REQUIRED_REMEDIATION_HOST_CHECKS.map((id) => ({ id, status: "passed", method: "manual" }))
        : []
    },
    blockers: [],
    warnings: []
  });
}

function tester(testerId) {
  return {
    testerId,
    completed: true,
    riskLevel: "clear",
    privacyDecision: "PRIVACY_OK",
    feedbackDecision: "READY_FOR_TESTER_2",
    postSessionDecision: "READY_FOR_NEXT_TESTER",
    mustFixCount: 0,
    watchCount: 1,
    folderRelativePath: `completed/${testerId}`,
    summary: "Post-session pipeline is ready for the next tester."
  };
}

async function writeAfterLive(afterLiveDir, testerId) {
  const folder = path.join(afterLiveDir, `${testerId}-20260709`);
  await writeJson(path.join(folder, "reports", "TRIAL_AFTER_LIVE_REPORT.json"), {
    ok: true,
    mode: "trial-after-live",
    decision: "AFTER_LIVE_READY",
    testerId,
    evidencePacket: {
      packetRelativePath: path.relative(rootPath, folder).split(path.sep).join("/")
    },
    blockers: [],
    warnings: []
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runHandoff(args) {
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
