import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const testsPath = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.resolve(testsPath, "..");
const scriptPath = path.join(rootPath, "scripts", "trial-remediation-gate.js");

test("remediation gate closes a synthetic blocked session without rewriting its decision", async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await runGate(fixture.root);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);

  const report = await readJson(path.join(fixture.root, "dist", "TRIAL_REMEDIATION_REPORT.json"));
  assert.equal(report.decision, "REMEDIATION_READY_FOR_RETEST");
  assert.equal(report.ok, true);
  assert.equal(report.originalAfterLiveDecision, "AFTER_LIVE_BLOCKED");
  assert.equal(report.fixCommit, fixture.commit);
  assert.equal(report.currentCommit, fixture.commit);
  assert.equal(report.readinessSourceVersion.commit, fixture.commit);
  assert.equal(report.resolvedItems.length, 1);
  assert.equal(report.unresolvedItems.length, 0);
  assert.equal(report.resolvedItems[0].sourceRef, "backlog:p0-001");
  assert.equal(report.hostAcceptance.acceptedCommit, fixture.commit);
  assert.equal(report.privacy.sourceReportsModified, false);

  const preserved = await readJson(path.join(fixture.root, "dist", "TRIAL_AFTER_LIVE_REPORT.json"));
  assert.equal(preserved.decision, "AFTER_LIVE_BLOCKED");

  const evidenceReport = path.join(fixture.root, report.evidenceCopy.relativePath, "reports", "TRIAL_REMEDIATION_REPORT.json");
  assert.equal((await readJson(evidenceReport)).decision, "REMEDIATION_READY_FOR_RETEST");

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /RAW_TESTER_QUOTE_DO_NOT_COPY/);
  assert.doesNotMatch(serialized, /PRIVATE_TESTER_NOTE_DO_NOT_COPY/);
  assert.ok(!serialized.includes(fixture.root), "report must not copy the fixture's absolute path");
});

