import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(rootPath, "scripts", "after-live-recovery.js");

test("after-live creates a local evidence packet without raw tester records", async (t) => {
  const fixture = await makeFixture("tester-after-live-1");
  t.after(() => fs.rm(fixture.runRoot, { recursive: true, force: true }));
  const result = await runAfterLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(report.ok, true);
  assert.match(report.decision, /^AFTER_LIVE_READY/);
  assert.ok(report.steps.some((step) => step.name === "archive:session"));
  assert.ok(await exists(path.join(fixture.packetPath, "EVIDENCE_PACKET_MANIFEST.json")));
  assert.ok(await exists(path.join(fixture.packetPath, "reports", "TRIAL_AFTER_LIVE_REPORT.json")));
  assert.ok(await exists(path.join(fixture.packetPath, "session-context", "LIVE_SESSION_HOST_SUMMARY.md")));
  assert.equal(await exists(path.join(fixture.packetPath, "session-context", "HUMAN_TRIAL_OBSERVATION.md")), false);
  assert.equal(await exists(path.join(fixture.packetPath, "session-context", "TRIAL_FEEDBACK_TEMPLATE.md")), false);
  assert.equal(await exists(path.join(fixture.packetPath, "session-context", "TRIAL_RESULT_RECORD.md")), false);
});

test("after-live stops before privacy-sensitive incomplete sessions are packaged", async (t) => {
  const fixture = await makeFixture("tester-after-live-hold");
  t.after(() => fs.rm(fixture.runRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture.sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), "# Empty\n", "utf8");

  const result = await runAfterLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));

  assert.notEqual(result.code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "AFTER_LIVE_BLOCKED");
  assert.ok(report.blockers.some((item) => item.includes("Session completion")));
  assert.equal(await exists(path.join(fixture.packetPath, "EVIDENCE_PACKET_MANIFEST.json")), false);
});

test("after-live does not treat a stale archive as success when the current review blocks", async (t) => {
  const fixture = await makeFixture("tester-after-live-stale-archive");
  t.after(() => fs.rm(fixture.runRoot, { recursive: true, force: true }));
  const staleArchivePath = path.join(fixture.reportsPath, "TRIAL_ARCHIVE_REPORT.json");
  await writeJson(staleArchivePath, {
    ok: true,
    mode: "trial-archive-session",
    createdAt: "2026-07-01T00:00:00.000Z",
    decision: "ARCHIVE_READY_LOCAL",
    testerId: "tester-from-an-earlier-run",
    sessionRelativePath: "dist/trial-session-packs/tester-from-an-earlier-run",
    archiveRelativePath: "dist/trial-archives/tester-from-an-earlier-run",
    blockers: [],
    warnings: []
  });

  const resultRecordPath = path.join(fixture.sessionPath, "TRIAL_RESULT_RECORD.md");
  const resultRecord = await fs.readFile(resultRecordPath, "utf8");
  assert.match(resultRecord, /- Decision after trial: Continue/);
  await fs.writeFile(
    resultRecordPath,
    resultRecord.replace("- Decision after trial: Continue", "- Decision after trial: Fix first"),
    "utf8"
  );

  const result = await runAfterLive(fixture.args);
  const report = JSON.parse(await fs.readFile(fixture.jsonPath, "utf8"));
  const markdown = await fs.readFile(fixture.markdownPath, "utf8");

  assert.notEqual(result.code, 0);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "AFTER_LIVE_BLOCKED");
  assert.equal(report.reports.review.decision, "REVIEW_BLOCKED");
  assert.equal(report.steps.some((step) => step.name === "archive:session"), false);
  assert.equal(report.archiveStep.status, "NOT_RUN");
  assert.equal(report.archiveStep.succeeded, false);
  assert.equal(report.archiveStep.stalePreExisting, true);
  assert.equal(report.archiveStep.observedDecision, "ARCHIVE_READY_LOCAL");
  assert.equal(report.reports.archive.decision, "ARCHIVE_NOT_RUN");
  assert.equal(report.reports.archive.currentRunSucceeded, false);
  assert.equal(report.reports.archive.stalePreExisting, true);
  assert.equal(report.reports.archive.observedDecision, "ARCHIVE_READY_LOCAL");
  assert.match(markdown, /Current run status: NOT_RUN/);
  assert.match(markdown, /Stale pre-existing report: Yes/);
  assert.ok(report.nextCommands.some((item) => item.includes("trial:remediation")));
  assert.ok(report.nextCommands.every((item) => !item.includes("trial:after-live")));
  assert.ok(report.nextSteps.some((item) => /do not rerun after-live/i.test(item)));
  assert.equal(report.evidencePacket, null);
  assert.equal(await exists(path.join(fixture.packetPath, "EVIDENCE_PACKET_MANIFEST.json")), false);
});