test("remediation gate supports an explicitly accepted review result", async (t) => {
  const fixture = await makeFixture({ privacyReview: true, watchItems: true, acceptanceWithReview: true });
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await runGate(fixture.root, ["--no-evidence-copy"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = await readJson(path.join(fixture.root, "dist", "TRIAL_REMEDIATION_REPORT.json"));
  assert.equal(report.decision, "REMEDIATION_READY_WITH_REVIEW");
  assert.ok(report.warnings.some((item) => item.code === "PRIVACY_REVIEW"));
  assert.ok(report.warnings.some((item) => item.code === "ORIGINAL_WATCH_ITEMS_RETAINED"));
  assert.equal(report.hostAcceptance.acceptedWarnings, true);
});

test("remediation gate holds privacy, consent, stop, mapping, verification, and stale readiness failures", async (t) => {
  const fixture = await makeFixture({
    privacyHold: true,
    intakeConsent: false,
    structuredStop: true,
    missingMapping: true,
    verificationFailed: true,
    staleReadiness: true
  });
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await runGate(fixture.root, ["--no-evidence-copy"]);
  assert.equal(result.exitCode, 1);
  const report = await readJson(path.join(fixture.root, "dist", "TRIAL_REMEDIATION_REPORT.json"));
  assert.equal(report.decision, "REMEDIATION_HOLD");
  assert.equal(report.ok, false);

  const codes = new Set(report.blockers.map((item) => item.code));
  for (const expected of [
    "PRIVACY_HOLD",
    "INTAKE_CONSENT_MISSING",
    "ORIGINAL_STOP_RECORDED",
    "UNMAPPED_BLOCKER",
    "READINESS_COMMIT_STALE",
    "FIX_NOT_VERIFIED"
  ]) {
    assert.ok(codes.has(expected), `missing blocker code ${expected}`);
  }
  assert.equal(report.unresolvedItems.length, 1);
  assert.equal(report.unresolvedItems[0].reasonCode, "UNMAPPED_BLOCKER");
});

test("remediation gate requires a mapping for a non-derived after-live failure", async (t) => {
  const fixture = await makeFixture({ afterLiveTechnical: true });
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await runGate(fixture.root, ["--no-evidence-copy"]);
  assert.equal(result.exitCode, 1);
  const report = await readJson(path.join(fixture.root, "dist", "TRIAL_REMEDIATION_REPORT.json"));
  assert.equal(report.decision, "REMEDIATION_HOLD");
  assert.ok(report.unresolvedItems.some((item) => item.origin === "after-live" && item.reasonCode === "UNMAPPED_BLOCKER"));
});

test("remediation gate never substitutes automation for a required host check", async (t) => {
  const fixture = await makeFixture({ missingHostCheck: true });
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await runGate(fixture.root, ["--no-evidence-copy"]);
  assert.equal(result.exitCode, 1);
  const report = await readJson(path.join(fixture.root, "dist", "TRIAL_REMEDIATION_REPORT.json"));
  assert.equal(report.decision, "REMEDIATION_HOLD");
  assert.ok(report.blockers.some((item) => item.code === "HOST_CHECK_MISSING"));
});

async function makeFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeclaw-remediation-"));
  await fs.writeFile(path.join(root, ".gitignore"), "dist/\n", "utf8");
  await fs.writeFile(path.join(root, "seed.txt"), "synthetic fixture\n", "utf8");
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["config", "user.name", "CodeClaw Fixture"]);
  await git(root, ["add", ".gitignore", "seed.txt"]);
  await git(root, ["commit", "--quiet", "-m", "synthetic fixture"]);
  const commit = (await git(root, ["rev-parse", "HEAD"])).trim();

  const reports = path.join(root, "dist");
  const session = path.join(reports, "trial-session-packs", "tester-fixture");
  const packagePath = path.join(reports, "CodeClaw-local-trial-fixture");
  await fs.mkdir(session, { recursive: true });
  await fs.mkdir(packagePath, { recursive: true });

  const readinessAt = new Date(Date.now() + 1_000).toISOString();
  const acceptanceAt = new Date(Date.now() + 2_000).toISOString();
  const sourceFile = path.join(session, "TRIAL_FEEDBACK_TEMPLATE.md");
  const sourceRef = "trial-session-packs/tester-fixture/TRIAL_FEEDBACK_TEMPLATE.md:70";

  await writeJson(path.join(reports, "TRIAL_AFTER_LIVE_REPORT.json"), {
    ok: false,
    mode: "trial-after-live",
    createdAt: "2026-07-12T01:00:00.000Z",
    testerId: "tester-fixture",
    decision: "AFTER_LIVE_BLOCKED",
    sessionRelativePath: "dist/trial-session-packs/tester-fixture",
    blockers: [
      "TRIAL_REVIEW_REPORT is not ok.",
      ...(options.afterLiveTechnical ? ["Synthetic archive pipeline failure."] : [])
    ],
    warnings: []
  });
  await writeJson(path.join(reports, "TRIAL_REVIEW_REPORT.json"), {
    ok: false,
    mode: "trial-review-session",
    testerId: "tester-fixture",
    decision: "REVIEW_BLOCKED",
    actionItems: [{
      id: "P0-001",
      priority: "P0",
      title: "Synthetic patch gate",
      evidence: "RAW_TESTER_QUOTE_DO_NOT_COPY",
      sources: [sourceRef]
    }],
    blockers: ["Preserved review blocker."],
    warnings: options.watchItems ? ["Preserved watch entry."] : []
  });
  await writeJson(path.join(reports, "TRIAL_PRIVACY_REPORT.json"), {
    ok: !options.privacyHold,
    mode: "trial-privacy-check",
    decision: options.privacyHold ? "PRIVACY_HOLD" : options.privacyReview ? "PRIVACY_REVIEW" : "PRIVACY_OK",
    blockers: options.privacyHold ? ["PRIVATE_TESTER_NOTE_DO_NOT_COPY"] : [],
    warnings: options.privacyReview ? ["PRIVATE_TESTER_NOTE_DO_NOT_COPY"] : []
  });
  await writeJson(path.join(reports, "TRIAL_FEEDBACK_SUMMARY.json"), {
    ok: true,
    mode: "trial-feedback-ingest",
    decision: "NO_GO_FIX_FIRST",
    decisionSignals: [{ label: "Decision after trial", result: options.structuredStop ? "Stop" : "Fix first" }],
    blockers: [{
      file: sourceFile,
      line: 70,
      label: "Synthetic patch gate",
      result: "Fail",
      notes: "RAW_TESTER_QUOTE_DO_NOT_COPY",
      category: "language"
    }],
    warnings: []
  });
  await writeJson(path.join(reports, "TRIAL_FIX_BACKLOG.json"), {
    ok: true,
    mode: "trial-fix-backlog",
    decision: "FIX_BLOCKERS_BEFORE_TESTER_2",
    mustFixBeforeTester2: [{
      id: "P0-001",
      priority: "P0",
      lane: "must-fix",
      title: "Synthetic patch gate",
      evidence: "RAW_TESTER_QUOTE_DO_NOT_COPY",
      sources: [sourceRef]
    }],
    watchDuringTester2: options.watchItems ? [{ id: "P1-001" }] : []
  });
  await writeJson(path.join(reports, "TRIAL_SESSION_COMPLETION_REPORT.json"), {
    ok: true,
    mode: "trial-session-completion",
    decision: "SESSION_COMPLETION_READY",
    blockers: [],
    warnings: []
  });
  await writeJson(path.join(reports, "TRIAL_READINESS_REPORT.json"), {
    ok: true,
    mode: "trial-readiness",
    createdAt: readinessAt,
    sourceRoot: root,
    sourceVersion: { available: true, commit: options.staleReadiness ? "0".repeat(40) : commit, dirty: false },
    packagePath,
    checks: [{ name: "fixture:test", exitCode: 0 }],
    hygiene: { missingRequired: [], disallowed: [], files: 1 }
  });
  await writeJson(path.join(session, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId: "tester-fixture",
    testerIntake: {
      consent: options.intakeConsent !== false,
      privacyAccepted: true
    }
  });
  await writeJson(path.join(reports, "TRIAL_REMEDIATION_CHECKLIST.json"), {
    mode: "trial-remediation-checklist",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    testerId: "tester-fixture",
    originalAfterLiveDecision: "AFTER_LIVE_BLOCKED",
    fixCommit: commit,
    items: [{
      id: "FIX-001",
      sourceRefs: options.missingMapping ? [] : ["backlog:p0-001"],
      status: "fixed",
      verification: {
        status: options.verificationFailed ? "failed" : "passed",
        verifiedCommit: commit,
        checkedAt: new Date().toISOString(),
        evidence: [{ kind: "test", reference: "synthetic:test", passed: !options.verificationFailed }]
      }
    }]
  });
  await writeJson(path.join(reports, "TRIAL_REMEDIATION_ACCEPTANCE.json"), {
    mode: "trial-remediation-acceptance",
    schemaVersion: 1,
    testerId: "tester-fixture",
    decision: options.acceptanceWithReview ? "ACCEPTED_WITH_REVIEW" : "ACCEPTED",
    acceptedBy: "host-fixture",
    acceptedAt: acceptanceAt,
    fixCommit: commit,
    acceptedCommit: commit,
    originalRecordsUnchanged: true,
    hostChecks: hostChecks(options.missingHostCheck, acceptanceAt),
    reviewedFixIds: ["fix-001"],
    acceptedWarnings: Boolean(options.acceptanceWithReview)
  });
  return { root, commit };
}

function hostChecks(missingOne = false, checkedAt = new Date().toISOString()) {
  const ids = [
    "desktop-sticky-navigation",
    "narrow-layout",
    "saved-session-choice",
    "chinese-demo-patch",
    "preflight-read-only-explanation",
    "apply-verify-boundaries",
    "demo-apply-verify-revert"
  ];
  return (missingOne ? ids.slice(1) : ids).map((id) => ({
    id,
    status: "passed",
    method: "manual",
    checkedAt
  }));
}

async function runGate(root, extraArgs = []) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, "--root", root, ...extraArgs], {
      cwd: rootPath,
      windowsHide: true
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: error.code, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

async function git(root, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root, windowsHide: true });
  return stdout;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