async function makeFixture(testerId) {
  const runRoot = path.join(rootPath, "dist", `after-live-test-${process.pid}-${Date.now()}-${testerId}`);
  const sessionPath = path.join(runRoot, "session");
  const packagePath = path.join(runRoot, "package");
  const reportsPath = path.join(runRoot, "reports");
  const packetPath = path.join(runRoot, "packet");
  const archivePath = path.join(runRoot, "archive");
  const jsonPath = path.join(runRoot, "TRIAL_AFTER_LIVE_REPORT.json");
  const markdownPath = path.join(runRoot, "TRIAL_AFTER_LIVE_REPORT.md");
  await fs.mkdir(sessionPath, { recursive: true });
  await fs.mkdir(packagePath, { recursive: true });
  await writeCompletedSession(sessionPath, testerId);
  await writeJson(path.join(reportsPath, "TRIAL_DISPATCH_NOTE.json"), {
    ok: true,
    mode: "trial-dispatch",
    decision: "READY_TO_SEND",
    packagePath,
    requiredDocs: [],
    blockers: [],
    missingPackageDocs: []
  });
  await writeJson(path.join(reportsPath, "TRIAL_LIVE_CAPTURE_REPORT.json"), {
    ok: true,
    mode: "trial-live-capture",
    decision: "LIVE_CAPTURE_READY",
    testerId,
    sessionFolder: sessionPath,
    blockers: [],
    warnings: []
  });
  return {
    runRoot,
    sessionPath,
    reportsPath,
    packetPath,
    archivePath,
    jsonPath,
    markdownPath,
    args: [
      "--session", path.relative(rootPath, sessionPath),
      "--tester", testerId,
      "--next-tester", "tester-after-live-2",
      "--reports", path.relative(rootPath, reportsPath),
      "--out", path.relative(rootPath, packetPath),
      "--archive-out", path.relative(rootPath, archivePath),
      "--json", path.relative(rootPath, jsonPath),
      "--markdown", path.relative(rootPath, markdownPath),
      "--force"
    ]
  };
}

async function writeCompletedSession(sessionPath, testerId) {
  await fs.writeFile(path.join(sessionPath, "SESSION_BRIEF.md"), `# Session Brief\n\nTester id: ${testerId}\n`, "utf8");
  await fs.writeFile(path.join(sessionPath, "HOST_RUNBOOK.md"), "# Host Runbook\n\nUse Demo, then read-only preflight.\n", "utf8");
  await fs.writeFile(path.join(sessionPath, "LIVE_SESSION_HOST_SUMMARY.md"), [
    "# CodeClaw Live Session Host Summary",
    "",
    `- Tester id: ${testerId}`,
    "- Date: 2026-07-09",
    "- Trial scope: Demo / real read-only preflight",
    "- Main friction: None",
    "- Main trust concern: None",
    "- Proceed recommendation: Continue",
    ""
  ].join("\n"), "utf8");
  await writeJson(path.join(sessionPath, "SESSION_PACK_MANIFEST.json"), {
    ok: true,
    mode: "trial-session-pack",
    testerId,
    outputPath: sessionPath,
    outputRelativePath: path.relative(rootPath, sessionPath).split(path.sep).join("/"),
    files: ["TRIAL_FEEDBACK_TEMPLATE.md", "HUMAN_TRIAL_OBSERVATION.md", "TRIAL_RESULT_RECORD.md"]
  });
  await fs.writeFile(path.join(sessionPath, "HUMAN_TRIAL_OBSERVATION.md"), recordMarkdown({
    title: "Human Trial Observation",
    fields: {
      Tester: testerId,
      "Biggest friction": "The startup flow was clear.",
      "Biggest trust concern": "None",
      "First point where host helped": "No host help was needed.",
      "Recommended product fix": "None",
      "Safe to continue to tester 2": "Yes"
    },
    rows: [
      ["Demo opened", "Pass", "Tester reached the demo flow."],
      ["Preflight understood", "Pass", "Read-only copy was understood."],
      ["Path entry understood", "Pass", "Path entry did not block the tester."],
      ["Patch gate trusted", "Pass", "Tester stopped before apply."],
      ["No writes occurred", "Pass", "Host confirmed no writes."],
      ["Feedback captured", "Pass", "Feedback was completed."]
    ]
  }), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_FEEDBACK_TEMPLATE.md"), recordMarkdown({
    title: "Trial Feedback Template",
    fields: {
      Name: testerId,
      "Observed live": "Yes",
      Goal: "Try Demo and read-only preflight.",
      "Would you use CodeClaw again on a real project?": "Yes",
      "Would you try one disposable patch next?": "Yes",
      "Most useful part": "The visible safety gates.",
      "Most confusing part": "None",
      "Should this build go to tester 2?": "Yes"
    },
    rows: [
      ["Launcher opened", "Pass", "No startup issue."],
      ["Demo understood", "Pass", "Demo was easy to find."],
      ["Read-only clear", "Pass", "Tester understood no writes."],
      ["Context relevant", "Pass", "Files looked relevant."],
      ["Apply boundary clear", "Pass", "Tester knew apply writes."],
      ["Verify boundary clear", "Pass", "Tester knew verify runs commands."],
      ["Trust level", "Pass", "Tester trusted the gates."],
      ["Feedback completed", "Pass", "Record completed."]
    ]
  }), "utf8");
  await fs.writeFile(path.join(sessionPath, "TRIAL_RESULT_RECORD.md"), recordMarkdown({
    title: "Trial Result Record",
    fields: {
      Host: "codeclaw-host",
      "Decision after trial": "Continue",
      "First stuck moment": "None",
      "Host intervention needed": "No",
      Severity: "Low",
      "Strongest trust-building moment": "Read-only preflight copy.",
      "Strongest trust concern": "None",
      "Proceed to tester 2": "Yes",
      "Required fix before tester 2": "None"
    },
    rows: [
      ["Launch outcome", "Pass", "Launcher worked."],
      ["Demo outcome", "Pass", "Demo completed."],
      ["Real preflight outcome", "Pass", "Read-only preflight completed."],
      ["Safety outcome", "Pass", "No unexpected write occurred."],
      ["Feedback outcome", "Pass", "Records are complete."],
      ["Go or no-go", "Pass", "Proceed to tester 2."]
    ]
  }), "utf8");
}

function recordMarkdown({ title, fields, rows }) {
  return [
    `# ${title}`,
    "",
    ...Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Checklist",
    "",
    "| Check | Result | Notes |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} |`),
    "",
    "## Issues",
    "",
    "1. None.",
    ""
  ].join("\n");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runAfterLive(args) {
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
